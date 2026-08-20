/**
 * Normalización de texto para búsquedas.
 *
 * El front busca ignorando acentos y mayúsculas: un `$regex` con
 * `$options: 'i'` sobre el nombre original NO hace que "Gomez" encuentre
 * "Gómez", y el usuario sí lo nota (spec 6.7).
 *
 * Por eso cada documento buscable guarda un campo `nombreNormalizado` (sin
 * acentos, en minúsculas) y las consultas se hacen contra él con el término
 * pasado por la MISMA función.
 */

/** Minúsculas, sin acentos ni diacríticos, espacios colapsados. */
function normalize(valor) {
  if (typeof valor !== 'string') return ''
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Escapa los metacaracteres para poder usar texto libre dentro de un $regex. */
function escapeRegex(valor) {
  return String(valor).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Construye un filtro de búsqueda insensible a acentos sobre campos
 * normalizados, más coincidencia directa sobre campos que ya son ASCII
 * (correo, por ejemplo).
 *
 * @param {string} termino
 * @param {object} opciones
 * @param {string[]} [opciones.camposNormalizados]
 * @param {string[]} [opciones.camposDirectos]
 * @returns {object|null} filtro de Mongo, o null si el término está vacío
 */
function buildSearchFilter(
  termino,
  { camposNormalizados = [], camposDirectos = [] } = {}
) {
  const normalizado = normalize(termino)
  if (!normalizado) return null
  const patron = new RegExp(escapeRegex(normalizado), 'i')
  const or = [
    ...camposNormalizados.map((campo) => ({ [campo]: patron })),
    ...camposDirectos.map((campo) => ({ [campo]: patron }))
  ]
  return or.length > 0 ? { $or: or } : null
}

/** Colación española para ordenar nombres con `localeCompare` (spec 7.6). */
function compareNames(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'es', {
    sensitivity: 'base'
  })
}

module.exports = { normalize, escapeRegex, buildSearchFilter, compareNames }
