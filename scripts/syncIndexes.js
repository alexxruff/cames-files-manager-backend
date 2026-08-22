/**
 * Sincroniza los índices declarados en los esquemas (`npm run db:indices`).
 *
 * En producción `autoIndex` está apagado: construir índices al arrancar bloquea
 * la base y retrasa el despliegue. Este script se corre una vez después de cada
 * despliegue que cambie índices.
 *
 * `syncIndexes` además BORRA los índices que ya no están en el esquema, así que
 * revisa la salida antes de correrlo contra producción.
 */
const mongoose = require('mongoose')
const logger = require('../src/utils/logger')
const { connect, disconnect } = require('../src/config/database')

// Todos los modelos deben quedar registrados antes de sincronizar.
require('../src/models')

async function main() {
  await connect()

  for (const [nombre, modelo] of Object.entries(mongoose.models)) {
    const borrados = await modelo.syncIndexes()
    const indices = await modelo.listIndexes()
    logger.info(`Índices sincronizados: ${nombre}`, {
      coleccion: modelo.collection.name,
      indices: indices.map((i) => i.name),
      borrados
    })
  }

  await disconnect()
}

main().catch(async (error) => {
  logger.error('No se pudieron sincronizar los índices', { error: error.message })
  await disconnect().catch(() => {})
  process.exit(1)
})
