/**
 * Migración: el alcance del jefe de área deja de derivarse de dónde trabaja
 * (D-60).
 *
 *   node scripts/migrateAreaLeadership.js --dry-run
 *   node scripts/migrateAreaLeadership.js
 *
 * **Correr ANTES de desplegar D-60, o en el mismo despliegue.** Hasta ahora el
 * alcance de un `jefe_area` salían de `adscripciones.areas`; a partir de D-60
 * sale de `dirigeAreas`, que nadie tiene todavía. Sin esta migración, **todos
 * los jefes de área se quedan sin ver a nadie** en cuanto se despliega.
 *
 * Qué hace: a cada persona con acceso `jefe_area` activo, le copia `areas` a
 * `dirigeAreas` en cada una de sus adscripciones activas. O sea, deja las cosas
 * exactamente como estaban — y a partir de ahí RH puede reasignar de verdad
 * desde configuración, que es el punto del cambio.
 *
 * NO toca a nadie más: un `rh_admin` o un `rh_consulta` no usan `areasPorEmpresa`
 * para nada, y darles jefaturas que nadie pidió sería inventar permisos.
 *
 * Es idempotente: sólo escribe donde `dirigeAreas` está vacío, así que volver a
 * correrlo no deshace una reasignación hecha después.
 */
const logger = require('../src/utils/logger')
const { connect, disconnect } = require('../src/config/database')
const Employee = require('../src/api/v1/employees/employeeModel')
const Affiliation = require('../src/api/v1/affiliations/affiliationModel')

const DRY_RUN = process.argv.slice(2).includes('--dry-run')

async function main() {
  await connect()

  const jefes = await Employee.find({
    'acceso.nivelAcceso': 'jefe_area',
    'acceso.activo': true
  }).select('nombre acceso.email')

  logger.info(`Jefes de área con acceso: ${jefes.length}`, { dryRun: DRY_RUN })
  if (jefes.length === 0) {
    logger.info('Nada que migrar')
    return disconnect()
  }

  const resumen = []

  for (const jefe of jefes) {
    const adscripciones = await Affiliation.find({
      empleadoId: jefe._id,
      activo: true
    }).select('empresaId areas dirigeAreas')

    for (const adscripcion of adscripciones) {
      // Ya tiene jefatura asignada: no se pisa.
      if ((adscripcion.dirigeAreas || []).length > 0) continue

      const areas = adscripcion.areas || []
      if (areas.length === 0) {
        logger.warn(
          `${jefe.nombre} no tiene áreas en una de sus empresas: seguirá sin ver a nadie ahí`,
          { empresaId: String(adscripcion.empresaId) }
        )
        continue
      }

      resumen.push({
        jefe: jefe.nombre,
        correo: jefe.acceso?.email,
        empresaId: String(adscripcion.empresaId),
        dirigeAreas: areas
      })

      if (DRY_RUN) continue
      adscripcion.dirigeAreas = areas
      await adscripcion.save()
    }
  }

  logger.info('Jefaturas sembradas', { adscripciones: resumen.length, dryRun: DRY_RUN })
  for (const r of resumen) {
    logger.info(`  · ${r.jefe} (${r.correo}) dirige ${r.dirigeAreas.join(', ')}`, {
      empresaId: r.empresaId
    })
  }

  if (!DRY_RUN && resumen.length > 0) {
    logger.warn(
      'Esto deja el alcance como estaba. Revísalo en configuración: el punto de ' +
        'D-60 es que trabajar en un área ya no es dirigirla, y es probable que ' +
        'alguno de estos no debiera dirigir la suya.'
    )
  }

  await disconnect()
}

main().catch(async (error) => {
  logger.error('La migración de jefaturas falló', {
    error: error.message,
    stack: error.stack
  })
  await disconnect().catch(() => {})
  process.exit(1)
})
