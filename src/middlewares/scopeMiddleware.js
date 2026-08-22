const { AppError } = require('./errorHandler')
const { isPlatformAdmin, isLimitedToOwnArea } = require('../utils/permissions')
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
 * - `req.areasPorEmpresa`  — `{ empresaId: [areas] }`, para el jefe de área.
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
      return next()
    }

    const adscripciones = await Affiliation.find({
      empleadoId: req.user._id,
      activo: true
    }).select('empresaId areas')

    req.esAdminPlataforma = false
    req.empresasVisibles = adscripciones.map((a) => String(a.empresaId))
    req.areasPorEmpresa = Object.fromEntries(
      adscripciones.map((a) => [String(a.empresaId), a.areas || []])
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

module.exports = { applyScope, empresaFiltro, empresaEsVisible, areasVisibles }
