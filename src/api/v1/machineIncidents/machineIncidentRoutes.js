const express = require('express')
const machineIncidentController = require('./machineIncidentController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { requirePasswordDefinitiva } = require('../../../middlewares/passwordMiddleware')
const { CAPABILITIES } = require('../../../utils/permissions')
const {
  resolveIncidentValidation
} = require('../../../validations/machineIncidentValidation')

/**
 * `/incidencias/:id` — operar sobre una incidencia concreta (D-88).
 *
 * Levantarlas y listarlas vive bajo la máquina (`/maquinas/:id/incidencias`),
 * porque son de ella; resolverla opera sobre la incidencia, que ya se identifica
 * sola. Mismo reparto que los contratos y la maquinaria.
 *
 * Resolver pide la misma casilla que levantar (`MANAGE_MACHINE_INCIDENTS`,
 * D-92): son las dos mitades del mismo trabajo, y quien reporta la falla es
 * quien dice cómo se arregló.
 */
const router = express.Router()

// `requirePasswordDefinitiva` va aquí y no en `protect`: ver D-49.
router.use(protect, requirePasswordDefinitiva, applyScope)

router.post(
  '/:id/resolucion',
  requireCapability(CAPABILITIES.MANAGE_MACHINE_INCIDENTS),
  resolveIncidentValidation,
  validateRequest,
  asyncHandler(machineIncidentController.resolver)
)

module.exports = router
