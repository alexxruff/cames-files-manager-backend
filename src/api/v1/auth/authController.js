const authService = require('./authService')
const { ok } = require('../../../utils/response')

/**
 * HTTP de autenticación (backend-spec §6.1).
 * `data: { user, token }` en login y cambio de contraseña; `{ user }` en /me.
 */
class AuthController {
  /** POST /auth/login */
  async login(req, res) {
    const { email, password } = req.body
    const { user, token } = await authService.login(email, password)

    req.log.info('Inicio de sesión', {
      empleadoId: user._id,
      nivelAcceso: user.nivelAcceso,
      empresas: user.empresas.length
    })

    return ok(res, { user, token }, 'Sesión iniciada')
  }

  /** GET /auth/me — el front lo llama en cada arranque para revalidar. */
  async me(req, res) {
    const user = await authService.getCurrentUser(req.user._id)
    return ok(res, { user })
  }

  /** POST /auth/logout */
  async logout(req, res) {
    req.log.info('Cierre de sesión', { empleadoId: req.user._id.toString() })
    return ok(res, null, 'Sesión cerrada')
  }

  /**
   * POST /auth/cambiar-password
   * Devuelve un token nuevo: el cambio invalida las sesiones anteriores.
   */
  async changePassword(req, res) {
    const { user, token } = await authService.changePassword(req.user._id, req.body)
    req.log.info('Contraseña actualizada', { empleadoId: user._id })
    return ok(
      res,
      { user, token },
      'Contraseña actualizada. Tus otras sesiones se cerraron.'
    )
  }
}

module.exports = new AuthController()
