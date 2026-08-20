const express = require('express')
const { connectionState } = require('../../../config/database')
const authRoutes = require('../auth/authRoutes')
const userRoutes = require('../users/userRoutes')

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
router.get('/ready', (req, res) => {
  const db = connectionState()
  res.status(db.listo ? 200 : 503).json({
    status: db.listo ? 'success' : 'error',
    message: db.listo
      ? 'El servidor está listo'
      : 'El servidor no tiene conexión a la base de datos',
    data: { baseDeDatos: db, timestamp: new Date().toISOString() }
  })
})

// ─── Recursos ────────────────────────────────────────────────────────────────
router.use('/auth', authRoutes)
router.use('/usuarios', userRoutes)

// Pendientes (spec 9.3 a 9.8). Se montarán aquí conforme se implementen:
//   router.use('/expedientes', recordRoutes)
//   router.use('/alertas', alertRoutes)
//   router.use('/plantillas-checklist', checklistTemplateRoutes)
//   router.use('/reportes', reportRoutes)
//   router.use('/dashboard', dashboardRoutes)
//   router.use('/clientes', clientRoutes)      // fase 2

module.exports = router
