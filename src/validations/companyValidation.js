const { body, param, query } = require('express-validator')

// RFC de persona moral (12) o física (13).
const PATRON_RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/

exports.listCompaniesValidation = [
  query('incluirInactivas')
    .optional()
    .isIn(['true', 'false'])
    .withMessage('incluirInactivas debe ser true o false'),
  query('busqueda')
    .optional()
    .trim()
    .isLength({ max: 120 })
    .withMessage('La búsqueda no puede exceder 120 caracteres')
]

exports.companyIdValidation = [
  param('id').isMongoId().withMessage('La empresa indicada no es válida')
]

exports.createCompanyValidation = [
  body('nombre')
    .trim()
    .notEmpty()
    .withMessage('El nombre de la empresa es requerido')
    .bail()
    .isLength({ min: 3, max: 120 })
    .withMessage('El nombre debe tener entre 3 y 120 caracteres'),
  body('rfc')
    .optional({ values: 'falsy' })
    .trim()
    .toUpperCase()
    .matches(PATRON_RFC)
    .withMessage('El RFC no tiene un formato válido'),
  body('activo').optional().isBoolean().withMessage('activo debe ser verdadero o falso')
]

exports.PATRON_RFC = PATRON_RFC
