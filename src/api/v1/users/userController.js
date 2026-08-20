const userService = require('./userService')
const { ok, created, noContent } = require('../../../utils/response')

/**
 * HTTP de usuarios: parsea la petición, llama al servicio, responde con el
 * envelope. Sin lógica de negocio (spec 3).
 *
 * Los datos van anidados bajo llave nombrada: `{ usuarios }`, `{ usuario }`.
 */
class UserController {
  /** GET /usuarios?incluirInactivos=&busqueda= */
  async list(req, res) {
    const usuarios = await userService.list(
      {
        busqueda: req.query.busqueda,
        incluirInactivos: req.query.incluirInactivos === 'true'
      },
      { scopeFilter: req.scopeFilter }
    )
    return ok(res, { usuarios })
  }

  /** GET /usuarios/:id */
  async getById(req, res) {
    const usuario = await userService.getById(req.params.id, {
      scopeFilter: req.scopeFilter
    })
    return ok(res, { usuario })
  }

  /** POST /usuarios */
  async create(req, res) {
    const usuario = await userService.create(req.body, {
      actor: req.user,
      ownerClienteId: req.ownerClienteId
    })
    req.log.info('Usuario creado', {
      usuarioCreadoId: usuario._id.toString(),
      nivelAcceso: usuario.nivelAcceso
    })
    return created(res, { usuario }, 'Usuario creado correctamente')
  }

  /** PATCH /usuarios/:id */
  async update(req, res) {
    const usuario = await userService.update(req.params.id, req.body, {
      actor: req.user,
      scopeFilter: req.scopeFilter
    })
    req.log.info('Usuario actualizado', { usuarioId: usuario._id.toString() })
    return ok(res, { usuario }, 'Usuario actualizado correctamente')
  }

  /** DELETE /usuarios/:id → 204 (baja lógica) */
  async deactivate(req, res) {
    const usuario = await userService.deactivate(req.params.id, {
      actor: req.user,
      scopeFilter: req.scopeFilter
    })
    req.log.info('Usuario dado de baja', { usuarioId: usuario._id.toString() })
    return noContent(res)
  }

  /** PATCH /usuarios/:id/reactivar */
  async reactivate(req, res) {
    const usuario = await userService.reactivate(req.params.id, {
      scopeFilter: req.scopeFilter
    })
    req.log.info('Usuario reactivado', { usuarioId: usuario._id.toString() })
    return ok(res, { usuario }, 'Usuario reactivado correctamente')
  }
}

module.exports = new UserController()
