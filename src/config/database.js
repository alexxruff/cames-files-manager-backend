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
 * 6. Los errores de conexión se traducen a un mensaje que dice qué hacer, y los
 *    que no se arreglan reintentando (versión incompatible, credenciales mal)
 *    fallan de inmediato en vez de gastar los cinco intentos.
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
// Los eventos de desconexión sólo son noticia despues de haber conectado: si no,
// el intento inicial fallido los emite y el log se llena de ruido duplicado.
let huboConexion = false

function registrarListeners() {
  if (listenersRegistrados) return
  listenersRegistrados = true

  mongoose.connection.on('connected', () => {
    huboConexion = true
  })
  mongoose.connection.on('disconnected', () => {
    if (huboConexion) {
      logger.warn('MongoDB desconectado; el driver intentará reconectar')
    }
  })
  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconectado')
  })
  mongoose.connection.on('error', (error) => {
    // Durante el arranque, `connect()` ya reporta el fallo con más contexto.
    if (huboConexion) {
      logger.error('Error de conexión de MongoDB', { error: error.message })
    }
  })
}

/**
 * Traduce el error del driver a algo accionable, en español.
 *
 * `devuelve.reintentar === false` para los errores que no se arreglan
 * esperando: seguir reintentando sólo retrasa el diagnóstico.
 *
 * @param {Error} error
 * @returns {{ mensaje: string|null, reintentar: boolean }}
 */
function explicarErrorDeConexion(error) {
  const texto = String(error?.message || '')

  // El driver 6 (Mongoose 8) exige MongoDB 4.2+ (wire version 8).
  if (/wire version/i.test(texto)) {
    return {
      reintentar: false,
      mensaje:
        'El servidor de MongoDB es demasiado viejo para este proyecto: Mongoose 8 ' +
        'usa el driver 6, que exige MongoDB 4.2 o superior. ' +
        'Para desarrollo, levanta el Mongo de este repo con `npm run db:up` ' +
        '(queda en el puerto 27018) y apunta MONGODB_URI a mongodb://127.0.0.1:27018. ' +
        'Ojo: el 27017 de esta máquina lo ocupa un MongoDB 3.6 que usa talentlink-backend.'
    }
  }

  if (/Authentication failed|bad auth/i.test(texto)) {
    return {
      reintentar: false,
      mensaje:
        'MongoDB rechazó las credenciales del URI. Revisa usuario y contraseña en ' +
        'MONGODB_URI (si la contraseña tiene @, : o /, hay que escaparla con ' +
        'encodeURIComponent).'
    }
  }

  if (/ECONNREFUSED/i.test(texto)) {
    return {
      reintentar: true,
      mensaje:
        'No hay nada escuchando en la dirección de MONGODB_URI. ' +
        'En desarrollo: `npm run db:up`.'
    }
  }

  if (/ENOTFOUND|querySrv|getaddrinfo/i.test(texto)) {
    return {
      reintentar: true,
      mensaje:
        'No se pudo resolver el host de MONGODB_URI. Revisa el nombre del cluster ' +
        'y tu conexión a internet.'
    }
  }

  if (/IP that isn't whitelisted|not authorized|whitelist/i.test(texto)) {
    return {
      reintentar: false,
      mensaje:
        'El cluster rechazó la conexión por lista de IPs. Agrega tu IP actual en ' +
        'Atlas → Network Access.'
    }
  }

  return { mensaje: null, reintentar: true }
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
      const { mensaje, reintentar } = explicarErrorDeConexion(error)
      // Un servidor incompatible o unas credenciales mal no se arreglan
      // esperando: reintentar sólo retrasa el diagnóstico.
      const ultimo = intento === MAX_ATTEMPTS || !reintentar

      logger.error(
        ultimo
          ? 'No se pudo conectar a MongoDB'
          : `Fallo al conectar a MongoDB (intento ${intento}/${MAX_ATTEMPTS})`,
        { error: error.message }
      )
      // El mensaje accionable va aparte y sin metadata, para que se lea.
      if (mensaje) logger.error(`→ ${mensaje}`)

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

module.exports = {
  connect,
  disconnect,
  connectionState,
  explicarErrorDeConexion
}
