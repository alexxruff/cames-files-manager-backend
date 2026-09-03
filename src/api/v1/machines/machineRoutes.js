const express = require('express')
const machineController = require('./machineController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { recibirArchivo } = require('../../../middlewares/uploadMiddleware')
const { requirePasswordDefinitiva } = require('../../../middlewares/passwordMiddleware')
const { CAPABILITIES } = require('../../../utils/permissions')
const {
  machineIdValidation,
  machineImageValidation,
  updateMachineValidation,
  machineEstadoValidation
} = require('../../../validations/machineValidation')

/**
 * `/maquinas/:id` — operar sobre una máquina concreta (D-86).
 *
 * El alta y el listado viven bajo la empresa (`/empresas/:id/maquinas`), porque
 * el catálogo es de ella; lo demás opera sobre la máquina, que ya se identifica
 * sola. Mismo reparto que contratos y asignaciones.
 *
 * Leer: cualquiera con sesión y alcance sobre la empresa. Escribir: la misma
 * capacidad que gestionar proyectos —la maquinaria es de la obra—.
 */
const router = express.Router()

// `requirePasswordDefinitiva` va aquí y no en `protect`: ver D-49.
router.use(protect, requirePasswordDefinitiva, applyScope)

const gestionarProyectos = requireCapability(CAPABILITIES.MANAGE_PROJECTS)

router.get(
  '/:id',
  machineIdValidation,
  validateRequest,
  asyncHandler(machineController.getById)
)

/*
 * `recibirArchivo` va antes de las validaciones porque es multer quien llena
 * `req.body` cuando la petición viene como `multipart` (D-80). Sigue aceptando
 * el mismo JSON sin archivo.
 */
router.patch(
  '/:id',
  gestionarProyectos,
  recibirArchivo,
  updateMachineValidation,
  validateRequest,
  asyncHandler(machineController.update)
)

router.patch(
  '/:id/estado',
  gestionarProyectos,
  machineEstadoValidation,
  validateRequest,
  asyncHandler(machineController.setEstado)
)

/*
 * Abrir la foto. Sólo pide sesión y alcance —quien puede ver la máquina puede
 * ver su imagen—, y existe porque la URL que viaja en cada respuesta caduca a
 * los 10 minutos.
 */
router.get(
  '/:id/imagen',
  machineImageValidation,
  validateRequest,
  asyncHandler(machineController.urlImagen)
)

module.exports = router
