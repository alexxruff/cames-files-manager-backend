const express = require('express')
const contractController = require('./contractController')
const { AppError } = require('../../../middlewares/errorHandler')
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
  contractFileUploadValidation,
  contractModificacionValidation,
  contractModificacionFileValidation,
  contractModificacionFileUploadValidation,
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
 * Editar un contrato **ya no existe** (D-90). Se confundía con modificarlo, que
 * es otra cosa: corregir un dedazo se hace eliminando y volviendo a capturar,
 * repactar lo firmado se hace con una modificación, y adjuntar el papel tiene
 * ahora su propia ruta.
 *
 * **410 y no 404** a propósito, como `/usuarios`: 404 diría «esto nunca
 * existió», y lo que pasó es que se repartió en tres. El mensaje dice en cuáles,
 * para que el front lo descubra en la primera llamada.
 */
router.patch('/:id', (req, res, next) => {
  next(
    new AppError(
      410,
      'Editar un contrato ya no existe. Usa POST /contratos/:id/modificaciones para registrar un cambio de fechas o monto · PUT /contratos/:id/archivo para adjuntar el contrato escaneado · DELETE /contratos/:id para eliminarlo y capturarlo de nuevo',
      { code: 'RUTA_MOVIDA' }
    )
  )
})

/*
 * El contrato escaneado, que antes viajaba en el `PATCH` (D-81). `recibirArchivo`
 * va ANTES de las validaciones porque es multer quien llena `req.body` cuando la
 * petición viene como `multipart`; con la subida directa (D-83) el cuerpo trae
 * sólo `subidaId`.
 */
router.put(
  '/:id/archivo',
  gestionarProyectos,
  recibirArchivo,
  contractFileUploadValidation,
  validateRequest,
  asyncHandler(contractController.subirArchivoContrato)
)

/*
 * Las modificaciones del contrato (D-90). Mismo reparto que los reportes
 * bimestrales del SIROC: se agregan, se deshace la última, y el papel de
 * cualquiera se lee con sesión y alcance y se reemplaza con la capacidad de
 * gestionar proyectos.
 */
router.post(
  '/:id/modificaciones',
  gestionarProyectos,
  recibirArchivo,
  contractModificacionValidation,
  validateRequest,
  asyncHandler(contractController.registrarModificacion)
)
router.delete(
  '/:id/modificaciones/ultima',
  gestionarProyectos,
  contractIdValidation,
  validateRequest,
  asyncHandler(contractController.quitarUltimaModificacion)
)
router
  .route('/:id/modificaciones/:indice/archivo')
  .get(
    contractModificacionFileValidation,
    validateRequest,
    asyncHandler(contractController.urlArchivoModificacion)
  )
  .put(
    gestionarProyectos,
    recibirArchivo,
    contractModificacionFileUploadValidation,
    validateRequest,
    asyncHandler(contractController.subirArchivoModificacion)
  )

/*
 * Eliminar, que **no es dar de baja** (D-90): esto borra el contrato, su SIROC,
 * sus reportes bimestrales, sus modificaciones y todos sus archivos, y libera
 * los dos números. La baja sigue en `PATCH /:id/estado`, y la advertencia previa
 * es de la pantalla.
 */
router.delete(
  '/:id',
  gestionarProyectos,
  contractIdValidation,
  validateRequest,
  asyncHandler(contractController.eliminar)
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
 * toca la fecha, la nota, el monto, el bimestre ni el orden (D-80, D-91).
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
