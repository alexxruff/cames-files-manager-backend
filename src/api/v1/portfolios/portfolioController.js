const portfolioService = require('./portfolioService')
const { ok, created } = require('../../../utils/response')

/** HTTP de carteras: empresa ↔ cliente (backend-spec §6.3). */
class PortfolioController {
  #contexto(req) {
    return { user: req.user, empresasVisibles: req.empresasVisibles }
  }

  /** GET /empresas/:id/clientes */
  list = async (req, res) => {
    const datos = await portfolioService.list(
      req.params.id,
      {
        activo: req.query.activo === undefined ? undefined : req.query.activo === 'true'
      },
      this.#contexto(req)
    )
    return ok(res, datos)
  }

  /** POST /empresas/:id/clientes */
  add = async (req, res) => {
    const { cartera, reactivada } = await portfolioService.add(
      req.params.id,
      req.body,
      this.#contexto(req)
    )

    req.log.info(
      reactivada ? 'Cliente reactivado en la cartera' : 'Cliente agregado a la cartera',
      {
        empresaId: req.params.id,
        clienteId: cartera.clienteId
      }
    )

    // 200 si se reactivó un vínculo que ya existía; 201 sólo si es nuevo.
    return reactivada
      ? ok(res, { cartera }, 'Ese cliente volvió a la cartera de la empresa')
      : created(res, { cartera }, 'Cliente agregado a la cartera')
  }

  /** PATCH /carteras/:id */
  update = async (req, res) => {
    const datos = await portfolioService.update(
      req.params.id,
      req.body,
      this.#contexto(req)
    )
    return ok(res, datos, 'Cartera actualizada')
  }

  /** PATCH /carteras/:id/estado */
  setEstado = async (req, res) => {
    const datos = await portfolioService.setEstado(
      req.params.id,
      req.body.activo,
      this.#contexto(req)
    )
    return ok(
      res,
      datos,
      req.body.activo ? 'Cliente devuelto a la cartera' : 'Cliente sacado de la cartera'
    )
  }
}

module.exports = new PortfolioController()
