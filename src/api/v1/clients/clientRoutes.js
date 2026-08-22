const express = require('express')
const clientController = require('./clientController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { CAPABILITIES } = require('../../../utils/permissions')
const {
  listClientsValidation,
  clientIdValidation,
  createClientValidation,
  updateClientValidation,
  clientEstadoValidation
} = require('../../../validations/clientValidation')

const router = express.Router()

router.use(protect, applyScope)

/*
 * Alta, edición y baja: `rh_admin` y `jefe_area` (corrección de la matriz
 * confirmada con Urbacames). `rh_consulta` no. Como en el personal, quien puede
 * crear puede también corregir y desactivar.
 *
 * Leer: cualquiera con sesión — el catálogo puebla los selectores de proyectos y
 * carteras.
 */
const administrarClientes = requireCapability(CAPABILITIES.MANAGE_CLIENTS)

router
  .route('/')
  .get(listClientsValidation, validateRequest, asyncHandler(clientController.list))
  .post(
    administrarClientes,
    createClientValidation,
    validateRequest,
    asyncHandler(clientController.create)
  )

router
  .route('/:id')
  .get(clientIdValidation, validateRequest, asyncHandler(clientController.getById))
  .patch(
    administrarClientes,
    updateClientValidation,
    validateRequest,
    asyncHandler(clientController.update)
  )

router.patch(
  '/:id/estado',
  administrarClientes,
  clientEstadoValidation,
  validateRequest,
  asyncHandler(clientController.setEstado)
)

module.exports = router
