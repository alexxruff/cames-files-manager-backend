/**
 * Tipos de alerta y su severidad (spec 5 y 7.6). La severidad ordena la
 * bandeja: 0 es lo más urgente. Las alertas se derivan en cada consulta,
 * nunca se almacenan.
 */
const ALERT_TYPES = Object.freeze([
  'vencido',
  'documento_rechazado',
  'por_vencer',
  'documento_faltante'
])

const ALERT_SEVERITY = Object.freeze({
  vencido: 0,
  documento_rechazado: 1,
  por_vencer: 2,
  documento_faltante: 3
})

/** Acciones que se registran en la bitácora de accesos (spec 6.6). */
const AUDIT_ACTIONS = Object.freeze([
  'ver_documento',
  'descargar_documento',
  'exportar_reporte'
])

module.exports = { ALERT_TYPES, ALERT_SEVERITY, AUDIT_ACTIONS }
