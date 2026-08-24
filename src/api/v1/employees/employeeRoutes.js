const express = require('express')
const employeeController = require('./employeeController')
const recordController = require('../records/recordController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { recibirArchivo } = require('../../../middlewares/uploadMiddleware')
const { CAPABILITIES } = require('../../../utils/permissions')
const {
  importEmployeesValidation
} = require('../../../validations/employeeImportValidation')
const {
  listEmployeesValidation,
  createEmployeeValidation,
  updateEmployeeValidation,
  employeeEstadoValidation,
  employeeIdValidation,
  grantAccessValidation,
  updateAccessValidation,
  resetPasswordValidation
} = require('../../../validations/employeeValidation')

const router = express.Router()

router.use(protect, applyScope)

// ─── Catálogo ─────────────────────────────────────────────────────────────────
router
  .route('/')
  .get(
    requireCapability(CAPABILITIES.VIEW_EMPLOYEES),
    listEmployeesValidation,
    validateRequest,
    asyncHandler(employeeController.list)
  )
  /*
   * El alta no lleva `requireCapability`: quién puede crear depende del **tipo**
   * de persona (`mano_de_obra` los tres niveles, `administrativo` sólo
   * `rh_admin`), y eso se decide en el servicio con `canManageEmployeeType`, que
   * es donde ya está el tipo validado. Un middleware fijo aquí daría 403 a un
   * `rh_consulta` que sí puede dar de alta personal de obra.
   */
  .post(
    createEmployeeValidation,
    validateRequest,
    asyncHandler(employeeController.create)
  )

// ─── Importación desde el archivo de nómina (.xlsx) — D-46 ───────────────────
/*
 * Va ANTES de `/:id`: aunque hoy no chocarían (`/:id` no declara POST), dejarlo
 * después dependería de ese detalle, y basta con que alguien agregue un
 * `POST /:id` para que `/empleados/importar` empiece a responder "empleado no
 * válido" sin que nadie entienda por qué.
 *
 * ─── El permiso ────────────────────────────────────────────────────────────
 * Se exigen DOS capacidades, las dos exclusivas de `rh_admin`: importar mueve
 * gente entre empresas (`MANAGE_AFFILIATIONS`) y da de alta personal
 * administrativo (`MANAGE_ADMIN_EMPLOYEES`) —de los 145 del archivo, buena parte
 * lo es—. Un alta masiva sobre el catálogo compartido no es trabajo de
 * `rh_consulta` ni de `jefe_area`.
 *
 * DESVIACIÓN ANOTADA: la importación crea las categorías que falten, y crear
 * categorías a mano exige `alcanceGlobal` (`MANAGE_CATEGORIES`). Aquí no se
 * exige: el puesto llega en una columna del archivo, no es una decisión de
 * catálogo, y pedir al administrador de plataforma para importar la nómina de
 * una empresa dejaría la función inservible. Ver D-46.
 */
const importarPersonal = [
  requireCapability(CAPABILITIES.MANAGE_AFFILIATIONS),
  requireCapability(CAPABILITIES.MANAGE_ADMIN_EMPLOYEES)
]

router.post(
  '/importar/previsualizar',
  importarPersonal,
  recibirArchivo,
  importEmployeesValidation,
  validateRequest,
  asyncHandler(employeeController.previewImport)
)

router.post(
  '/importar',
  importarPersonal,
  recibirArchivo,
  importEmployeesValidation,
  validateRequest,
  asyncHandler(employeeController.import)
)

router
  .route('/:id')
  .get(
    requireCapability(CAPABILITIES.VIEW_EMPLOYEES),
    employeeIdValidation,
    validateRequest,
    asyncHandler(employeeController.getById)
  )
  /*
   * Editar tampoco lleva capacidad fija, por lo mismo que el alta: quien puede
   * crear a alguien de un tipo puede editarlo, y el tipo lo sabe el servicio.
   */
  .patch(
    updateEmployeeValidation,
    validateRequest,
    asyncHandler(employeeController.update)
  )

// La baja del sistema SÍ sigue siendo de `rh_admin`: corregir datos y sacar a
// alguien del sistema no son la misma decisión.
router.patch(
  '/:id/estado',
  requireCapability(CAPABILITIES.DEACTIVATE_EMPLOYEES),
  employeeEstadoValidation,
  validateRequest,
  asyncHandler(employeeController.setEstado)
)

// El expediente de la persona. Se crea solo si no existía.
router.get(
  '/:id/expediente',
  requireCapability(CAPABILITIES.VIEW_EMPLOYEES),
  employeeIdValidation,
  validateRequest,
  asyncHandler(recordController.porEmpleado)
)

// ─── Accesos: sub-recurso del empleado (sólo `rh_admin`) ─────────────────────
const administrarAccesos = requireCapability(CAPABILITIES.MANAGE_ACCESS)

router
  .route('/:id/acceso')
  .post(
    administrarAccesos,
    grantAccessValidation,
    validateRequest,
    asyncHandler(employeeController.grantAccess)
  )
  .patch(
    administrarAccesos,
    updateAccessValidation,
    validateRequest,
    asyncHandler(employeeController.updateAccess)
  )
  .delete(
    administrarAccesos,
    employeeIdValidation,
    validateRequest,
    asyncHandler(employeeController.revokeAccess)
  )

router.post(
  '/:id/acceso/restablecer-password',
  administrarAccesos,
  resetPasswordValidation,
  validateRequest,
  asyncHandler(employeeController.resetPassword)
)

module.exports = router
