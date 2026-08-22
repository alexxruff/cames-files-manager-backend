const mongoose = require('mongoose')
const env = require('../config/env')
const logger = require('../utils/logger')

/**
 * Errores de la aplicación y su traducción a HTTP.
 *
 * Reglas del spec que este archivo hace cumplir:
 * - Envelope `{ status, message, errors? }` en TODA respuesta de error (#2).
 * - Errores de validación con `errors: [{ msg }]`, que es lo que el front lee (#3).
 * - Mensajes en español, dirigidos a la persona usuaria: dicen qué hacer, no qué
 *   falló internamente (#3).
 * - Códigos: 400 validación · 401 sin sesión · 403 sin permiso · 404 no existe
 *   o no es visible · 409 conflicto · 413 archivo grande · 415 tipo no permitido.
 */
class AppError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} message Mensaje en español, mostrable al usuario.
   * @param {object} [opciones]
   * @param {Array<{msg: string, path?: string}>} [opciones.errors]
   * @param {string} [opciones.code] Código estable para el front, si hace falta.
   * @param {object} [opciones.data] Datos que el front necesita para reaccionar
   *   al error, no sólo para mostrarlo: la lista de posibles duplicados de un
   *   `409`, por ejemplo. Va en `data` del envelope en vez de `null`.
   */
  constructor(statusCode, message, { errors, code, data } = {}) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.status = String(statusCode).startsWith('4') ? 'fail' : 'error'
    this.isOperational = true
    if (errors) this.errors = errors
    if (code) this.code = code
    if (data !== undefined) this.data = data
    Error.captureStackTrace(this, this.constructor)
  }

  /** 400 con la forma de express-validator. */
  static validation(message, errors) {
    return new AppError(400, message, { errors })
  }

  /**
   * 404 para lo que existe pero no es visible para quien pregunta.
   * Nunca 403: un 403 confirmaría que el recurso existe (spec 4).
   */
  static notFound(message) {
    return new AppError(404, message)
  }

  static forbidden(message) {
    return new AppError(403, message)
  }

  static unauthorized(message) {
    return new AppError(401, message)
  }

  /**
   * 409 con datos para que el front pueda ofrecer una salida: «ya existe, ¿la
   * adscribo?» necesita el id del que ya está, no sólo el mensaje.
   */
  static conflict(message, { code, data, errors } = {}) {
    return new AppError(409, message, { code, data, errors })
  }
}

/** Nombre legible del campo duplicado para el mensaje de error. */
const ETIQUETAS_CAMPO = {
  email: 'correo',
  nombre: 'nombre',
  colaboradorId: 'colaborador'
}

function normalizarError(err) {
  if (err instanceof AppError) return err

  // Validación de Mongoose → 400 con la lista de campos.
  if (err instanceof mongoose.Error.ValidationError) {
    const errors = Object.values(err.errors).map((e) => ({
      msg: e.message,
      path: e.path
    }))
    return new AppError(400, errors[0]?.msg || 'Datos inválidos', { errors })
  }

  // ObjectId con forma inválida.
  if (err instanceof mongoose.Error.CastError) {
    return new AppError(400, 'El identificador enviado no es válido')
  }

  // Índice único violado.
  if (err.code === 11000) {
    const campo = Object.keys(err.keyPattern || err.keyValue || {})[0]
    const etiqueta = ETIQUETAS_CAMPO[campo] || campo || 'valor'
    return new AppError(400, `Ya existe un registro con ese ${etiqueta}`, {
      errors: [{ msg: `Ya existe un registro con ese ${etiqueta}`, path: campo }]
    })
  }

  if (err.name === 'JsonWebTokenError') {
    return new AppError(401, 'Tu sesión no es válida. Vuelve a iniciar sesión.')
  }
  if (err.name === 'TokenExpiredError') {
    return new AppError(401, 'Tu sesión expiró. Vuelve a iniciar sesión.')
  }

  // JSON mal formado en el cuerpo (body-parser).
  if (err.type === 'entity.parse.failed') {
    return new AppError(400, 'El cuerpo de la petición no es JSON válido')
  }
  if (err.type === 'entity.too.large') {
    return new AppError(413, 'El contenido enviado es demasiado grande')
  }

  return null
}

// Express identifica el manejador de errores por su firma de 4 argumentos:
// `next` tiene que estar declarado aunque no se use.
function errorHandler(err, req, res, next) {
  const error = normalizarError(err)
  const log = req.log || logger

  if (error) {
    // Errores esperados: se registran en nivel bajo, sin stack.
    if (error.statusCode >= 500) {
      log.error(error.message, { stack: err.stack })
    } else {
      log.warn('Petición rechazada', {
        statusCode: error.statusCode,
        message: error.message,
        ruta: `${req.method} ${req.originalUrl}`
      })
    }

    return res.status(error.statusCode).json({
      status: error.status,
      message: error.message,
      ...(error.errors ? { errors: error.errors } : {}),
      ...(error.code ? { code: error.code } : {}),
      // Normalmente `null`; algunos errores llevan datos con los que el front
      // puede reaccionar (candidatos de un duplicado, por ejemplo).
      data: error.data ?? null
    })
  }

  // Inesperado: se registra completo y al usuario se le da un mensaje neutro.
  log.error('Error no controlado', {
    error: err.message,
    stack: err.stack,
    ruta: `${req.method} ${req.originalUrl}`
  })

  return res.status(err.statusCode || 500).json({
    status: 'error',
    message: 'Ocurrió un error inesperado. Vuelve a intentarlo.',
    data: null,
    ...(env.isProduction ? {} : { debug: { error: err.message, stack: err.stack } })
  })
}

/** 404 para rutas que no existen. Va después de todas las rutas. */
function notFoundHandler(req, res, next) {
  next(new AppError(404, `La ruta ${req.method} ${req.originalUrl} no existe`))
}

module.exports = { AppError, errorHandler, notFoundHandler }
