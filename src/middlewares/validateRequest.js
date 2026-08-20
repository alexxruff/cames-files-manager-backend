const { validationResult } = require('express-validator')
const { AppError } = require('./errorHandler')

/**
 * Traduce el resultado de express-validator al formato que el front lee
 * (spec regla #3):
 *
 *   { "status": "fail", "message": "…", "errors": [{ "msg": "…" }] }
 *
 * `talentlink-backend` concatenaba todos los mensajes en `message` y perdía el
 * arreglo `errors`, así que el front no podía señalar el campo culpable.
 */
function validateRequest(req, res, next) {
  const resultado = validationResult(req)
  if (resultado.isEmpty()) return next()

  const errors = resultado.array().map((e) => ({
    msg: e.msg,
    ...(e.path ? { path: e.path } : {})
  }))

  return next(new AppError(400, errors[0].msg, { errors }))
}

module.exports = validateRequest
