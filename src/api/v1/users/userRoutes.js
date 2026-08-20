const express = require('express')
const userController = require('./userController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { CAPABILITIES } = require('../../../utils/permissions')
const {
  listUsersValidation,
  userIdValidation,
  createUserValidation,
  updateUserValidation
} = require('../../../validations/userValidation')

const router = express.Router()

// Todo /usuarios exige sesión, alcance y la capacidad de administrar usuarios
// (sólo `rh_admin` la tiene — spec 9.2).
router.use(protect, applyScope, requireCapability(CAPABILITIES.MANAGE_USERS))

router
  .route('/')
  .get(listUsersValidation, validateRequest, asyncHandler(userController.list))
  .post(createUserValidation, validateRequest, asyncHandler(userController.create))

router
  .route('/:id')
  .get(userIdValidation, validateRequest, asyncHandler(userController.getById))
  .patch(updateUserValidation, validateRequest, asyncHandler(userController.update))
  .delete(userIdValidation, validateRequest, asyncHandler(userController.deactivate))

router.patch(
  '/:id/reactivar',
  userIdValidation,
  validateRequest,
  asyncHandler(userController.reactivate)
)

module.exports = router
