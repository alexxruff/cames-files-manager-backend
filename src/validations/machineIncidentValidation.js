const { body, param, query } = require('express-validator')
const { PATRON_FECHA } = require('../utils/dates')

/**
 * Incidencias de maquinaria (D-88).
 *
 * Lo que NO se valida aquí es tan importante como lo que sí: el trabajador y la
 * obra **no se aceptan en el cuerpo**, porque se derivan de la historia de la
 * máquina. Mandarlos se rechaza más abajo, en el servicio, no aquí.
 */
const fecha = (regla, campo) =>
  regla
    .optional()
    .matches(PATRON_FECHA)
    .withMessage(`${campo} debe tener el formato AAAA-MM-DD`)

exports.listIncidentsValidation = [
  param('id').isMongoId().withMessage('La máquina indicada no es válida'),
  query('estado')
    .optional()
    .isIn(['abiertas', 'resueltas', 'todas'])
    .withMessage('estado debe ser abiertas, resueltas o todas')
]

exports.createIncidentValidation = [
  param('id').isMongoId().withMessage('La máquina indicada no es válida'),
  body('tipoId')
    .notEmpty()
    .withMessage('El tipo de incidencia es requerido')
    .bail()
    .isMongoId()
    .withMessage('El tipo de incidencia indicado no es válido'),
  body('descripcion')
    .trim()
    .notEmpty()
    .withMessage('La descripción de la incidencia es requerida')
    .bail()
    .isLength({ max: 1000 })
    .withMessage('La descripción no puede exceder 1000 caracteres'),
  fecha(body('fechaIncidencia'), 'La fecha de la incidencia')
]

exports.resolveIncidentValidation = [
  param('id').isMongoId().withMessage('La incidencia indicada no es válida'),
  fecha(body('fechaResolucion'), 'La fecha de resolución'),
  body('notaResolucion')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 1000 })
    .withMessage('La nota de resolución no puede exceder 1000 caracteres')
]
