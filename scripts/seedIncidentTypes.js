/**
 * Siembra los tipos de incidencia base (`npm run seed:tipos-incidencia`).
 *
 * El arranque del servidor ya lo hace; este script sirve para ejecutarlo contra
 * una base concreta sin levantar la API. Es idempotente: no toca los tipos que
 * ya existen, ni siquiera si alguien los renombró.
 */
const logger = require('../src/utils/logger')
const { connect, disconnect } = require('../src/config/database')
const { ensureBaseIncidentTypes } = require('../src/services/seedIncidentTypes')

async function main() {
  await connect()
  const resultado = await ensureBaseIncidentTypes()
  logger.info('Sembrado terminado', resultado)
  await disconnect()
}

main().catch(async (error) => {
  logger.error('No se pudieron sembrar los tipos de incidencia', {
    error: error.message
  })
  await disconnect().catch(() => {})
  process.exit(1)
})
