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

  /** Si esta petición trae papel, por el camino que sea (D-83). */
  #trajoArchivo(req) {
    return Boolean(req.file || req.body?.subidaId)
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

  /**
   * POST /proyectos/:id/contratos
   *
   * Acepta `multipart` con el contrato escaneado en el campo `archivo`, opcional
   * (D-81), y sigue aceptando el mismo JSON de siempre.
   */
  create = async (req, res) => {
    const datos = await contractService.create(
      req.params.id,
      { ...req.body, archivo: this.#archivo(req) },
      this.#contexto(req)
    )
    req.log.info('Contrato creado', {
      proyectoId: req.params.id,
      contratoId: datos.contrato._id,
      numero: datos.contrato.numero
    })
    return created(res, datos, 'Contrato creado')
  }

  /**
   * PUT /contratos/:id/archivo
   *
   * Sube el contrato escaneado, o reemplaza el que tenga. Es lo que quedó del
   * `PATCH` que se fue (D-90): quien captura no siempre tiene el papel a la mano.
   */
  subirArchivoContrato = async (req, res) => {
    const datos = await contractService.reemplazarArchivoContrato(
      req.params.id,
      { ...req.body, archivo: this.#archivo(req) },
      this.#contexto(req)
    )
    req.log.info('Contrato escaneado guardado', { contratoId: req.params.id })
    return ok(res, datos, 'Contrato escaneado guardado')
  }

  /**
   * POST /contratos/:id/modificaciones
   *
   * Acepta `multipart` con el convenio modificatorio en el campo `archivo`,
   * opcional (D-90), y el mismo JSON sin él.
   */
  registrarModificacion = async (req, res) => {
    const datos = await contractService.registrarModificacion(
      req.params.id,
      { ...req.body, archivo: this.#archivo(req) },
      this.#contexto(req)
    )
    req.log.info('Contrato modificado', {
      contratoId: req.params.id,
      modificaciones: datos.contrato.historia?.entradas?.length
    })
    return created(res, datos, 'Modificación del contrato registrada')
  }

  /** DELETE /contratos/:id/modificaciones/ultima */
  quitarUltimaModificacion = async (req, res) => {
    const datos = await contractService.quitarUltimaModificacion(
      req.params.id,
      this.#contexto(req)
    )
    req.log.info('Modificación del contrato deshecha', { contratoId: req.params.id })
    return ok(res, datos, 'Última modificación del contrato deshecha')
  }

  /** GET /contratos/:id/modificaciones/:indice/archivo */
  urlArchivoModificacion = async (req, res) => {
    const datos = await contractService.urlDeArchivoModificacion(
      req.params.id,
      Number(req.params.indice),
      { ...this.#contexto(req), descargar: req.query.descargar === 'true' }
    )
    return ok(res, datos)
  }

  /**
   * PUT /contratos/:id/modificaciones/:indice/archivo
   *
   * Le pone el convenio a una modificación ya capturada, o reemplaza el que
   * tenga. No toca ningún otro dato de la modificación.
   */
  subirArchivoModificacion = async (req, res) => {
    const datos = await contractService.reemplazarArchivoModificacion(
      req.params.id,
      Number(req.params.indice),
      { ...req.body, archivo: this.#archivo(req) },
      this.#contexto(req)
    )
    req.log.info('Convenio modificatorio guardado', {
      contratoId: req.params.id,
      indice: req.params.indice
    })
    return ok(res, datos, 'Convenio modificatorio guardado')
  }

  /**
   * GET /contratos/:id/archivo
   *
   * Un enlace fresco al contrato escaneado. `?descargar=true` fuerza la
   * descarga; los tipos que el navegador no previsualiza se descargan siempre.
   */
  urlArchivoContrato = async (req, res) => {
    const datos = await contractService.urlDeArchivoContrato(req.params.id, {
      ...this.#contexto(req),
      descargar: req.query.descargar === 'true'
    })
    return ok(res, datos)
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
      this.#trajoArchivo(req) ? 'SIROC registrado con su archivo' : 'SIROC registrado'
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
    return created(res, datos, 'Reporte bimestral del SIROC registrado')
  }

  /** DELETE /contratos/:id/siroc/actualizaciones/ultima */
  quitarUltimaActualizacion = async (req, res) => {
    const datos = await contractService.quitarUltimaActualizacion(
      req.params.id,
      this.#contexto(req)
    )
    req.log.info('Actualización de SIROC deshecha', { contratoId: req.params.id })
    return ok(res, datos, 'Último reporte bimestral del SIROC deshecho')
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
      { ...req.body, archivo: this.#archivo(req) },
      this.#contexto(req)
    )
    req.log.info('Acuse de actualización del SIROC guardado', {
      contratoId: req.params.id,
      indice: req.params.indice
    })
    return ok(res, datos, 'Acuse del reporte bimestral guardado')
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

  /**
   * DELETE /contratos/:id — borrarlo de verdad, con todo lo suyo (D-90).
   *
   * Devuelve **qué se llevó** —el SIROC, cuántos reportes bimestrales, cuántas
   * modificaciones y cuántos archivos—: es lo que la pantalla necesita para
   * advertirlo antes y para confirmarlo después.
   */
  eliminar = async (req, res) => {
    const datos = await contractService.eliminar(req.params.id, this.#contexto(req))
    req.log.warn('Contrato eliminado', {
      contratoId: req.params.id,
      ...datos.eliminado
    })
    return ok(res, datos, 'Contrato eliminado')
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
