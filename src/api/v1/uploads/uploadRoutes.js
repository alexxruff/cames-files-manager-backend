const express = require('express')
const uploadController = require('./uploadController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { requirePasswordDefinitiva } = require('../../../middlewares/passwordMiddleware')
const { createUploadValidation } = require('../../../validations/uploadValidation')

/**
 * `/subidas` — el permiso para subir un archivo directo al almacenamiento (D-83).
 *
 * **No hay capacidad en la ruta**, y es deliberado: cuál hace falta depende del
 * destino —adjuntar al expediente no es lo mismo que adjuntar a un contrato—, así
 * que la decide el servicio con la misma tabla de permisos de siempre. Aquí sólo
 * se exige sesión.
 *
 * Tampoco hay ruta para confirmar: eso ocurre en la ruta del recurso, la misma
 * que ya se usaba con `multipart`, mandando `subidaId` en el cuerpo.
 */
const router = express.Router()

router.use(protect, requirePasswordDefinitiva, applyScope)

router.post(
  '/',
  createUploadValidation,
  validateRequest,
  asyncHandler(uploadController.crear)
)

module.exports = router
