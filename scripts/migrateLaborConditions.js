/**
 * Migración: separar `nomina` en `condiciones` + `nomina` (D-63).
 *
 *   node scripts/migrateLaborConditions.js --dry-run
 *   node scripts/migrateLaborConditions.js
 *   node scripts/migrateLaborConditions.js --limpiar
 *
 * El archivo de nómina trae 13 columnas que no son ni identidad ni contrato, y
 * todas acabaron en `nomina`, que no se serializa. Ocho de ellas **no son
 * sensibles** —régimen del IMSS, turno, registro patronal, base de cotización,
 * zona, prestación, periodicidad y teletrabajo— y por estar ahí quedaron
 * invisibles sin motivo. Este script las sube a `condiciones`, que sí se muestra.
 *
 * En `nomina` se quedan los siete que sí necesitan una decisión de permisos:
 * salario diario, las tres partes del SBC, banco, sucursal y cuenta.
 *
 * **Copia, no mueve.** El original se conserva bajo `nomina` hasta que se corra
 * con `--limpiar`, que es lo único destructivo y va aparte a propósito. Es
 * idempotente: sólo escribe donde `condiciones` está vacío.
 */
const mongoose = require('mongoose')
const logger = require('../src/utils/logger')
const { connect, disconnect } = require('../src/config/database')

const argumentos = process.argv.slice(2)
const DRY_RUN = argumentos.includes('--dry-run')
const LIMPIAR = argumentos.includes('--limpiar')

/** Lo que se muda: los ocho que no son sensibles. */
const CONDICIONES = Object.freeze([
  'tipoRegimen',
  'turno',
  'registroPatronal',
  'baseCotizacion',
  'zonaSalario',
  'tipoPrestacion',
  'periodicidadPago',
  'teletrabajador'
])

async function main() {
  await connect()

  /*
   * Con el driver crudo: los ocho campos ya no están en `payrollSchema`, así que
   * Mongoose los ignoraría al leer `nomina`.
   */
  const coleccion = mongoose.connection.db.collection('affiliations')

  if (LIMPIAR) {
    const $unset = Object.fromEntries(CONDICIONES.map((c) => [`nomina.${c}`, '']))
    const { modifiedCount } = await coleccion.updateMany({}, { $unset })
    logger.info(`Respaldo borrado en ${modifiedCount} adscripciones`)
    return disconnect()
  }

  const todas = await coleccion.find({}).toArray()
  logger.info(`Adscripciones: ${todas.length}`, { dryRun: DRY_RUN })

  let migradas = 0
  let sinDatos = 0

  for (const adscripcion of todas) {
    const nomina = adscripcion.nomina || {}
    const yaTiene = adscripcion.condiciones || {}

    // Sólo lo que de verdad tiene valor, y sin pisar lo que ya esté puesto.
    const condiciones = {}
    for (const campo of CONDICIONES) {
      const valor = nomina[campo]
      if (valor === null || valor === undefined) continue
      if (yaTiene[campo] !== null && yaTiene[campo] !== undefined) continue
      condiciones[campo] = valor
    }

    if (Object.keys(condiciones).length === 0) {
      sinDatos += 1
      continue
    }

    migradas += 1
    if (DRY_RUN) continue

    await coleccion.updateOne(
      { _id: adscripcion._id },
      {
        $set: Object.fromEntries(
          Object.entries(condiciones).map(([c, v]) => [`condiciones.${c}`, v])
        )
      }
    )
  }

  logger.info('Condiciones migradas', {
    migradas,
    sinDatosQueMover: sinDatos,
    dryRun: DRY_RUN
  })

  if (!DRY_RUN && migradas > 0) {
    logger.warn(
      'El original sigue bajo `nomina` como respaldo. Verifica que las condiciones ' +
        'se vean en GET /empleados y bórralo con --limpiar.'
    )
  }

  await disconnect()
}

main().catch(async (error) => {
  logger.error('La migración de condiciones falló', {
    error: error.message,
    stack: error.stack
  })
  await disconnect().catch(() => {})
  process.exit(1)
})
