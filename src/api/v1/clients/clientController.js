const clientService = require('./clientService')
const { ok, created } = require('../../../utils/response')

/** HTTP de clientes (backend-spec §6.2). */
class ClientController {
  #contexto(req) {
    return { user: req.user, empresasVisibles: req.empresasVisibles }
  }

  /** El archivo adjunto de un `multipart`, o `null` si no vino ninguno. */
  #archivo(req) {
    return req.file
      ? { buffer: req.file.buffer, nombreOriginal: req.file.originalname }
      : null
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

  // ─── Registros de obra (D-66) ─────────────────────────────────────────────

  /**
   * POST /clientes/:id/registros-obra — idempotente por número.
   *
   * `application/json` o `multipart/form-data` con el campo `archivo`, que es
   * **opcional** (D-79): el dato es el número; el papel puede llegar después.
   */
  addRegistroObra = async (req, res) => {
    const { cliente, registro, yaExistia } = await clientService.agregarRegistroObra(
      req.params.id,
      { ...req.body, archivo: this.#archivo(req) },
      this.#contexto(req)
    )

    if (yaExistia)
      return ok(res, { cliente, registro }, 'Ese registro de obra ya existía')

    req.log.info('Registro de obra agregado', {
      clienteId: req.params.id,
      numero: registro.numero
    })
    return created(res, { cliente, registro }, 'Registro de obra agregado')
  }

  /**
   * PATCH /clientes/:id/registros-obra/:roId
   *
   * Igual que el alta, acepta `multipart`: mandar sólo el archivo **reemplaza**
   * el que hubiera, y el anterior se borra del almacenamiento.
   */
  updateRegistroObra = async (req, res) => {
    const datos = await clientService.actualizarRegistroObra(
      req.params.id,
      req.params.roId,
      { ...req.body, archivo: this.#archivo(req) },
      this.#contexto(req)
    )
    return ok(
      res,
      datos,
      req.file ? 'Archivo del registro de obra guardado' : 'Registro de obra actualizado'
    )
  }

  /**
   * GET /clientes/:id/registros-obra/:roId/archivo
   *
   * Un enlace fresco al papel del registro. `?descargar=true` fuerza la
   * descarga; los tipos que el navegador no previsualiza se descargan siempre.
   */
  urlArchivoRegistroObra = async (req, res) => {
    const datos = await clientService.urlDeArchivoRegistroObra(
      req.params.id,
      req.params.roId,
      { ...this.#contexto(req), descargar: req.query.descargar === 'true' }
    )
    return ok(res, datos)
  }

  /** PATCH /clientes/:id/registros-obra/:roId/estado */
  setEstadoRegistroObra = async (req, res) => {
    const datos = await clientService.setEstadoRegistroObra(
      req.params.id,
      req.params.roId,
      req.body.activo,
      this.#contexto(req)
    )
    return ok(
      res,
      datos,
      datos.registro.activo
        ? 'Registro de obra reactivado'
        : 'Registro de obra dado de baja'
    )
  }
}

module.exports = new ClientController()
