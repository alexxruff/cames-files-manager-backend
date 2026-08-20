/**
 * Estatus de documento y semáforo del expediente (spec 5).
 *
 * REGLA CRÍTICA: en la base sólo viven los cuatro `STORED_DOCUMENT_STATUSES`.
 * `expiring` y `expired` se DERIVAN al leer, a partir de `vigenciaHasta`
 * (spec 2.9 y 7.3). Persistirlos los desincroniza al día siguiente.
 */
const STORED_DOCUMENT_STATUSES = Object.freeze([
  'pending',
  'in_review',
  'validated',
  'rejected'
])

const DERIVED_DOCUMENT_STATUSES = Object.freeze(['expiring', 'expired'])

const DOCUMENT_STATUSES = Object.freeze([
  ...STORED_DOCUMENT_STATUSES,
  ...DERIVED_DOCUMENT_STATUSES
])

/** Estatus que puede tener una versión concreta de un documento. */
const VERSION_STATUSES = Object.freeze(['in_review', 'validated', 'rejected'])

/** Semáforo del expediente: siempre derivado, nunca almacenado. */
const RECORD_STATUSES = Object.freeze(['incomplete', 'complete', 'expiring', 'expired'])

/** Severidad del semáforo para el orden por defecto del listado (spec 9.3). */
const RECORD_STATUS_SEVERITY = Object.freeze({
  expired: 0,
  incomplete: 1,
  expiring: 2,
  complete: 3
})

module.exports = {
  STORED_DOCUMENT_STATUSES,
  DERIVED_DOCUMENT_STATUSES,
  DOCUMENT_STATUSES,
  VERSION_STATUSES,
  RECORD_STATUSES,
  RECORD_STATUS_SEVERITY
}
