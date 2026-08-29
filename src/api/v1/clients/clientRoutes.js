const express = require('express')
const clientController = require('./clientController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { requirePasswordDefinitiva } = require('../../../middlewares/passwordMiddleware')
const { CAPABILITIES } = require('../../../utils/permissions')
const {
  listClientsValidation,
  clientIdValidation,
  createClientValidation,
  updateClientValidation,
  clientEstadoValidation,
  addConstructionRegistrationValidation,
  updateConstructionRegistrationValidation,
  constructionRegistrationEstadoValidation
} = require('../../../validations/clientValidation')

const router = express.Router()

// `requirePasswordDefinitiva` va aquí y no en `protect`: ver D-49.
router.use(protect, requirePasswordDefinitiva, applyScope)

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

/*
 * Registros de obra del cliente (D-66). Sub-recurso, igual que los registros
 * patronales bajo la empresa: no tienen vida fuera de su cliente.
 *
 * Mismo permiso que administrar clientes —`rh_admin` y `jefe_area`—, no el de
 * plataforma: son dato operativo del cliente, no configuración del grupo.
 */
router.post(
  '/:id/registros-obra',
  administrarClientes,
  addConstructionRegistrationValidation,
  validateRequest,
  asyncHandler(clientController.addRegistroObra)
)

router.patch(
  '/:id/registros-obra/:roId',
  administrarClientes,
  updateConstructionRegistrationValidation,
  validateRequest,
  asyncHandler(clientController.updateRegistroObra)
)

router.patch(
  '/:id/registros-obra/:roId/estado',
  administrarClientes,
  constructionRegistrationEstadoValidation,
  validateRequest,
  asyncHandler(clientController.setEstadoRegistroObra)
)

module.exports = router
