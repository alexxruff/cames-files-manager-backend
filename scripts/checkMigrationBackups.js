/**
 * Comprueba si es seguro borrar los respaldos de las migraciones (Fase 8).
 *
 *   node scripts/checkMigrationBackups.js
 *
 * NO escribe nada. Se corre **antes** de:
 *
 *   node scripts/migrateLaborConditions.js --limpiar   (respaldo de D-63)
 *   node scripts/migrateEmployeeNumbers.js --limpiar   (respaldo de D-54)
 *
 * Los dos `--limpiar` son destructivos y no comprueban nada por su cuenta:
 * asumen que la migración ya corrió y quedó bien. Esta comprobación es lo que
 * convierte esa suposición en un hecho, y hay que repetirla **en cada entorno**
 * porque las bases divergieron.
 *
 * Qué busca, que es lo único que importa: **un valor que viva SÓLO en el
 * respaldo**. Si existe, borrar lo perdería para siempre.
 */
const mongoose = require('mongoose')
const logger = require('../src/utils/logger')
const { connect, disconnect } = require('../src/config/database')

/** Los ocho que D-63 mudó de `nomina` a `condiciones`. */
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
  const adscripciones = mongoose.connection.db.collection('affiliations')

  // ── Respaldo de D-63: los ocho campos duplicados dentro de `nomina` ────────
  let enRiesgo = 0
  const detalle = []
  for (const campo of CONDICIONES) {
    const n = await adscripciones.countDocuments({
      // Un valor REAL en el respaldo…
      [`nomina.${campo}`]: { $exists: true, $nin: [null, ''] },
      // …que no está en su lugar nuevo.
      $or: [
        { [`condiciones.${campo}`]: null },
        { [`condiciones.${campo}`]: { $exists: false } }
      ]
    })
    if (n > 0) {
      enRiesgo += n
      detalle.push(`${campo} (${n})`)
    }
  }

  const totalRespaldo = await adscripciones.countDocuments({
    'nomina.registroPatronal': { $exists: true }
  })

  // ── Respaldo de D-54: `numeroEmpleado` en la adscripción ──────────────────
  const noCoinciden = await adscripciones
    .aggregate([
      { $match: { numeroEmpleado: { $exists: true, $ne: null } } },
      {
        $lookup: {
          from: 'employees',
          localField: 'empleadoId',
          foreignField: '_id',
          as: 'e'
        }
      },
      { $unwind: '$e' },
      { $match: { $expr: { $ne: ['$numeroEmpleado', '$e.numeroEmpleado'] } } },
      { $count: 'n' }
    ])
    .toArray()

  const numerosPendientes = await adscripciones.countDocuments({
    numeroEmpleado: { $exists: true }
  })
  const numerosEnRiesgo = noCoinciden[0]?.n ?? 0

  // ── Veredicto ─────────────────────────────────────────────────────────────
  logger.info('Respaldo de condiciones (D-63)', {
    adscripcionesConRespaldo: totalRespaldo,
    veredicto: enRiesgo === 0 ? 'SEGURO borrar' : `NO BORRAR: ${enRiesgo} se perderían`,
    ...(detalle.length ? { campos: detalle } : {})
  })
  if (enRiesgo > 0) {
    logger.warn(
      '  Corre primero `node scripts/migrateLaborConditions.js` SIN --limpiar: ' +
        'hay valores que nunca se copiaron a `condiciones`.'
    )
  }

  logger.info('Respaldo de numeroEmpleado (D-54)', {
    adscripcionesConRespaldo: numerosPendientes,
    veredicto:
      numerosEnRiesgo === 0
        ? 'SEGURO borrar'
        : `NO BORRAR: ${numerosEnRiesgo} no coinciden con su persona`
  })
  if (numerosEnRiesgo > 0) {
    logger.warn(
      '  Corre primero `node scripts/migrateEmployeeNumbers.js` SIN --limpiar: ' +
        'hay números que no llegaron a su persona.'
    )
  }

  if (totalRespaldo === 0 && numerosPendientes === 0) {
    logger.info('No queda ningún respaldo: esta base ya está limpia')
  }

  await disconnect()
}

main().catch(async (error) => {
  logger.error('La comprobación de respaldos falló', {
    error: error.message,
    stack: error.stack
  })
  await disconnect().catch(() => {})
  process.exit(1)
})
