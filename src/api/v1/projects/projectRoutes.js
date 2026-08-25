const express = require('express')
const projectController = require('./projectController')
const assignmentController = require('../assignments/assignmentController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { requirePasswordDefinitiva } = require('../../../middlewares/passwordMiddleware')
const { CAPABILITIES } = require('../../../utils/permissions')
const {
  listProjectsValidation,
  projectIdValidation,
  createProjectValidation,
  updateProjectValidation,
  postponeValidation,
  finishValidation,
  cloneCategoriesValidation
} = require('../../../validations/projectValidation')
const {
  listAssignmentsValidation,
  createAssignmentValidation
} = require('../../../validations/assignmentValidation')

const router = express.Router()

// `requirePasswordDefinitiva` va aquí y no en `protect`: ver D-49.
router.use(protect, requirePasswordDefinitiva, applyScope)

// Proyectos: `rh_admin` y `jefe_area` (matriz §8.2). Leer, cualquiera con sesión.
const gestionarProyectos = requireCapability(CAPABILITIES.MANAGE_PROJECTS)
const asignarPersonal = requireCapability(CAPABILITIES.ASSIGN_TO_PROJECTS)

router
  .route('/')
  .get(listProjectsValidation, validateRequest, asyncHandler(projectController.list))
  .post(
    gestionarProyectos,
    createProjectValidation,
    validateRequest,
    asyncHandler(projectController.create)
  )

router
  .route('/:id')
  .get(projectIdValidation, validateRequest, asyncHandler(projectController.getById))
  .patch(
    gestionarProyectos,
    updateProjectValidation,
    validateRequest,
    asyncHandler(projectController.update)
  )

// ─── Ciclo de vida ───────────────────────────────────────────────────────────
// La fecha de cierre sólo se mueve por aquí, con motivo y quedando en el
// historial: es auditoría, y por eso el PATCH la rechaza.
router.post(
  '/:id/aplazar',
  gestionarProyectos,
  postponeValidation,
  validateRequest,
  asyncHandler(projectController.aplazar)
)
router.post(
  '/:id/finalizar',
  gestionarProyectos,
  finishValidation,
  validateRequest,
  asyncHandler(projectController.finalizar)
)
router.post(
  '/:id/reabrir',
  gestionarProyectos,
  projectIdValidation,
  validateRequest,
  asyncHandler(projectController.reabrir)
)
router.post(
  '/:id/categorias/clonar',
  gestionarProyectos,
  cloneCategoriesValidation,
  validateRequest,
  asyncHandler(projectController.clonarCategorias)
)

// ─── Personal del proyecto ───────────────────────────────────────────────────
router
  .route('/:id/asignaciones')
  .get(
    listAssignmentsValidation,
    validateRequest,
    asyncHandler(assignmentController.listByProject)
  )
  .post(
    asignarPersonal,
    createAssignmentValidation,
    validateRequest,
    asyncHandler(assignmentController.create)
  )

router.get(
  '/:id/asignables',
  asignarPersonal,
  projectIdValidation,
  validateRequest,
  asyncHandler(assignmentController.asignables)
)

module.exports = router
