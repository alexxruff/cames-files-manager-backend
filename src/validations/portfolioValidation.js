const { body, param, query } = require('express-validator')

/** Campos de la relación empresa ↔ cliente que se pueden editar. */
const CAMPOS_CARTERA = ['contactoNombre', 'contactoEmail', 'contactoTelefono', 'notas']

const reglasContacto = [
  body('contactoNombre')
    .optional({ values: 'null' })
    .trim()
    .isLength({ max: 120 })
    .withMessage('El nombre del contacto no puede exceder 120 caracteres'),
  body('contactoEmail')
    .optional({ values: 'falsy' })
    .trim()
    .isEmail()
    .withMessage('Escribe un correo de contacto válido')
    .normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false }),
  body('contactoTelefono')
    .optional({ values: 'null' })
    .trim()
    .isLength({ max: 20 })
    .withMessage('El teléfono no puede exceder 20 caracteres'),
  body('notas')
    .optional({ values: 'null' })
    .trim()
    .isLength({ max: 500 })
    .withMessage('Las notas no pueden exceder 500 caracteres')
]

exports.listPortfolioValidation = [
  param('id').isMongoId().withMessage('La empresa indicada no es válida'),
  query('activo')
    .optional()
    .isIn(['true', 'false'])
    .withMessage('activo debe ser true o false')
]

exports.addToPortfolioValidation = [
  param('id').isMongoId().withMessage('La empresa indicada no es válida'),
  body('clienteId').isMongoId().withMessage('Selecciona un cliente válido'),
  ...reglasContacto
]

exports.updatePortfolioValidation = [
  param('id').isMongoId().withMessage('El registro de cartera no es válido'),
  body().custom((cuerpo) => {
    const campos = Object.keys(cuerpo || {})
    if (campos.length === 0) throw new Error('No hay nada que actualizar')
    const invalidos = campos.filter((c) => !CAMPOS_CARTERA.includes(c))
    if (invalidos.length > 0) {
      const pistas = {
        activo: 'PATCH /carteras/:id/estado',
        clienteId:
          'no se puede cambiar el cliente de un vínculo; saca este y agrega el otro'
      }
      const detalle = invalidos
        .map((c) => (pistas[c] ? `${c} (${pistas[c]})` : c))
        .join(', ')
      throw new Error(`Estos campos no se pueden actualizar aquí: ${detalle}`)
    }
    return true
  }),
  ...reglasContacto
]

exports.portfolioEstadoValidation = [
  param('id').isMongoId().withMessage('El registro de cartera no es válido'),
  body('activo').isBoolean().withMessage('activo debe ser verdadero o falso')
]

exports.CAMPOS_CARTERA = CAMPOS_CARTERA
