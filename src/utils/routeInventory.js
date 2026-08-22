/**
 * Inventario de rutas montadas, derivado del router en tiempo de ejecución.
 *
 * POR QUÉ EXISTE: la documentación se desincroniza; el router no. Cuando el front
 * dice "este endpoint no existe", esto lo resuelve en una petición en vez de en
 * un ida y vuelta por chat.
 *
 * Recorre el stack de Express en vez de mantener una lista a mano: si alguien
 * monta o quita un recurso, el inventario cambia solo.
 */

/** Reconstruye el prefijo con el que se montó un sub-router. */
function prefijoDeCapa(capa) {
  const fuente = capa.regexp?.source || ''
  const limpio = fuente
    .replace('^\\/', '/')
    .replace('\\/?(?=\\/|$)', '')
    .replace(/\\\//g, '/')
    .replace(/\$$/, '')
    .replace('(?=/|$)', '')
    .replace('^/?', '')
  return limpio === '/' ? '' : limpio
}

/**
 * @param {object} router Router o app de Express.
 * @param {string} [prefijo]
 * @returns {Array<{metodos: string[], ruta: string}>}
 */
function listRoutes(router, prefijo = '') {
  const stack = router?.stack || router?._router?.stack || []
  const rutas = []

  for (const capa of stack) {
    if (capa.route) {
      const declarados = Object.keys(capa.route.methods).filter((m) => m !== '_all')
      // `router.all(...)` no declara métodos concretos: se anuncia como ALL.
      const metodos =
        declarados.length > 0 ? declarados.map((m) => m.toUpperCase()).sort() : ['ALL']
      // Normaliza '/usuarios/' → '/usuarios'
      const ruta = (prefijo + capa.route.path).replace(/\/$/, '') || '/'
      rutas.push({ metodos, ruta })
    } else if (capa.handle?.stack) {
      rutas.push(...listRoutes(capa.handle, prefijo + prefijoDeCapa(capa)))
    }
  }

  return rutas.sort((a, b) => a.ruta.localeCompare(b.ruta))
}

module.exports = { listRoutes }
