const express = require('express')
const areaController = require('./areaController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { requirePasswordDefinitiva } = require('../../../middlewares/passwordMiddleware')
const { CAPABILITIES } = require('../../../utils/permissions')
const {
  listAreasValidation,
  createAreaValidation,
  updateAreaValidation,
  areaEstadoValidation
} = require('../../../validations/areaValidation')

const router = express.Router()

// `requirePasswordDefinitiva` va aquí y no en `protect`: ver D-49.
router.use(protect, requirePasswordDefinitiva, applyScope)

const administrarCatalogo = requireCapability(CAPABILITIES.MANAGE_AREAS)

router
  .route('/')
  // Lectura para cualquiera con sesión: pueblan los desplegables del alta y de
  // las adscripciones, igual que las categorías.
  .get(listAreasValidation, validateRequest, asyncHandler(areaController.list))
  .post(
    administrarCatalogo,
    createAreaValidation,
    validateRequest,
    asyncHandler(areaController.create)
  )

router.patch(
  '/:id',
  administrarCatalogo,
  updateAreaValidation,
  validateRequest,
  asyncHandler(areaController.update)
)

/*
 * El estado NO lleva `administrarCatalogo`: quién puede darla de baja depende de
 * si el área es temporal, y eso sólo se sabe leyendo el documento. El permiso lo
 * resuelve el controlador contra las dos capacidades (D-58).
 */
router.patch(
  '/:id/estado',
  areaEstadoValidation,
  validateRequest,
  asyncHandler(areaController.setEstado)
)

module.exports = router
