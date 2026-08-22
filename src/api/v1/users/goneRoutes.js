const express = require('express')
const { AppError } = require('../../../middlewares/errorHandler')

/**
 * `/usuarios` ya no existe: el usuario de la plataforma es un **empleado con
 * `acceso`** (modelo-datos §5.2), así que su administración vive en
 * `/empleados/:id/acceso`.
 *
 * Se responde **410 Gone** y no 404 a propósito: 404 diría "esta ruta nunca
 * existió", y aquí lo que pasó es que se movió. El mensaje dice a dónde, para que
 * el front lo descubra en la primera llamada en vez de en una revisión de
 * documentación.
 *
 * Se puede borrar este archivo cuando el front haya migrado.
 */
const router = express.Router()

const RUTAS_NUEVAS = [
  'GET /api/v1/empleados?soloConAcceso=true — quiénes entran a la plataforma',
  'POST /api/v1/empleados/:id/acceso — dar acceso a un empleado existente',
  'PATCH /api/v1/empleados/:id/acceso — cambiar nivel, correo o activarlo',
  'DELETE /api/v1/empleados/:id/acceso — quitar el acceso',
  'POST /api/v1/empleados/:id/acceso/restablecer-password'
]

router.all('*', (req, res, next) => {
  next(
    new AppError(
      410,
      'La ruta /usuarios ya no existe: el usuario de la plataforma ahora es un empleado con acceso. ' +
        `Usa ${RUTAS_NUEVAS.join(' · ')}`,
      { code: 'RUTA_MOVIDA' }
    )
  )
})

module.exports = router
