const alertService = require('./alertService')
const { ok } = require('../../../utils/response')
const { empresaFiltro } = require('../../../middlewares/scopeMiddleware')

/** HTTP de la bandeja de alertas (spec §6.6, D-47). */
class AlertController {
  #contexto(req) {
    return {
      user: req.user,
      empresasVisibles: req.empresasVisibles,
      areasPorEmpresa: req.areasPorEmpresa
    }
  }

  /** GET /alertas */
  list = async (req, res) => {
    // Valida que la empresa pedida esté dentro del alcance (404 si no).
    if (req.query.empresaId) empresaFiltro(req, req.query.empresaId)

    const datos = await alertService.list(
      {
        tipo: req.query.tipo,
        origen: req.query.origen,
        empresaId: req.query.empresaId,
        area: req.query.area,
        empleadoId: req.query.empleadoId,
        diasCumpleanos:
          req.query.diasCumpleanos === undefined
            ? undefined
            : Number(req.query.diasCumpleanos)
      },
      this.#contexto(req)
    )

    return ok(res, datos)
  }
}

module.exports = new AlertController()
