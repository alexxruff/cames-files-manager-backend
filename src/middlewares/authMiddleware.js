const jwt = require('jsonwebtoken')
const env = require('../config/env')
const { AppError } = require('./errorHandler')
const { can } = require('../utils/permissions')
const User = require('../api/v1/users/userModel')

/**
 * Autenticación y autorización.
 *
 * Cambios respecto a `talentlink-backend`:
 * - `restrictTo` operaba sobre `role: 'user' | 'admin'`. Aquí la autorización se
 *   expresa en CAPACIDADES (`requireCapability`), no en niveles sueltos: cuando
 *   la matriz del spec 8 cambie, se toca un solo archivo y no cada ruta.
 * - El token incluye `nivelAcceso` y `alcance` sólo como pista de depuración: el
 *   usuario SIEMPRE se relee de la base, para que revocar acceso o cambiar de
 *   nivel surta efecto de inmediato y no al expirar el token.
 */

function extraerToken(req) {
  const cabecera = req.headers.authorization
  if (cabecera && cabecera.startsWith('Bearer ')) {
    return cabecera.slice(7).trim() || null
  }
  return null
}

/** Exige sesión válida. Deja el documento del usuario en `req.user`. */
async function protect(req, res, next) {
  try {
    const token = extraerToken(req)
    if (!token) {
      return next(new AppError(401, 'Necesitas iniciar sesión para continuar'))
    }

    const payload = jwt.verify(token, env.JWT_SECRET)
    const usuario = await User.findById(payload.sub || payload.id)

    if (!usuario) {
      return next(new AppError(401, 'Tu sesión no es válida. Vuelve a iniciar sesión.'))
    }
    if (!usuario.active) {
      return next(new AppError(401, 'Tu cuenta está desactivada'))
    }

    req.user = usuario
    req.log = req.log?.child?.({ usuarioId: usuario._id.toString() }) || req.log
    return next()
  } catch (error) {
    return next(error)
  }
}

/**
 * Exige una capacidad de la matriz de permisos (spec 8).
 *
 *   router.post('/', protect, requireCapability(CAPABILITIES.MANAGE_USERS), …)
 */
function requireCapability(capability) {
  return function verificar(req, res, next) {
    if (!req.user) {
      return next(new AppError(401, 'Necesitas iniciar sesión para continuar'))
    }
    if (!can(req.user.nivelAcceso, capability)) {
      return next(new AppError(403, 'No tienes permiso para realizar esta acción'))
    }
    return next()
  }
}

/** Exige uno de los niveles de acceso indicados. Úsalo sólo si no hay capacidad. */
function requireAccessLevel(...niveles) {
  return function verificar(req, res, next) {
    if (!req.user) {
      return next(new AppError(401, 'Necesitas iniciar sesión para continuar'))
    }
    if (!niveles.includes(req.user.nivelAcceso)) {
      return next(new AppError(403, 'No tienes permiso para realizar esta acción'))
    }
    return next()
  }
}

module.exports = { protect, requireCapability, requireAccessLevel }
