const express = require('express')
const authController = require('./authController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect } = require('../../../middlewares/authMiddleware')
const { loginLimiter } = require('../../../middlewares/rateLimiters')
const {
  loginValidation,
  changePasswordValidation
} = require('../../../validations/authValidation')

const router = express.Router()

// Única ruta pública de toda la API (spec 9).
router.post(
  '/login',
  loginLimiter,
  loginValidation,
  validateRequest,
  asyncHandler(authController.login)
)

router.get('/me', protect, asyncHandler(authController.me))
router.post('/logout', protect, asyncHandler(authController.logout))
router.post(
  '/cambiar-password',
  protect,
  changePasswordValidation,
  validateRequest,
  asyncHandler(authController.changePassword)
)

module.exports = router
