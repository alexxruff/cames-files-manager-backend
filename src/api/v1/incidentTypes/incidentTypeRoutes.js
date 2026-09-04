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
 * Lo escribe **quien administra los tipos de incidencia**, no el administrador
 * de plataforma, y es una desviación consciente de «los catálogos compartidos
 * exigen alcanceGlobal»: quien está capturando una incidencia y no encuentra el
 * tipo tiene que poder agregarlo ahí mismo. El motivo completo, en D-88.
 *
 * Desde D-92 la lectura pide **ver incidencias** en vez de sólo tener sesión.
 * No es lo mismo que `/areas` y `/categorias`, que llenan los desplegables de
 * TODOS los formularios y por eso siguen abiertas: éste llena uno solo, el de la
 * incidencia, y a quien no ve incidencias no le sirve de nada.
 */
const router = express.Router()

// `requirePasswordDefinitiva` va aquí y no en `protect`: ver D-49.
router.use(protect, requirePasswordDefinitiva, applyScope)

const verIncidencias = requireCapability(CAPABILITIES.VIEW_MACHINE_INCIDENTS)
const administrarCatalogo = requireCapability(CAPABILITIES.MANAGE_INCIDENT_TYPES)

router
  .route('/')
  // Puebla el desplegable del alta de una incidencia: misma casilla que verlas.
  .get(
    verIncidencias,
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
