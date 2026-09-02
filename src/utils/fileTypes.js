/**
 * Detección del tipo real de un archivo por sus *magic bytes*.
 *
 * POR QUÉ NO SE CONFÍA EN EL `Content-Type` NI EN LA EXTENSIÓN (spec §6.5): los
 * dos los controla quien sube el archivo. Un `.pdf` con `Content-Type:
 * application/pdf` puede ser un ejecutable, y el equipo de RH abre estos
 * archivos todos los días.
 *
 * ─── Qué se acepta y por qué (D-78) ─────────────────────────────────────────
 *
 * Antes sólo PDF y las imágenes que cualquier navegador puede abrir, para que
 * nadie guardara un documento que la mitad del equipo no pudiera ver. En la
 * práctica el criterio estorbaba: los registros de obra, los avisos de SIROC y
 * los contratos llegan en Word y en Excel, y obligar a convertirlos a PDF hacía
 * que se quedaran fuera del sistema. Desde D-78 se aceptan **DOC, DOCX, XLS,
 * XLSX y CSV** además de PDF, JPG, PNG y WEBP, en TODO el backend —también en
 * los documentos del expediente—.
 *
 * Lo que resuelve el problema original es `previsualizable`: los tipos de
 * Office **no se abren en el navegador**, así que su URL firmada se emite como
 * `attachment` y el contrato lleva la bandera para que la interfaz ofrezca
 * descargar en vez de un visor en blanco.
 *
 * HEIC sigue fuera a propósito, aunque sea lo que produce un iPhone: Chrome no
 * lo muestra y no hay nada que descargar que sirva. El mensaje de error lo dice.
 */

/** `WordDocument` y `Workbook`, como los guarda un OLE2: UTF-16LE. */
const utf16 = (texto) => Buffer.from(texto, 'utf16le')

/** Firma de contenedor OLE2 (los formatos de Office anteriores a 2007). */
const FIRMA_OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
/** `PK\x03\x04` — un DOCX o un XLSX es un ZIP. */
const FIRMA_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04])

const esOle2 = (b) => b.length > 8 && b.subarray(0, 8).equals(FIRMA_OLE2)
const esZip = (b) => b.length > 4 && b.subarray(0, 4).equals(FIRMA_ZIP)

/**
 * ¿El ZIP trae esta ruta dentro?
 *
 * Los nombres de las entradas viajan **sin comprimir** en las cabeceras locales
 * y en el directorio central, así que buscarlos en el buffer distingue un DOCX
 * de un XLSX —y a los dos de un `.zip` cualquiera— sin descomprimir nada.
 */
const zipContiene = (b, ruta) => b.includes(Buffer.from(ruta, 'latin1'))

const FIRMAS = Object.freeze([
  {
    mime: 'application/pdf',
    extension: 'pdf',
    etiqueta: 'PDF',
    previsualizable: true,
    // "%PDF"
    coincide: (b) => b.length > 4 && b.subarray(0, 4).toString('latin1') === '%PDF'
  },
  {
    mime: 'image/jpeg',
    extension: 'jpg',
    etiqueta: 'JPG',
    previsualizable: true,
    coincide: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  },
  {
    mime: 'image/png',
    extension: 'png',
    etiqueta: 'PNG',
    previsualizable: true,
    coincide: (b) =>
      b.length > 8 &&
      b
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  },
  {
    mime: 'image/webp',
    extension: 'webp',
    etiqueta: 'WEBP',
    previsualizable: true,
    coincide: (b) =>
      b.length > 12 &&
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP'
  },
  {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extension: 'docx',
    etiqueta: 'DOCX',
    previsualizable: false,
    coincide: (b) => esZip(b) && zipContiene(b, 'word/document.xml')
  },
  {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx',
    etiqueta: 'XLSX',
    previsualizable: false,
    coincide: (b) => esZip(b) && zipContiene(b, 'xl/workbook.xml')
  },
  {
    mime: 'application/msword',
    extension: 'doc',
    etiqueta: 'DOC',
    previsualizable: false,
    /*
     * OLE2 es el contenedor de DOC, XLS y PPT por igual, así que la firma sola
     * no basta: se busca el nombre del flujo interno, que también viaja en
     * claro. La extensión sólo desempata cuando el flujo no aparece.
     */
    coincide: (b, { extensionDeclarada } = {}) =>
      esOle2(b) &&
      (b.includes(utf16('WordDocument')) ||
        (!b.includes(utf16('Workbook')) && extensionDeclarada === 'doc'))
  },
  {
    mime: 'application/vnd.ms-excel',
    extension: 'xls',
    etiqueta: 'XLS',
    previsualizable: false,
    coincide: (b, { extensionDeclarada } = {}) =>
      esOle2(b) &&
      (b.includes(utf16('Workbook')) ||
        (!b.includes(utf16('WordDocument')) && extensionDeclarada === 'xls'))
  },
  {
    mime: 'text/csv',
    extension: 'csv',
    etiqueta: 'CSV',
    previsualizable: false,
    /*
     * **El único que depende de la extensión**, y no hay forma de evitarlo: un
     * CSV es texto plano y no tiene firma que lo distinga de cualquier otro
     * texto. Se exige `.csv` declarado Y que el contenido sea texto de verdad,
     * y como no se previsualiza, el navegador nunca lo interpreta: lo descarga.
     */
    coincide: (b, { extensionDeclarada } = {}) =>
      extensionDeclarada === 'csv' && pareceTexto(b)
  }
])

