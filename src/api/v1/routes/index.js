const express = require('express')
/*
 * El módulo entero, no las funciones desestructuradas: `ping` se llama a través
 * de él para no quedarse con una referencia congelada al importar — es lo que
 * permite sustituirlo en las pruebas y comprobar el camino del 503.
 */
const database = require('../../../config/database')
const asyncHandler = require('../../../utils/asyncHandler')
const { ok } = require('../../../utils/response')
const { listRoutes } = require('../../../utils/routeInventory')
const authRoutes = require('../auth/authRoutes')
const employeeRoutes = require('../employees/employeeRoutes')
const companyRoutes = require('../companies/companyRoutes')
const categoryRoutes = require('../categories/categoryRoutes')
const areaRoutes = require('../areas/areaRoutes')
const clientRoutes = require('../clients/clientRoutes')
const projectRoutes = require('../projects/projectRoutes')
const portfolioRoutes = require('../portfolios/portfolioRoutes')
const assignmentRoutes = require('../assignments/assignmentRoutes')
const contractRoutes = require('../contracts/contractRoutes')
const machineRoutes = require('../machines/machineRoutes')
const machineIncidentRoutes = require('../machineIncidents/machineIncidentRoutes')
const incidentTypeRoutes = require('../incidentTypes/incidentTypeRoutes')
const recordRoutes = require('../records/recordRoutes')
const affiliationRoutes = require('../affiliations/affiliationRoutes')
const alertRoutes = require('../alerts/alertRoutes')
const uploadRoutes = require('../uploads/uploadRoutes')
const permissionRoutes = require('../permissions/permissionRoutes')
const moduleRoutes = require('../modules/moduleRoutes')
const roleRoutes = require('../roles/roleRoutes')
const goneRoutes = require('../users/goneRoutes')

const router = express.Router()

/**
 * Monta los recursos de la API v1.
 *
 * Las RUTAS van en español porque son parte del contrato que el front ya
 * consume (`/usuarios`, `/expedientes`, `/plantillas-checklist`). El código que
 * las atiende está en inglés: ver docs/ARQUITECTURA.md § Idiomas.
 */

/** Liveness: el proceso responde. No toca la base. */
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'El servidor está funcionando',
    data: { timestamp: new Date().toISOString() }
  })
})

/** Readiness: además hay base de datos. Es lo que debe mirar el balanceador. */
router.get(
  '/ready',
  asyncHandler(async (req, res) => {
    /*
     * Se COMPRUEBA la base, no se lee una bandera (D-61). `connectionState`
     * mira `readyState`, que es local: tras reanudarse de una suspensión decía
     * "conectado" con todos los sockets muertos, y el health check daba verde
     * mientras cada petición real se colgaba. El `ping` va acotado en el tiempo
     * para que la sonda no se cuelgue ella misma.
     */
    const responde = await database.ping()
    const db = { ...database.connectionState(), responde }

    res.status(responde ? 200 : 503).json({
      status: responde ? 'success' : 'error',
      message: responde
        ? 'El servidor está listo'
        : 'El servidor no tiene conexión a la base de datos',
      data: { baseDeDatos: db, timestamp: new Date().toISOString() }
    })
  })
)

/**
 * Identidad de la versión desplegada. Pública y a propósito: contesta «qué
 * commit está corriendo aquí» sin sesión, que es justo lo que hace falta cuando
 * algo se despliega y nadie sabe qué quedó arriba.
 *
 * Devuelve SÓLO identidad de release —commit y hora de construcción, ambos
 * horneados en la imagen (ver Dockerfile)—: ni `NODE_ENV`, ni configuración, ni
 * dependencias, ni nada del entorno. No es un volcado de diagnóstico.
 *
 * `no-store` porque una respuesta cacheada de esto miente sobre lo que corre.
 */
router.get('/version', (req, res) => {
  res.set('Cache-Control', 'no-store')

  return ok(res, {
    schemaVersion: 1,
    service: 'cames-api',
    commit: process.env.CAMES_GIT_COMMIT ?? null,
    builtAt: process.env.CAMES_BUILD_TIME ?? null
  })
})

