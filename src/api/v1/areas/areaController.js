const areaService = require('./areaService')
const { ok, created } = require('../../../utils/response')
const { can, CAPABILITIES } = require('../../../utils/permissions')

/** HTTP del catálogo de áreas (D-58). */
class AreaController {
  /** GET /areas?activa=true|false|todos&temporal=true */
  list = async (req, res) => {
    const datos = await areaService.list({
      activa: req.query.activa,
      temporal:
        req.query.temporal === undefined ? undefined : req.query.temporal === 'true'
    })
    return ok(res, datos)
  }

  /**
   * POST /areas — idempotente por nombre, igual que las categorías.
   * `201` si se creó, `200` si ya existía: la interfaz distingue sin adivinar.
   */
  create = async (req, res) => {
    const { area, yaExistia } = await areaService.create(req.body)

    if (yaExistia) return ok(res, { area }, 'Esa área ya existía')

    req.log.info('Área creada', { areaId: area._id, clave: area.clave })
    return created(res, { area }, 'Área creada correctamente')
  }

  /** PATCH /areas/:id — sólo el nombre; la clave es inmutable. */
  update = async (req, res) => {
    const datos = await areaService.update(req.params.id, req.body)
    return ok(res, datos, 'Área actualizada')
  }

  /**
   * PATCH /areas/:id/estado — dar de baja o reactivar.
   *
   * El permiso NO se resuelve con un middleware fijo: depende del área. Las
   * temporales las cierra RH y el resto del catálogo el administrador de
   * plataforma (D-58), y eso sólo se sabe leyendo el documento. Se le pasan al
   * servicio las dos capacidades ya resueltas.
   */
  setEstado = async (req, res) => {
    const acceso = req.user?.acceso
    const datos = await areaService.setEstado(req.params.id, req.body.activa, {
      puedeAdministrar: can(acceso, CAPABILITIES.MANAGE_AREAS),
      puedeCerrarTemporales: can(acceso, CAPABILITIES.CLOSE_TEMPORARY_AREAS)
    })

    req.log.info('Área actualizada', {
      areaId: req.params.id,
      activa: datos.area.activa
    })
    return ok(res, datos, datos.area.activa ? 'Área reactivada' : 'Área dada de baja')
  }
}

module.exports = new AreaController()
