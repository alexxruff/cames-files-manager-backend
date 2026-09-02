const contractService = require('./contractService')
const { ok, created } = require('../../../utils/response')

/** HTTP de contratos y SIROC (backend-spec §6.7, D-70). */
class ContractController {
  /** El archivo de multer, en la forma que espera el servicio. `null` si no vino. */
  #archivo(req) {
    return req.file
      ? { buffer: req.file.buffer, nombreOriginal: req.file.originalname }
      : null
  }

  #contexto(req) {
    return {
      user: req.user,
      empresasVisibles: req.empresasVisibles,
      areasPorEmpresa: req.areasPorEmpresa
    }
  }

  /** GET /proyectos/:id/contratos?incluirInactivos= */
  listByProject = async (req, res) => {
    const datos = await contractService.listByProject(
      req.params.id,
      { incluirInactivos: req.query.incluirInactivos === 'true' },
      this.#contexto(req)
    )
    return ok(res, datos)
  }

  /** POST /proyectos/:id/contratos */
  create = async (req, res) => {
    const datos = await contractService.create(
      req.params.id,
      req.body,
      this.#contexto(req)
    )
    req.log.info('Contrato creado', {
      proyectoId: req.params.id,
      contratoId: datos.contrato._id,
      numero: datos.contrato.numero
    })
    return created(res, datos, 'Contrato creado')
  }

  /** PATCH /contratos/:id */
  update = async (req, res) => {
    const datos = await contractService.update(
      req.params.id,
      req.body,
      this.#contexto(req)
    )
    return ok(res, datos, 'Contrato actualizado')
  }

  /**
   * PUT /contratos/:id/siroc
   *
   * Acepta `multipart` con el aviso escaneado en el campo `archivo`, opcional
   * (D-80). Sin archivo se sigue pudiendo mandar JSON, y corregir el número no
   * tira el papel que ya estaba.
   */
  setSiroc = async (req, res) => {
    const datos = await contractService.setSiroc(
      req.params.id,
      { ...req.body, archivo: this.#archivo(req) },
      this.#contexto(req)
    )
    req.log.info('SIROC registrado', {
      contratoId: req.params.id,
      numero: datos.contrato.siroc?.numero
    })
    return ok(
      res,
      datos,
      req.file ? 'SIROC registrado con su archivo' : 'SIROC registrado'
    )
  }

  /** DELETE /contratos/:id/siroc */
  quitarSiroc = async (req, res) => {
    const datos = await contractService.quitarSiroc(req.params.id, this.#contexto(req))
    req.log.info('SIROC retirado', { contratoId: req.params.id })
    return ok(res, datos, 'SIROC retirado del contrato')
  }

  /**
   * POST /contratos/:id/siroc/actualizaciones
   *
   * Igual que el alta del aviso, acepta `multipart`: el `archivo` que venga es
   * el acuse de ESTA renovación, no el del SIROC original (D-80).
   */
  registrarActualizacion = async (req, res) => {
    const datos = await contractService.registrarActualizacion(
      req.params.id,
      { ...req.body, archivo: this.#archivo(req) },
      this.#contexto(req)
    )
    req.log.info('SIROC actualizado', {
      contratoId: req.params.id,
      numero: datos.contrato.siroc?.numero,
      actualizaciones: datos.contrato.siroc?.actualizaciones?.length
    })
    return created(res, datos, 'Actualización del SIROC registrada')
  }

  /** DELETE /contratos/:id/siroc/actualizaciones/ultima */
  quitarUltimaActualizacion = async (req, res) => {
    const datos = await contractService.quitarUltimaActualizacion(
      req.params.id,
      this.#contexto(req)
    )
    req.log.info('Actualización de SIROC deshecha', { contratoId: req.params.id })
    return ok(res, datos, 'Última actualización del SIROC deshecha')
  }

  /**
   * GET /contratos/:id/siroc/archivo
   *
   * Un enlace fresco al aviso escaneado. `?descargar=true` fuerza la descarga;
   * los tipos que el navegador no previsualiza se descargan siempre.
   */
  urlArchivoSiroc = async (req, res) => {
    const datos = await contractService.urlDeArchivoSiroc(req.params.id, {
      ...this.#contexto(req),
      descargar: req.query.descargar === 'true'
    })
    return ok(res, datos)
  }

  /** GET /contratos/:id/siroc/actualizaciones/:indice/archivo */
  urlArchivoActualizacion = async (req, res) => {
    const datos = await contractService.urlDeArchivoActualizacion(
      req.params.id,
      Number(req.params.indice),
      { ...this.#contexto(req), descargar: req.query.descargar === 'true' }
    )
    return ok(res, datos)
  }

  /**
   * PUT /contratos/:id/siroc/actualizaciones/:indice/archivo
   *
   * Le pone el acuse a una renovación ya capturada, o reemplaza el que tenga.
   * No toca ningún otro dato de la actualización.
   */
  subirArchivoActualizacion = async (req, res) => {
    const datos = await contractService.reemplazarArchivoActualizacion(
      req.params.id,
      Number(req.params.indice),
      this.#archivo(req),
      this.#contexto(req)
    )
    req.log.info('Acuse de actualización del SIROC guardado', {
      contratoId: req.params.id,
      indice: req.params.indice
    })
    return ok(res, datos, 'Acuse de la actualización guardado')
  }

  /** POST /contratos/:id/finalizar */
  finalizar = async (req, res) => {
    const datos = await contractService.finalizar(req.params.id, this.#contexto(req))
    return ok(res, datos, 'Contrato finalizado')
  }

  /** POST /contratos/:id/reabrir */
  reabrir = async (req, res) => {
    const datos = await contractService.reabrir(req.params.id, this.#contexto(req))
    return ok(res, datos, 'Contrato reabierto')
  }

  /** PATCH /contratos/:id/estado — la baja, no el ciclo de vida. */
  setEstado = async (req, res) => {
    const datos = await contractService.setEstado(
      req.params.id,
      req.body,
      this.#contexto(req)
    )
    return ok(
      res,
      datos,
      req.body.activo ? 'Contrato reactivado' : 'Contrato dado de baja'
    )
  }
}

module.exports = new ContractController()
