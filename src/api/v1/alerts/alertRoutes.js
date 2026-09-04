const express = require('express')
const alertController = require('./alertController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { requirePasswordDefinitiva } = require('../../../middlewares/passwordMiddleware')
const { CAPABILITIES } = require('../../../utils/permissions')
const { listAlertsValidation } = require('../../../validations/alertValidation')

/**
 * `/alertas` — la bandeja de pendientes (spec §6.6).
 *
 * Sólo lectura, y no hay más: **las alertas no se crean, ni se marcan, ni se
 * borran**. Se derivan de los expedientes y de las fechas de nacimiento en cada
 * consulta, así que se resuelven solas cuando se resuelve la causa (D-47).
 *
 * El permiso es `VIEW_ALERTS` —los tres niveles, D-92— porque una alerta no dice
 * nada que su dueño no pueda ver ya en el expediente. El **alcance** sí acota:
 * `jefe_area` sólo recibe alertas de su gente, y lo garantiza
 * `employeeService.list`, no este archivo.
 */
const router = express.Router()

// `requirePasswordDefinitiva` va aquí y no en `protect`: ver D-49.
router.use(protect, requirePasswordDefinitiva, applyScope)

router.get(
  '/',
  requireCapability(CAPABILITIES.VIEW_ALERTS),
  listAlertsValidation,
  validateRequest,
  asyncHandler(alertController.list)
)

module.exports = router
