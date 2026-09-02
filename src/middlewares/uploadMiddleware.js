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
 * El límite de tamaño lo aplica multer y se traduce a `413`. El **tipo** no se
 * valida aquí: se valida por *magic bytes* en el servicio, que es lo único que
 * no se puede falsificar.
 *
 * **El tope no es el mismo en todas las rutas** (D-81). El general son 30 MB
 * —un contrato de obra escaneado pasa de 20—, pero la importación de nómina se
 * queda más abajo: `exceljs` abre el libro entero en memoria y lo expande, así
 * que ahí el archivo grande es lo que tira la máquina, no lo que la usa.
 */
const CAMPO = 'archivo'

/** El middleware de multer para un tope concreto, con sus errores traducidos. */
function crearReceptor(maxBytes) {
  const subida = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxBytes,
      files: 1,
      // Los campos de texto que acompañan al archivo (vigenciaHasta).
      fields: 10
    }
  })

  return function recibir(req, res, next) {
    subida.single(CAMPO)(req, res, (error) => {
      if (!error) return next()

      if (error.code === 'LIMIT_FILE_SIZE') {
        const mb = Math.round(maxBytes / (1024 * 1024))
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
}

/** El tope general: expediente, registro de obra, SIROC y contrato. */
const recibirArchivo = crearReceptor(env.MAX_UPLOAD_BYTES)

/**
 * Un receptor con su propio tope, para la ruta que no puede permitirse el
 * general. Hoy sólo la importación de nómina (D-81).
 */
const recibirArchivoHasta = (maxBytes) => crearReceptor(maxBytes)

module.exports = { recibirArchivo, recibirArchivoHasta, CAMPO }
