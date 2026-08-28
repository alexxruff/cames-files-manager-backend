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
