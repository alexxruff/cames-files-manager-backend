const recordService = require('./recordService')
const { ok, created } = require('../../../utils/response')
const { CAMPO } = require('../../../middlewares/uploadMiddleware')
const { empresaFiltro } = require('../../../middlewares/scopeMiddleware')

/** HTTP de expedientes y sus documentos (backend-spec §6.5). */
class RecordController {
  #contexto(req) {
    return {
      user: req.user,
      empresasVisibles: req.empresasVisibles,
      areasPorEmpresa: req.areasPorEmpresa,
      ip: req.ip,
      userAgent: req.get('user-agent') || null
    }
  }

  /** GET /expedientes — paginado, con los mismos filtros que /empleados */
  list = async (req, res) => {
    // Valida que la empresa pedida esté dentro del alcance (404 si no).
    if (req.query.empresaId) empresaFiltro(req, req.query.empresaId)

    const datos = await recordService.list(
      {
        busqueda: req.query.busqueda,
        empresaId: req.query.empresaId,
        area: req.query.area,
        estatus: req.query.estatus,
        activo: req.query.activo,
        orden: req.query.orden,
        pagina: req.query.pagina,
        porPagina: req.query.porPagina
      },
      this.#contexto(req)
    )
    return ok(res, datos)
  }

  /** GET /empleados/:id/expediente */
  porEmpleado = async (req, res) => {
    const datos = await recordService.porEmpleado(req.params.id, this.#contexto(req))
    return ok(res, datos)
  }

  /** GET /expedientes/:id */
  porId = async (req, res) => {
    const datos = await recordService.porId(req.params.id, this.#contexto(req))
    return ok(res, datos)
  }

  /** POST /expedientes/:id/documentos/:tipo — multipart: `archivo` + `vigenciaHasta?` */
  subirDocumento = async (req, res) => {
    const datos = await recordService.subirDocumento(
      req.params.id,
      req.params.tipo,
      {
        archivo: req.file
          ? { buffer: req.file.buffer, nombreOriginal: req.file.originalname }
          : null,
        vigenciaHasta: req.body?.vigenciaHasta || null
      },
      this.#contexto(req)
    )

    req.log.info('Documento subido', {
      expedienteId: req.params.id,
      tipo: req.params.tipo,
      bytes: req.file?.size
    })

    return created(
      res,
      datos,
      'Documento subido. Queda en revisión hasta que Recursos Humanos lo valide.'
    )
  }

  /**
   * POST /expedientes/:id/documentos/:tipo/revisar — `{ aprobado, motivo? }`.
   * Un solo endpoint para validar y rechazar (D-43): `aprobado: true` valida,
   * `aprobado: false` rechaza con `motivo`.
   */
  revisarDocumento = async (req, res) => {
    const { aprobado, motivo } = req.body
    const datos = await recordService.revisarDocumento(
      req.params.id,
      req.params.tipo,
      { aprobado, motivo },
      this.#contexto(req)
    )

    req.log.info('Documento revisado', {
      expedienteId: req.params.id,
      tipo: req.params.tipo,
      aprobado
    })

    return ok(res, datos, aprobado ? 'Documento validado.' : 'Documento rechazado.')
  }

  /**
   * GET /expedientes/:id/documentos/:tipo/versiones/:version/url
   *
   * URL firmada de corta vida. `?descargar=true` para forzar la descarga en vez
   * de abrirlo en el navegador. **Queda registrado en la bitácora.**
   */
  urlDeVersion = async (req, res) => {
    const datos = await recordService.urlDeVersion(
      req.params.id,
      req.params.tipo,
      req.params.version,
      { ...this.#contexto(req), descargar: req.query.descargar === 'true' }
    )

    req.log.info('URL firmada emitida', {
      expedienteId: req.params.id,
      tipo: req.params.tipo,
      version: req.params.version
    })

    return ok(res, datos)
  }

  /** El nombre del campo del multipart, para los mensajes de error. */
  static get CAMPO_ARCHIVO() {
    return CAMPO
  }
}

module.exports = new RecordController()
