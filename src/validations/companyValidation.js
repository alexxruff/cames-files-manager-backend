const { body, param, query } = require('express-validator')

// RFC de persona moral (12) o física (13).
const PATRON_RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/

/**
 * Registros patronales: uno o varios (D-64). Se manda la **lista completa** —no
 * un agrega/quita— así que `[]` los deja sin ninguno.
 */
const reglasRegistros = (obligatorio = false) => {
  const regla = body('registrosPatronales')
  const base = obligatorio ? regla : regla.optional()
  return base
    .isArray()
    .withMessage('registrosPatronales debe ser una lista')
    .bail()
    .custom((lista) => {
      const invalidos = (lista || []).filter(
        (r) => typeof r !== 'string' || r.trim().length < 3 || r.trim().length > 30
      )
      if (invalidos.length > 0) {
        throw new Error(
          'Cada registro patronal debe ser texto de entre 3 y 30 caracteres'
        )
      }
      return true
    })
}

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
  body('activo').optional().isBoolean().withMessage('activo debe ser verdadero o falso'),
  reglasRegistros()
]

exports.updateCompanyValidation = [
  param('id').isMongoId().withMessage('La empresa indicada no es válida'),
  body().custom((cuerpo) => {
    const campos = Object.keys(cuerpo || {})
    if (campos.length === 0) throw new Error('No hay nada que actualizar')

    const permitidos = [
      'nombre',
      'rfc',
      'registrosPatronales',
      'branding',
      'configuracion'
    ]
    const invalidos = campos.filter((c) => !permitidos.includes(c))
    if (invalidos.length > 0) {
      const pistas = { activo: 'PATCH /empresas/:id/estado' }
      const detalle = invalidos
        .map((c) => (pistas[c] ? `${c} (usa ${pistas[c]})` : c))
        .join(', ')
      throw new Error(`Estos campos no se pueden actualizar aquí: ${detalle}`)
    }
    return true
  }),
  body('nombre')
    .optional()
    .trim()
    .isLength({ min: 3, max: 120 })
    .withMessage('El nombre debe tener entre 3 y 120 caracteres'),
  body('rfc')
    .optional({ values: 'falsy' })
    .trim()
    .toUpperCase()
    .matches(PATRON_RFC)
    .withMessage('El RFC no tiene un formato válido'),
  reglasRegistros()
]

exports.companyEstadoValidation = [
  param('id').isMongoId().withMessage('La empresa indicada no es válida'),
  body('activo').isBoolean().withMessage('activo debe ser verdadero o falso')
]

exports.PATRON_RFC = PATRON_RFC
