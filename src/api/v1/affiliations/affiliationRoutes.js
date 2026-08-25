const express = require('express')
const affiliationController = require('./affiliationController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { requirePasswordDefinitiva } = require('../../../middlewares/passwordMiddleware')
const { CAPABILITIES } = require('../../../utils/permissions')
const {
  updateAffiliationValidation,
  affiliationEstadoValidation
} = require('../../../validations/affiliationValidation')

/**
 * `/adscripciones/:id` — editar el vínculo empresa ↔ empleado.
 *
 * El alta y el listado viven bajo la empresa (`/empresas/:id/adscripciones`),
 * porque siempre se adscribe desde una empresa concreta. Aquí quedan las
 * operaciones sobre un vínculo que ya existe y se identifica por sí mismo —
 * igual que `/carteras/:id`.
 */
const router = express.Router()

// `requirePasswordDefinitiva` va aquí y no en `protect`: ver D-49.
router.use(protect, requirePasswordDefinitiva, applyScope)

// Exclusivo de `rh_admin` (D-32 lo confirma: adscribir no es lo mismo que dar
// de alta, y el jefe de área/analista no mueven gente entre empresas).
const gestionarAdscripcion = requireCapability(CAPABILITIES.MANAGE_AFFILIATIONS)

router.patch(
  '/:id',
  gestionarAdscripcion,
  updateAffiliationValidation,
  validateRequest,
  asyncHandler(affiliationController.update)
)

router.patch(
  '/:id/estado',
  gestionarAdscripcion,
  affiliationEstadoValidation,
  validateRequest,
  asyncHandler(affiliationController.setEstado)
)

module.exports = router
