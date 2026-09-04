const { listRoutes } = require('../../src/utils/routeInventory')
const { PERMISSION_KEYS } = require('../../src/utils/permissions')

/**
 * Qué casilla exige cada ruta, leído del router (D-92).
 *
 * La tarea 44 partió los permisos por sección, y el error que puede colarse sin
 * que nada falle es dejar una ruta con la casilla de otra sección —o sin
 * ninguna—: la prueba de paridad compara la matriz, no las rutas, y las de
 * integración prueban el camino de cada recurso pero no que el reparto sea
 * completo.
 *
 * Esta recorre el stack de Express y compara con la lista de abajo. Cuando falle
 * por una ruta nueva, la respuesta correcta casi siempre es agregarle su
 * `requireCapability` — no agregar la ruta a `SIN_CASILLA`.
 */

/** `{ 'GET /api/v1/x': ['viewX'] }` — leído del router, no de una lista a mano. */
function casillasPorRuta() {
  const router = require('../../src/api/v1/routes')
  const mapa = {}

  for (const { metodos, ruta, capacidades } of listRoutes(router, '/api/v1', {
    conCapacidades: true
  })) {
    for (const metodo of metodos) mapa[`${metodo} ${ruta}`] = capacidades[metodo]
  }

  return mapa
}

/**
 * Las rutas que a propósito NO piden casilla, con el motivo. Cualquier otra que
 * aparezca aquí sin renglón es un agujero.
 */
const SIN_CASILLA = Object.freeze({
  'GET /api/v1': 'inventario público',
  'GET /api/v1/health': 'liveness, sin sesión',
  'GET /api/v1/ready': 'readiness, sin sesión',
  'GET /api/v1/version': 'identidad del release, pública a propósito',
  'POST /api/v1/auth/login': 'la única ruta pública de datos',
  'POST /api/v1/auth/logout': 'basta con la sesión',
  'GET /api/v1/auth/me': 'quién soy: basta con la sesión',
  'POST /api/v1/auth/cambiar-password': 'la contraseña propia, con sesión',
  'GET /api/v1/permisos': 'el catálogo de casillas: no dice quién tiene qué',
  // Los catálogos que llenan los desplegables de TODOS los formularios.
  'GET /api/v1/areas': 'puebla los desplegables de todos los formularios',
  'GET /api/v1/categorias': 'puebla los desplegables de todos los formularios',
  // El tipo decide quién puede: `canManageEmployeeType`, en el servicio.
  'POST /api/v1/empleados': 'depende del tipo de persona, lo decide el servicio',
  'PATCH /api/v1/empleados/:id': 'depende del tipo de persona, lo decide el servicio',
  // Depende de si el área es temporal, y eso sólo se sabe leyendo el documento:
  // el controlador resuelve entre `manageAreas` y `closeTemporaryAreas` (D-58).
  'PATCH /api/v1/areas/:id/estado': 'depende de si el área es temporal, D-58',
  // La capacidad depende del destino del archivo: la decide `uploadService`.
  'POST /api/v1/subidas': 'la casilla depende del destino, la decide el servicio',
  // Movidas, contestan 410 con el mensaje de a dónde se fueron.
  'ALL /api/v1/usuarios*': 'ruta retirada, responde 410',
  'PATCH /api/v1/contratos/:id': 'ruta retirada, responde 410'
})

