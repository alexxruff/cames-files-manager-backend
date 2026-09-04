const { randomUUID } = require('node:crypto')
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
const env = require('../config/env')
const logger = require('../utils/logger')
const { attachmentToJson, nombreDeDescarga } = require('../utils/attachments')

/**
 * Almacenamiento de los documentos del expediente (backend-spec §7).
 *
 * Toma la estructura del `r2Service` de `talentlink-backend` —mismo cliente S3
 * contra Cloudflare R2, mismas URLs firmadas— con cuatro cambios:
 *
 * 1. La configuración sale de `config/env`, validada al arrancar, en vez de
 *    leerse de `process.env` en cada llamada.
 * 2. La convención de claves es la del spec y **no incluye el nombre original**
 *    del archivo: un nombre controlado por el usuario dentro de una ruta es un
 *    riesgo de path traversal. El nombre va en `archivo.nombre`, para mostrar.
 * 3. Un driver **`memoria`** para desarrollar y probar sin credenciales de R2.
 *    En producción es `r2`; con `memoria` los archivos se pierden al reiniciar.
 * 4. El bucket es distinto al de talentlink: son datos personales de otra
 *    empresa y no comparten almacenamiento.
 *
 * El bucket es **privado**: nunca se expone una URL pública. Cada apertura pasa
 * por `urlDeDescarga`, que firma por 10 minutos.
 */

const enMemoria = new Map()
let clienteS3 = null

function driver() {
  // Sin credenciales no se puede hablar con R2: se cae a memoria en vez de
  // fallar en la primera subida. `advertirSiNoHayBucket` es lo que hace que eso
  // no pase en silencio.
  if (env.STORAGE_DRIVER === 'r2' && !estaConfigurado()) return 'memoria'
  return env.STORAGE_DRIVER
}

/**
 * Se llama al arrancar. Un backend de expedientes guardando en memoria pierde
 * los archivos al reiniciar, así que el caso «pedí R2 y no hay credenciales»
 * tiene que gritar: es un error de configuración, no un modo de operación.
 */
function advertirSiNoHayBucket() {
  const efectivo = driver()

  if (env.STORAGE_DRIVER === 'r2' && efectivo === 'memoria') {
    logger.warn(
      'ATENCIÓN: faltan credenciales de R2. Los documentos se guardan EN MEMORIA ' +
        'y se PIERDEN al reiniciar. Configura R2_ACCOUNT_ID, R2_BUCKET, ' +
        'R2_ACCESS_KEY_ID y R2_SECRET_ACCESS_KEY, o pon STORAGE_DRIVER=memoria ' +
        'si es a propósito.',
      { driverPedido: env.STORAGE_DRIVER, driverEfectivo: efectivo }
    )
    return
  }

  logger.info('Almacenamiento de documentos listo', {
    driver: efectivo,
    bucket: efectivo === 'r2' ? env.R2_BUCKET : null
  })
}

function estaConfigurado() {
  return Boolean(
    env.R2_ACCOUNT_ID && env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY
  )
}

function cliente() {
  if (!clienteS3) {
    clienteS3 = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY
      }
    })
  }
  return clienteS3
}

/**
 * Clave de almacenamiento (spec §7):
 * `expedientes/{empleadoId}/{tipoDocumento}/v{version}-{uuid}.{ext}`
 *
 * Hace obvio a quién pertenece cada archivo y permite borrar todo lo de una
 * persona con un prefijo. El `uuid` evita colisiones si se reintenta una subida.
 */
function construirClave({ empleadoId, tipo, version, extension }) {
  const ext = String(extension || 'bin')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
  const ruta = `expedientes/${empleadoId}/${tipo}/v${version}-${randomUUID()}.${ext}`
  // `R2_PREFIX` es la carpeta dentro del bucket cuando el bucket se comparte
  // con otro proyecto. La clave que se guarda en la base ya la incluye, así que
  // los archivos viejos siguen encontrándose si el prefijo cambia después.
  return env.R2_PREFIX ? `${env.R2_PREFIX}/${ruta}` : ruta
}

/**
 * Clave de un **adjunto administrativo** (D-79): el archivo que respalda un dato
 * del catálogo, no un documento del expediente.
 *
 * `{carpeta}/{ids...}-{uuid}.{ext}` — por ejemplo
 * `registros-obra/{clienteId}/{registroId}-{uuid}.pdf`. Misma convención que
 * `construirClave`: el nombre que puso el usuario **no** entra en la ruta (path
 * traversal), y el `uuid` hace que reemplazar el archivo nunca pise al anterior
 * mientras se sube.
 */
