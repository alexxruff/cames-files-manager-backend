/**
 * Migración: el proyecto deja de habilitar puestos (D-82).
 *
 *   node scripts/migrateProjectCategories.js --dry-run
 *   node scripts/migrateProjectCategories.js
 *
 * Un proyecto guardaba `categorias`: el subconjunto del catálogo con el que se
 * podía asignar gente a esa obra. Servía para dos cosas y las dos se cayeron —el
 * selector de asignables filtraba por ahí y el alta rechazaba lo que no
 * estuviera en la lista—, porque a una obra va quien haga falta y quién es de la
 * empresa lo dice la adscripción, no el puesto.
 *
 * Este script quita `categorias` de los proyectos que la traigan. El campo ya no
 * está en el esquema, así que Mongoose ni lo lee: quedaría de basura en la
 * colección y volvería a aparecer el día que alguien mire la base cruda.
 *
 * **Antes de borrar, imprime lo que borra**: proyecto y cuántas categorías tenía
 * habilitadas, para que quede en la bitácora. Es idempotente: correrlo dos veces
 * no hace nada la segunda. Las asignaciones **no se tocan**: cada una conserva
 * su `categoriaId`, que es el puesto con el que esa persona figura en la obra.
 */
const mongoose = require('mongoose')
const logger = require('../src/utils/logger')
const { connect, disconnect } = require('../src/config/database')

const DRY_RUN = process.argv.slice(2).includes('--dry-run')

async function main() {
  await connect()

  /*
   * Con el driver crudo, no con el modelo: `categorias` ya no existe en el
   * esquema y Mongoose lo ignoraría al leer, así que por el modelo no habría
   * forma de ver cuáles lo traen.
   */
  const coleccion = mongoose.connection.db.collection('projects')

  const conCategorias = await coleccion
    .find({ categorias: { $exists: true } })
    .project({ nombre: 1, empresaId: 1, categorias: 1 })
    .toArray()

  logger.info(`Proyectos con categorías habilitadas: ${conCategorias.length}`, {
    dryRun: DRY_RUN
  })

  for (const proyecto of conCategorias) {
    logger.info('Se quitan las categorías habilitadas', {
      proyectoId: proyecto._id.toString(),
      nombre: proyecto.nombre,
      empresaId: proyecto.empresaId?.toString() ?? null,
      categorias: (proyecto.categorias || []).length
    })
  }

  if (DRY_RUN || conCategorias.length === 0) {
    logger.info('Nada que escribir', { dryRun: DRY_RUN })
    return disconnect()
  }

  const { modifiedCount } = await coleccion.updateMany(
    { categorias: { $exists: true } },
    { $unset: { categorias: '' } }
  )

  logger.info('Categorías habilitadas eliminadas', { proyectos: modifiedCount })
  logger.warn(
    'A partir de aquí se puede asignar a cualquier persona adscrita y activa en ' +
      'la empresa del proyecto, sin importar su puesto.'
  )

  await disconnect()
}

main().catch(async (error) => {
  logger.error('La migración de las categorías del proyecto falló', {
    error: error.message,
    stack: error.stack
  })
  await disconnect().catch(() => {})
  process.exit(1)
})
