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
  companyModulesValidation,
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
const machineController = require('../machines/machineController')
const {
  listMachinesValidation,
  createMachineValidation
} = require('../../../validations/machineValidation')
const { recibirArchivo } = require('../../../middlewares/uploadMiddleware')

const router = express.Router()

// `requirePasswordDefinitiva` va aquí y no en `protect`: ver D-49.
router.use(protect, requirePasswordDefinitiva, applyScope)

/*
 * Ver la empresa y administrarla son casillas distintas desde D-92, y los
 * registros patronales tienen la suya, separada de editar la empresa.
 */
const verEmpresas = requireCapability(CAPABILITIES.VIEW_COMPANIES)
const administrarEmpresas = requireCapability(CAPABILITIES.MANAGE_COMPANIES)

router
  .route('/')
  // Quien ve empresas ve LAS SUYAS; el admin de plataforma, todas.
  .get(
    verEmpresas,
    listCompaniesValidation,
    validateRequest,
    asyncHandler(companyController.list)
  )
  .post(
    // Crear una empresa cambia la estructura del grupo: exige alcance global.
    administrarEmpresas,
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
  administrarEmpresas,
  updateCompanyValidation,
  validateRequest,
  asyncHandler(companyController.update)
)

router.patch(
  '/:id/estado',
  administrarEmpresas,
  companyEstadoValidation,
  validateRequest,
  asyncHandler(companyController.setEstado)
)

router.get(
  '/:id',
  verEmpresas,
  companyIdValidation,
  validateRequest,
  asyncHandler(companyController.getById)
)

/*
 * Los MÓDULOS de la empresa (D-95): qué secciones usa. Es un eje distinto de los
 * permisos —el módulo se apaga para toda la empresa, el permiso es de cada
 * persona—, así que vive bajo la empresa y no en `/roles`.
 *
 * Leer pide `viewCompanies` y **no obedece al módulo apagado**: si obedeciera,
 * una sección apagada no se podría volver a encender. Cambiarlos pide
 * `manageCompanies`, que ya exige alcance global: sólo el administrador de
 * plataforma decide qué usa cada empresa.
 */
router
  .route('/:id/modulos')
  .get(
    verEmpresas,
    companyIdValidation,
    validateRequest,
    asyncHandler(companyController.modulos)
  )
  .patch(
    administrarEmpresas,
    companyModulesValidation,
    validateRequest,
    asyncHandler(companyController.setModulos)
  )

/*
 * La CARTERA de la empresa: qué clientes del catálogo global usa.
 * Vive bajo la empresa porque siempre se consulta desde una empresa concreta.
 * Leer: quien ve clientes (puebla el selector de cliente al crear un
 * proyecto). Modificar: `rh_admin` y `jefe_area`.
 */
router
  .route('/:id/clientes')
  .get(
    requireCapability(CAPABILITIES.VIEW_CLIENTS),
    listPortfolioValidation,
    validateRequest,
    asyncHandler(portfolioController.list)
  )
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
 * Leer: quien ve adscripciones. Adscribir: exclusivo de `rh_admin`
 * (`MANAGE_AFFILIATIONS`), igual que en el alta.
 */
router
  .route('/:id/adscripciones')
  .get(
    requireCapability(CAPABILITIES.VIEW_AFFILIATIONS),
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
 * Casilla propia desde D-92 (`MANAGE_EMPLOYER_REGISTRIES`), que nació donde
 * estaba: exigiendo alcance global, igual que editar la empresa, porque afectan
 * a todo el grupo. Va aparte para poder dárselos después a quien lleva el IMSS
 * sin darle además la empresa entera.
 */
const administrarRegistrosPatronales = requireCapability(
  CAPABILITIES.MANAGE_EMPLOYER_REGISTRIES
)

router.post(
  '/:id/registros-patronales',
  administrarRegistrosPatronales,
  addEmployerRegistrationValidation,
  validateRequest,
  asyncHandler(companyController.addRegistroPatronal)
)

router.patch(
  '/:id/registros-patronales/:rpId',
  administrarRegistrosPatronales,
  updateEmployerRegistrationValidation,
  validateRequest,
  asyncHandler(companyController.updateRegistroPatronal)
)

router.patch(
  '/:id/registros-patronales/:rpId/estado',
  administrarRegistrosPatronales,
  employerRegistrationEstadoValidation,
  validateRequest,
  asyncHandler(companyController.setEstadoRegistroPatronal)
)

/*
 * El CATÁLOGO DE MAQUINARIA de la empresa (D-86). Vive bajo la empresa porque
 * es suyo: cada una conoce a sus máquinas por su propio identificador, y el
 * alcance se decide con el de la empresa. Operar sobre una máquina ya dada de
 * alta es `/maquinas/:id`.
 *
 * Leer: quien ve maquinaria. Dar de alta: quien administra el catálogo.
 * `recibirArchivo` va antes de las validaciones porque la foto puede venir en
 * el mismo `multipart` del alta (D-80).
 */
router
  .route('/:id/maquinas')
  .get(
    requireCapability(CAPABILITIES.VIEW_MACHINES),
    listMachinesValidation,
    validateRequest,
    asyncHandler(machineController.listByCompany)
  )
  .post(
    requireCapability(CAPABILITIES.MANAGE_MACHINES),
    recibirArchivo,
    createMachineValidation,
    validateRequest,
    asyncHandler(machineController.create)
  )

module.exports = router
