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
 * Qué casilla exige cada MÉTODO de una ruta: `{ GET: ['viewMachines'], … }`.
 *
 * Por método y no por ruta porque `router.route('/x').get(…).post(…)` monta las
 * dos cosas en la misma capa, y ver el catálogo de maquinaria no pide lo mismo
 * que dar de alta una máquina. `requireCapability` cuelga la capacidad de la
 * función que devuelve (D-92); esto sólo las recoge.
 *
 * Un método puede no tener ninguna: las públicas, y aquellas cuya casilla
 * depende del cuerpo y la decide el servicio.
 */
function capacidadesDeRuta(route, metodos) {
  const porMetodo = Object.fromEntries(metodos.map((m) => [m, []]))

  for (const capa of route.stack || []) {
    const capacidad = capa.handle?.capability
    if (!capacidad) continue
    // `router.all(…)` y los middlewares sin método declarado valen para todos.
    const destinos = capa.method ? [capa.method.toUpperCase()] : metodos
    for (const metodo of destinos) porMetodo[metodo]?.push(capacidad)
  }

  return porMetodo
}

/**
 * @param {object} router Router o app de Express.
 * @param {string} [prefijo]
 * @param {{conCapacidades?: boolean}} [opciones] `conCapacidades` agrega qué
 *   casilla exige cada ruta. Va apagado por omisión **a propósito**: el
 *   inventario de `GET /api/v1` es público y no tiene por qué publicar la matriz
 *   de permisos. Lo enciende `tests/unitarias/routeGuards.test.js`.
 * @returns {Array<{metodos: string[], ruta: string, capacidades?: Record<string, string[]>}>}
 */
function listRoutes(router, prefijo = '', opciones = {}) {
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
      rutas.push({
        metodos,
        ruta,
        ...(opciones.conCapacidades
          ? { capacidades: capacidadesDeRuta(capa.route, metodos) }
          : {})
      })
    } else if (capa.handle?.stack) {
      rutas.push(...listRoutes(capa.handle, prefijo + prefijoDeCapa(capa), opciones))
    }
  }

  return rutas.sort((a, b) => a.ruta.localeCompare(b.ruta))
}

module.exports = { listRoutes }
