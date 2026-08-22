const express = require('express')
const employeeController = require('./employeeController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { CAPABILITIES } = require('../../../utils/permissions')
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
