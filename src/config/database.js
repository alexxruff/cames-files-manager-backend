const mongoose = require('mongoose')
const env = require('./env')
const logger = require('../utils/logger')

/**
 * Conexión a MongoDB.
 *
 * Qué se corrigió respecto a `talentlink-backend`:
 *
 * 1. Allá `connectWithRetry` atrapaba el error y agendaba un reintento con
 *    `setTimeout`, pero la promesa se resolvía igual → el servidor empezaba a
 *    escuchar SIN base de datos y respondía 500 a todo. Aquí el `connect`
 *    reintenta con backoff y, si agota los intentos, RECHAZA: el proceso no
 *    levanta si no hay base.
 * 2. `useNewUrlParser` / `useUnifiedTopology` se eliminaron: no hacen nada
 *    desde el driver 4 y Mongoose 8 los ignora.
 * 3. `dbName` explícito: la base de este proyecto es propia y no se hereda del
 *    URI, para que apuntar al cluster compartido nunca escriba en otra DB.
 * 4. `autoIndex` apagado en producción (construir índices al arrancar bloquea);
 *    los índices se sincronizan con `npm run db:indices`.
 * 5. Se cierra ordenadamente y se expone el estado para el readiness check.
 */

const MAX_ATTEMPTS = env.isTest ? 1 : 5
const BASE_DELAY_MS = 1000

mongoose.set('strictQuery', true)

const CONNECTION_STATES = {
  0: 'desconectado',
  1: 'conectado',
  2: 'conectando',
  3: 'desconectando'
}

let listenersRegistrados = false

function registrarListeners() {
  if (listenersRegistrados) return
  listenersRegistrados = true

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB desconectado; el driver intentará reconectar')
  })
  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconectado')
  })
  mongoose.connection.on('error', (error) => {
    logger.error('Error de conexión de MongoDB', { error: error.message })
  })
}

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @param {object} [opciones]
 * @param {string} [opciones.uri] URI alterno (lo usan las pruebas).
 * @param {string} [opciones.dbName]
 */
async function connect({ uri = env.MONGODB_URI, dbName = env.MONGODB_DB_NAME } = {}) {
  registrarListeners()

  for (let intento = 1; intento <= MAX_ATTEMPTS; intento += 1) {
    try {
      await mongoose.connect(uri, {
        dbName,
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        maxPoolSize: 20,
        minPoolSize: 2,
        // No acumular operaciones si la conexión se cae: mejor fallar rápido.
        bufferCommands: false,
        autoIndex: !env.isProduction
      })
      logger.info('MongoDB conectado', {
        dbName: mongoose.connection.name,
        host: mongoose.connection.host
      })
      return mongoose.connection
    } catch (error) {
      const ultimo = intento === MAX_ATTEMPTS
      logger.error(`Fallo al conectar a MongoDB (intento ${intento}/${MAX_ATTEMPTS})`, {
        error: error.message
      })
      if (ultimo) throw error
      await esperar(BASE_DELAY_MS * 2 ** (intento - 1))
    }
  }
}

async function disconnect() {
  if (mongoose.connection.readyState === 0) return
  await mongoose.connection.close()
  logger.info('MongoDB desconectado ordenadamente')
}

function connectionState() {
  return {
    estado: CONNECTION_STATES[mongoose.connection.readyState] || 'desconocido',
    listo: mongoose.connection.readyState === 1,
    dbName: mongoose.connection.name || null
  }
}

module.exports = { connect, disconnect, connectionState }
