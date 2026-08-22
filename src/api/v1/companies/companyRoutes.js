const express = require('express')
const companyController = require('./companyController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { CAPABILITIES } = require('../../../utils/permissions')
const {
  listCompaniesValidation,
  companyIdValidation,
  createCompanyValidation
} = require('../../../validations/companyValidation')

const router = express.Router()

router.use(protect, applyScope)

router
  .route('/')
  // Cualquiera con sesión ve SUS empresas; el admin de plataforma, todas.
  .get(listCompaniesValidation, validateRequest, asyncHandler(companyController.list))
  .post(
    // Crear una empresa cambia la estructura del grupo: exige alcance global.
    requireCapability(CAPABILITIES.MANAGE_COMPANIES),
    createCompanyValidation,
    validateRequest,
    asyncHandler(companyController.create)
  )

router.get(
  '/:id',
  companyIdValidation,
  validateRequest,
  asyncHandler(companyController.getById)
)

module.exports = router
