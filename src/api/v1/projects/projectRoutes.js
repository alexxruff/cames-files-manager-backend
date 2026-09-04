const express = require('express')
const projectController = require('./projectController')
const assignmentController = require('../assignments/assignmentController')
const contractController = require('../contracts/contractController')
const machineAssignmentController = require('../machineAssignments/machineAssignmentController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { recibirArchivo } = require('../../../middlewares/uploadMiddleware')
const { requirePasswordDefinitiva } = require('../../../middlewares/passwordMiddleware')
const { CAPABILITIES } = require('../../../utils/permissions')
const {
  listProjectsValidation,
  projectIdValidation,
  createProjectValidation,
  updateProjectValidation,
  postponeValidation,
  finishValidation
} = require('../../../validations/projectValidation')
const {
  listAssignmentsValidation,
  createAssignmentValidation
} = require('../../../validations/assignmentValidation')
const {
  listContractsValidation,
  createContractValidation
} = require('../../../validations/contractValidation')
const {
  machinesByProjectValidation
} = require('../../../validations/machineAssignmentValidation')

const router = express.Router()

// `requirePasswordDefinitiva` va aquí y no en `protect`: ver D-49.
router.use(protect, requirePasswordDefinitiva, applyScope)

/*
 * Cuatro casillas, no una (D-92). `MANAGE_PROJECTS` autorizaba antes también los
 * contratos, el SIROC y toda la maquinaria; ahora se queda sólo con la obra, y
 * **ver la obra es su propio permiso**, que antes no se comprobaba.
 *
 * El personal de la obra va aparte de la obra a propósito: quien maneja
 * maquinaria necesita saber quién está en cada frente sin poder editar el
 * proyecto, y quien planea obras no tiene por qué ver la plantilla.
 */
const verProyectos = requireCapability(CAPABILITIES.VIEW_PROJECTS)
const gestionarProyectos = requireCapability(CAPABILITIES.MANAGE_PROJECTS)
const verPersonal = requireCapability(CAPABILITIES.VIEW_PROJECT_STAFF)
const asignarPersonal = requireCapability(CAPABILITIES.ASSIGN_TO_PROJECTS)
const verContratos = requireCapability(CAPABILITIES.VIEW_CONTRACTS)
const gestionarContratos = requireCapability(CAPABILITIES.MANAGE_CONTRACTS)
const verMaquinas = requireCapability(CAPABILITIES.VIEW_MACHINES)

router
  .route('/')
  .get(
    verProyectos,
    listProjectsValidation,
    validateRequest,
    asyncHandler(projectController.list)
  )
  .post(
    gestionarProyectos,
    createProjectValidation,
    validateRequest,
    asyncHandler(projectController.create)
  )

router
  .route('/:id')
  .get(
    verProyectos,
    projectIdValidation,
    validateRequest,
    asyncHandler(projectController.getById)
  )
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

// ─── Personal del proyecto ───────────────────────────────────────────────────
router
  .route('/:id/asignaciones')
  .get(
    verPersonal,
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

// ─── Contratos del proyecto (D-70) ───────────────────────────────────────────
// Cuelgan del proyecto porque no existen sin él. Lo demás —editar, SIROC,
// finalizar, baja— opera sobre el contrato, en `/contratos/:id`.
router
  .route('/:id/contratos')
  .get(
    verContratos,
    listContractsValidation,
    validateRequest,
    asyncHandler(contractController.listByProject)
  )
  .post(
    gestionarContratos,
    // Multer primero: es quien llena `req.body` cuando viene como `multipart`.
    recibirArchivo,
    createContractValidation,
    validateRequest,
    asyncHandler(contractController.create)
  )

/*
 * La maquinaria que hay HOY en la obra, con quién la tiene (D-87). Es de sólo
 * lectura: la máquina se asigna desde su ficha, no desde la obra, porque la obra
 * se deduce de la persona y no al revés.
 */
router.get(
  '/:id/maquinas',
  verMaquinas,
  machinesByProjectValidation,
  validateRequest,
  asyncHandler(machineAssignmentController.deLaObra)
)

module.exports = router
