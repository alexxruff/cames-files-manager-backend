const roleService = require('./roleService')
const { ok, created, noContent } = require('../../../utils/response')

/** HTTP de roles (D-93). */
class RoleController {
  /** GET /roles?incluirInactivos=&busqueda= */
  list = async (req, res) => {
    const datos = await roleService.list({
      incluirInactivos: req.query.incluirInactivos === 'true',
      busqueda: req.query.busqueda
    })
    return ok(res, datos)
  }

  /** GET /roles/:id */
  getById = async (req, res) => {
    const rol = await roleService.getById(req.params.id)
    return ok(res, { rol })
  }

  /** POST /roles → 201 */
  create = async (req, res) => {
    const rol = await roleService.create(req.body)
    req.log.info('Rol creado', { rolId: rol._id.toString(), nombre: rol.nombre })
    return created(res, { rol }, 'Rol creado correctamente')
  }

  /** PATCH /roles/:id */
  update = async (req, res) => {
    const rol = await roleService.update(req.params.id, req.body)
    req.log.info('Rol actualizado', { rolId: rol._id.toString() })
    return ok(res, { rol }, 'Rol actualizado correctamente')
  }

  /** DELETE /roles/:id → 204 */
  remove = async (req, res) => {
    await roleService.remove(req.params.id)
    req.log.info('Rol eliminado', { rolId: req.params.id })
    return noContent(res)
  }
}

module.exports = new RoleController()
