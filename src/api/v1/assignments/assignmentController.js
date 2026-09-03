const assignmentService = require('./assignmentService')
const { ok, created } = require('../../../utils/response')

/** HTTP de asignaciones: proyecto ↔ empleado (backend-spec §6.4). */
class AssignmentController {
  #contexto(req) {
    return {
      user: req.user,
      empresasVisibles: req.empresasVisibles,
      areasPorEmpresa: req.areasPorEmpresa
    }
  }

  /** GET /proyectos/:id/asignaciones?activo= */
  listByProject = async (req, res) => {
    const datos = await assignmentService.listByProject(
      req.params.id,
      {
        activo: req.query.activo === undefined ? undefined : req.query.activo === 'true'
      },
      this.#contexto(req)
    )
    return ok(res, datos)
  }

  /** GET /proyectos/:id/asignables — el selector de personal */
  asignables = async (req, res) => {
    const datos = await assignmentService.asignables(req.params.id, this.#contexto(req))
    return ok(res, datos)
  }

  /** GET /asignaciones/:id — el detalle, con la cadena resuelta (Fase 6) */
  getById = async (req, res) => {
    const datos = await assignmentService.getById(req.params.id, this.#contexto(req))
    return ok(res, datos)
  }

  /** POST /proyectos/:id/asignaciones */
  create = async (req, res) => {
    const datos = await assignmentService.create(
      req.params.id,
      req.body,
      this.#contexto(req)
    )
    req.log.info('Personal asignado', {
      proyectoId: req.params.id,
      empleadoId: req.body.empleadoId,
      avisos: datos.avisos.length
    })
    /*
     * El aviso de G2 viaja en `message` además de en `avisos` para que salga en
     * la interfaz aunque el front todavía no lea el campo nuevo. No cambia el
     * código: sigue siendo 201, porque la asignación se hizo.
     */
    return created(res, datos, datos.avisos[0] || 'Personal asignado al proyecto')
  }

  /** PATCH /asignaciones/:id/salida — cierra, no borra */
  salida = async (req, res) => {
    const datos = await assignmentService.salida(
      req.params.id,
      req.body,
      this.#contexto(req)
    )
    req.log.info('Asignación cerrada', {
      asignacionId: req.params.id,
      fechaSalida: req.body.fechaSalida,
      maquinasLiberadas: datos.maquinasLiberadas.length
    })
    /*
     * Si dejó máquinas, el mensaje lo dice: quien cierra la asignación es quien
     * puede hacer algo al respecto, y en ese momento.
     */
    return ok(
      res,
      datos,
      datos.avisos.length > 0
        ? `Asignación cerrada. ${datos.avisos.join(' ')}`
        : 'Asignación cerrada. Queda en el historial del proyecto.'
    )
  }
}

module.exports = new AssignmentController()
