const express = require('express')
const companyController = require('./companyController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { requirePasswordDefinitiva } = require('../../../middlewares/passwordMiddleware')
const { CAPABILITIES } = require('../../../utils/permissions')
const {
  listCompaniesValidation,
  companyIdValidation,
  createCompanyValidation,
  updateCompanyValidation,
  companyEstadoValidation,
  addEmployerRegistrationValidation,
  updateEmployerRegistrationValidation,
  employerRegistrationEstadoValidation
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

// `requirePasswordDefinitiva` va aquí y no en `protect`: ver D-49.
router.use(protect, requirePasswordDefinitiva, applyScope)

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

/*
 * Editar y dar de baja: exclusivo del administrador de plataforma, igual que
 * crear (D-64). Una empresa afecta a todo el grupo, y darla de baja esconde a su
 * gente de los listados.
 */
router.patch(
  '/:id',
  requireCapability(CAPABILITIES.MANAGE_COMPANIES),
  updateCompanyValidation,
  validateRequest,
  asyncHandler(companyController.update)
)

router.patch(
  '/:id/estado',
  requireCapability(CAPABILITIES.MANAGE_COMPANIES),
  companyEstadoValidation,
  validateRequest,
  asyncHandler(companyController.setEstado)
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

/*
 * Quién dirige cada área de esta empresa (D-60). Es la vista de la pantalla de
 * configuración: se entra por el ÁREA, no por la persona, y trae también las que
 * están sin dirigir, que es la mitad de para qué sirve.
 *
 * Sólo lectura: asignar es `PATCH /adscripciones/:id/jefaturas`, que exige la
 * capacidad de repartir visibilidad.
 */
router.get(
  '/:id/jefaturas',
  requireCapability(CAPABILITIES.MANAGE_AREA_LEADERSHIP),
  companyIdValidation,
  validateRequest,
  asyncHandler(affiliationController.jefaturas)
)

/*
 * Registros patronales de la empresa (D-65). Sub-recurso, como el acceso de un
 * empleado: no tienen vida fuera de su empresa, así que se administran bajo ella
 * y no en una ruta propia.
 *
 * Mismo permiso que editar la empresa: afectan a todo el grupo.
 */
const administrarEmpresa = requireCapability(CAPABILITIES.MANAGE_COMPANIES)

router.post(
  '/:id/registros-patronales',
  administrarEmpresa,
  addEmployerRegistrationValidation,
  validateRequest,
  asyncHandler(companyController.addRegistroPatronal)
)

router.patch(
  '/:id/registros-patronales/:rpId',
  administrarEmpresa,
  updateEmployerRegistrationValidation,
  validateRequest,
  asyncHandler(companyController.updateRegistroPatronal)
)

router.patch(
  '/:id/registros-patronales/:rpId/estado',
  administrarEmpresa,
  employerRegistrationEstadoValidation,
  validateRequest,
  asyncHandler(companyController.setEstadoRegistroPatronal)
)

module.exports = router
