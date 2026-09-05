const { MODULES } = require('../../../utils/modules')
const { ok } = require('../../../utils/response')

/**
 * HTTP del catálogo de módulos (D-95).
 *
 * Es un catálogo **estático**: sale del código, no de una colección, así que no
 * hay servicio ni modelo — igual que `/permisos`. Existe para que la pantalla
 * que da de alta una empresa sepa qué casillas ofrecer y, sobre todo, **cuáles
 * se pueden apagar**: los obligatorios ni siquiera se pintan.
 */
class ModuleController {
  /**
   * GET /modulos
   *
   * Qué módulos existen, en el orden en que se pintan, y cuáles son opcionales.
   * Lo que cada empresa tiene activo NO va aquí: eso es de la empresa, y está en
   * `GET /empresas/:id/modulos` y en `empresas[].modulos` de la sesión.
   */
  list = async (req, res) => {
    return ok(res, { modulos: MODULES.map((modulo) => ({ ...modulo })) })
  }
}

module.exports = new ModuleController()