function construirClaveAdjunto({ carpeta, ids = [], extension }) {
  const ext = String(extension || 'bin')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
  const tramos = ids.map((id) => String(id).replace(/[^a-z0-9]/gi, ''))
  const ultimo = tramos.pop()
  const ruta = [carpeta, ...tramos, `${ultimo}-${randomUUID()}.${ext}`].join('/')

  return env.R2_PREFIX ? `${env.R2_PREFIX}/${ruta}` : ruta
}

/** Sube el contenido y devuelve la clave con la que quedó guardado. */
async function subir({ buffer, clave, contentType }) {
  if (!buffer || !clave) {
    throw new Error('subir: buffer y clave son requeridos')
  }

  if (driver() === 'memoria') {
    enMemoria.set(clave, { buffer, contentType })
    logger.debug('Documento guardado en memoria', { clave, bytes: buffer.length })
    return clave
  }

  await cliente().send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: clave,
      Body: buffer,
      ContentType: contentType
    })
  )
  logger.info('Documento subido a R2', { clave, bytes: buffer.length })
  return clave
}

/**
 * URL firmada de corta vida para abrir el archivo.
 *
 * @param {string} clave
 * @param {object} [opciones]
 * @param {string} [opciones.nombreArchivo] Nombre con el que se descarga.
 * @param {number} [opciones.ttlSegundos]
 * @param {boolean} [opciones.descargar] `attachment` en vez de `inline`.
 */
async function urlDeDescarga(clave, opciones = {}) {
  if (!clave) return null
  const ttlSegundos = opciones.ttlSegundos || env.R2_SIGNED_URL_TTL

  if (driver() === 'memoria') {
    // Sin R2 no hay nada que firmar. Se devuelve una URL simulada para que el
    // flujo se pueda ejercitar en desarrollo y en pruebas.
    return `memoria://${clave}?expiraEn=${ttlSegundos}`
  }

  const disposicion = opciones.nombreArchivo
    ? `${opciones.descargar ? 'attachment' : 'inline'}; filename="${encodeURIComponent(opciones.nombreArchivo)}"`
    : undefined

  return getSignedUrl(
    cliente(),
    new GetObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: clave,
      ResponseContentDisposition: disposicion
    }),
    { expiresIn: ttlSegundos }
  )
}

/**
 * El adjunto como lo ve el front, con su URL firmada (D-79).
 *
 * `null` si no hay archivo, para que quien lo pinte no tenga que distinguir
 * entre «no hay» y «no se pudo». Lo que **no se previsualiza** se firma siempre
 * como descarga: un DOCX servido `inline` es una pantalla de basura binaria.
 *
 * @param {object} archivo el subdocumento guardado
 * @param {string} nombreBase con qué nombre se descarga — el del DATO (D-78)
 * @param {object} [opciones]
 * @param {?boolean} [opciones.descargar] fuerza `attachment`; por omisión se
 *   decide con `previsualizable`.
 */
async function firmarAdjunto(archivo, nombreBase, { descargar = null } = {}) {
  const publico = attachmentToJson(archivo)
  if (!publico) return null

  const nombreArchivo = nombreDeDescarga(nombreBase, publico.mime)

  return {
    ...publico,
    nombreDescarga: nombreArchivo,
    url: await urlDeDescarga(archivo.claveAlmacenamiento, {
      nombreArchivo,
      // Lo que no se previsualiza se descarga siempre; lo demás, si lo piden.
      descargar: descargar ?? !publico.previsualizable
    })
  }
}

/**
 * Lo que devuelve `findRegistry`, con la URL firmada de su archivo.
 *
 * Necesita el arreglo original porque la clave de almacenamiento no viaja en la
 * forma pública —ni debe—, así que hay que volver al subdocumento para firmarla.
 */
async function firmarRegistro(registro, registrosOriginales) {
  if (!registro?.archivo) return registro

  const original = (registrosOriginales || []).find((r) => String(r._id) === registro._id)
  if (!original?.archivo) return registro

  return { ...registro, archivo: await firmarAdjunto(original.archivo, registro.numero) }
}

/**
 * El SIROC como sale al front, con el archivo del aviso y el de cada renovación
 * ya firmados (D-80).
 *
 * Recibe la forma pública —la que produjo el `toJSON`, que nunca trae la clave—
 * y el subdocumento original, que es donde vive. Las renovaciones se cruzan por
 * **posición**: no tienen `_id` (D-76) y el arreglo va en orden.
 *
 * El nombre de descarga es el del DATO (D-78): el aviso baja como el número del
 * SIROC y cada acuse como `<número>-actualizacion-<fecha>`, para que en la
 * carpeta de descargas se distingan solos.
 */
