const incidentTypeService = require('./incidentTypeService')
const { ok, created } = require('../../../utils/response')

/** HTTP del catálogo de tipos de incidencia (D-88). */
class IncidentTypeController {
  /** GET /tipos-incidencia?incluirInactivos=&busqueda= */
  list = async (req, res) => {
    const datos = await incidentTypeService.list({
      incluirInactivos: req.query.incluirInactivos === 'true',
      busqueda: req.query.busqueda
    })
    return ok(res, datos)
  }

  /**
   * POST /tipos-incidencia — idempotente por nombre, como las áreas.
   * `201` si se creó, `200` si ya existía: la pantalla distingue sin adivinar.
   */
  create = async (req, res) => {
    const { tipo, yaExistia } = await incidentTypeService.create(req.body)

    if (yaExistia) return ok(res, { tipo }, 'Ese tipo de incidencia ya existía')

    req.log.info('Tipo de incidencia creado', { tipoId: tipo._id, nombre: tipo.nombre })
    return created(res, { tipo }, 'Tipo de incidencia creado')
  }

  /** PATCH /tipos-incidencia/:id — renombrar. */
  update = async (req, res) => {
    const datos = await incidentTypeService.update(req.params.id, req.body)
    return ok(res, datos, 'Tipo de incidencia actualizado')
  }

  /** PATCH /tipos-incidencia/:id/estado — dar de baja o reactivar. */
  setEstado = async (req, res) => {
    const datos = await incidentTypeService.setEstado(req.params.id, req.body.activo)

    req.log.info('Tipo de incidencia actualizado', {
      tipoId: req.params.id,
      activo: datos.tipo.activo
    })
    return ok(
      res,
      datos,
      datos.tipo.activo
        ? 'Tipo de incidencia reactivado'
        : 'Tipo de incidencia dado de baja'
    )
  }
}

module.exports = new IncidentTypeController()