/**
 * Rutas especificadas y todavía NO implementadas (spec 9.3 a 9.8). Están
 * reservadas: responden 404 y no deben ocuparse con otra cosa.
 *
 * Se declaran aquí, junto al montaje, para que `GET /api/v1` pueda decirle al
 * front qué falta sin que nadie tenga que consultar un documento aparte.
 */
const RUTAS_PENDIENTES = Object.freeze([
  // Catálogos compartidos. `/empleados/:id/adscripciones` no se implementó
  // aparte: `GET /empleados/:id` ya trae sus adscripciones embebidas.
  { metodos: ['GET'], ruta: '/api/v1/empleados/:id/adscripciones', spec: '6.2' },
  { metodos: ['GET'], ruta: '/api/v1/empleados/:id/asignaciones', spec: '6.2' },
  // Proyectos, expedientes y derivados
  { metodos: ['GET'], ruta: '/api/v1/dashboard/metricas', spec: '6.6' },
  { metodos: ['GET'], ruta: '/api/v1/reportes/expedientes', spec: '6.6' },
  { metodos: ['GET', 'PATCH'], ruta: '/api/v1/plantillas-checklist', spec: '6.5' },
  // Árbol empresa → áreas → proyectos (modelo §9.2). Estaba especificada y sin
  // anunciar: el front no tenía cómo saber que falta.
  { metodos: ['GET'], ruta: '/api/v1/organizacion', spec: '6.3' },
  { metodos: ['POST'], ruta: '/api/v1/auth/recuperar', spec: '6.1' },
  { metodos: ['POST'], ruta: '/api/v1/auth/restablecer', spec: '6.1' }
])

/**
 * Inventario de la API: qué existe y qué falta. Público y de sólo lectura.
 *
 * `implementados` NO es una lista escrita a mano: se deriva del router, así que
 * es imposible que mienta. Si algo no aparece aquí, no existe en el servidor.
 */
router.get('/', (req, res) => {
  const implementados = listRoutes(router, '/api/v1').filter((r) => r.ruta !== '/api/v1')

  res.status(200).json({
    status: 'success',
    message: 'API de expedientes laborales (Urbacames)',
    data: {
      version: 'v1',
      base: '/api/v1',
      implementados,
      pendientes: RUTAS_PENDIENTES,
      nota:
        'Un 404 con el mensaje "La ruta ... no existe" significa NO IMPLEMENTADO. ' +
        'Un 401 significa que la ruta sí existe y falta la sesión.'
    }
  })
})

// ─── Recursos ────────────────────────────────────────────────────────────────
router.use('/auth', authRoutes)
router.use('/empleados', employeeRoutes)
router.use('/empresas', companyRoutes)
router.use('/categorias', categoryRoutes)
router.use('/areas', areaRoutes)
router.use('/clientes', clientRoutes)
router.use('/proyectos', projectRoutes)
router.use('/carteras', portfolioRoutes)
router.use('/asignaciones', assignmentRoutes)
router.use('/contratos', contractRoutes)
router.use('/maquinas', machineRoutes)
router.use('/incidencias', machineIncidentRoutes)
router.use('/tipos-incidencia', incidentTypeRoutes)
router.use('/expedientes', recordRoutes)
router.use('/adscripciones', affiliationRoutes)
router.use('/alertas', alertRoutes)
router.use('/subidas', uploadRoutes)
router.use('/permisos', permissionRoutes)
router.use('/modulos', moduleRoutes)
router.use('/roles', roleRoutes)

// Movida al modelo nuevo: responde 410 con la ruta que la sustituye.
router.use('/usuarios', goneRoutes)

// Pendientes (backend-spec §6.5 y §6.6). Se montarán aquí conforme se
// implementen; `GET /api/v1` los anuncia mientras tanto en `pendientes`:
//   router.use('/plantillas-checklist', checklistTemplateRoutes)
//   router.use('/reportes', reportRoutes)
//   router.use('/dashboard', dashboardRoutes)
//   router.use('/organizacion', organizationRoutes)

/*
 * El router es una función, así que la lista viaja colgada de él. Se expone para
 * que `tests/unitarias/docs.test.js` compruebe que la documentación la refleja:
 * es el único lugar donde se declara qué falta, y se desfasaba en silencio.
 */
module.exports = router
module.exports.RUTAS_PENDIENTES = RUTAS_PENDIENTES
