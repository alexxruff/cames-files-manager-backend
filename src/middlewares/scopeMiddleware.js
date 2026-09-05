const { AppError } = require('./errorHandler')
const {
  isPlatformAdmin,
  isLimitedToOwnArea,
  permissionKeysOf
} = require('../utils/permissions')
const { CAPABILITIES } = require('../utils/permissions')
const Affiliation = require('../api/v1/affiliations/affiliationModel')

/**
 * Alcance (modelo-datos §8.1). LA PIEZA CRÍTICA DE SEGURIDAD.
 *
 * Con empleados y clientes globales, «lo que puedo ver» ya NO es un campo en el
 * documento: se **deriva de las adscripciones activas** del usuario.
 *
 * Deja en la petición:
 * - `req.empresasVisibles` — array de ids, o `null` = todas (admin de plataforma).
 * - `req.areasPorEmpresa`  — `{ empresaId: [areas] }`, para el jefe de área. Son
 *   las áreas que **DIRIGE**, no aquellas donde trabaja (D-60).
 * - `req.permisosPorEmpresa` — `{ empresaId: Set(claves) }` (D-94). Desde que el
 *   rol puede ser distinto en cada empresa, tener un permiso dejó de ser sí/no y
 *   pasó a ser **en cuáles**. Quien lo usa es `requireCapability`, que con esto
 *   acota `empresasVisibles` a las empresas donde de verdad lo tiene.
 * - `req.esAdminPlataforma`.
 *
 * Reglas que no se negocian:
 * - **`empresaId` nunca se lee del cuerpo ni del query para decidir alcance.**
 *   Sale del usuario. Si llega en la petición sirve como filtro adicional DENTRO
 *   de lo visible (`empresaFiltro`), jamás para ampliarlo.
 * - **Fuera de alcance responde 404, no 403**: un 403 confirmaría que existe.
 */
async function applyScope(req, res, next) {
  try {
    if (!req.user) {
      return next(new AppError(401, 'Necesitas iniciar sesión para continuar'))
    }

    const acceso = req.user.acceso

    if (isPlatformAdmin(acceso)) {
      req.esAdminPlataforma = true
      req.empresasVisibles = null // null = todas
      req.areasPorEmpresa = {}
      /*
       * El administrador de plataforma no se acota por empresa: ve todas y su
       * rol es el base. `null` aquí significa «lo que pueda, lo puede en todas»,
       * igual que `empresasVisibles`.
       */
      req.permisosPorEmpresa = null
      return next()
    }

    /*
     * El rol de cada adscripción viene POBLADO, en la misma consulta: es lo que
     * permite resolver los permisos de cada empresa sin una consulta por empresa.
     */
    const adscripciones = await Affiliation.find({
      empleadoId: req.user._id,
      activo: true
    })
      .select('empresaId dirigeAreas rolId')
      .populate({
        path: 'rolId',
        select: 'nombre permisos todosLosPermisos soloSusAreas activo'
      })

    req.esAdminPlataforma = false
    req.empresasVisibles = adscripciones.map((a) => String(a.empresaId))
    /*
     * `dirigeAreas`, NO `areas` (D-60). Antes el alcance salía de dónde estaba
     * adscrita la persona: ponerla en Contabilidad porque ahí trabaja le daba,
     * de paso, visión sobre todo Contabilidad. Dirigir un área es una asignación
     * explícita y esto es lo único que la lee.
     */
    req.areasPorEmpresa = Object.fromEntries(
      adscripciones.map((a) => [String(a.empresaId), a.dirigeAreas || []])
    )

    /*
     * Los permisos DE CADA EMPRESA (D-94). Si la adscripción trae rol, manda ése;
     * si no, el de la persona —y si tampoco, su `nivelAcceso`—, que es la misma
     * cadena de respaldo de D-93 con un eslabón más. `permissionKeysOf` resuelve
     * los tres casos y aplica las excepciones, que son de la persona y valen en
     * todas sus empresas.
     */
    req.permisosPorEmpresa = Object.fromEntries(
      adscripciones.map((a) => [
        String(a.empresaId),
        new Set(permissionKeysOf(acceso, { rolDeLaEmpresa: a.rolId }))
      ])
    )

    return next()
  } catch (error) {
    return next(error)
  }
}

/**
 * Filtro de empresa listo para una consulta, respetando el alcance.
 *
 * @param {object} req
 * @param {string} [empresaIdSolicitada] lo que pidió el cliente (query o body)
 * @returns {object} `{}`, `{ empresaId }` o `{ empresaId: { $in: [...] } }`
 * @throws {AppError} 404 si pide una empresa fuera de su alcance
 */
function empresaFiltro(req, empresaIdSolicitada) {
  const visibles = req.empresasVisibles

  if (empresaIdSolicitada) {
    // Pedir una empresa concreta acota; nunca amplía.
    if (visibles !== null && !visibles.includes(String(empresaIdSolicitada))) {
      throw AppError.notFound('La empresa no existe')
    }
    return { empresaId: empresaIdSolicitada }
  }

  if (visibles === null) return {}
  return { empresaId: { $in: visibles } }
}

/** ¿Esta empresa está dentro del alcance del usuario? */
function empresaEsVisible(req, empresaId) {
  if (req.empresasVisibles === null) return true
  return req.empresasVisibles.includes(String(empresaId))
}

/**
 * Áreas que el usuario puede ver en una empresa, o `null` si no está limitado.
 * Para un jefe de área de dos empresas, son sus áreas EN ESA empresa.
 */
function areasVisibles(req, empresaId) {
  if (!isLimitedToOwnArea(req.user?.acceso, CAPABILITIES.VIEW_EMPLOYEES)) return null
  return req.areasPorEmpresa?.[String(empresaId)] || []
}

/**
 * Las empresas donde este usuario tiene la capacidad, o `null` = todas (D-94).
 *
 * Va aparte de `requireCapability` porque también la necesitan los servicios que
 * deciden por el cuerpo de la petición y no por la ruta.
 */
function empresasCon(req, capability) {
  const porEmpresa = req.permisosPorEmpresa
  if (!porEmpresa) return null // administrador de plataforma

  return Object.entries(porEmpresa)
    .filter(([, claves]) => claves.has(capability))
    .map(([empresaId]) => empresaId)
}

module.exports = {
  applyScope,
  empresaFiltro,
  empresaEsVisible,
  areasVisibles,
  empresasCon
}
