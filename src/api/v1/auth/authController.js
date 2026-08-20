const authService = require('./authService')
const { ok } = require('../../../utils/response')

/**
 * HTTP de autenticación (spec 9.1). El front espera `data: { user, token }` en
 * login y `data: { user }` en `/auth/me`, con la forma exacta de `AuthUser`
 * (la produce `userModel.toJSON`).
 */
class AuthController {
  /** POST /auth/login */
  async login(req, res) {
    const { email, password } = req.body
    const { usuario, token } = await authService.login(email, password)

    req.log.info('Inicio de sesión', {
      usuarioId: usuario._id.toString(),
      nivelAcceso: usuario.nivelAcceso
    })

    return ok(res, { user: usuario, token }, 'Sesión iniciada')
  }

  /** GET /auth/me — el front lo llama en cada arranque para revalidar. */
  async me(req, res) {
    const usuario = await authService.getCurrentUser(req.user._id)
    return ok(res, { user: usuario })
  }

  /**
   * POST /auth/logout — la sesión es un JWT sin estado, así que aquí no hay
   * nada que invalidar: el front borra el token. Existe para que el front no
   * tenga que tratar este caso distinto y para dejar rastro en la bitácora.
   */
  async logout(req, res) {
    req.log.info('Cierre de sesión', { usuarioId: req.user._id.toString() })
    return ok(res, null, 'Sesión cerrada')
  }

  /** POST /auth/cambiar-password */
  async changePassword(req, res) {
    const usuario = await authService.changePassword(req.user._id, req.body)
    req.log.info('Contraseña actualizada', { usuarioId: usuario._id.toString() })
    return ok(res, { user: usuario }, 'Contraseña actualizada correctamente')
  }
}

module.exports = new AuthController()