async function firmarSiroc(siroc, sirocOriginal) {
  if (!siroc) return siroc

  const actualizaciones = await Promise.all(
    (siroc.actualizaciones ?? []).map(async (a, indice) => ({
      ...a,
      archivo: await firmarAdjunto(
        sirocOriginal?.actualizaciones?.[indice]?.archivo,
        nombreDeReporteBimestral(siroc.numero, a.fecha)
      )
    }))
  )

  return {
    ...siroc,
    actualizaciones,
    archivo: await firmarAdjunto(sirocOriginal?.archivo, siroc.numero)
  }
}

/**
 * La línea del tiempo del contrato con el papel de cada entrada firmado (D-90).
 *
 * Igual que `firmarSiroc`, y por lo mismo: la forma pública nunca trae la clave
 * de almacenamiento, así que hay que volver al documento para firmarla. El papel
 * del original es el del contrato —no se copia a ninguna parte—; el de cada
 * modificación es el suyo, y se cruza por **posición**.
 */
async function firmarHistoria(historia, contratoOriginal) {
  if (!historia?.modificado) return historia

  const entradas = await Promise.all(
    (historia.entradas ?? []).map(async (entrada) => {
      const esOriginal = entrada.tipo === 'original'
      return {
        ...entrada,
        archivo: await firmarAdjunto(
          esOriginal
            ? contratoOriginal?.archivo
            : contratoOriginal?.modificaciones?.[entrada.indice]?.archivo,
          esOriginal
            ? nombreDeContrato(contratoOriginal)
            : nombreDeModificacion(contratoOriginal, entrada)
        )
      }
    })
  )

  return { ...historia, entradas }
}

/**
 * Con qué nombre baja el convenio modificatorio: el del contrato y la fecha en
 * que se acordó, para que dos modificaciones no caigan con el mismo nombre en la
 * carpeta de descargas.
 */
function nombreDeModificacion(contrato, modificacion) {
  return `${nombreDeContrato(contrato)}-modificacion-${modificacion?.fechaAcuerdo ?? ''}`
}

/** Con qué nombre baja el acuse de un reporte bimestral. */
function nombreDeReporteBimestral(numero, fecha) {
  return `${numero}-reporte-bimestral-${fecha}`
}

/**
 * Con qué nombre baja el contrato escaneado (D-81).
 *
 * El del DATO, como todo lo demás (D-78), pero aquí el dato no es un número:
 * `nombre` y `fase` son los dos opcionales (D-75), así que se cae al que haya y,
 * si no hay ninguno, al ordinal —que siempre existe—.
 */
function nombreDeContrato(contrato) {
  return contrato?.nombre || contrato?.fase || `Contrato ${contrato?.numero ?? ''}`.trim()
}

/**
 * Borra un objeto. **Las versiones de un documento no se borran** (el versionado
 * es el requisito de trazabilidad): esto existe para limpiar una subida que
 * falló a medias, no para el flujo normal.
 */
/**
 * Clave temporal de una subida directa (D-83): `pendientes/{subidaId}`.
 *
 * Todo lo que sube el navegador aterriza aquí y **sólo se mueve a su carpeta
 * definitiva cuando se confirma**, con el tipo ya comprobado por contenido. Dos
 * cosas se ganan con eso: las carpetas de verdad no ven nunca un archivo sin
 * validar, y la basura de las subidas que nadie confirma queda toda bajo un
 * prefijo, que es lo que una regla de ciclo de vida sabe barrer sola.
 *
 * Sin extensión a propósito: el tipo real todavía no se conoce.
 */
function construirClaveTemporal(subidaId) {
  const ruta = `pendientes/${String(subidaId).replace(/[^a-z0-9]/gi, '')}`
  return env.R2_PREFIX ? `${env.R2_PREFIX}/${ruta}` : ruta
}

/**
 * URL firmada para que **el navegador suba directo** al almacenamiento (D-83).
 *
 * `contentLength` va **firmado**: la petición que no mande exactamente ese
 * tamaño no valida la firma, así que el tope deja de depender de que el cliente
 * se porte bien. Es lo que sustituye al límite de multer cuando el archivo ya no
 * pasa por aquí.
 */
