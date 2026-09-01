const express = require('express')
const contractController = require('./contractController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { requirePasswordDefinitiva } = require('../../../middlewares/passwordMiddleware')
const { CAPABILITIES } = require('../../../utils/permissions')
const {
  contractIdValidation,
  updateContractValidation,
  contractEstadoValidation,
  setSirocValidation,
  sirocRenovacionValidation
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

router.patch(
  '/:id',
  gestionarProyectos,
  updateContractValidation,
  validateRequest,
  asyncHandler(contractController.update)
)

router
  .route('/:id/siroc')
  .put(
    gestionarProyectos,
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
