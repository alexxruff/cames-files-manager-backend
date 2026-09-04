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
 * Desde D-92 leer también es una casilla, y los registros de obra tienen la
 * suya: el contador los captura sin poder dar de alta clientes.
 */
const verClientes = requireCapability(CAPABILITIES.VIEW_CLIENTS)
const administrarClientes = requireCapability(CAPABILITIES.MANAGE_CLIENTS)
const administrarRegistrosObra = requireCapability(CAPABILITIES.MANAGE_WORK_REGISTRIES)

router
  .route('/')
  .get(
    verClientes,
    listClientsValidation,
    validateRequest,
    asyncHandler(clientController.list)
  )
  .post(
    administrarClientes,
    createClientValidation,
    validateRequest,
    asyncHandler(clientController.create)
  )

router
  .route('/:id')
  .get(
    verClientes,
    clientIdValidation,
    validateRequest,
    asyncHandler(clientController.getById)
  )
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
 * Su propia casilla desde D-92 (`MANAGE_WORK_REGISTRIES`), que nació con el
 * mismo reparto que administrar clientes —`rh_admin` y `jefe_area`— y no con el
 * de plataforma: son dato operativo del cliente, no configuración del grupo.
 */
/*
 * `recibirArchivo` va antes de las validaciones porque es quien llena
 * `req.body` cuando la petición viene como `multipart` (D-79). Las dos rutas
 * siguen aceptando `application/json` sin archivo: multer deja pasar lo que no
 * es multipart.
 */
router.post(
  '/:id/registros-obra',
  administrarRegistrosObra,
  recibirArchivo,
  addConstructionRegistrationValidation,
  validateRequest,
  asyncHandler(clientController.addRegistroObra)
)

router.patch(
  '/:id/registros-obra/:roId',
  administrarRegistrosObra,
  recibirArchivo,
  updateConstructionRegistrationValidation,
  validateRequest,
  asyncHandler(clientController.updateRegistroObra)
)

/*
 * Abrir el archivo del registro. No pide más que ver el cliente: quien puede
 * leer el número puede ver el papel que lo respalda.
 */
router.get(
  '/:id/registros-obra/:roId/archivo',
  verClientes,
  constructionRegistrationFileValidation,
  validateRequest,
  asyncHandler(clientController.urlArchivoRegistroObra)
)

router.patch(
  '/:id/registros-obra/:roId/estado',
  administrarRegistrosObra,
  constructionRegistrationEstadoValidation,
  validateRequest,
  asyncHandler(clientController.setEstadoRegistroObra)
)

module.exports = router
