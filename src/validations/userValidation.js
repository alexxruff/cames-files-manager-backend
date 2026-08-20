const { body, param, query } = require('express-validator')
const { ACCESS_LEVELS, AREAS, SCOPES } = require('../constants')

/**
 * Validaciones de usuarios. Los mensajes se le muestran TAL CUAL a la persona
 * usuaria: en español, y diciendo qué hacer (spec regla #3).
 *
 * Diferencia deliberada con `talentlink-backend`: el nombre admite acentos y ñ.
 * Allá el patrón era /^[a-zA-Z\s-]+$/ y rechazaba a quien se llama Muñoz.
 */

// Letras de cualquier idioma, espacios, apóstrofo y guion.
const PATRON_NOMBRE = /^[\p{L}\s'-]+$/u
const PATRON_PASSWORD = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[!@#$%^&*]).*$/

const reglaNombre = (campo = 'name') =>
  body(campo)
    .trim()
    .notEmpty()
    .withMessage('El nombre es requerido')
    .bail()
    .isLength({ min: 2, max: 50 })
    .withMessage('El nombre debe tener entre 2 y 50 caracteres')
    .matches(PATRON_NOMBRE)
    .withMessage('El nombre sólo puede contener letras, espacios, apóstrofos y guiones')

const reglaEmail = (campo = 'email') =>
  body(campo)
    .trim()
    .notEmpty()
    .withMessage('El correo es requerido')
    .bail()
    .isEmail()
    .withMessage('Escribe un correo válido')
    .normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false })

const reglaPassword = (campo = 'password') =>
  body(campo)
    .notEmpty()
    .withMessage('La contraseña es requerida')
    .bail()
    .isLength({ min: 8 })
    .withMessage('La contraseña debe tener al menos 8 caracteres')
    .matches(PATRON_PASSWORD)
    .withMessage(
      'La contraseña necesita una mayúscula, una minúscula, un número y uno de estos símbolos: !@#$%^&*'
    )

const reglaNivelAcceso = (opcional = false) => {
  const regla = body('nivelAcceso')
  if (opcional) regla.optional()
  return regla.isIn(ACCESS_LEVELS).withMessage('Selecciona un nivel de acceso válido')
}

/** El área es obligatoria para jefe_area y se ignora para los demás niveles. */
const reglaArea = body('area')
  .optional({ values: 'null' })
  .custom((valor, { req }) => {
    if (req.body.nivelAcceso === 'jefe_area') {
      if (!valor) throw new Error('Un jefe de área necesita un área asignada')
      if (!AREAS.includes(valor)) throw new Error('Selecciona un área válida')
    } else if (valor && !AREAS.includes(valor)) {
      throw new Error('Selecciona un área válida')
    }
    return true
  })

const reglasAlcance = [
  body('alcance').optional().isIn(SCOPES).withMessage('El alcance indicado no es válido'),
  body('clienteId')
    .optional({ values: 'null' })
    .custom((valor, { req }) => {
      if (req.body.alcance === 'cliente' && !valor) {
        throw new Error('Indica el cliente al que pertenece el usuario')
      }
      if (valor && !/^[a-f\d]{24}$/i.test(valor)) {
        throw new Error('El cliente indicado no es válido')
      }
      return true
    })
]

/** Campos que PATCH /usuarios/:id acepta. Cualquier otro → 400 (spec 9.2). */
const CAMPOS_ACTUALIZABLES = [
  'name',
  'email',
  'nivelAcceso',
  'area',
  'alcance',
  'clienteId'
]

exports.listUsersValidation = [
  query('incluirInactivos')
    .optional()
    .isIn(['true', 'false'])
    .withMessage('incluirInactivos debe ser true o false'),
  query('busqueda').optional().trim().isLength({ max: 120 })
]

exports.userIdValidation = [
  param('id').isMongoId().withMessage('El usuario indicado no es válido')
]

exports.createUserValidation = [
  reglaNombre(),
  reglaEmail(),
  reglaPassword(),
  reglaNivelAcceso(),
  reglaArea,
  ...reglasAlcance
]

exports.updateUserValidation = [
  param('id').isMongoId().withMessage('El usuario indicado no es válido'),
  body().custom((cuerpo) => {
    const invalidos = Object.keys(cuerpo || {}).filter(
      (campo) => !CAMPOS_ACTUALIZABLES.includes(campo)
    )
    if (invalidos.length > 0) {
      throw new Error(
        `Estos campos no se pueden actualizar aquí: ${invalidos.join(', ')}`
      )
    }
    if (Object.keys(cuerpo || {}).length === 0) {
      throw new Error('No hay nada que actualizar')
    }
    return true
  }),
  body('name')
    .optional()
    .custom((valor) => {
      const nombre = String(valor).trim()
      if (nombre.length < 2 || nombre.length > 50) {
        throw new Error('El nombre debe tener entre 2 y 50 caracteres')
      }
      if (!PATRON_NOMBRE.test(nombre)) {
        throw new Error(
          'El nombre sólo puede contener letras, espacios, apóstrofos y guiones'
        )
      }
      return true
    }),
  body('email')
    .optional()
    .trim()
    .isEmail()
    .withMessage('Escribe un correo válido')
    .normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false }),
  reglaNivelAcceso(true),
  reglaArea,
  ...reglasAlcance
]

exports.PATRON_NOMBRE = PATRON_NOMBRE
exports.PATRON_PASSWORD = PATRON_PASSWORD
exports.CAMPOS_ACTUALIZABLES = CAMPOS_ACTUALIZABLES
