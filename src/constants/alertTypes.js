/**
 * Tipos de alerta y su severidad (spec §6.6, modelo-datos §6.4).
 *
 * **Las alertas se derivan en cada consulta, nunca se almacenan** (regla #6 del
 * contrato, D-04). Es lo que hace que se "resuelvan solas": el día que alguien
 * sube el documento que faltaba, la alerta deja de existir en la siguiente
 * lectura. No hay nada que apagar, ni un campo que pueda quedar desincronizado.
 *
 * La severidad ordena la bandeja: **0 es lo más urgente**.
 */

/** Familias de alerta. El front discrimina por `origen`. */
const ALERT_ORIGINS = Object.freeze(['documento', 'cumpleanos'])

const ALERT_TYPES = Object.freeze([
  'vencido',
  'documento_rechazado',
  'por_vencer',
  'documento_faltante',
  'cumpleanos'
])

/**
 * `cumpleanos` va al final a propósito: es lo único de esta lista que **no es un
 * problema que resolver**. Nunca debe empujar hacia abajo un documento vencido.
 */
const ALERT_SEVERITY = Object.freeze({
  vencido: 0,
  documento_rechazado: 1,
  por_vencer: 2,
  documento_faltante: 3,
  cumpleanos: 4
})

/** A qué familia pertenece cada tipo. */
const ALERT_ORIGIN_BY_TYPE = Object.freeze({
  vencido: 'documento',
  documento_rechazado: 'documento',
  por_vencer: 'documento',
  documento_faltante: 'documento',
  cumpleanos: 'cumpleanos'
})

/** Acciones que se registran en la bitácora de accesos (spec 6.6). */
const AUDIT_ACTIONS = Object.freeze([
  'ver_documento',
  'descargar_documento',
  'exportar_reporte'
])

module.exports = {
  ALERT_ORIGINS,
  ALERT_TYPES,
  ALERT_SEVERITY,
  ALERT_ORIGIN_BY_TYPE,
  AUDIT_ACTIONS
}