describe('cada ruta exige la casilla de su sección', () => {
  const rutas = casillasPorRuta()

  it('ninguna ruta se quedó sin casilla por descuido', () => {
    const desprotegidas = Object.entries(rutas)
      .filter(([, capacidades]) => capacidades.length === 0)
      .map(([ruta]) => ruta)
      .filter((ruta) => !(ruta in SIN_CASILLA))

    expect(desprotegidas).toEqual([])
  })

  it('las rutas exentas siguen existiendo: la lista no se quedó vieja', () => {
    const inexistentes = Object.keys(SIN_CASILLA).filter((ruta) => !(ruta in rutas))
    expect(inexistentes).toEqual([])
  })

  it('las casillas que piden las rutas existen en el catálogo', () => {
    for (const [ruta, capacidades] of Object.entries(rutas)) {
      for (const capacidad of capacidades) {
        expect({ ruta, capacidad, existe: PERMISSION_KEYS.includes(capacidad) }).toEqual({
          ruta,
          capacidad,
          existe: true
        })
      }
    }
  })

  it('las ocho secciones que se leían sin permiso ya piden su casilla de ver', () => {
    const esperado = {
      'GET /api/v1/proyectos': 'viewProjects',
      'GET /api/v1/proyectos/:id': 'viewProjects',
      'GET /api/v1/proyectos/:id/asignaciones': 'viewProjectStaff',
      'GET /api/v1/asignaciones/:id': 'viewProjectStaff',
      'GET /api/v1/proyectos/:id/contratos': 'viewContracts',
      'GET /api/v1/contratos/:id/archivo': 'viewContracts',
      'GET /api/v1/contratos/:id/siroc/archivo': 'viewSiroc',
      'GET /api/v1/maquinas/:id': 'viewMachines',
      'GET /api/v1/maquinas/:id/historial': 'viewMachines',
      'GET /api/v1/empresas/:id/maquinas': 'viewMachines',
      'GET /api/v1/empleados/:id/maquinas': 'viewMachines',
      'GET /api/v1/maquinas/:id/incidencias': 'viewMachineIncidents',
      'GET /api/v1/tipos-incidencia': 'viewMachineIncidents',
      'GET /api/v1/clientes': 'viewClients',
      'GET /api/v1/clientes/:id': 'viewClients',
      'GET /api/v1/empresas': 'viewCompanies',
      'GET /api/v1/empresas/:id': 'viewCompanies',
      'GET /api/v1/empresas/:id/adscripciones': 'viewAffiliations',
      'GET /api/v1/empleados/:id/expediente': 'viewRecords',
      'GET /api/v1/expedientes': 'viewRecords',
      'GET /api/v1/alertas': 'viewAlerts'
    }

    for (const [ruta, casilla] of Object.entries(esperado)) {
      expect({ ruta, pide: rutas[ruta] }).toEqual({ ruta, pide: [casilla] })
    }
  })

  it('maquinaria, incidencias, contratos y obras ya no comparten una sola casilla', () => {
    const esperado = {
      'POST /api/v1/proyectos': 'manageProjects',
      'POST /api/v1/proyectos/:id/contratos': 'manageContracts',
      'DELETE /api/v1/contratos/:id': 'manageContracts',
      'PUT /api/v1/contratos/:id/siroc': 'manageSiroc',
      'POST /api/v1/contratos/:id/siroc/actualizaciones': 'manageSiroc',
      'POST /api/v1/empresas/:id/maquinas': 'manageMachines',
      'PATCH /api/v1/maquinas/:id': 'manageMachines',
      'POST /api/v1/maquinas/:id/asignacion': 'assignMachines',
      'POST /api/v1/maquinas/:id/devolucion': 'assignMachines',
      'POST /api/v1/maquinas/:id/incidencias': 'manageMachineIncidents',
      'POST /api/v1/incidencias/:id/resolucion': 'manageMachineIncidents',
      'POST /api/v1/tipos-incidencia': 'manageIncidentTypes',
      'POST /api/v1/clientes/:id/registros-obra': 'manageWorkRegistries',
      'POST /api/v1/empresas/:id/registros-patronales': 'manageEmployerRegistries',
      'POST /api/v1/empleados/importar': 'importEmployees'
    }

    for (const [ruta, casilla] of Object.entries(esperado)) {
      expect({ ruta, pide: rutas[ruta] }).toEqual({ ruta, pide: [casilla] })
    }

    // Y `manageProjects` ya no autoriza nada fuera de la obra.
    const conProyectos = Object.entries(rutas)
      .filter(([, c]) => c.includes('manageProjects'))
      .map(([ruta]) => ruta)
      .sort()

    expect(conProyectos).toEqual([
      'PATCH /api/v1/proyectos/:id',
      'POST /api/v1/proyectos',
      'POST /api/v1/proyectos/:id/aplazar',
      'POST /api/v1/proyectos/:id/finalizar',
      'POST /api/v1/proyectos/:id/reabrir'
    ])
  })
})
