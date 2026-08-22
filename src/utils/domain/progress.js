const { resolveDocuments } = require('./documentStatus')

/** Estatus que cuentan como documento entregado y vigente. */
const ESTATUS_ENTREGADO = Object.freeze(['validated', 'expiring'])

/**
 * Avance del checklist (spec 7.4).
 *
 * Tres asimetrías deliberadas:
 * - El **porcentaje sólo mira los requeridos**: un documento opcional sin subir
 *   no puede impedir que un expediente llegue al 100 %.
 * - Los **contadores de revisión y vigencia miran todos** los documentos, porque
 *   un opcional vencido también exige que alguien actúe.
 * - Un documento **por vencer sigue contando como entregado**: el checklist está
 *   completo, lo que pasa es que además hay que renovarlo.
 */
function computeProgress(documentos = [], opciones) {
  const resueltos = resolveDocuments(documentos, opciones)
  const requeridosDocs = resueltos.filter((doc) => doc.requerido)

  const requeridos = requeridosDocs.length
  const entregados = requeridosDocs.filter((doc) =>
    ESTATUS_ENTREGADO.includes(doc.estatus)
  ).length
  const faltantes = requeridosDocs.filter((doc) => doc.estatus === 'pending').length

  const contar = (estatus) => resueltos.filter((doc) => doc.estatus === estatus).length

  const enRevision = contar('in_review')
  const rechazados = contar('rejected')
  const porVencer = contar('expiring')
  const vencidos = contar('expired')

  // Un checklist sin requeridos está completo por definición; sin este caso la
  // división daría NaN.
  const porcentaje = requeridos === 0 ? 100 : Math.round((entregados / requeridos) * 100)

  return {
    requeridos,
    entregados,
    porcentaje,
    faltantes,
    enRevision,
    rechazados,
    porVencer,
    vencidos,
    estatus: deriveRecordStatus({ requeridos, entregados, porVencer, vencidos })
  }
}

/**
 * Semáforo del expediente (spec 7.5), en este orden exacto: de lo más urgente a
 * lo más tranquilo. El orden importa: un expediente con un vencido Y faltantes
 * es `expired`, porque eso es lo que hay que atender primero.
 */
function deriveRecordStatus({ requeridos, entregados, porVencer, vencidos }) {
  if (vencidos > 0) return 'expired'
  if (entregados < requeridos) return 'incomplete'
  if (porVencer > 0) return 'expiring'
  return 'complete'
}

module.exports = { computeProgress, deriveRecordStatus, ESTATUS_ENTREGADO }
