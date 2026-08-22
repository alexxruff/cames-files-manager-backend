const express = require('express')
const categoryController = require('./categoryController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { CAPABILITIES } = require('../../../utils/permissions')
const {
  listCategoriesValidation,
  createCategoryValidation,
  categoryEstadoValidation
} = require('../../../validations/categoryValidation')

const router = express.Router()

router.use(protect, applyScope)

const administrarCatalogo = requireCapability(CAPABILITIES.MANAGE_CATEGORIES)

router
  .route('/')
  // Lectura para cualquiera con sesión: pueblan los desplegables del alta.
  .get(listCategoriesValidation, validateRequest, asyncHandler(categoryController.list))
  .post(
    administrarCatalogo,
    createCategoryValidation,
    validateRequest,
    asyncHandler(categoryController.create)
  )

router.patch(
  '/:id/estado',
  administrarCatalogo,
  categoryEstadoValidation,
  validateRequest,
  asyncHandler(categoryController.setEstado)
)

module.exports = router
