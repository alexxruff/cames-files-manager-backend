const rateLimit = require('express-rate-limit')
const env = require('../config/env')

/**
 * Límites de peticiones. El mensaje va en el envelope de error del spec para
 * que el front lo pueda mostrar igual que cualquier otro fallo (429).
 */
const respuestaLimite = (message) => ({
  status: 'fail',
  message,
  data: null
})

/** Límite general de la API. */
const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.isTest,
  message: respuestaLimite(
    'Demasiadas peticiones. Espera un momento y vuelve a intentarlo.'
  )
})

/**
 * Límite del login, mucho más estricto: es la puerta de entrada a expedientes
 * con datos personales sensibles. Se cuenta por IP + correo, para que muchos
 * intentos contra una misma cuenta no se diluyan cambiando de IP ni un ataque
 * desde una IP se reparta probando correos distintos.
 */
const loginLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  max: env.LOGIN_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: () => env.isTest,
  keyGenerator: (req) => {
    const correo = String(req.body?.email || '').toLowerCase()
    return `${req.ip}:${correo}`
  },
  message: respuestaLimite(
    'Demasiados intentos de inicio de sesión. Espera unos minutos y vuelve a intentarlo.'
  )
})

module.exports = { apiLimiter, loginLimiter }
