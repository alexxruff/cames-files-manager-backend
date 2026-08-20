const jwt = require('jsonwebtoken')
const env = require('../../../config/env')
const User = require('../users/userModel')
const { AppError } = require('../../../middlewares/errorHandler')

/**
 * Sesión (spec 8 y 9.1). JWT en `Authorization: Bearer <token>`, 12 h.
 *
 * Decisiones:
 * - El token lleva `sub` (id), `nivelAcceso` y `alcance` sólo como pista para
 *   depurar. La autorización SIEMPRE relee al usuario de la base
 *   (`authMiddleware.protect`): así dar de baja a alguien o bajarle el nivel
 *   surte efecto de inmediato, no cuando expire su token.
 * - No hay registro público: las cuentas las crea un administrador por
 *   `POST /usuarios`. El backend prestado exponía `POST /auth/register` abierto,
 *   que en esta plataforma sería un agujero: cualquiera se daría acceso a
 *   expedientes con datos personales sensibles.
 * - El error de login es siempre el mismo, exista o no el correo: enumerar
 *   cuentas válidas es el primer paso de un ataque de credenciales.
 */
class AuthService {
  generateToken(usuario) {
    return jwt.sign(
      {
        sub: usuario._id.toString(),
        nivelAcceso: usuario.nivelAcceso,
        alcance: usuario.alcance
      },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN }
    )
  }

  async login(email, password) {
    if (!email || !password) {
      throw AppError.validation('Escribe tu correo y tu contraseña', [
        { msg: 'Escribe tu correo y tu contraseña' }
      ])
    }

    const usuario = await User.findOne({ email: String(email).toLowerCase() }).select(
      '+password'
    )

    const credencialesInvalidas = new AppError(401, 'Correo o contraseña incorrectos')

    if (!usuario) {
      throw credencialesInvalidas
    }
    if (!(await usuario.comparePassword(password))) {
      throw credencialesInvalidas
    }
    // Se comprueba DESPUÉS de la contraseña: un desactivado que teclea mal su
    // contraseña no debe averiguar que su cuenta existe.
    if (!usuario.active) {
      throw new AppError(401, 'Tu cuenta está desactivada. Contacta a Recursos Humanos.')
    }

    // `updateOne` en vez de `save`: no dispara el hook de hasheo ni revalida.
    const ahora = new Date()
    await User.updateOne({ _id: usuario._id }, { $set: { ultimoAccesoEn: ahora } })
    usuario.ultimoAccesoEn = ahora

    usuario.password = undefined

    return { usuario, token: this.generateToken(usuario) }
  }

  async getCurrentUser(usuarioId) {
    const usuario = await User.findById(usuarioId)
    if (!usuario || !usuario.active) {
      throw new AppError(401, 'Tu sesión no es válida. Vuelve a iniciar sesión.')
    }
    return usuario
  }

  /** POST /auth/cambiar-password (spec 9.1). */
  async changePassword(usuarioId, { passwordActual, passwordNueva }) {
    const usuario = await User.findById(usuarioId).select('+password')
    if (!usuario) {
      throw new AppError(401, 'Tu sesión no es válida. Vuelve a iniciar sesión.')
    }

    if (!(await usuario.comparePassword(passwordActual))) {
      throw AppError.validation('Tu contraseña actual no es correcta', [
        { msg: 'Tu contraseña actual no es correcta', path: 'passwordActual' }
      ])
    }

    if (await usuario.comparePassword(passwordNueva)) {
      throw AppError.validation('La contraseña nueva debe ser distinta de la actual', [
        {
          msg: 'La contraseña nueva debe ser distinta de la actual',
          path: 'passwordNueva'
        }
      ])
    }

    usuario.password = passwordNueva
    await usuario.save()

    usuario.password = undefined
    return usuario
  }
}

module.exports = new AuthService()
