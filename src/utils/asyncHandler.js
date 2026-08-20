/**
 * Envuelve un handler async y manda cualquier rechazo al errorHandler.
 *
 * Evita el `try { … } catch (e) { next(e) }` repetido en cada método de cada
 * controlador de `talentlink-backend`, donde además era fácil olvidar el
 * `next(error)` y dejar la petición colgada.
 *
 *   router.get('/', asyncHandler(controller.list))
 */
function asyncHandler(fn) {
  return function envuelto(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

module.exports = asyncHandler
