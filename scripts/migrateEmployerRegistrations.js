/**
 * Migración: registros patronales de cadenas a subdocumentos, y poblarlos desde
 * la nómina (D-65).
 *
 *   node scripts/migrateEmployerRegistrations.js --dry-run
 *   node scripts/migrateEmployerRegistrations.js
 *
 * Dos pasos, y el segundo es el que da el valor:
 *
 *   1. **Normalizar.** `registrosPatronales` nació como `[String]` (D-64). Se
 *      convierte cada cadena en `{ _id, numero, descripcion: null, activo: true }`.
 *      Se lee con el driver crudo porque el esquema nuevo espera objetos y
 *      Mongoose no sabría interpretar las cadenas.
 *
 *   2. **Poblar desde el archivo de nómina.** Cada adscripción ya guarda el
 *      registro patronal de esa persona en `condiciones.registroPatronal` (D-63).
 *      De ahí salen los que la empresa realmente usa, sin capturar nada a mano:
 *      se agrupan por empresa y se agregan los que falten.
 *
 * Idempotente: no duplica lo que ya está, y sólo agrega lo que falta. No borra
 * nada.
 */
const mongoose = require('mongoose')
const logger = require('../src/utils/logger')
const { connect, disconnect } = require('../src/config/database')

const DRY_RUN = process.argv.slice(2).includes('--dry-run')

const normalizar = (valor) =>
  String(valor || '')
    .trim()
    .toUpperCase()

async function main() {
  await connect()

  const empresas = mongoose.connection.db.collection('companies')
  const adscripciones = mongoose.connection.db.collection('affiliations')

  const todas = await empresas.find({}).toArray()
  logger.info(`Empresas: ${todas.length}`, { dryRun: DRY_RUN })

  // ── Paso 2, en una sola consulta: qué registros usa cada empresa ──────────
  const porEmpresa = new Map()
  const deNomina = await adscripciones
    .aggregate([
      { $match: { 'condiciones.registroPatronal': { $nin: [null, ''] } } },
      {
        $group: {
          _id: { empresaId: '$empresaId', numero: '$condiciones.registroPatronal' },
          personas: { $sum: 1 }
        }
      }
    ])
    .toArray()

  for (const fila of deNomina) {
    const clave = String(fila._id.empresaId)
    if (!porEmpresa.has(clave)) porEmpresa.set(clave, [])
    porEmpresa
      .get(clave)
      .push({ numero: normalizar(fila._id.numero), personas: fila.personas })
  }

  const resumen = { normalizados: 0, agregados: 0, empresas: [] }

  for (const empresa of todas) {
    const actuales = empresa.registrosPatronales || []

    // Paso 1: lo que sea cadena pasa a subdocumento.
    const yaObjetos = actuales.filter((r) => r && typeof r === 'object' && r.numero)
    const cadenas = actuales.filter((r) => typeof r === 'string')

    const registros = yaObjetos.map((r) => ({
      _id: r._id || new mongoose.Types.ObjectId(),
      numero: normalizar(r.numero),
      descripcion: r.descripcion ?? null,
      activo: r.activo !== false
    }))

    for (const cadena of cadenas) {
      const numero = normalizar(cadena)
      if (!numero || registros.some((r) => r.numero === numero)) continue
      registros.push({
        _id: new mongoose.Types.ObjectId(),
        numero,
        descripcion: null,
        activo: true
      })
      resumen.normalizados += 1
    }

    // Paso 2: los que usa su gente y no están en el catálogo.
    const agregados = []
    for (const { numero, personas } of porEmpresa.get(String(empresa._id)) || []) {
      if (!numero || registros.some((r) => r.numero === numero)) continue
      registros.push({
        _id: new mongoose.Types.ObjectId(),
        numero,
        // Se deja dicho de dónde salió: nadie lo capturó, lo trajo el archivo.
        descripcion: `Detectado en la nómina (${personas} ${personas === 1 ? 'persona' : 'personas'})`,
        activo: true
      })
      agregados.push(`${numero} (${personas})`)
      resumen.agregados += 1
    }

    const cambia =
      cadenas.length > 0 || agregados.length > 0 || registros.length !== actuales.length
    if (!cambia) continue

    resumen.empresas.push({
      nombre: empresa.nombre,
      antes: actuales.length,
      despues: registros.length,
      agregadosDeNomina: agregados
    })

    if (DRY_RUN) continue
    await empresas.updateOne(
      { _id: empresa._id },
      { $set: { registrosPatronales: registros } }
    )
  }

  logger.info('Registros patronales', {
    cadenasNormalizadas: resumen.normalizados,
    agregadosDesdeNomina: resumen.agregados,
    dryRun: DRY_RUN
  })
  for (const e of resumen.empresas) {
    logger.info(`  · ${e.nombre}: ${e.antes} → ${e.despues}`, {
      agregadosDeNomina: e.agregadosDeNomina
    })
  }

  if (resumen.empresas.length === 0) logger.info('Nada que migrar')

  await disconnect()
}

main().catch(async (error) => {
  logger.error('La migración de registros patronales falló', {
    error: error.message,
    stack: error.stack
  })
  await disconnect().catch(() => {})
  process.exit(1)
})
