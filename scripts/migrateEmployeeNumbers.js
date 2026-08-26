/**
 * Migración: `affiliations.numeroEmpleado` → `employees.numeroEmpleado` (D-54).
 *
 *   node scripts/migrateEmployeeNumbers.js --dry-run
 *   node scripts/migrateEmployeeNumbers.js
 *   node scripts/migrateEmployeeNumbers.js --limpiar
 *
 * El número dejó de ser de la relación laboral —único por empresa— y pasó a ser
 * de la PERSONA, único en todo el grupo. Este script mueve lo que ya está
 * capturado.
 *
 * Qué hace:
 *   1. Lee `numeroEmpleado` de cada adscripción **con el driver crudo**: el campo
 *      ya no está en el esquema y Mongoose lo ignoraría.
 *   2. Se lo escribe a la persona, sólo si todavía no tiene número.
 *   3. Reporta los dos conflictos que el modelo nuevo no admite, sin escribir:
 *      · una persona con números DISTINTOS en dos empresas → gana el de la
 *        adscripción activa más antigua, el otro se reporta;
 *      · el mismo número en dos personas distintas (numeraciones que se repetían
 *        entre empresas) → gana la primera, la otra se queda sin número.
 *
 * Es **idempotente** y no borra nada: `affiliations.numeroEmpleado` se conserva
 * como respaldo hasta que se corra con `--limpiar`, que es lo único destructivo
 * y va aparte a propósito. Corre `npm run db:indices` DESPUÉS: es lo que crea el
 * índice único nuevo en `employees` y borra el viejo de `affiliations`.
 */
const mongoose = require('mongoose')
const logger = require('../src/utils/logger')
const { connect, disconnect } = require('../src/config/database')
const Employee = require('../src/api/v1/employees/employeeModel')

const argumentos = process.argv.slice(2)
const DRY_RUN = argumentos.includes('--dry-run')
const LIMPIAR = argumentos.includes('--limpiar')

async function main() {
  await connect()

  const adscripciones = mongoose.connection.db.collection('affiliations')

  if (LIMPIAR) {
    const { modifiedCount } = await adscripciones.updateMany(
      { numeroEmpleado: { $exists: true } },
      { $unset: { numeroEmpleado: '' } }
    )
    logger.info(`Respaldo borrado: ${modifiedCount} adscripciones sin numeroEmpleado`)
    return disconnect()
  }

  /*
   * Ordenadas por activa primero y luego por antigüedad: así, cuando alguien
   * trae dos números distintos, el que gana es el de la relación laboral vigente
   * más vieja, que es la que originó su alta en la nómina.
   */
  const conNumero = await adscripciones
    .find({ numeroEmpleado: { $type: 'string' } })
    .sort({ activo: -1, createdAt: 1 })
    .toArray()

  logger.info(`Adscripciones con número: ${conNumero.length}`, { dryRun: DRY_RUN })
  if (conNumero.length === 0) {
    logger.info('Nada que migrar')
    return disconnect()
  }

  const resumen = { migrados: [], omitidos: [], conflictos: [] }
  const numeroTomado = new Map()
  const personaResuelta = new Map()

  // Los números que YA están en `employees`: una corrida anterior, o altas
  // hechas después del cambio.
  for (const empleado of await Employee.find({
    numeroEmpleado: { $type: 'string' }
  }).select('nombre numeroEmpleado')) {
    numeroTomado.set(empleado.numeroEmpleado, empleado)
    personaResuelta.set(empleado._id.toString(), empleado.numeroEmpleado)
  }

  for (const adscripcion of conNumero) {
    const numero = adscripcion.numeroEmpleado
    const empleadoId = adscripcion.empleadoId.toString()

    const yaTiene = personaResuelta.get(empleadoId)
    if (yaTiene) {
      if (yaTiene !== numero) {
        resumen.conflictos.push({
          motivo: 'la misma persona tiene dos números',
          empleadoId,
          seQueda: yaTiene,
          seDescarta: numero,
          empresaId: adscripcion.empresaId.toString()
        })
      }
      continue
    }

    const duenoDelNumero = numeroTomado.get(numero)
    if (duenoDelNumero) {
      resumen.conflictos.push({
        motivo: 'dos personas distintas comparten el número',
        numero,
        loConserva: duenoDelNumero.nombre,
        seQuedaSinNumero: empleadoId
      })
      continue
    }

    const empleado = await Employee.findById(adscripcion.empleadoId).select(
      'nombre numeroEmpleado'
    )
    if (!empleado) {
      resumen.omitidos.push({ empleadoId, motivo: 'la persona ya no existe' })
      continue
    }

    if (!DRY_RUN) {
      empleado.numeroEmpleado = numero
      await empleado.save()
    }

    numeroTomado.set(numero, empleado)
    personaResuelta.set(empleadoId, numero)
    resumen.migrados.push({ empleadoId, nombre: empleado.nombre, numero })
  }

  logger.info('Resumen', {
    migrados: resumen.migrados.length,
    conflictos: resumen.conflictos.length,
    omitidos: resumen.omitidos.length,
    dryRun: DRY_RUN
  })
  for (const c of resumen.conflictos) logger.warn(`  · conflicto: ${c.motivo}`, c)
  for (const o of resumen.omitidos)
    logger.warn(`  · omitido ${o.empleadoId}: ${o.motivo}`)

  if (resumen.conflictos.length > 0) {
    logger.warn(
      'Los conflictos NO se escribieron: resuélvelos a mano con ' +
        'PATCH /empleados/:id { numeroEmpleado } y vuelve a correr el script.'
    )
  }
  if (!DRY_RUN) {
    logger.warn(
      'Corre `npm run db:indices` para crear el índice único de employees y borrar ' +
        'el viejo de affiliations. El respaldo en affiliations.numeroEmpleado sigue ' +
        'ahí: bórralo con --limpiar cuando verifiques la migración.'
    )
  }

  await disconnect()
}

main().catch(async (error) => {
  logger.error('La migración falló', { error: error.message, stack: error.stack })
  await disconnect().catch(() => {})
  process.exit(1)
})
