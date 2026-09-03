/**
 * Limpieza de subidas que nadie confirmó (D-83).
 *
 *   node scripts/cleanOrphanUploads.js --dry-run
 *   node scripts/cleanOrphanUploads.js
 *
 * Con la subida directa, el navegador pone el archivo en el almacenamiento y
 * **después** avisa por la ruta del recurso. Entre esas dos cosas puede cerrar
 * la pestaña, quedarse sin red o equivocarse: entonces el objeto se queda en
 * `pendientes/`, sin que nada lo referencie y sin que nadie pueda verlo.
 *
 * Esto barre esos restos: por cada permiso `pendiente` que ya caducó, borra su
 * objeto del almacenamiento y el propio permiso.
 *
 * De los `usada` **borra el objeto temporal si quedó alguno, pero nunca el
 * permiso**: ése es el rastro de quién subió qué. Normalmente no queda nada —al
 * confirmar, el archivo se mueve y el original desaparece—, pero mover son dos
 * operaciones, copiar y borrar, y si la segunda falla el archivo se queda ahí sin
 * que nadie vuelva a mirarlo.
 *
 * Es idempotente —correrlo dos veces no hace nada la segunda— y conviene dejarlo
 * en un cron diario. R2 puede además barrer `pendientes/` con una regla de ciclo
 * de vida; las dos cosas no se estorban, y la regla es la red por si esto no
 * corre.
 */
const Upload = require('../src/api/v1/uploads/uploadModel')
const storage = require('../src/services/storageService')
const logger = require('../src/utils/logger')
const { connect, disconnect } = require('../src/config/database')

const DRY_RUN = process.argv.slice(2).includes('--dry-run')

async function main() {
  await connect()

  const vencidas = await Upload.find({ expiraEn: { $lt: new Date() } })
  const pendientes = vencidas.filter((s) => s.estado === 'pendiente')

  logger.info(`Permisos vencidos: ${vencidas.length}`, {
    sinUsar: pendientes.length,
    usados: vencidas.length - pendientes.length,
    dryRun: DRY_RUN
  })

  let conArchivo = 0

  for (const subida of vencidas) {
    /*
     * Se mira si el objeto existe antes de anunciarlo: la mayoría de los
     * permisos vencidos son de gente que abrió el formulario y no llegó a
     * elegir archivo, y ésos no dejaron nada en el almacenamiento.
     */
    const cabecera = await storage.cabecera(subida.claveTemporal)
    if (cabecera) conArchivo += 1

    // De los usados sólo interesa el caso raro: que su temporal siga ahí.
    if (subida.estado === 'usada' && !cabecera) continue

    logger.info(
      subida.estado === 'usada'
        ? 'Temporal que sobrevivió a una subida confirmada'
        : 'Subida sin confirmar',
      {
        subidaId: subida._id.toString(),
        destino: subida.destino,
        nombre: subida.nombre,
        solicitadaPor: subida.solicitadaPor,
        pedidaEn: subida.createdAt,
        bytesEnAlmacenamiento: cabecera?.tamanoBytes ?? 0
      }
    )

    if (DRY_RUN) continue

    if (cabecera) await storage.borrar(subida.claveTemporal)
    // El permiso gastado se queda: es el rastro. Sólo se van los que nadie usó.
    if (subida.estado === 'pendiente') await Upload.deleteOne({ _id: subida._id })
  }

  if (DRY_RUN) {
    logger.info('Nada que borrar', {
      dryRun: true,
      permisos: vencidas.length,
      conArchivo
    })
    return disconnect()
  }

  logger.info('Limpieza terminada', {
    permisosBorrados: pendientes.length,
    archivosBorrados: conArchivo
  })
  await disconnect()
}

main().catch(async (error) => {
  logger.error('La limpieza de subidas falló', {
    error: error.message,
    stack: error.stack
  })
  await disconnect().catch(() => {})
  process.exit(1)
})
