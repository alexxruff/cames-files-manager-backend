const { body, param, query } = require('express-validator')
const { EMPLOYEE_TYPES } = require('../constants')

exports.listCategoriesValidation = [
  query('tipo')
    .optional()
    .isIn(EMPLOYEE_TYPES)
    .withMessage('El tipo debe ser administrativo o mano_de_obra'),
  query('incluirInactivas')
    .optional()
    .isIn(['true', 'false'])
    .withMessage('incluirInactivas debe ser true o false'),
  query('busqueda').optional().trim().isLength({ max: 80 })
]

exports.createCategoryValidation = [
  body('nombre')
    .trim()
    .notEmpty()
    .withMessage('El nombre de la categoría es requerido')
    .bail()
    .isLength({ min: 3, max: 80 })
    .withMessage('El nombre debe tener entre 3 y 80 caracteres'),
  body('tipo')
    .isIn(EMPLOYEE_TYPES)
    .withMessage('El tipo debe ser administrativo o mano_de_obra')
]

exports.categoryEstadoValidation = [
  param('id').isMongoId().withMessage('La categoría indicada no es válida'),
  body('activo').isBoolean().withMessage('activo debe ser verdadero o falso')
]
