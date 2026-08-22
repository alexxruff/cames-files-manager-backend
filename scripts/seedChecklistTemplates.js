/**
 * Siembra las plantillas base del checklist (`npm run seed:plantillas`).
 *
 * El arranque del servidor ya lo hace; este script sirve para ejecutarlo contra
 * una base concreta sin levantar la API (por ejemplo, después de crear la base de
 * producción). Es idempotente: no toca las plantillas que ya existen.
 */
const logger = require('../src/utils/logger')
const { connect, disconnect } = require('../src/config/database')
const { ensureBaseChecklistTemplates } = require('../src/services/seedChecklistTemplates')

async function main() {
  await connect()
  const resultado = await ensureBaseChecklistTemplates()
  logger.info('Sembrado terminado', resultado)
  await disconnect()
}

main().catch(async (error) => {
  logger.error('No se pudieron sembrar las plantillas', { error: error.message })
  await disconnect().catch(() => {})
  process.exit(1)
})
