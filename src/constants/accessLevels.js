/**
 * Niveles de acceso (`nivelAcceso`) y eje multi-cliente (`alcance`).
 *
 * `nivelAcceso` sustituye al `role: 'user' | 'admin'` del backend prestado.
 * Seguimos exponiendo `role` en la respuesta por compatibilidad con el front
 * mientras termina la transición (spec 9.1): ver `accessLevelToRole`.
 */
const ACCESS_LEVELS = Object.freeze(['rh_admin', 'rh_consulta', 'jefe_area'])

const ACCESS_LEVEL_LABELS = Object.freeze({
  rh_admin: 'Administrador de RH',
  rh_consulta: 'Consulta de RH',
  jefe_area: 'Jefe de área'
})

const SCOPES = Object.freeze(['interno', 'cliente'])

/** Compatibilidad hacia atrás con el `role` que el front todavía lee. */
function accessLevelToRole(nivelAcceso) {
  return nivelAcceso === 'rh_admin' ? 'admin' : 'user'
}

module.exports = {
  ACCESS_LEVELS,
  ACCESS_LEVEL_LABELS,
  SCOPES,
  accessLevelToRole
}
