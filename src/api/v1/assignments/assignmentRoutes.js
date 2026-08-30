const express = require('express')
const assignmentController = require('./assignmentController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { requirePasswordDefinitiva } = require('../../../middlewares/passwordMiddleware')
const { CAPABILITIES } = require('../../../utils/permissions')
const {
  assignmentIdValidation,
  assignmentExitValidation
} = require('../../../validations/assignmentValidation')

/**
 * `/asignaciones/:id` — el detalle y el cierre de una asignación.
 *
 * El alta y el listado viven bajo el proyecto (`/proyectos/:id/asignaciones`);
 * esto opera sobre una asignación concreta, que se identifica por sí misma.
 *
 * El alcance **no se comprueba aquí**, sino sobre el proyecto al que pertenece:
 * es el proyecto el que tiene empresa. Fuera de alcance responde 404, no 403.
 */
const router = express.Router()

// `requirePasswordDefinitiva` va aquí y no en `protect`: ver D-49.
router.use(protect, requirePasswordDefinitiva, applyScope)

// Sólo sesión, como el listado del proyecto: leer quién está en la obra no es
// lo mismo que moverlo.
router.get(
  '/:id',
  assignmentIdValidation,
  validateRequest,
  asyncHandler(assignmentController.getById)
)

router.patch(
  '/:id/salida',
  requireCapability(CAPABILITIES.ASSIGN_TO_PROJECTS),
  assignmentExitValidation,
  validateRequest,
  asyncHandler(assignmentController.salida)
)

module.exports = router
