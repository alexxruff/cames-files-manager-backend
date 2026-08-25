const env = require('../../config/env')
const { daysBetween, today } = require('../dates')

/**
 * Estatus efectivo de un documento (spec 7.3).
 *
 * En la base sólo viven `pending`, `in_review`, `validated` y `rejected`.
 * `expiring` y `expired` dependen del día en que se consulta, así que se derivan
 * aquí y NUNCA se persisten.
 *
 * Los tres casos que es fácil equivocar, y que tienen prueba cada uno:
 * - El día del vencimiento todavía cuenta como vigente: `dias === 0` es
 *   `expiring`, no `expired`. Se vence al día siguiente.
 * - El umbral es inclusivo: exactamente 30 días es `expiring`; 31 es `validated`.
 * - Lo que no está validado no vence: un `in_review` con vigencia pasada sigue
 *   siendo `in_review`.
 */
function effectiveStatus(
  documento,
  { hoy = today(), diasAlerta = env.DIAS_ALERTA_VENCIMIENTO } = {}
) {
  if (!documento || documento.estatus !== 'validated') {
    return documento?.estatus
  }

  if (!documento.vigenciaHasta) return 'validated'

  const dias = daysBetween(hoy, documento.vigenciaHasta)
  if (dias < 0) return 'expired'
  if (dias <= diasAlerta) return 'expiring'
  return 'validated'
}

/** Copia del documento con el estatus ya resuelto para la fecha dada. */
function resolveDocument(documento, opciones) {
  /*
   * Se normaliza a objeto plano ANTES de esparcir: `{ ...subdocumento }` de
   * Mongoose copia los internos (`$__`, `_doc`) y **no los campos del esquema**,
   * así que el resultado saldría sin `tipo`, sin `requerido` y sin `estatus` —y
   * sin ningún error, que es lo peligroso. Pasó de verdad al derivar las alertas.
   */
  const plano =
    typeof documento?.toObject === 'function' ? documento.toObject() : documento
  return { ...plano, estatus: effectiveStatus(plano, opciones) }
}

function resolveDocuments(documentos = [], opciones) {
  return documentos.map((doc) => resolveDocument(doc, opciones))
}

/** Días para el vencimiento; negativo si ya venció, `null` si no caduca. */
function daysUntilExpiry(documento, { hoy = today() } = {}) {
  if (!documento?.vigenciaHasta) return null
  return daysBetween(hoy, documento.vigenciaHasta)
}

module.exports = {
  effectiveStatus,
  resolveDocument,
  resolveDocuments,
  daysUntilExpiry
}
