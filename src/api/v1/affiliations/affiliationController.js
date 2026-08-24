const affiliationService = require('./affiliationService')
const { ok, created } = require('../../../utils/response')

/** HTTP de adscripciones: empresa ↔ empleado (backend-spec §6.3). */
class AffiliationController {
  #contexto(req) {
    return {
      user: req.user,
      empresasVisibles: req.empresasVisibles,
      areasPorEmpresa: req.areasPorEmpresa
    }
  }

  /** GET /empresas/:id/adscripciones */
  list = async (req, res) => {
    const datos = await affiliationService.list(
      req.params.id,
      {
        activo: req.query.activo === undefined ? undefined : req.query.activo === 'true',
        area: req.query.area
      },
      this.#contexto(req)
    )
    return ok(res, datos)
  }

  /** POST /empresas/:id/adscripciones */
  add = async (req, res) => {
    const { adscripcion, reactivada } = await affiliationService.add(
      req.params.id,
      req.body,
      this.#contexto(req)
    )

    req.log.info(
      reactivada ? 'Adscripción reactivada' : 'Persona adscrita a la empresa',
      { empresaId: req.params.id, empleadoId: adscripcion.empleadoId }
    )

    return reactivada
      ? ok(res, { adscripcion }, 'Esa persona volvió a estar adscrita a la empresa')
      : created(res, { adscripcion }, 'Persona adscrita a la empresa')
  }

  /** PATCH /adscripciones/:id */
  update = async (req, res) => {
    const datos = await affiliationService.update(
      req.params.id,
      req.body,
      this.#contexto(req)
    )
    return ok(res, datos, 'Adscripción actualizada')
  }

  /** PATCH /adscripciones/:id/estado */
  setEstado = async (req, res) => {
    const datos = await affiliationService.setEstado(
      req.params.id,
      { activo: req.body.activo, motivo: req.body.motivo },
      this.#contexto(req)
    )
    return ok(
      res,
      datos,
      req.body.activo ? 'Adscripción reactivada' : 'Persona dada de baja de esta empresa'
    )
  }
}

module.exports = new AffiliationController()
