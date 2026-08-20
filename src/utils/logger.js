const winston = require('winston')
const env = require('../config/env')

/**
 * Logger de la aplicación.
 *
 * Diferencias con `talentlink-backend`:
 * - En producción sale JSON a stdout (lo que esperan Fly.io, Docker y cualquier
 *   agregador de logs). Los archivos son opcionales (`LOG_TO_FILE=true`); allá
 *   se escribían siempre y en un contenedor efímero eso sólo llena el disco.
 * - Silencioso en pruebas, para que la salida de Jest sea legible.
 * - `logger.child({ requestId })` permite correlacionar todas las líneas de una
 *   misma petición sin pasar el id a mano.
 */

const { combine, timestamp, printf, colorize, errors, json, splat } = winston.format

const formatoLegible = printf(({ level, message, timestamp: ts, stack, ...meta }) => {
  let linea = `${ts} [${level}]: ${stack || message}`
  const extra = Object.keys(meta).filter((k) => k !== 'splat')
  if (extra.length > 0) {
    try {
      linea += ` ${JSON.stringify(meta)}`
    } catch {
      linea += ' [metadata circular]'
    }
  }
  return linea
})

const transports = [
  new winston.transports.Console({
    format: env.isProduction
      ? combine(timestamp(), errors({ stack: true }), splat(), json())
      : combine(
          colorize(),
          timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          errors({ stack: true }),
          splat(),
          formatoLegible
        )
  })
]

if (env.LOG_TO_FILE) {
  transports.push(
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
      format: combine(timestamp(), errors({ stack: true }), json())
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
      format: combine(timestamp(), errors({ stack: true }), json())
    })
  )
}

const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  // En pruebas se calla salvo que se pida LOG_VERBOSE=true al correr Jest.
  silent: env.isTest && process.env.LOG_VERBOSE !== 'true',
  defaultMeta: { servicio: 'cames-files-manager-backend' },
  transports
})

module.exports = logger
