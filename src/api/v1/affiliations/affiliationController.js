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
        activo: req.query.activo,
        area: req.query.area,
        categoriaId: req.query.categoriaId,
        orden: req.query.orden
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

  /** PATCH /adscripciones/:id/jefaturas — qué áreas dirige (D-60) */
  setJefaturas = async (req, res) => {
    const datos = await affiliationService.setJefaturas(
      req.params.id,
      req.body.dirigeAreas,
      this.#contexto(req)
    )

    req.log.info('Jefaturas de área actualizadas', {
      adscripcionId: req.params.id,
      dirigeAreas: datos.adscripcion.dirigeAreas
    })
    return ok(res, datos, 'Jefaturas actualizadas')
  }

  /** PATCH /adscripciones/:id/rol — el rol de esta persona en esta empresa (D-94). */
  setRol = async (req, res) => {
    const datos = await affiliationService.setRol(
      req.params.id,
      req.body.rolId ?? null,
      this.#contexto(req)
    )

    req.log.info('Rol de la adscripción actualizado', {
      adscripcionId: req.params.id,
      rolId: datos.adscripcion.rolId
    })

    return ok(res, datos, 'Rol actualizado correctamente')
  }

  /** GET /empresas/:id/jefaturas — quién dirige cada área (D-60) */
  jefaturas = async (req, res) => {
    const datos = await affiliationService.jefaturas(req.params.id, this.#contexto(req))
    return ok(res, datos)
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
