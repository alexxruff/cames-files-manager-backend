const express = require('express')
const employeeController = require('./employeeController')
const recordController = require('../records/recordController')
const machineAssignmentController = require('../machineAssignments/machineAssignmentController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { requirePasswordDefinitiva } = require('../../../middlewares/passwordMiddleware')
const { recibirArchivoHasta } = require('../../../middlewares/uploadMiddleware')
const env = require('../../../config/env')
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
const {
  machinesByEmployeeValidation
} = require('../../../validations/machineAssignmentValidation')

const router = express.Router()

// `requirePasswordDefinitiva` va aquí y no en `protect`: ver D-49.
router.use(protect, requirePasswordDefinitiva, applyScope)

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
 * Una casilla propia, `IMPORT_EMPLOYEES` (D-92). Antes se exigían DOS a la vez
 * —`MANAGE_AFFILIATIONS` y `MANAGE_ADMIN_EMPLOYEES`—, porque importar mueve
 * gente entre empresas y da de alta personal administrativo; nació con el mismo
 * reparto que daba ese par, o sea exclusiva de `rh_admin`. Un alta masiva sobre
 * el catálogo compartido no es trabajo de `rh_consulta` ni de `jefe_area`.
 *
 * DESVIACIÓN ANOTADA: la importación crea las categorías que falten, y crear
 * categorías a mano exige `alcanceGlobal` (`MANAGE_CATEGORIES`). Aquí no se
 * exige: el puesto llega en una columna del archivo, no es una decisión de
 * catálogo, y pedir al administrador de plataforma para importar la nómina de
 * una empresa dejaría la función inservible. Ver D-46.
 */
/*
 * El .xlsx entra con un tope PROPIO y más bajo que el general (D-81): `exceljs`
 * abre el libro entero en memoria y lo expande a objetos, así que aquí un
 * archivo grande no es un archivo grande, es la máquina caída. Un reporte de
 * nómina real pesa cientos de KB.
 */
const recibirLibro = recibirArchivoHasta(env.MAX_IMPORT_UPLOAD_BYTES)

const importarPersonal = requireCapability(CAPABILITIES.IMPORT_EMPLOYEES)

router.post(
  '/importar/previsualizar',
  importarPersonal,
  recibirLibro,
  importEmployeesValidation,
  validateRequest,
  asyncHandler(employeeController.previewImport)
)

router.post(
  '/importar',
  importarPersonal,
  recibirLibro,
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

/*
 * El expediente de la persona. Se crea solo si no existía.
 *
 * Pide `VIEW_RECORDS`, no `VIEW_EMPLOYEES` (D-92): se le puede negar el
 * expediente a quien sí puede ver a la persona —es justo lo que necesita el
 * auxiliar de operaciones—.
 */
router.get(
  '/:id/expediente',
  requireCapability(CAPABILITIES.VIEW_RECORDS),
  employeeIdValidation,
  validateRequest,
  asyncHandler(recordController.porEmpleado)
)

// ─── Accesos: sub-recurso del empleado (sólo `rh_admin`) ─────────────────────
const administrarAccesos = requireCapability(CAPABILITIES.MANAGE_ACCESS)

router
  .route('/:id/acceso')
  .get(
    administrarAccesos,
    employeeIdValidation,
    validateRequest,
    asyncHandler(employeeController.getAccess)
  )
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

/*
 * Las máquinas que trae esa persona (D-87). Puede traer varias, y de más de una
 * empresa si está adscrita a varias: el listado se recorta al alcance de quien
 * pregunta, empresa por empresa.
 */
router.get(
  '/:id/maquinas',
  requireCapability(CAPABILITIES.VIEW_MACHINES),
  machinesByEmployeeValidation,
  validateRequest,
  asyncHandler(machineAssignmentController.delTrabajador)
)

module.exports = router
