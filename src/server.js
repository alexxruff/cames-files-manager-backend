const env = require('./config/env')
const app = require('./app')
const logger = require('./utils/logger')
const { connect, disconnect } = require('./config/database')
const { ensureBootstrapAdmin } = require('./services/bootstrapAdmin')
const { ensureBaseChecklistTemplates } = require('./services/seedChecklistTemplates')
const { advertirSiNoHayBucket } = require('./services/storageService')

/**
 * Arranque y apagado del proceso.
 *
 * Diferencias con `talentlink-backend`:
 * - Si la base no conecta, el proceso NO levanta. Allá el reintento dejaba que
 *   el servidor empezara a escuchar sin base y respondiera 500 a todo.
 * - Apagado ordenado con SIGTERM/SIGINT: se dejan de aceptar conexiones, se
 *   terminan las peticiones en curso y se cierra Mongo. Es lo que necesita
 *   cualquier despliegue con contenedores para no cortar peticiones a la mitad.
 */

let server

async function iniciar() {
  await connect()

  // Administrador inicial: sólo hace algo si la base no tiene ningún usuario.
  // Un fallo aquí no debe impedir que la API levante, pero sí se registra: sin
  // usuarios y sin bootstrap, nadie puede entrar.
  try {
    await ensureBootstrapAdmin()
  } catch (error) {
    logger.error('No se pudo crear el administrador inicial', {
      error: error.message
    })
  }

  // Plantillas base del checklist: sin ellas no se puede generar ningún
  // expediente. Idempotente, y no sobreescribe las que alguien haya editado.
  try {
    await ensureBaseChecklistTemplates()
  } catch (error) {
    logger.error('No se pudieron sembrar las plantillas base', {
      error: error.message
    })
  }

  // Configuración del almacenamiento: si falta el bucket, que se vea en el log.
  advertirSiNoHayBucket()

  server = app.listen(env.PORT, () => {
    logger.info('Servidor escuchando', {
      puerto: env.PORT,
      entorno: env.NODE_ENV
    })
  })
}

async function apagar(motivo, codigoSalida = 0) {
  logger.info('Apagando el servidor', { motivo })

  const forzar = setTimeout(() => {
    logger.error('El apagado ordenado tardó demasiado; se fuerza la salida')
    process.exit(1)
  }, 10000)
  forzar.unref()

  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve))
    }
    await disconnect()
  } catch (error) {
    logger.error('Error durante el apagado', { error: error.message })
    codigoSalida = 1
  }

  clearTimeout(forzar)
  process.exit(codigoSalida)
}

process.on('SIGTERM', () => apagar('SIGTERM'))
process.on('SIGINT', () => apagar('SIGINT'))

process.on('uncaughtException', (error) => {
  logger.error('Excepción no capturada', { error: error.message, stack: error.stack })
  apagar('uncaughtException', 1)
})

process.on('unhandledRejection', (reason) => {
  logger.error('Promesa rechazada sin manejar', {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined
  })
  apagar('unhandledRejection', 1)
})

iniciar().catch((error) => {
  logger.error('No se pudo arrancar la aplicación', {
    error: error.message,
    stack: error.stack
  })
  process.exit(1)
})