async function urlDeSubida(clave, { contentType, contentLength, ttlSegundos } = {}) {
  const expiresIn = ttlSegundos || env.R2_UPLOAD_URL_TTL

  if (driver() === 'memoria') {
    // Sin R2 no hay nada que firmar. La URL simulada permite ejercitar el flujo
    // en desarrollo y en pruebas, donde el objeto se coloca con `subir`.
    return `memoria://${clave}?subida=1&expiraEn=${expiresIn}`
  }

  return getSignedUrl(
    cliente(),
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: clave,
      ContentType: contentType,
      ContentLength: contentLength
    }),
    { expiresIn, signableHeaders: new Set(['content-length', 'content-type']) }
  )
}

/**
 * Qué hay guardado bajo esa clave, sin traerse el contenido: tamaño y tipo
 * declarado. `null` si el objeto no existe — que es como se sabe que el
 * navegador nunca llegó a subir.
 */
async function cabecera(clave) {
  if (driver() === 'memoria') {
    const guardado = enMemoria.get(clave)
    if (!guardado) return null
    return { tamanoBytes: guardado.buffer.length, contentType: guardado.contentType }
  }

  try {
    const respuesta = await cliente().send(
      new HeadObjectCommand({ Bucket: env.R2_BUCKET, Key: clave })
    )
    return {
      tamanoBytes: Number(respuesta.ContentLength) || 0,
      contentType: respuesta.ContentType || null
    }
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound')
      return null
    throw error
  }
}

/**
 * Los primeros bytes del objeto, para detectar el tipo real por su firma.
 *
 * **Es lo que conserva la validación por contenido cuando el archivo ya no pasa
 * por el servidor** (D-83): en vez de mirar un buffer que teníamos en memoria,
 * se piden unos kilobytes al almacenamiento. Ese tramo —servidor a R2— es el
 * rápido, así que cuesta milisegundos aunque el archivo pese 30 MB.
 */
async function leerRango(clave, bytes = 4096) {
  if (driver() === 'memoria') {
    const guardado = enMemoria.get(clave)
    return guardado ? guardado.buffer.subarray(0, bytes) : null
  }

  try {
    const respuesta = await cliente().send(
      new GetObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: clave,
        Range: `bytes=0-${bytes - 1}`
      })
    )
    return Buffer.from(await respuesta.Body.transformToByteArray())
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NoSuchKey')
      return null
    throw error
  }
}

/**
 * Mueve un objeto dentro del bucket: copia y borra el origen.
 *
 * Es cómo una subida pendiente llega a su carpeta definitiva con la extensión
 * real. La copia ocurre **dentro** del almacenamiento, así que el archivo no
 * vuelve a viajar por la red del servidor.
 */
async function mover(origen, destino, { contentType } = {}) {
  if (driver() === 'memoria') {
    const guardado = enMemoria.get(origen)
    if (!guardado) throw new Error(`mover: no hay nada en ${origen}`)
    enMemoria.set(destino, {
      buffer: guardado.buffer,
      contentType: contentType || guardado.contentType
    })
    enMemoria.delete(origen)
    return destino
  }

  await cliente().send(
    new CopyObjectCommand({
      Bucket: env.R2_BUCKET,
      CopySource: `${env.R2_BUCKET}/${origen}`,
      Key: destino,
      ContentType: contentType,
      MetadataDirective: contentType ? 'REPLACE' : 'COPY'
    })
  )
  await borrar(origen)
  logger.info('Documento movido a su carpeta definitiva', { origen, destino })
  return destino
}

async function borrar(clave) {
  if (!clave) return

  if (driver() === 'memoria') {
    enMemoria.delete(clave)
    return
  }

  try {
    await cliente().send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: clave }))
    logger.info('Documento eliminado del almacenamiento', { clave })
  } catch (error) {
    // No se bloquea la operación de negocio si el borrado remoto falla.
    logger.error('No se pudo eliminar el documento del almacenamiento', {
      clave,
      error: error.message
    })
  }
}

/** Sólo para pruebas y desarrollo: qué hay guardado en el driver de memoria. */
function contenidoEnMemoria(clave) {
  return enMemoria.get(clave) || null
}

function limpiarMemoria() {
  enMemoria.clear()
}

module.exports = {
  driver,
  estaConfigurado,
  construirClave,
  construirClaveAdjunto,
  construirClaveTemporal,
  firmarAdjunto,
  firmarRegistro,
  firmarSiroc,
  firmarHistoria,
  nombreDeReporteBimestral,
  nombreDeModificacion,
  nombreDeContrato,
  subir,
  urlDeSubida,
  cabecera,
  leerRango,
  mover,
  urlDeDescarga,
  borrar,
  contenidoEnMemoria,
  limpiarMemoria,
  advertirSiNoHayBucket
}
