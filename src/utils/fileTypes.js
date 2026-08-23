/**
 * Detección del tipo real de un archivo por sus *magic bytes*.
 *
 * POR QUÉ NO SE CONFÍA EN EL `Content-Type` NI EN LA EXTENSIÓN (spec §6.5): los
 * dos los controla quien sube el archivo. Un `.pdf` con `Content-Type:
 * application/pdf` puede ser un ejecutable, y el equipo de RH abre estos
 * archivos todos los días.
 *
 * Se aceptan PDF y las imágenes que **cualquier navegador puede abrir**. HEIC
 * queda fuera a propósito, aunque sea lo que produce un iPhone: Chrome no lo
 * muestra, y un expediente con documentos que la mitad del equipo no puede ver
 * es peor que pedir la conversión. El mensaje de error lo dice.
 */

const FIRMAS = Object.freeze([
  {
    mime: 'application/pdf',
    extension: 'pdf',
    etiqueta: 'PDF',
    // "%PDF"
    coincide: (b) => b.length > 4 && b.subarray(0, 4).toString('latin1') === '%PDF'
  },
  {
    mime: 'image/jpeg',
    extension: 'jpg',
    etiqueta: 'JPG',
    coincide: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  },
  {
    mime: 'image/png',
    extension: 'png',
    etiqueta: 'PNG',
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
    coincide: (b) =>
      b.length > 12 &&
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP'
  }
])

/** Tipos que sí se aceptan, para el mensaje de error. */
const TIPOS_PERMITIDOS = Object.freeze(FIRMAS.map((f) => f.etiqueta))

/**
 * @param {Buffer} buffer
 * @returns {{mime: string, extension: string, etiqueta: string}|null} null si el
 *   contenido no corresponde a ningún tipo permitido.
 */
function detectarTipo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null

  const firma = FIRMAS.find((f) => f.coincide(buffer))
  if (!firma) return null

  return { mime: firma.mime, extension: firma.extension, etiqueta: firma.etiqueta }
}

/** ¿El contenido parece una imagen HEIC/HEIF de iPhone? Para avisar mejor. */
function pareceHeic(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false
  if (buffer.subarray(4, 8).toString('latin1') !== 'ftyp') return false
  const marca = buffer.subarray(8, 12).toString('latin1')
  return ['heic', 'heix', 'hevc', 'mif1', 'heif'].includes(marca)
}

module.exports = { detectarTipo, pareceHeic, TIPOS_PERMITIDOS, FIRMAS }
