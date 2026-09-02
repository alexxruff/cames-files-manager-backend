const express = require('express')
const contractController = require('./contractController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { recibirArchivo } = require('../../../middlewares/uploadMiddleware')
const { requirePasswordDefinitiva } = require('../../../middlewares/passwordMiddleware')
const { CAPABILITIES } = require('../../../utils/permissions')
const {
  contractIdValidation,
  contractFileValidation,
  updateContractValidation,
  contractEstadoValidation,
  setSirocValidation,
  sirocRenovacionValidation,
  sirocFileValidation,
  sirocUpdateFileValidation,
  sirocUpdateFileUploadValidation
} = require('../../../validations/contractValidation')

/**
 * `/contratos/:id` — operar sobre un contrato concreto.
 *
 * El alta y el listado viven bajo el proyecto (`/proyectos/:id/contratos`),
 * porque un contrato no existe sin él; lo demás opera sobre el contrato, que ya
 * se identifica solo. Mismo reparto que en asignaciones.
 *
 * Ojo con las dos rutas de estado, que **no son lo mismo** (D-70):
 *   POST  /:id/finalizar · /:id/reabrir → `estado`, el ciclo de vida
 *   PATCH /:id/estado                   → `activo`, la baja
 */
const router = express.Router()

// `requirePasswordDefinitiva` va aquí y no en `protect`: ver D-49.
router.use(protect, requirePasswordDefinitiva, applyScope)

// Los contratos son parte de gestionar el proyecto: misma capacidad.
const gestionarProyectos = requireCapability(CAPABILITIES.MANAGE_PROJECTS)

/*
 * `recibirArchivo` va antes de las validaciones también aquí: mandar el contrato
 * escaneado —solo o junto con las fechas— es una edición del contrato, no un
 * recurso aparte (D-81). Sigue aceptando el mismo JSON sin archivo.
 */
router.patch(
  '/:id',
  gestionarProyectos,
  recibirArchivo,
  updateContractValidation,
  validateRequest,
  asyncHandler(contractController.update)
)

/*
 * Abrir el contrato escaneado. Como el papel del aviso: sólo pide sesión y
 * alcance —quien puede leer el contrato puede ver el documento que lo
 * respalda—, y existe porque la URL que viaja en cada respuesta caduca a los 10
 * minutos.
 */
router.get(
  '/:id/archivo',
  contractFileValidation,
  validateRequest,
  asyncHandler(contractController.urlArchivoContrato)
)

/*
 * `recibirArchivo` va ANTES de las validaciones porque es multer quien llena
 * `req.body` cuando la petición viene como `multipart` (D-80). Las dos rutas de
 * captura siguen aceptando `application/json` sin archivo: multer deja pasar lo
 * que no es multipart.
 */
router
  .route('/:id/siroc')
  .put(
    gestionarProyectos,
    recibirArchivo,
    setSirocValidation,
    validateRequest,
    asyncHandler(contractController.setSiroc)
  )
  .delete(
    gestionarProyectos,
    contractIdValidation,
    validateRequest,
    asyncHandler(contractController.quitarSiroc)
  )

/*
 * Las renovaciones del aviso (D-76). Cuelgan del SIROC y no de `PUT /siroc`
 * porque no lo reemplazan: el número sigue siendo el mismo y lo que se agrega es
 * una fecha más a su historia.
 */
router.post(
  '/:id/siroc/actualizaciones',
  gestionarProyectos,
  recibirArchivo,
  sirocRenovacionValidation,
  validateRequest,
  asyncHandler(contractController.registrarActualizacion)
)
router.delete(
  '/:id/siroc/actualizaciones/ultima',
  gestionarProyectos,
  contractIdValidation,
  validateRequest,
  asyncHandler(contractController.quitarUltimaActualizacion)
)

/*
 * Abrir el papel del aviso. Sólo pide sesión y alcance —lo mismo que ver el
 * contrato—: quien puede leer el número del SIROC puede ver el papel que lo
 * respalda. La URL que viaja en cada respuesta caduca a los 10 minutos; esto
 * pide una nueva sin recargar el proyecto entero.
 */
router.get(
  '/:id/siroc/archivo',
  sirocFileValidation,
  validateRequest,
  asyncHandler(contractController.urlArchivoSiroc)
)
/*
 * El archivo de una renovación se LEE con sesión y alcance, y se REEMPLAZA con
 * la misma capacidad que capturarla. El `PUT` está aquí y no en un `POST` nuevo
 * porque el recurso es el archivo de esa posición y esto lo reemplaza entero: no
 * toca la fecha, la nota ni el orden (D-80).
 */
router
  .route('/:id/siroc/actualizaciones/:indice/archivo')
  .get(
    sirocUpdateFileValidation,
    validateRequest,
    asyncHandler(contractController.urlArchivoActualizacion)
  )
  .put(
    gestionarProyectos,
    recibirArchivo,
    sirocUpdateFileUploadValidation,
    validateRequest,
    asyncHandler(contractController.subirArchivoActualizacion)
  )

router.post(
  '/:id/finalizar',
  gestionarProyectos,
  contractIdValidation,
  validateRequest,
  asyncHandler(contractController.finalizar)
)
router.post(
  '/:id/reabrir',
  gestionarProyectos,
  contractIdValidation,
  validateRequest,
  asyncHandler(contractController.reabrir)
)

router.patch(
  '/:id/estado',
  gestionarProyectos,
  contractEstadoValidation,
  validateRequest,
  asyncHandler(contractController.setEstado)
)

module.exports = router
