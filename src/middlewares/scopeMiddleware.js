const { AppError } = require('./errorHandler')
const {
  isPlatformAdmin,
  isLimitedToOwnArea,
  permissionKeysOf
} = require('../utils/permissions')
const { CAPABILITIES } = require('../utils/permissions')
const Affiliation = require('../api/v1/affiliations/affiliationModel')
const Company = require('../api/v1/companies/companyModel')
const { moduleOfCapability } = require('../utils/modules')

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
 * - `req.modulosApagadosPorEmpresa` — `{ empresaId: [claves] }` (D-95). Sólo las
 *   empresas que tienen ALGO apagado, que normalmente son ninguna. Quien lo usa
 *   es `requireCapability`, que saca del alcance a las empresas donde la sección
 *   que pide la ruta no existe.
 * - `req.todasLasEmpresas` — la lista completa de ids, o `null`. Se carga sólo
 *   para el administrador de plataforma **y sólo si hay algún módulo apagado**:
 *   es lo único con lo que se le puede restar una empresa a un `null` que
 *   significa «todas».
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

    /*
     * Los módulos apagados del grupo (D-95). Va antes del reparto porque el
     * administrador de plataforma también los obedece: apagar una sección la
     * apaga para todos.
     */
    const conApagados = await Company.find({
      // Sólo las que tienen ALGO apagado: `$ne: []` también traería las que no
      // tienen el campo, que son todas las de antes de D-95.
      'modulosApagados.0': { $exists: true }
    }).select('_id modulosApagados')

    req.modulosApagadosPorEmpresa = Object.fromEntries(
      conApagados.map((e) => [String(e._id), [...e.modulosApagados]])
    )
    req.todasLasEmpresas = null

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

      /*
       * `null` = todas no se puede filtrar, así que cuando hay algo apagado se
       * materializa la lista para poder restarle esas empresas. La consulta sólo
       * ocurre a partir de que alguien apaga un módulo; mientras nadie lo haga,
       * el administrador de plataforma no paga nada.
       */
      if (conApagados.length > 0) {
        const todas = await Company.find().select('_id')
        req.todasLasEmpresas = todas.map((e) => String(e._id))
      }
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
  const apagada = empresaConModuloApagado(req, capability)
  const porEmpresa = req.permisosPorEmpresa

  if (!porEmpresa) {
    // Administrador de plataforma: todas, menos donde la sección no existe.
    const apagadas = empresasSinModulo(req, capability)
    if (apagadas.length === 0) return null
    return (req.todasLasEmpresas || []).filter((id) => !apagadas.includes(id))
  }

  return Object.entries(porEmpresa)
    .filter(([empresaId, claves]) => claves.has(capability) && !apagada(empresaId))
    .map(([empresaId]) => empresaId)
}

/**
 * Las empresas donde la sección que exige esta casilla está APAGADA (D-95).
 *
 * Vive aquí, junto al resto del alcance, porque es lo mismo con otro nombre: una
 * empresa que apagó maquinaria queda fuera del alcance de todo lo que pida una
 * casilla de maquinaria, y de ahí sale el 404 de siempre.
 */
function empresasSinModulo(req, capability) {
  const modulo = moduleOfCapability(capability)
  if (!modulo?.opcional) return []

  return Object.entries(req.modulosApagadosPorEmpresa || {})
    .filter(([, claves]) => claves.includes(modulo.clave))
    .map(([empresaId]) => empresaId)
}

/** `(empresaId) => boolean` para la casilla dada. */
function empresaConModuloApagado(req, capability) {
  const apagadas = new Set(empresasSinModulo(req, capability))
  return (empresaId) => apagadas.has(String(empresaId))
}

/**
 * El alcance de siempre, menos las empresas que tienen apagada la sección de
 * esta casilla (D-95). `null` cuando no hay nada que quitar.
 *
 * Vive aquí porque lo usan dos: `requireCapability`, que lo aplica en la ruta, y
 * `uploadService`, que decide la casilla por el destino del archivo y no por la
 * ruta (`POST /subidas` no lleva `requireCapability`).
 *
 * Un `empresasVisibles` en `null` —administrador de plataforma— se materializa
 * con `todasLasEmpresas`: a «todas» no se le puede restar una.
 *
 * @returns {string[]|null}
 */
function alcanceSinModulo(reqLike, capability) {
  const apagadas = empresasSinModulo(reqLike, capability)
  if (apagadas.length === 0) return null

  const visibles =
    reqLike.empresasVisibles === null
      ? reqLike.todasLasEmpresas || []
      : reqLike.empresasVisibles

  return visibles.map(String).filter((id) => !apagadas.includes(id))
}

module.exports = {
  applyScope,
  empresaFiltro,
  empresaEsVisible,
  areasVisibles,
  empresasCon,
  empresasSinModulo,
  alcanceSinModulo
}
