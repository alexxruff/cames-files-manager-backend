/**
 * Migración: el enum de áreas → la colección `areas` (D-58).
 *
 *   node scripts/migrateAreas.js --dry-run
 *   node scripts/migrateAreas.js
 *
 * Qué hace, y en este orden:
 *
 *   1. **Siembra las nueve áreas base** y, de las del modelo anterior, sólo las
 *      que TENGAN gente asignada. Es lo mismo que hace el arranque
 *      (`ensureBaseAreas`); se repite aquí para poder correrlo sin desplegar.
 *   2. **Registra cualquier otra área que esté en uso** y no conozca ninguna de
 *      las dos listas — por ejemplo una que se haya capturado a mano. Entra como
 *      NO base y activa: el objetivo es que ninguna adscripción quede apuntando
 *      a un área que no existe en el catálogo, porque a partir de D-58 eso
 *      impide editarla.
 *   3. **Reporta** qué áreas quedaron sin base y cuánta gente tiene cada una.
 *
 * NO reasigna a nadie: las áreas del modelo anterior las corrige el archivo de
 * nómina al re-importarlo (decisión del cliente, ver D-58). Este script sólo se
 * asegura de que nada quede huérfano mientras tanto.
 *
 * Es idempotente y no borra nada. Después conviene correr `npm run db:indices`:
 * la colección `areas` estrena dos índices únicos.
 */
const logger = require('../src/utils/logger')
const { connect, disconnect } = require('../src/config/database')
const Area = require('../src/api/v1/areas/areaModel')
const Affiliation = require('../src/api/v1/affiliations/affiliationModel')
const { ensureBaseAreas } = require('../src/services/seedAreas')
const { claveDesdeNombre } = require('../src/api/v1/areas/areaService')

const DRY_RUN = process.argv.slice(2).includes('--dry-run')

async function main() {
  await connect()

  if (!DRY_RUN) await ensureBaseAreas()

  // Todas las claves que alguien tiene asignada hoy, con cuánta gente.
  const enUso = await Affiliation.aggregate([
    { $unwind: '$areas' },
    { $group: { _id: '$areas', personas: { $sum: 1 } } },
    { $sort: { personas: -1 } }
  ])

  const conocidas = new Set((await Area.find().select('clave')).map((a) => a.clave))
  const huerfanas = enUso.filter((a) => !conocidas.has(a._id))

  for (const { _id: clave, personas } of huerfanas) {
    // El nombre no se puede recuperar: se compone desde la clave, y RH lo
    // corrige con `PATCH /areas/:id` si hace falta.
    const nombre = clave
      .split('_')
      .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
      .join(' ')

    logger.warn(`Área en uso que no estaba en el catálogo: ${clave}`, {
      personas,
      nombre,
      dryRun: DRY_RUN
    })

    if (DRY_RUN) continue
    await Area.create({
      clave: claveDesdeNombre(clave),
      nombre,
      esBase: false,
      temporal: false
    })
  }

  const sinBase = await Area.find({ esBase: false }).select('clave nombre activa')
  const cuenta = new Map(enUso.map((a) => [a._id, a.personas]))

  logger.info('Catálogo de áreas', {
    total: await Area.countDocuments(),
    base: await Area.countDocuments({ esBase: true }),
    fueraDeLasBase: sinBase.map((a) => ({
      clave: a.clave,
      nombre: a.nombre,
      activa: a.activa,
      personas: cuenta.get(a.clave) || 0
    })),
    dryRun: DRY_RUN
  })

  if (sinBase.length > 0) {
    logger.warn(
      'Las áreas fuera de las base se corrigen re-importando el archivo de nómina: ' +
        'la columna Departamento reasigna a cada persona. Cuando una se quede sin ' +
        'nadie, dala de baja con PATCH /areas/:id/estado.'
    )
  }
  if (!DRY_RUN) {
    logger.warn(
      'Corre `npm run db:indices`: la colección areas estrena dos índices únicos.'
    )
  }

  await disconnect()
}

main().catch(async (error) => {
  logger.error('La migración de áreas falló', {
    error: error.message,
    stack: error.stack
  })
  await disconnect().catch(() => {})
  process.exit(1)
})
