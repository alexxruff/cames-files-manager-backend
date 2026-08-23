const express = require('express')
const portfolioController = require('./portfolioController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { CAPABILITIES } = require('../../../utils/permissions')
const {
  updatePortfolioValidation,
  portfolioEstadoValidation
} = require('../../../validations/portfolioValidation')

/**
 * `/carteras/:id` — editar el vínculo empresa ↔ cliente.
 *
 * El alta y el listado viven bajo la empresa (`/empresas/:id/clientes`), porque
 * la cartera se lee y se llena siempre desde una empresa concreta. Aquí quedan
 * las operaciones sobre un vínculo que ya existe y se identifica por sí mismo.
 */
const router = express.Router()

router.use(protect, applyScope)

const gestionarCartera = requireCapability(CAPABILITIES.MANAGE_CLIENT_PORTFOLIO)

router.patch(
  '/:id',
  gestionarCartera,
  updatePortfolioValidation,
  validateRequest,
  asyncHandler(portfolioController.update)
)

router.patch(
  '/:id/estado',
  gestionarCartera,
  portfolioEstadoValidation,
  validateRequest,
  asyncHandler(portfolioController.setEstado)
)

module.exports = router