/** Tipos que sí se aceptan, para el mensaje de error. */
const TIPOS_PERMITIDOS = Object.freeze(FIRMAS.map((f) => f.etiqueta))

/** Los que el navegador abre sin descargar. */
const TIPOS_PREVISUALIZABLES = Object.freeze(
  FIRMAS.filter((f) => f.previsualizable).map((f) => f.mime)
)

/**
 * ¿Esto es texto y no un binario disfrazado?
 *
 * Sin bytes de control (salvo tabulador, salto de línea y retorno) y decodifica
 * como UTF-8. Es lo que se le puede pedir a un formato que no tiene firma.
 */
function pareceTexto(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false

  // Sólo el principio: un CSV de nómina puede pesar megas y basta con la
  // muestra para saber si es texto.
  const muestra = buffer.subarray(0, 8192)
  for (const byte of muestra) {
    if (byte === 0x09 || byte === 0x0a || byte === 0x0d) continue
    if (byte < 0x20 || byte === 0x7f) return false
  }

  const texto = muestra.toString('utf8')
  // El carácter de reemplazo aparece cuando la decodificación falló. Se tolera
  // al final, donde la muestra pudo cortar un carácter multibyte a la mitad.
  return !texto.slice(0, -4).includes('�')
}

/** `contrato final.DOCX` → `docx`. Nunca decide sola: sólo desempata. */
function extensionDe(nombreArchivo) {
  if (typeof nombreArchivo !== 'string') return null
  const punto = nombreArchivo.lastIndexOf('.')
  if (punto < 0 || punto === nombreArchivo.length - 1) return null
  return nombreArchivo.slice(punto + 1).toLowerCase()
}

/**
 * @param {Buffer} buffer
 * @param {object|string} [opciones] el nombre original del archivo, o
 *   `{ nombreArchivo }`. Se usa **sólo para desempatar** entre formatos que
 *   comparten contenedor (DOC/XLS) y para el CSV, que no tiene firma.
 * @returns {{mime: string, extension: string, etiqueta: string,
 *   previsualizable: boolean}|null} null si el contenido no corresponde a
 *   ningún tipo permitido.
 */
function detectarTipo(buffer, opciones = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null

  const nombreArchivo = typeof opciones === 'string' ? opciones : opciones.nombreArchivo
  const contexto = { extensionDeclarada: extensionDe(nombreArchivo) }

  const firma = FIRMAS.find((f) => f.coincide(buffer, contexto))
  if (!firma) return null

  return {
    mime: firma.mime,
    extension: firma.extension,
    etiqueta: firma.etiqueta,
    previsualizable: firma.previsualizable
  }
}

/**
 * ¿Este mime se puede abrir en el navegador?
 *
 * Lo que NO se previsualiza se sirve siempre como descarga: un DOCX abierto
 * `inline` es una pantalla de basura binaria, o una descarga con nombre feo.
 */
function esPrevisualizable(mime) {
  return TIPOS_PREVISUALIZABLES.includes(mime)
}

/** La extensión que le toca a un mime guardado. `bin` si no se reconoce. */
function extensionDeMime(mime) {
  return FIRMAS.find((f) => f.mime === mime)?.extension || 'bin'
}

/**
 * El mensaje de `415`, en un solo lugar: son nueve tipos y enumerarlos a mano
 * en cada servicio garantizaba que una lista se quedara vieja.
 */
function mensajeTipoNoPermitido(buffer) {
  const pista = pareceHeic(buffer)
    ? ' Las fotos de iPhone (HEIC) no se pueden abrir en todos los navegadores: conviértela a JPG o PDF.'
    : ''
  return `El archivo no es de un tipo permitido (${TIPOS_PERMITIDOS.join(', ')}).${pista}`
}

/** ¿El contenido parece una imagen HEIC/HEIF de iPhone? Para avisar mejor. */
function pareceHeic(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false
  if (buffer.subarray(4, 8).toString('latin1') !== 'ftyp') return false
  const marca = buffer.subarray(8, 12).toString('latin1')
  return ['heic', 'heix', 'hevc', 'mif1', 'heif'].includes(marca)
}

module.exports = {
  detectarTipo,
  esPrevisualizable,
  extensionDeMime,
  mensajeTipoNoPermitido,
  pareceHeic,
  pareceTexto,
  extensionDe,
  TIPOS_PERMITIDOS,
  TIPOS_PREVISUALIZABLES,
  FIRMAS
}
