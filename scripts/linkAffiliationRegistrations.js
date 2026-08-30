/**
 * Migración M3: vincular cada adscripción con su registro patronal (D-72).
 *
 *   node scripts/linkAffiliationRegistrations.js --dry-run
 *   node scripts/linkAffiliationRegistrations.js
 *
 * Cada adscripción guarda el registro patronal **como texto**, tal como lo trajo
 * el archivo de nómina (`condiciones.registroPatronal`, D-63). Desde D-65 la
 * empresa tiene su catálogo con identidad propia, así que aquí se cruzan por
 * número normalizado —ignorando guiones, espacios y mayúsculas— y se llena
 * `registroPatronalId`.
 *
 * **Sólo llena lo vacío.** Una adscripción que ya está vinculada no se toca: el
 * vínculo pudo corregirse a mano y pisarlo desharía ese trabajo. Por eso es
 * idempotente y se puede correr las veces que haga falta.
 *
 * **No crea registros patronales.** Darlos de alta es del administrador de
 * plataforma (D-65). Lo que no resuelve se reporta —con el número y a cuánta
 * gente afecta— y se queda en `null`; nada depende de que esté.
 *
 * El texto NO se borra: es lo que dijo el archivo, y es lo único que queda para
 * lo que no resolvió. Mismo reparto que entre `areas` y `departamento`.
 */
const mongoose = require('mongoose')
const logger = require('../src/utils/logger')
const { connect, disconnect } = require('../src/config/database')
const { normalizeRegistryNumber } = require('../src/utils/domain')

const DRY_RUN = process.argv.slice(2).includes('--dry-run')

async function main() {
  await connect()

  const empresas = mongoose.connection.db.collection('companies')
  const adscripciones = mongoose.connection.db.collection('affiliations')

  const todas = await empresas.find({}).toArray()
  const resumen = { vinculadas: 0, empresas: [], sinResolver: [] }

  for (const empresa of todas) {
    // Sólo los activos: vincular a uno dado de baja dejaría el dato apuntando a
    // algo que el resto del sistema ya rechaza.
    const catalogo = new Map(
      (empresa.registrosPatronales || [])
        .filter((r) => r && typeof r === 'object' && r.activo !== false)
        .map((r) => [normalizeRegistryNumber(r.numero), r._id])
    )

    const pendientes = await adscripciones
      .find({
        empresaId: empresa._id,
        'condiciones.registroPatronal': { $nin: [null, ''] },
        $or: [{ registroPatronalId: null }, { registroPatronalId: { $exists: false } }]
      })
      .toArray()

    if (pendientes.length === 0) continue

    // Se agrupa por número para hacer una escritura por registro, no una por
    // persona: son 144 adscripciones y cuatro números.
    const porNumero = new Map()
    for (const a of pendientes) {
      const numero = String(a.condiciones.registroPatronal).trim()
      if (!porNumero.has(numero)) porNumero.set(numero, [])
      porNumero.get(numero).push(a._id)
    }

    const vinculados = []
    for (const [numero, ids] of porNumero) {
      const registroId = catalogo.get(normalizeRegistryNumber(numero))
      if (!registroId) {
        resumen.sinResolver.push({
          empresa: empresa.nombre,
          numero,
          personas: ids.length
        })
        continue
      }

      vinculados.push(`${numero} (${ids.length})`)
      resumen.vinculadas += ids.length
      if (DRY_RUN) continue
      await adscripciones.updateMany(
        { _id: { $in: ids } },
        { $set: { registroPatronalId: registroId } }
      )
    }

    if (vinculados.length > 0) {
      resumen.empresas.push({ nombre: empresa.nombre, vinculados })
    }
  }

  logger.info('Adscripciones vinculadas a su registro patronal', {
    adscripciones: resumen.vinculadas,
    sinResolver: resumen.sinResolver.length,
    dryRun: DRY_RUN
  })
  for (const e of resumen.empresas) {
    logger.info(`  · ${e.nombre}`, { vinculados: e.vinculados })
  }
  for (const s of resumen.sinResolver) {
    logger.warn(
      `  · ${s.empresa}: "${s.numero}" no está en su catálogo (${s.personas} ${
        s.personas === 1 ? 'persona' : 'personas'
      }). Agrégalo con POST /empresas/:id/registros-patronales y vuelve a correr esto.`
    )
  }

  if (resumen.empresas.length === 0 && resumen.sinResolver.length === 0) {
    logger.info('Nada que vincular')
  }

  await disconnect()
}

main().catch(async (error) => {
  logger.error('La vinculación de registros patronales falló', {
    error: error.message,
    stack: error.stack
  })
  await disconnect().catch(() => {})
  process.exit(1)
})
