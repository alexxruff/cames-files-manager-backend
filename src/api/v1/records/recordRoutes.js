const express = require('express')
const recordController = require('./recordController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { requirePasswordDefinitiva } = require('../../../middlewares/passwordMiddleware')
const { recibirArchivo } = require('../../../middlewares/uploadMiddleware')
const { CAPABILITIES } = require('../../../utils/permissions')
const {
  recordIdValidation,
  listRecordsValidation,
  uploadDocumentValidation,
  reviewDocumentValidation,
  documentVersionValidation
} = require('../../../validations/recordValidation')

const router = express.Router()

// `requirePasswordDefinitiva` va aquí y no en `protect`: ver D-49.
router.use(protect, requirePasswordDefinitiva, applyScope)

/** GET /expedientes — listado paginado (D-45). Mismos filtros que /empleados. */
router.get(
  '/',
  requireCapability(CAPABILITIES.VIEW_RECORDS),
  listRecordsValidation,
  validateRequest,
  asyncHandler(recordController.list)
)

router.get(
  '/:id',
  requireCapability(CAPABILITIES.VIEW_RECORDS),
  recordIdValidation,
  validateRequest,
  asyncHandler(recordController.porId)
)

/*
 * Subir: `rh_admin` y `rh_consulta`. El jefe de área ve el expediente pero no
 * sube documentos (matriz §8.2).
 *
 * `recibirArchivo` va ANTES de las validaciones: hasta que multer no procesa el
 * multipart, `req.body` está vacío y `vigenciaHasta` no existiría.
 */
router.post(
  '/:id/documentos/:tipo',
  requireCapability(CAPABILITIES.UPLOAD_DOCUMENTS),
  recibirArchivo,
  uploadDocumentValidation,
  validateRequest,
  asyncHandler(recordController.subirDocumento)
)

/*
 * Revisar: `rh_admin` y `rh_consulta` (`REVIEW_DOCUMENTS`, D-44). Un endpoint
 * para validar y rechazar (D-43): `{ aprobado: true|false, motivo? }`.
 */
router.post(
  '/:id/documentos/:tipo/revisar',
  requireCapability(CAPABILITIES.REVIEW_DOCUMENTS),
  reviewDocumentValidation,
  validateRequest,
  asyncHandler(recordController.revisarDocumento)
)

/*
 * Abrir un archivo. No lleva capacidad fija: cualquiera que vea el expediente
 * puede abrir los documentos NO sensibles, y el servicio niega los sensibles a
 * quien no puede abrirlos (el jefe de área). Cada emisión queda en la bitácora.
 */
router.get(
  '/:id/documentos/:tipo/versiones/:version/url',
  requireCapability(CAPABILITIES.VIEW_RECORDS),
  documentVersionValidation,
  validateRequest,
  asyncHandler(recordController.urlDeVersion)
)

module.exports = router
