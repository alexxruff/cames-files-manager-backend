const { body, param, query } = require('express-validator')
const { subidaIdOpcional } = require('./uploadValidation')

/**
 * Catálogo de maquinaria (D-86).
 *
 * `empresaId` NO se valida en el cuerpo porque **no llega del cliente**: la
 * máquina se da de alta bajo `/empresas/:id/maquinas` y la empresa es la de la
 * ruta.
 */

const CAMPOS_EDITABLES = ['identificador', 'modelo']

const identificador = (regla) =>
  regla
    .trim()
    .notEmpty()
    .withMessage('El identificador de la máquina es requerido')
    .bail()
    .isLength({ max: 60 })
    .withMessage('El identificador no puede exceder 60 caracteres')

const modelo = (regla) =>
  regla
    .trim()
    .notEmpty()
    .withMessage('El modelo de la máquina es requerido')
    .bail()
    .isLength({ max: 120 })
    .withMessage('El modelo no puede exceder 120 caracteres')

exports.listMachinesValidation = [
  param('id').isMongoId().withMessage('La empresa indicada no es válida'),
  query('incluirInactivas')
    .optional()
    .isBoolean()
    .withMessage('incluirInactivas debe ser verdadero o falso'),
  query('busqueda').optional().trim().isLength({ max: 120 })
]

exports.createMachineValidation = [
  param('id').isMongoId().withMessage('La empresa indicada no es válida'),
  identificador(body('identificador')),
  modelo(body('modelo')),
  subidaIdOpcional
]

exports.machineIdValidation = [
  param('id').isMongoId().withMessage('La máquina indicada no es válida')
]

exports.machineImageValidation = [
  param('id').isMongoId().withMessage('La máquina indicada no es válida'),
  query('descargar')
    .optional()
    .isBoolean()
    .withMessage('descargar debe ser verdadero o falso')
]

exports.updateMachineValidation = [
  param('id').isMongoId().withMessage('La máquina indicada no es válida'),
  body().custom((cuerpo, { req }) => {
    const campos = Object.keys(cuerpo || {})
    /*
     * Un `multipart` con SÓLO la imagen no trae campos, y es una petición
     * legítima: así se le pone la foto a una máquina ya dada de alta. Con la
     * subida directa (D-83) el equivalente es un cuerpo con sólo `subidaId`.
     */
    if (campos.length === 0 && !req.file) throw new Error('No hay nada que actualizar')

    const invalidos = campos
      .filter((c) => c !== 'subidaId')
      .filter((c) => !CAMPOS_EDITABLES.includes(c))
    if (invalidos.length > 0) {
      const pistas = {
        activo: 'usa PATCH /maquinas/:id/estado',
        empresaId: 'una máquina no cambia de empresa'
      }
      const detalle = invalidos
        .map((c) => (pistas[c] ? `${c} (${pistas[c]})` : c))
        .join(', ')
      throw new Error(`Estos campos no se pueden enviar aquí: ${detalle}`)
    }
    return true
  }),
  identificador(body('identificador').optional()),
  modelo(body('modelo').optional()),
  subidaIdOpcional
]

exports.machineEstadoValidation = [
  param('id').isMongoId().withMessage('La máquina indicada no es válida'),
  body('activo').isBoolean().withMessage('activo debe ser verdadero o falso')
]
