const companyService = require('./companyService')
const { ok, created } = require('../../../utils/response')

/** HTTP de empresas (backend-spec §6.3). */
class CompanyController {
  /** GET /empresas */
  list = async (req, res) => {
    const datos = await companyService.list(
      {
        incluirInactivas: req.query.incluirInactivas === 'true',
        busqueda: req.query.busqueda
      },
      { empresasVisibles: req.empresasVisibles }
    )
    return ok(res, datos)
  }

  /** GET /empresas/:id */
  getById = async (req, res) => {
    const datos = await companyService.getById(req.params.id, {
      empresasVisibles: req.empresasVisibles
    })
    return ok(res, datos)
  }

  /** POST /empresas — sólo administrador de plataforma */
  create = async (req, res) => {
    const datos = await companyService.create(req.body)
    req.log.info('Empresa creada', {
      empresaId: datos.empresa._id,
      nombre: datos.empresa.nombre
    })
    return created(res, datos, 'Empresa creada correctamente')
  }

  /** PATCH /empresas/:id — corregir datos, incluidos los registros patronales */
  update = async (req, res) => {
    const datos = await companyService.update(req.params.id, req.body)

    req.log.info('Empresa actualizada', {
      empresaId: req.params.id,
      campos: Object.keys(req.body)
    })
    return ok(res, datos, 'Empresa actualizada')
  }

  // ─── Registros patronales (D-65) ──────────────────────────────────────────

  /**
   * POST /empresas/:id/registros-patronales — idempotente por número.
   * `201` si se creó, `200` si ya existía: la interfaz distingue sin adivinar.
   */
  addRegistroPatronal = async (req, res) => {
    const { empresa, registro, yaExistia } = await companyService.agregarRegistroPatronal(
      req.params.id,
      req.body
    )

    if (yaExistia) {
      return ok(res, { empresa, registro }, 'Ese registro patronal ya existía')
    }

    req.log.info('Registro patronal agregado', {
      empresaId: req.params.id,
      numero: registro.numero
    })
    return created(res, { empresa, registro }, 'Registro patronal agregado')
  }

  /** PATCH /empresas/:id/registros-patronales/:rpId */
  updateRegistroPatronal = async (req, res) => {
    const datos = await companyService.actualizarRegistroPatronal(
      req.params.id,
      req.params.rpId,
      req.body
    )
    return ok(res, datos, 'Registro patronal actualizado')
  }

  /** PATCH /empresas/:id/registros-patronales/:rpId/estado */
  setEstadoRegistroPatronal = async (req, res) => {
    const datos = await companyService.setEstadoRegistroPatronal(
      req.params.id,
      req.params.rpId,
      req.body.activo
    )
    return ok(
      res,
      datos,
      datos.registro.activo
        ? 'Registro patronal reactivado'
        : 'Registro patronal dado de baja'
    )
  }

  /** PATCH /empresas/:id/estado — baja y reactivación */
  setEstado = async (req, res) => {
    const datos = await companyService.setEstado(req.params.id, req.body.activo)

    req.log.info('Estado de empresa actualizado', {
      empresaId: req.params.id,
      activo: datos.empresa.activo
    })
    return ok(
      res,
      datos,
      datos.empresa.activo ? 'Empresa reactivada' : 'Empresa dada de baja'
    )
  }
}

module.exports = new CompanyController()
