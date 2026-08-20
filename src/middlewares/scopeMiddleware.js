const { AppError } = require('./errorHandler')
const { areaFilter } = require('../utils/permissions')

/**
 * Alcance multi-cliente (spec 4). LA PIEZA CRÍTICA DE SEGURIDAD.
 *
 * Deja en `req.scopeFilter` el filtro que TODA consulta de datos de
 * colaboradores debe incluir:
 *   - usuario `interno` → `{}` (ve lo de la casa y lo de todos los clientes)
 *   - usuario `cliente` → `{ clienteId: <el suyo> }`
 *
 * Y en `req.areaFilter` el filtro por área, para el jefe de área. Se combinan
 * con `req.dataFilter`: para un jefe de área de un cliente aplican LOS DOS.
 *
 * Reglas que lo acompañan y que no se negocian:
 * - El `clienteId` NUNCA se lee del body ni del query string: sale del usuario.
 *   Si llega `?clienteId=otro`, se ignora en silencio.
 * - Fuera de alcance se responde 404, no 403: un 403 confirmaría que el
 *   expediente existe.
 * - Al crear, el `clienteId` se HEREDA del usuario (`ownerClienteId`), nunca del
 *   cuerpo de la petición.
 *
 * En fase 1 todos los usuarios son `interno` y `scopeFilter` es `{}`. El
 * middleware existe y está probado desde ya para que activar la fase 2 no exija
 * revisar cada consulta.
 */
function applyScope(req, res, next) {
  if (!req.user) {
    return next(new AppError(401, 'Necesitas iniciar sesión para continuar'))
  }

  const esCliente = req.user.alcance === 'cliente'

  req.scopeFilter = esCliente ? { clienteId: req.user.clienteId } : {}
  req.areaFilter = areaFilter(req.user)
  req.dataFilter = { ...req.scopeFilter, ...req.areaFilter }

  // `clienteId` que se hereda a lo que este usuario cree.
  // Usuario interno → null ("es de la casa"). En fase 2 podrá elegir cliente.
  req.ownerClienteId = esCliente ? req.user.clienteId : null

  return next()
}

module.exports = { applyScope }
