const { randomUUID } = require('node:crypto')
const logger = require('../utils/logger')

/**
 * Contexto de petición: id de correlación y logger hijo.
 *
 * Deja en `req.requestId` un id único y en `req.log` un logger que lo incluye en
 * cada línea, para poder seguir una petición completa en los logs. También lo
 * devuelve en el header `X-Request-Id`, así el front puede citarlo al reportar
 * un error y se encuentra en segundos.
 */
function requestContext(req, res, next) {
  const requestId = req.get('X-Request-Id') || randomUUID()
  req.requestId = requestId
  req.log = logger.child({ requestId })
  res.set('X-Request-Id', requestId)
  next()
}

/** Log de acceso, con duración y usuario si ya está autenticado. */
function requestLogger(req, res, next) {
  const inicio = process.hrtime.bigint()
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - inicio) / 1e6
    const nivel =
      res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'http'
    req.log[nivel]('Petición atendida', {
      metodo: req.method,
      ruta: req.originalUrl,
      statusCode: res.statusCode,
      duracionMs: Number(ms.toFixed(1)),
      usuarioId: req.user?._id?.toString() || null
    })
  })
  next()
}

module.exports = { requestContext, requestLogger }
