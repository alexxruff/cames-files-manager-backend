const { body, param, query } = require('express-validator')

/**
 * Catálogo de tipos de incidencia (D-88).
 *
 * Sólo el nombre: el tipo agrupa, la descripción de la incidencia describe.
 */
const nombre = (regla) =>
  regla
    .trim()
    .notEmpty()
    .withMessage('El nombre del tipo de incidencia es requerido')
    .bail()
    .isLength({ min: 3, max: 80 })
    .withMessage('El nombre debe tener entre 3 y 80 caracteres')

exports.listIncidentTypesValidation = [
  query('incluirInactivos')
    .optional()
    .isIn(['true', 'false'])
    .withMessage('incluirInactivos debe ser true o false'),
  query('busqueda').optional().trim().isLength({ max: 80 })
]

exports.createIncidentTypeValidation = [nombre(body('nombre'))]

exports.updateIncidentTypeValidation = [
  param('id').isMongoId().withMessage('El tipo de incidencia indicado no es válido'),
  nombre(body('nombre'))
]

exports.incidentTypeEstadoValidation = [
  param('id').isMongoId().withMessage('El tipo de incidencia indicado no es válido'),
  body('activo').isBoolean().withMessage('activo debe ser verdadero o falso')
]
