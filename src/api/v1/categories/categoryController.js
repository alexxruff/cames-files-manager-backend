const categoryService = require('./categoryService')
const { ok, created } = require('../../../utils/response')

/** HTTP de categorías (backend-spec §6.2). */
class CategoryController {
  /** GET /categorias?tipo=&incluirInactivas=&busqueda= */
  list = async (req, res) => {
    const datos = await categoryService.list({
      tipo: req.query.tipo,
      incluirInactivas: req.query.incluirInactivas === 'true',
      busqueda: req.query.busqueda
    })
    return ok(res, datos)
  }

  /**
   * POST /categorias — idempotente por nombre.
   * `201` si se creó, `200` si ya existía: la interfaz distingue sin adivinar.
   */
  create = async (req, res) => {
    const { categoria, creada } = await categoryService.create(req.body)

    if (!creada) {
      return ok(res, { categoria }, 'Esa categoría ya existía')
    }

    req.log.info('Categoría creada', { categoriaId: categoria._id, tipo: categoria.tipo })
    return created(res, { categoria }, 'Categoría creada correctamente')
  }

  /** PATCH /categorias/:id/estado */
  setEstado = async (req, res) => {
    const datos = await categoryService.setEstado(req.params.id, req.body.activo)
    return ok(res, datos, 'Categoría actualizada')
  }
}

module.exports = new CategoryController()
