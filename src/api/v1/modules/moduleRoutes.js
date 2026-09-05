const express = require('express')
const moduleController = require('./moduleController')
const asyncHandler = require('../../../utils/asyncHandler')
const { protect } = require('../../../middlewares/authMiddleware')
const { requirePasswordDefinitiva } = require('../../../middlewares/passwordMiddleware')

/**
 * `/modulos` — qué secciones existen y cuáles se pueden apagar (D-95).
 *
 * **Sólo pide sesión**, por lo mismo que `/permisos`: la lista de módulos que
 * existen no es un dato de nadie —no dice qué usa ninguna empresa—, y quien
 * arma la pantalla de una empresa necesita saber cuáles son opcionales para no
 * ofrecer casillas que no se pueden apagar.
 *
 * No lleva `applyScope`: no hay datos de ninguna empresa que acotar.
 */
const router = express.Router()

// `requirePasswordDefinitiva` va aquí y no en `protect`: ver D-49.
router.use(protect, requirePasswordDefinitiva)

router.get('/', asyncHandler(moduleController.list))

module.exports = router
