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
  affiliationEstadoValidation,
  affiliationJefaturasValidation,
  affiliationRolValidation
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

/*
 * La jefatura NO lleva `gestionarAdscripcion`: no es un dato de la relación
 * laboral sino quién ve a quién, y por eso tiene su propia capacidad (D-60).
 */
router.patch(
  '/:id/jefaturas',
  requireCapability(CAPABILITIES.MANAGE_AREA_LEADERSHIP),
  affiliationJefaturasValidation,
  validateRequest,
  asyncHandler(affiliationController.setJefaturas)
)

/*
 * El rol de esta persona EN ESTA EMPRESA (D-94). Va aparte del `PATCH` de la
 * adscripción por lo mismo que las jefaturas: no es un dato de la relación
 * laboral, es qué puede hacer.
 *
 * Y pide `MANAGE_ACCESS`, no `MANAGE_AREA_LEADERSHIP`: es **la misma decisión**
 * que darle su rol base en `/empleados/:id/acceso`, sólo que acotada a una
 * empresa. Quien reparte accesos reparte permisos; quien mueve gente entre
 * empresas, no.
 */
router.patch(
  '/:id/rol',
  requireCapability(CAPABILITIES.MANAGE_ACCESS),
  affiliationRolValidation,
  validateRequest,
  asyncHandler(affiliationController.setRol)
)

router.patch(
  '/:id/estado',
  gestionarAdscripcion,
  affiliationEstadoValidation,
  validateRequest,
  asyncHandler(affiliationController.setEstado)
)

module.exports = router
