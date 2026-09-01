/**
 * Migración: el SIROC deja de tener fecha final (D-76).
 *
 *   node scripts/migrateSirocValidity.js --dry-run
 *   node scripts/migrateSirocValidity.js
 *
 * El aviso de obra vale **dos meses contados desde su registro** —o desde su
 * última actualización—, así que su vigencia no es un dato que alguien capture:
 * se deriva al leer, en `seguimientoSiroc`. Mientras además se guardaba, quien
 * capturaba tecleaba ahí la fecha de fin del contrato, y el contrato terminaba
 * mostrando una vigencia que el seguimiento no usaba y que lo contradecía.
 *
 * Este script quita `siroc.vigenciaHasta` de los contratos que lo traigan. El
 * campo ya no está en el esquema, así que Mongoose ni lo lee: quedaría de basura
 * en la colección y volvería a aparecer el día que alguien mire la base cruda.
 *
 * **Antes de borrar, imprime lo que borra**: contrato, SIROC y la fecha que tenía,
 * para que quede en la bitácora si alguien necesita recuperarla. Es idempotente:
 * correrlo dos veces no hace nada la segunda.
 */
const mongoose = require('mongoose')
const logger = require('../src/utils/logger')
const { connect, disconnect } = require('../src/config/database')

const DRY_RUN = process.argv.slice(2).includes('--dry-run')

async function main() {
  await connect()

  /*
   * Con el driver crudo, no con el modelo: `vigenciaHasta` ya no existe en el
   * esquema y Mongoose lo ignoraría al leer, así que por el modelo no habría
   * forma de ver cuáles lo traen.
   */
  const coleccion = mongoose.connection.db.collection('contracts')

  const conVigencia = await coleccion
    .find({ 'siroc.vigenciaHasta': { $exists: true } })
    .project({ numero: 1, proyectoId: 1, 'siroc.numero': 1, 'siroc.vigenciaHasta': 1 })
    .toArray()

  logger.info(`Contratos con vigencia capturada en el SIROC: ${conVigencia.length}`, {
    dryRun: DRY_RUN
  })

  for (const contrato of conVigencia) {
    logger.info('Se quita la vigencia del SIROC', {
      contratoId: contrato._id.toString(),
      contratoNumero: contrato.numero,
      proyectoId: contrato.proyectoId?.toString() ?? null,
      siroc: contrato.siroc?.numero ?? null,
      vigenciaHasta: contrato.siroc?.vigenciaHasta ?? null
    })
  }

  if (DRY_RUN || conVigencia.length === 0) {
    logger.info('Nada que escribir', { dryRun: DRY_RUN })
    return disconnect()
  }

  const { modifiedCount } = await coleccion.updateMany(
    { 'siroc.vigenciaHasta': { $exists: true } },
    { $unset: { 'siroc.vigenciaHasta': '' } }
  )

  logger.info('Vigencia del SIROC eliminada', { contratos: modifiedCount })
  logger.warn(
    'La vigencia ahora se deriva: la trae cada contrato en ' +
      '`seguimientoSiroc.vigenciaPeriodoHasta`, dos meses después del registro o ' +
      'de la última actualización.'
  )

  await disconnect()
}

main().catch(async (error) => {
  logger.error('La migración de la vigencia del SIROC falló', {
    error: error.message,
    stack: error.stack
  })
  await disconnect().catch(() => {})
  process.exit(1)
})
