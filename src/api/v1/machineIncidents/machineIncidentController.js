const machineIncidentService = require('./machineIncidentService')
const { ok, created } = require('../../../utils/response')

/** HTTP de las incidencias de maquinaria (D-88). */
class MachineIncidentController {
  #contexto(req) {
    return {
      user: req.user,
      empresasVisibles: req.empresasVisibles,
      areasPorEmpresa: req.areasPorEmpresa
    }
  }

  /** GET /maquinas/:id/incidencias?estado=abiertas|resueltas|todas */
  list = async (req, res) => {
    const datos = await machineIncidentService.list(
      req.params.id,
      { estado: req.query.estado || 'todas' },
      this.#contexto(req)
    )
    return ok(res, datos)
  }

  /** POST /maquinas/:id/incidencias */
  create = async (req, res) => {
    const datos = await machineIncidentService.create(
      req.params.id,
      req.body,
      this.#contexto(req)
    )
    req.log.info('Incidencia levantada', {
      maquinaId: req.params.id,
      incidenciaId: datos.incidencia._id,
      tipoId: datos.incidencia.tipoId
    })
    return created(res, datos, 'Incidencia registrada')
  }

  /** POST /incidencias/:id/resolucion */
  resolver = async (req, res) => {
    const datos = await machineIncidentService.resolver(
      req.params.id,
      req.body,
      this.#contexto(req)
    )
    req.log.info('Incidencia resuelta', {
      incidenciaId: req.params.id,
      fechaResolucion: datos.incidencia.fechaResolucion
    })
    return ok(res, datos, 'Incidencia resuelta')
  }
}

module.exports = new MachineIncidentController()
