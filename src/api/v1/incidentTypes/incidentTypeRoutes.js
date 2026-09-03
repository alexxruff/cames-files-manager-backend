const express = require('express')
const incidentTypeController = require('./incidentTypeController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { requirePasswordDefinitiva } = require('../../../middlewares/passwordMiddleware')
const { CAPABILITIES } = require('../../../utils/permissions')
const {
  listIncidentTypesValidation,
  createIncidentTypeValidation,
  updateIncidentTypeValidation,
  incidentTypeEstadoValidation
} = require('../../../validations/incidentTypeValidation')

/**
 * `/tipos-incidencia` — el catálogo compartido de tipos de incidencia (D-88).
 *
 * Lo escribe **quien gestiona proyectos**, no el administrador de plataforma, y
 * es una desviación consciente de «los catálogos compartidos exigen
 * alcanceGlobal»: quien está capturando una incidencia y no encuentra el tipo
 * tiene que poder agregarlo ahí mismo. El motivo completo, en D-88.
 */
const router = express.Router()

// `requirePasswordDefinitiva` va aquí y no en `protect`: ver D-49.
router.use(protect, requirePasswordDefinitiva, applyScope)

const administrarCatalogo = requireCapability(CAPABILITIES.MANAGE_PROJECTS)

router
  .route('/')
  // Lectura para cualquiera con sesión: puebla el desplegable del alta.
  .get(
    listIncidentTypesValidation,
    validateRequest,
    asyncHandler(incidentTypeController.list)
  )
  .post(
    administrarCatalogo,
    createIncidentTypeValidation,
    validateRequest,
    asyncHandler(incidentTypeController.create)
  )

router.patch(
  '/:id',
  administrarCatalogo,
  updateIncidentTypeValidation,
  validateRequest,
  asyncHandler(incidentTypeController.update)
)

router.patch(
  '/:id/estado',
  administrarCatalogo,
  incidentTypeEstadoValidation,
  validateRequest,
  asyncHandler(incidentTypeController.setEstado)
)

module.exports = router
