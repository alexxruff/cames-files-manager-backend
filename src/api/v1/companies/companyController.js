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
}

module.exports = new CompanyController()
