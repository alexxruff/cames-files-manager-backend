const jwt = require('jsonwebtoken')
const env = require('../config/env')
const { AppError } = require('./errorHandler')
const { can } = require('../utils/permissions')
const Employee = require('../api/v1/employees/employeeModel')

/**
 * Autenticación y autorización.
 *
 * El usuario de la plataforma **es un empleado con `acceso`** (modelo-datos §5.2):
 * no hay colección de usuarios. El token lleva el id del empleado.
 *
 * `protect` relee al empleado en cada petición —una sola consulta, por `_id`,
 * con su rol resuelto— para que quitar el acceso, cambiarle el rol, bajarle los
 * permisos a su perfil o dar de baja a la persona surta efecto de inmediato y no
 * al expirar el token. Y comprueba que el token no sea
 * anterior al último cambio de contraseña.
 */

function extraerToken(req) {
  const cabecera = req.headers.authorization
  if (cabecera && cabecera.startsWith('Bearer ')) {
    return cabecera.slice(7).trim() || null
  }
  return null
}

async function protect(req, res, next) {
  try {
    const token = extraerToken(req)
    if (!token) {
      return next(new AppError(401, 'Necesitas iniciar sesión para continuar'))
    }

    const payload = jwt.verify(token, env.JWT_SECRET)
    /*
     * El rol viene POBLADO, en la misma consulta (D-93). Dos motivos:
     *
     * - `can` es síncrona y se llama desde rutas, servicios y controladores; si
     *   el rol hubiera que leerlo aparte, habría que volver asíncrono medio
     *   código para una consulta que cabe aquí.
     * - Cambiar un rol le cambia los permisos a su gente **sin que vuelva a
     *   entrar**, porque se resuelve en cada petición y el token nunca guardó
     *   permisos. Es lo que hace que quitarle algo a un perfil surta efecto de
     *   inmediato, como ya pasaba al bajarle el nivel a alguien.
     */
    const empleado = await Employee.findById(payload.sub).populate({
      path: 'acceso.rolId',
      select: 'nombre permisos todosLosPermisos soloSusAreas activo'
    })

    const sesionInvalida = new AppError(
      401,
      'Tu sesión no es válida. Vuelve a iniciar sesión.'
    )

    if (!empleado || !empleado.acceso) return next(sesionInvalida)
    if (!empleado.activo) return next(new AppError(401, 'Tu cuenta está desactivada'))
    if (!empleado.acceso.activo) {
      return next(new AppError(401, 'Tu acceso a la plataforma fue desactivado'))
    }
    // `iatMs` es lo que emite este backend; `iat * 1000` cubre un token viejo.
    const emitidoEn = payload.iatMs || (payload.iat ? payload.iat * 1000 : null)
    if (!empleado.tokenSigueValido(emitidoEn)) {
      return next(new AppError(401, 'Tu contraseña cambió. Vuelve a iniciar sesión.'))
    }

    req.user = empleado
    req.log = req.log?.child?.({ empleadoId: empleado._id.toString() }) || req.log
    return next()
  } catch (error) {
    return next(error)
  }
}

/**
 * Exige una capacidad de la matriz (modelo-datos §8.2).
 *
 *   router.post('/', protect, requireCapability(CAPABILITIES.MANAGE_ACCESS), …)
 *
 * Sin la capacidad responde **403**, no 404: el 404 está reservado a lo que queda
 * fuera del alcance de empresa o de área (regla #7 del contrato). «No puedes
 * hacer esto» y «esto no es tuyo» son dos respuestas distintas a propósito, y
 * mezclarlas dejaría al front sin forma de saber si esconder el botón o la
 * sección entera.
 */
function requireCapability(capability) {
  function verificar(req, res, next) {
    if (!req.user) {
      return next(new AppError(401, 'Necesitas iniciar sesión para continuar'))
    }
    if (!can(req.user.acceso, capability)) {
      return next(new AppError(403, 'No tienes permiso para realizar esta acción'))
    }
    return next()
  }

  /*
   * La capacidad queda colgada del guardián para poder LEER desde fuera qué
   * exige cada ruta (D-92). No la usa la autorización —eso es el `can` de
   * arriba—: la usa `tests/unitarias/routeGuards.test.js`, que recorre el router
   * y falla si una sección se queda sin su casilla. Antes eso sólo se veía
   * leyendo los veinte archivos de rutas uno por uno.
   */
  verificar.capability = capability
  return verificar
}

/** Exige ser administrador de plataforma (catálogos compartidos). */
function requirePlatformAdmin(req, res, next) {
  if (!req.user) {
    return next(new AppError(401, 'Necesitas iniciar sesión para continuar'))
  }
  if (!req.user.acceso?.alcanceGlobal) {
    return next(
      new AppError(
        403,
        'Sólo un administrador de plataforma puede modificar los catálogos compartidos'
      )
    )
  }
  return next()
}

module.exports = { protect, requireCapability, requirePlatformAdmin }
