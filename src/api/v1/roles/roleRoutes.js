const express = require('express')
const roleController = require('./roleController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { requirePasswordDefinitiva } = require('../../../middlewares/passwordMiddleware')
const { CAPABILITIES } = require('../../../utils/permissions')
const {
  listRolesValidation,
  roleIdValidation,
  createRoleValidation,
  updateRoleValidation
} = require('../../../validations/roleValidation')

/**
 * `/roles` — armar perfiles desde la plataforma (D-93).
 *
 * **Leer y escribir piden cosas distintas, a propósito.** Quien da de alta un
 * usuario necesita la lista para elegirle su rol, así que leer pide
 * `MANAGE_ACCESS`; decidir qué puede un perfil es otra cosa y pide
 * `MANAGE_ROLES`, que además exige ser administrador de plataforma. Fue una
 * decisión explícita del usuario (4 sept 2026): repartir accesos y definir
 * perfiles no son el mismo trabajo, y quien hace lo primero no debería poder
 * inventarse permisos para sí mismo.
 *
 * No lleva `applyScope`: hoy todos los roles son del grupo (`empresaId: null`),
 * así que no hay nada que acotar por empresa.
 */
const router = express.Router()

// `requirePasswordDefinitiva` va aquí y no en `protect`: ver D-49.
router.use(protect, requirePasswordDefinitiva)

const verRoles = requireCapability(CAPABILITIES.MANAGE_ACCESS)
const administrarRoles = requireCapability(CAPABILITIES.MANAGE_ROLES)

router
  .route('/')
  .get(verRoles, listRolesValidation, validateRequest, asyncHandler(roleController.list))
  .post(
    administrarRoles,
    createRoleValidation,
    validateRequest,
    asyncHandler(roleController.create)
  )

router
  .route('/:id')
  .get(verRoles, roleIdValidation, validateRequest, asyncHandler(roleController.getById))
  .patch(
    administrarRoles,
    updateRoleValidation,
    validateRequest,
    asyncHandler(roleController.update)
  )
  .delete(
    administrarRoles,
    roleIdValidation,
    validateRequest,
    asyncHandler(roleController.remove)
  )

module.exports = router
