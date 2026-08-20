const { body } = require('express-validator')

const PATRON_PASSWORD = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[!@#$%^&*]).*$/

exports.loginValidation = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Escribe tu correo')
    .bail()
    .isEmail()
    .withMessage('Escribe un correo válido')
    .normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false }),
  body('password').notEmpty().withMessage('Escribe tu contraseña')
]

exports.changePasswordValidation = [
  body('passwordActual').notEmpty().withMessage('Escribe tu contraseña actual'),
  body('passwordNueva')
    .notEmpty()
    .withMessage('Escribe tu contraseña nueva')
    .bail()
    .isLength({ min: 8 })
    .withMessage('La contraseña debe tener al menos 8 caracteres')
    .matches(PATRON_PASSWORD)
    .withMessage(
      'La contraseña necesita una mayúscula, una minúscula, un número y uno de estos símbolos: !@#$%^&*'
    )
]
