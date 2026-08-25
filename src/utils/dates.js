const env = require('../config/env')

/**
 * Fechas de calendario (`YYYY-MM-DD`) — spec regla #6.
 *
 * Las fechas civiles (ingreso, término de contrato, vigencia, baja) se guardan y
 * se transportan como String `YYYY-MM-DD`, SIN hora ni zona. Guardarlas como
 * `Date` las lleva a medianoche UTC y en México se leen un día antes: es un bug
 * real que ya se corrigió en el front y no se debe reintroducir aquí.
 *
 * Toda la aritmética de este archivo usa `Date.UTC` sobre los componentes de la
 * cadena. Al no mezclar husos, el resultado no cambia con el horario de verano
 * ni con la zona del servidor.
 */

const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/

/** ¿Es una fecha de calendario válida y existente? (2026-02-30 → false) */
function isCalendarDate(valor) {
  if (typeof valor !== 'string' || !PATRON_FECHA.test(valor)) return false
  const [anio, mes, dia] = valor.split('-').map(Number)
  if (mes < 1 || mes > 12 || dia < 1) return false
  return dia <= daysInMonth(anio, mes)
}

function daysInMonth(anio, mes) {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate()
}

/** Convierte `YYYY-MM-DD` a milisegundos UTC de esa medianoche. */
function toUtcMillis(fecha) {
  const [anio, mes, dia] = fecha.split('-').map(Number)
  return Date.UTC(anio, mes - 1, dia)
}

const pad = (n) => String(n).padStart(2, '0')

function fromParts(anio, mes, dia) {
  return `${anio}-${pad(mes)}-${pad(dia)}`
}

/**
 * Hoy en la zona horaria de negocio (`TIMEZONE`), como `YYYY-MM-DD`.
 * Un servidor en UTC no debe adelantar el día para un usuario en México.
 */
function today(timeZone = env.TIMEZONE, ahora = new Date()) {
  // 'en-CA' formatea exactamente como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(ahora)
}

/**
 * Días completos de `desde` a `hasta`. Positivo si `hasta` es posterior.
 * `daysBetween(hoy, vigenciaHasta)` es el `diasRestantes` del spec.
 */
function daysBetween(desde, hasta) {
  return Math.round((toUtcMillis(hasta) - toUtcMillis(desde)) / 86400000)
}

/**
 * Suma meses respetando el fin de mes (spec 7.7):
 * 31 de enero + 1 mes = 28 (o 29) de febrero, nunca 3 de marzo.
 */
function addMonths(fecha, meses) {
  const [anio, mes, dia] = fecha.split('-').map(Number)
  const totalMeses = anio * 12 + (mes - 1) + meses
  const anioDestino = Math.floor(totalMeses / 12)
  const mesDestino = (totalMeses % 12) + 1
  const diaDestino = Math.min(dia, daysInMonth(anioDestino, mesDestino))
  return fromParts(anioDestino, mesDestino, diaDestino)
}

function addDays(fecha, dias) {
  const destino = new Date(toUtcMillis(fecha) + dias * 86400000)
  return fromParts(
    destino.getUTCFullYear(),
    destino.getUTCMonth() + 1,
    destino.getUTCDate()
  )
}

/** -1, 0 o 1. Sirve para ordenar y comparar sin construir `Date`. */
function compare(a, b) {
  return a === b ? 0 : a < b ? -1 : 1
}

function isBefore(a, b) {
  return compare(a, b) < 0
}

function isAfter(a, b) {
  return compare(a, b) > 0
}

/**
 * El próximo aniversario de una fecha, contando desde `hoy`.
 *
 * Se usa para los cumpleaños: la fecha de nacimiento es fija y lo que interesa
 * es cuándo cae este año (o el siguiente, si ya pasó).
 *
 * **El 29 de febrero se celebra el 28 en los años no bisiestos**, con el mismo
 * criterio de fin de mes que `addMonths`: se elige el último día real del mes en
 * vez de saltar al 1 de marzo. Sin esto, quien nació un 29 de febrero no
 * aparecería nunca en tres de cada cuatro años.
 *
 * **El aniversario de HOY es hoy**, no el del año que viene: `daysUntilAnniversary`
 * devuelve 0 el día del cumpleaños, que es justo el día que hay que avisar.
 *
 * @param {string} fecha `'YYYY-MM-DD'`
 * @param {string} [hoy] `'YYYY-MM-DD'`
 * @returns {string|null} `'YYYY-MM-DD'`, o null si la fecha no es válida
 */
function nextAnniversary(fecha, hoy = today()) {
  if (!isCalendarDate(fecha) || !isCalendarDate(hoy)) return null

  const [, mes, dia] = fecha.split('-').map(Number)
  const anioActual = Number(hoy.slice(0, 4))

  const enAnio = (anio) => fromParts(anio, mes, Math.min(dia, daysInMonth(anio, mes)))

  const esteAnio = enAnio(anioActual)
  return isBefore(esteAnio, hoy) ? enAnio(anioActual + 1) : esteAnio
}

/**
 * Días completos hasta el próximo aniversario. `0` el mismo día.
 * @returns {number|null} null si la fecha no es válida
 */
function daysUntilAnniversary(fecha, hoy = today()) {
  const proximo = nextAnniversary(fecha, hoy)
  return proximo === null ? null : daysBetween(hoy, proximo)
}

/**
 * Años que cumple en su próximo aniversario. Es la edad que va a tener, no la
 * que tiene hoy: el día del cumpleaños las dos coinciden.
 * @returns {number|null}
 */
function ageOnNextAnniversary(fechaNacimiento, hoy = today()) {
  const proximo = nextAnniversary(fechaNacimiento, hoy)
  if (proximo === null) return null
  const edad = Number(proximo.slice(0, 4)) - Number(fechaNacimiento.slice(0, 4))
  return edad >= 0 ? edad : null
}

module.exports = {
  PATRON_FECHA,
  isCalendarDate,
  daysInMonth,
  today,
  daysBetween,
  addMonths,
  addDays,
  nextAnniversary,
  daysUntilAnniversary,
  ageOnNextAnniversary,
  compare,
  isBefore,
  isAfter
}
