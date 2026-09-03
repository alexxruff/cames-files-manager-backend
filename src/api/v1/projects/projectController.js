const projectService = require('./projectService')
const { ok, created } = require('../../../utils/response')

/** HTTP de proyectos (backend-spec §6.4). */
class ProjectController {
  #contexto(req) {
    return {
      user: req.user,
      empresasVisibles: req.empresasVisibles,
      areasPorEmpresa: req.areasPorEmpresa
    }
  }

  /** GET /proyectos?empresaId=&estado=&clienteId=&busqueda=&pagina=&porPagina= */
  list = async (req, res) => {
    const datos = await projectService.list(
      {
        empresaId: req.query.empresaId,
        estado: req.query.estado,
        clienteId: req.query.clienteId,
        busqueda: req.query.busqueda,
        pagina: req.query.pagina,
        porPagina: req.query.porPagina
      },
      this.#contexto(req)
    )
    return ok(res, datos)
  }

  /** GET /proyectos/:id */
  getById = async (req, res) => {
    const datos = await projectService.getById(req.params.id, this.#contexto(req))
    return ok(res, datos)
  }

  /** POST /proyectos */
  create = async (req, res) => {
    const datos = await projectService.create(req.body, this.#contexto(req))
    req.log.info('Proyecto creado', {
      proyectoId: datos.proyecto._id,
      empresaId: datos.proyecto.empresaId
    })
    return created(res, datos, 'Proyecto creado correctamente')
  }

  /** PATCH /proyectos/:id */
  update = async (req, res) => {
    const datos = await projectService.update(
      req.params.id,
      req.body,
      this.#contexto(req)
    )
    req.log.info('Proyecto actualizado', {
      proyectoId: datos.proyecto._id,
      campos: Object.keys(req.body)
    })
    return ok(res, datos, 'Proyecto actualizado correctamente')
  }

  /** POST /proyectos/:id/aplazar */
  aplazar = async (req, res) => {
    const datos = await projectService.aplazar(
      req.params.id,
      req.body,
      this.#contexto(req)
    )
    req.log.info('Proyecto aplazado', {
      proyectoId: datos.proyecto._id,
      fechaNueva: req.body.fechaNueva
    })
    return ok(res, datos, 'Cierre aplazado. Queda registrado en el historial.')
  }

  /** POST /proyectos/:id/finalizar */
  finalizar = async (req, res) => {
    const datos = await projectService.finalizar(
      req.params.id,
      req.body,
      this.#contexto(req)
    )
    req.log.info('Proyecto finalizado', { proyectoId: datos.proyecto._id })
    return ok(
      res,
      datos,
      'Proyecto finalizado. Las asignaciones abiertas se cerraron con esa fecha.'
    )
  }

  /** POST /proyectos/:id/reabrir */
  reabrir = async (req, res) => {
    const datos = await projectService.reabrir(req.params.id, this.#contexto(req))
    req.log.info('Proyecto reabierto', { proyectoId: datos.proyecto._id })
    return ok(
      res,
      datos,
      'Proyecto reabierto. Vuelve a asignar al personal que necesites.'
    )
  }
}

module.exports = new ProjectController()
