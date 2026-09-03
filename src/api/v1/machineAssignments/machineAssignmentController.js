const machineAssignmentService = require('./machineAssignmentService')
const { ok, created } = require('../../../utils/response')

/** HTTP de la asignación de maquinaria (D-87). */
class MachineAssignmentController {
  #contexto(req) {
    return {
      user: req.user,
      empresasVisibles: req.empresasVisibles,
      areasPorEmpresa: req.areasPorEmpresa
    }
  }

  /** POST /maquinas/:id/asignacion */
  asignar = async (req, res) => {
    const datos = await machineAssignmentService.asignar(
      req.params.id,
      req.body,
      this.#contexto(req)
    )

    req.log.info('Máquina asignada', {
      maquinaId: req.params.id,
      empleadoId: req.body.empleadoId,
      proyectoId: datos.maquina.asignacion?.proyectoId,
      liberadaDe: datos.liberada?.empleadoId ?? null
    })

    return created(
      res,
      datos,
      datos.liberada
        ? 'Máquina asignada; se le quitó a quien la tenía'
        : 'Máquina asignada'
    )
  }

  /** POST /maquinas/:id/devolucion */
  devolver = async (req, res) => {
    const datos = await machineAssignmentService.devolver(
      req.params.id,
      req.body,
      this.#contexto(req)
    )

    req.log.info('Máquina devuelta', {
      maquinaId: req.params.id,
      tramoId: datos.devuelta._id
    })

    return ok(res, datos, 'Máquina devuelta')
  }

  /** GET /maquinas/:id/historial */
  historial = async (req, res) => {
    const datos = await machineAssignmentService.historial(
      req.params.id,
      this.#contexto(req)
    )
    return ok(res, datos)
  }

  /** GET /proyectos/:id/maquinas */
  deLaObra = async (req, res) => {
    const datos = await machineAssignmentService.deLaObra(
      req.params.id,
      this.#contexto(req)
    )
    return ok(res, datos)
  }

  /** GET /empleados/:id/maquinas */
  delTrabajador = async (req, res) => {
    const datos = await machineAssignmentService.delTrabajador(
      req.params.id,
      this.#contexto(req)
    )
    return ok(res, datos)
  }
}

module.exports = new MachineAssignmentController()
