const express = require('express')
const assignmentController = require('./assignmentController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { requirePasswordDefinitiva } = require('../../../middlewares/passwordMiddleware')
const { CAPABILITIES } = require('../../../utils/permissions')
const { assignmentExitValidation } = require('../../../validations/assignmentValidation')

/**
 * `/asignaciones/:id/salida` — cerrar una asignación.
 *
 * El alta y el listado viven bajo el proyecto (`/proyectos/:id/asignaciones`);
 * cerrar opera sobre una asignación concreta, que se identifica por sí misma.
 */
const router = express.Router()

// `requirePasswordDefinitiva` va aquí y no en `protect`: ver D-49.
router.use(protect, requirePasswordDefinitiva, applyScope)

router.patch(
  '/:id/salida',
  requireCapability(CAPABILITIES.ASSIGN_TO_PROJECTS),
  assignmentExitValidation,
  validateRequest,
  asyncHandler(assignmentController.salida)
)

module.exports = router
