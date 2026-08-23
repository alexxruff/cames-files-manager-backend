const clientService = require('./clientService')
const { ok, created } = require('../../../utils/response')

/** HTTP de clientes (backend-spec §6.2). */
class ClientController {
  #contexto(req) {
    return { user: req.user, empresasVisibles: req.empresasVisibles }
  }

  /** GET /clientes?busqueda=&incluirInactivos=&orden=&catalogoCompleto=&pagina=&porPagina= */
  list = async (req, res) => {
    const datos = await clientService.list(
      {
        busqueda: req.query.busqueda,
        incluirInactivos: req.query.incluirInactivos === 'true',
        orden: req.query.orden,
        catalogoCompleto: req.query.catalogoCompleto === 'true',
        pagina: req.query.pagina,
        porPagina: req.query.porPagina
      },
      this.#contexto(req)
    )
    return ok(res, datos)
  }

  /** GET /clientes/:id */
  getById = async (req, res) => {
    const datos = await clientService.getById(req.params.id, this.#contexto(req))
    return ok(res, datos)
  }

  /** POST /clientes */
  create = async (req, res) => {
    const datos = await clientService.create(req.body)
    req.log.info('Cliente creado', {
      clienteId: datos.cliente._id,
      nombre: datos.cliente.nombre
    })
    return created(res, datos, 'Cliente creado correctamente')
  }

  /** PATCH /clientes/:id */
  update = async (req, res) => {
    const datos = await clientService.update(req.params.id, req.body)
    req.log.info('Cliente actualizado', {
      clienteId: datos.cliente._id,
      campos: Object.keys(req.body)
    })
    return ok(res, datos, 'Cliente actualizado correctamente')
  }

  /** PATCH /clientes/:id/estado — baja lógica o reactivación */
  setEstado = async (req, res) => {
    const datos = await clientService.setEstado(req.params.id, req.body.activo)
    req.log.info(req.body.activo ? 'Cliente reactivado' : 'Cliente desactivado', {
      clienteId: datos.cliente._id
    })
    return ok(
      res,
      datos,
      req.body.activo
        ? 'Cliente reactivado'
        : 'Cliente desactivado. No se borra: su historial se conserva.'
    )
  }
}

module.exports = new ClientController()
