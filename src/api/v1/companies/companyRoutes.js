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
const portfolioController = require('../portfolios/portfolioController')
const {
  listPortfolioValidation,
  addToPortfolioValidation
} = require('../../../validations/portfolioValidation')
const affiliationController = require('../affiliations/affiliationController')
const {
  listAffiliationsValidation,
  addAffiliationValidation
} = require('../../../validations/affiliationValidation')

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

/*
 * La CARTERA de la empresa: qué clientes del catálogo global usa.
 * Vive bajo la empresa porque siempre se consulta desde una empresa concreta.
 * Leer: cualquiera con sesión (puebla el selector de cliente al crear un
 * proyecto). Modificar: `rh_admin` y `jefe_area`.
 */
router
  .route('/:id/clientes')
  .get(listPortfolioValidation, validateRequest, asyncHandler(portfolioController.list))
  .post(
    requireCapability(CAPABILITIES.MANAGE_CLIENT_PORTFOLIO),
    addToPortfolioValidation,
    validateRequest,
    asyncHandler(portfolioController.add)
  )

/*
 * La ADSCRIPCIÓN empresa ↔ empleado: vincula a alguien que ya existe en el
 * catálogo compartido, en vez de darlo de alta otra vez. Vive bajo la empresa
 * porque siempre se adscribe desde una empresa concreta; editar un vínculo que
 * ya existe es `/adscripciones/:id` (D-45).
 *
 * Leer: quien ve empleados. Adscribir: exclusivo de `rh_admin`
 * (`MANAGE_AFFILIATIONS`), igual que en el alta.
 */
router
  .route('/:id/adscripciones')
  .get(
    requireCapability(CAPABILITIES.VIEW_EMPLOYEES),
    listAffiliationsValidation,
    validateRequest,
    asyncHandler(affiliationController.list)
  )
  .post(
    requireCapability(CAPABILITIES.MANAGE_AFFILIATIONS),
    addAffiliationValidation,
    validateRequest,
    asyncHandler(affiliationController.add)
  )

module.exports = router
