const { body, param, query } = require('express-validator')
const { isCalendarDate } = require('../utils/dates')

exports.listAssignmentsValidation = [
  param('id').isMongoId().withMessage('El proyecto indicado no es válido'),
  query('activo')
    .optional()
    .isIn(['true', 'false'])
    .withMessage('activo debe ser true o false')
]

exports.createAssignmentValidation = [
  param('id').isMongoId().withMessage('El proyecto indicado no es válido'),
  body('empleadoId').isMongoId().withMessage('Selecciona un empleado válido'),
  body('categoriaId').isMongoId().withMessage('Selecciona una categoría válida'),
  body('fechaAsignacion').custom((valor) => {
    if (!isCalendarDate(valor)) {
      throw new Error('La fecha de asignación debe tener el formato AAAA-MM-DD')
    }
    return true
  })
]

exports.assignmentIdValidation = [
  param('id').isMongoId().withMessage('La asignación indicada no es válida')
]

exports.assignmentExitValidation = [
  param('id').isMongoId().withMessage('La asignación indicada no es válida'),
  body('fechaSalida').custom((valor) => {
    if (!isCalendarDate(valor)) {
      throw new Error('La fecha de salida debe tener el formato AAAA-MM-DD')
    }
    return true
  })
]
