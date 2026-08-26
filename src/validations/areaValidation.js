const { body, param, query } = require('express-validator')

/**
 * Validación del catálogo de áreas (D-58).
 *
 * `clave` no se valida en ningún lado porque **no se manda nunca**: la genera el
 * servicio a partir del nombre y es inmutable. Aceptarla desde HTTP dejaría al
 * cliente elegir la llave con la que se guardan las adscripciones.
 */
exports.listAreasValidation = [
  query('activa')
    .optional()
    .isIn(['true', 'false', 'todos'])
    .withMessage('activa debe ser true, false o todos'),
  query('temporal')
    .optional()
    .isIn(['true', 'false'])
    .withMessage('temporal debe ser true o false')
]

const nombre = () =>
  body('nombre')
    .trim()
    .notEmpty()
    .withMessage('El nombre del área es requerido')
    .bail()
    .isLength({ min: 3, max: 80 })
    .withMessage('El nombre debe tener entre 3 y 80 caracteres')

exports.createAreaValidation = [nombre()]

exports.updateAreaValidation = [
  param('id').isMongoId().withMessage('El área indicada no es válida'),
  nombre()
]

exports.areaEstadoValidation = [
  param('id').isMongoId().withMessage('El área indicada no es válida'),
  body('activa').isBoolean().withMessage('activa debe ser verdadero o falso')
]
