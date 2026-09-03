const machineService = require('./machineService')
const { ok, created } = require('../../../utils/response')

/** HTTP del catálogo de maquinaria (D-86). */
class MachineController {
  /** El archivo de multer, en la forma que espera el servicio. `null` si no vino. */
  #archivo(req) {
    return req.file
      ? { buffer: req.file.buffer, nombreOriginal: req.file.originalname }
      : null
  }

  /** Si esta petición trae imagen, por el camino que sea (D-83). */
  #trajoImagen(req) {
    return Boolean(req.file || req.body?.subidaId)
  }

  #contexto(req) {
    return {
      user: req.user,
      empresasVisibles: req.empresasVisibles,
      areasPorEmpresa: req.areasPorEmpresa
    }
  }

  /** GET /empresas/:id/maquinas?incluirInactivas=&busqueda= */
  listByCompany = async (req, res) => {
    const datos = await machineService.listByCompany(
      req.params.id,
      {
        incluirInactivas: req.query.incluirInactivas === 'true',
        busqueda: req.query.busqueda
      },
      this.#contexto(req)
    )
    return ok(res, datos)
  }

  /**
   * POST /empresas/:id/maquinas
   *
   * Acepta `multipart` con la foto en el campo `archivo`, opcional, o el mismo
   * JSON con `subidaId` (D-83).
   */
  create = async (req, res) => {
    const datos = await machineService.create(
      req.params.id,
      { ...req.body, archivo: this.#archivo(req) },
      this.#contexto(req)
    )
    req.log.info('Máquina creada', {
      empresaId: req.params.id,
      maquinaId: datos.maquina._id,
      identificador: datos.maquina.identificador
    })
    return created(res, datos, 'Máquina creada')
  }

  /** GET /maquinas/:id */
  getById = async (req, res) => {
    const datos = await machineService.getById(req.params.id, this.#contexto(req))
    return ok(res, datos)
  }

  /**
   * PATCH /maquinas/:id
   *
   * También por `multipart`: mandar sólo la imagen, sin ningún campo, es cómo se
   * le pone la foto a una máquina ya dada de alta.
   */
  update = async (req, res) => {
    const datos = await machineService.update(
      req.params.id,
      { ...req.body, archivo: this.#archivo(req) },
      this.#contexto(req)
    )
    return ok(
      res,
      datos,
      this.#trajoImagen(req) ? 'Máquina actualizada con su imagen' : 'Máquina actualizada'
    )
  }

  /** PATCH /maquinas/:id/estado */
  setEstado = async (req, res) => {
    const datos = await machineService.setEstado(
      req.params.id,
      req.body,
      this.#contexto(req)
    )
    return ok(res, datos, req.body.activo ? 'Máquina reactivada' : 'Máquina dada de baja')
  }

  /**
   * GET /maquinas/:id/imagen
   *
   * Un enlace fresco a la foto. `?descargar=true` fuerza la descarga.
   */
  urlImagen = async (req, res) => {
    const datos = await machineService.urlDeImagen(req.params.id, {
      ...this.#contexto(req),
      descargar: req.query.descargar === 'true'
    })
    return ok(res, datos)
  }
}

module.exports = new MachineController()
