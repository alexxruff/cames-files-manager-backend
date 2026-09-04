const express = require('express')
const permissionController = require('./permissionController')
const asyncHandler = require('../../../utils/asyncHandler')
const { protect } = require('../../../middlewares/authMiddleware')
const { requirePasswordDefinitiva } = require('../../../middlewares/passwordMiddleware')

/**
 * `/permisos` — qué casillas existen y a qué sección pertenece cada una (D-92).
 *
 * **Sólo pide sesión**, y es deliberado: la lista de permisos que existen no es
 * un dato de nadie —no dice quién tiene qué—, y quien entra necesita saber cuáles
 * trae él para apagar su propio menú. Repartirlos sí exige `MANAGE_ACCESS`, y eso
 * vive en `/empleados/:id/acceso`.
 *
 * No lleva `applyScope`: no hay datos de ninguna empresa que acotar.
 */
const router = express.Router()

// `requirePasswordDefinitiva` va aquí y no en `protect`: ver D-49.
router.use(protect, requirePasswordDefinitiva)

router.get('/', asyncHandler(permissionController.list))

module.exports = router
