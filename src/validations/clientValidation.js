const { body, param, query } = require('express-validator')
const { subidaIdOpcional } = require('./uploadValidation')

// Persona moral (12) o física (13).
const PATRON_RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/

/** Campos que aceptan el alta y la edición. Cualquier otro → 400. */
const CAMPOS_CLIENTE = [
  'nombre',
  'rfc',
  'contactoNombre',
  'contactoEmail',
  'contactoTelefono'
]

const reglaRfc = body('rfc')
  .optional({ values: 'falsy' })
  .trim()
  .toUpperCase()
  .matches(PATRON_RFC)
  .withMessage('El RFC no tiene un formato válido')

const reglaContactoEmail = body('contactoEmail')
  .optional({ values: 'falsy' })
  .trim()
  .isEmail()
  .withMessage('Escribe un correo de contacto válido')
  .normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false })

const reglaContactoNombre = body('contactoNombre')
  .optional({ values: 'null' })
  .trim()
  .isLength({ max: 120 })
  .withMessage('El nombre del contacto no puede exceder 120 caracteres')

const reglaContactoTelefono = body('contactoTelefono')
  .optional({ values: 'null' })
  .trim()
  .isLength({ max: 20 })
  .withMessage('El teléfono no puede exceder 20 caracteres')

exports.listClientsValidation = [
  query('busqueda')
    .optional()
    .trim()
    .isLength({ max: 160 })
    .withMessage('La búsqueda no puede exceder 160 caracteres'),
  query('incluirInactivos')
    .optional()
    .isIn(['true', 'false'])
    .withMessage('incluirInactivos debe ser true o false'),
  query('orden')
    .optional()
    .isIn(['nombre_asc', 'nombre_desc'])
    .withMessage('El orden debe ser nombre_asc o nombre_desc'),
  query('catalogoCompleto')
    .optional()
    .isIn(['true', 'false'])
    .withMessage('catalogoCompleto debe ser true o false'),
  query('pagina')
    .optional()
    .isInt({ min: 1 })
    .withMessage('La página debe ser 1 o mayor'),
  query('porPagina')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('porPagina debe estar entre 1 y 100')
]

exports.clientIdValidation = [
  param('id').isMongoId().withMessage('El cliente indicado no es válido')
]

exports.createClientValidation = [
  body('nombre')
    .trim()
    .notEmpty()
    .withMessage('El nombre del cliente es requerido')
    .bail()
    .isLength({ min: 3, max: 160 })
    .withMessage('El nombre debe tener entre 3 y 160 caracteres'),
  reglaRfc,
  reglaContactoNombre,
  reglaContactoEmail,
  reglaContactoTelefono
]

exports.updateClientValidation = [
  param('id').isMongoId().withMessage('El cliente indicado no es válido'),
  body().custom((cuerpo) => {
    const campos = Object.keys(cuerpo || {})
    if (campos.length === 0) throw new Error('No hay nada que actualizar')

    const invalidos = campos.filter((c) => !CAMPOS_CLIENTE.includes(c))
    if (invalidos.length > 0) {
      const pistas = { activo: 'PATCH /clientes/:id/estado' }
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
    .isLength({ min: 3, max: 160 })
    .withMessage('El nombre debe tener entre 3 y 160 caracteres'),
  reglaRfc,
  reglaContactoNombre,
  reglaContactoEmail,
  reglaContactoTelefono
]

exports.clientEstadoValidation = [
  param('id').isMongoId().withMessage('El cliente indicado no es válido'),
  body('activo').isBoolean().withMessage('activo debe ser verdadero o falso')
]

exports.PATRON_RFC = PATRON_RFC
exports.CAMPOS_CLIENTE = CAMPOS_CLIENTE

/**
 * Registros de obra del cliente (D-66). Simétricos a los registros patronales de
 * la empresa: número y descripción; el `_id` lo pone la base.
 */
const numeroObra = (obligatorio) => {
  const regla = body('numero')
  return (obligatorio ? regla : regla.optional())
    .trim()
    .isLength({ min: 3, max: 30 })
    .withMessage('El número debe tener entre 3 y 30 caracteres')
}

const descripcionObra = () =>
  body('descripcion')
    .optional({ values: 'null' })
    .trim()
    .isLength({ max: 120 })
    .withMessage('La descripción no puede exceder 120 caracteres')

exports.addConstructionRegistrationValidation = [
  param('id').isMongoId().withMessage('El cliente indicado no es válido'),
  numeroObra(true),
  descripcionObra(),
  subidaIdOpcional
]

exports.updateConstructionRegistrationValidation = [
  param('id').isMongoId().withMessage('El cliente indicado no es válido'),
  param('roId').isMongoId().withMessage('El registro de obra indicado no es válido'),
  // Mandar SÓLO el archivo es una edición válida (D-79): reemplaza el que haya.
  body().custom((cuerpo, { req }) => {
    if (!req.file && Object.keys(cuerpo || {}).length === 0)
      throw new Error('No hay nada que actualizar')
    return true
  }),
  numeroObra(false),
  descripcionObra(),
  subidaIdOpcional
]

exports.constructionRegistrationFileValidation = [
  param('id').isMongoId().withMessage('El cliente indicado no es válido'),
  param('roId').isMongoId().withMessage('El registro de obra indicado no es válido'),
  query('descargar')
    .optional()
    .isBoolean()
    .withMessage('descargar debe ser verdadero o falso')
]

exports.constructionRegistrationEstadoValidation = [
  param('id').isMongoId().withMessage('El cliente indicado no es válido'),
  param('roId').isMongoId().withMessage('El registro de obra indicado no es válido'),
  body('activo').isBoolean().withMessage('activo debe ser verdadero o falso')
]
