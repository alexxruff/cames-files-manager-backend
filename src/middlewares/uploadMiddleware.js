const multer = require('multer')
const env = require('../config/env')
const { AppError } = require('./errorHandler')

/**
 * Recepción del archivo de un documento del expediente.
 *
 * `memoryStorage` y no disco: el archivo se valida por contenido y se sube a R2
 * en la misma petición, así que escribirlo en el disco del contenedor sólo
 * dejaría basura y una copia sin cifrar de datos personales.
 *
 * El límite de tamaño lo aplica multer (10 MB, spec §6.5) y se traduce a `413`.
 * El **tipo** no se valida aquí: se valida por *magic bytes* en el servicio, que
 * es lo único que no se puede falsificar.
 */
const CAMPO = 'archivo'

const subida = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_UPLOAD_BYTES,
    files: 1,
    // Los campos de texto que acompañan al archivo (vigenciaHasta).
    fields: 10
  }
})

/** Traduce los errores de multer al contrato de la API. */
function recibirArchivo(req, res, next) {
  subida.single(CAMPO)(req, res, (error) => {
    if (!error) return next()

    if (error.code === 'LIMIT_FILE_SIZE') {
      const mb = Math.round(env.MAX_UPLOAD_BYTES / (1024 * 1024))
      return next(
        new AppError(413, `El archivo pasa de ${mb} MB. Comprímelo o divídelo.`)
      )
    }
    if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(new AppError(400, `Envía un solo archivo, en el campo "${CAMPO}"`))
    }
    if (error instanceof multer.MulterError) {
      return next(new AppError(400, 'No se pudo leer el archivo enviado'))
    }
    return next(error)
  })
}

module.exports = { recibirArchivo, CAMPO }
