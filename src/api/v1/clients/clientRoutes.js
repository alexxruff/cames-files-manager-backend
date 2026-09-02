const express = require('express')
const clientController = require('./clientController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { requirePasswordDefinitiva } = require('../../../middlewares/passwordMiddleware')
const { recibirArchivo } = require('../../../middlewares/uploadMiddleware')
const { CAPABILITIES } = require('../../../utils/permissions')
const {
  listClientsValidation,
  clientIdValidation,
  createClientValidation,
  updateClientValidation,
  clientEstadoValidation,
  addConstructionRegistrationValidation,
  updateConstructionRegistrationValidation,
  constructionRegistrationEstadoValidation,
  constructionRegistrationFileValidation
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
/*
 * `recibirArchivo` va antes de las validaciones porque es quien llena
 * `req.body` cuando la petición viene como `multipart` (D-79). Las dos rutas
 * siguen aceptando `application/json` sin archivo: multer deja pasar lo que no
 * es multipart.
 */
router.post(
  '/:id/registros-obra',
  administrarClientes,
  recibirArchivo,
  addConstructionRegistrationValidation,
  validateRequest,
  asyncHandler(clientController.addRegistroObra)
)

router.patch(
  '/:id/registros-obra/:roId',
  administrarClientes,
  recibirArchivo,
  updateConstructionRegistrationValidation,
  validateRequest,
  asyncHandler(clientController.updateRegistroObra)
)

/*
 * Abrir el archivo del registro. Sólo pide sesión y alcance —lo mismo que ver
 * el cliente—: quien puede leer el número puede ver el papel que lo respalda.
 */
router.get(
  '/:id/registros-obra/:roId/archivo',
  constructionRegistrationFileValidation,
  validateRequest,
  asyncHandler(clientController.urlArchivoRegistroObra)
)

router.patch(
  '/:id/registros-obra/:roId/estado',
  administrarClientes,
  constructionRegistrationEstadoValidation,
  validateRequest,
  asyncHandler(clientController.setEstadoRegistroObra)
)

module.exports = router
