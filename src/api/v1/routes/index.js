const express = require('express')
/*
 * El módulo entero, no las funciones desestructuradas: `ping` se llama a través
 * de él para no quedarse con una referencia congelada al importar — es lo que
 * permite sustituirlo en las pruebas y comprobar el camino del 503.
 */
const database = require('../../../config/database')
const asyncHandler = require('../../../utils/asyncHandler')
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
const recordRoutes = require('../records/recordRoutes')
const affiliationRoutes = require('../affiliations/affiliationRoutes')
const alertRoutes = require('../alerts/alertRoutes')
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
router.use('/expedientes', recordRoutes)
router.use('/adscripciones', affiliationRoutes)
router.use('/alertas', alertRoutes)

// Movida al modelo nuevo: responde 410 con la ruta que la sustituye.
router.use('/usuarios', goneRoutes)

// Pendientes (backend-spec §6.5 y §6.6). Se montarán aquí conforme se
// implementen; `GET /api/v1` los anuncia mientras tanto en `pendientes`:
//   router.use('/plantillas-checklist', checklistTemplateRoutes)
//   router.use('/reportes', reportRoutes)
//   router.use('/dashboard', dashboardRoutes)
//   router.use('/organizacion', organizationRoutes)

module.exports = router
