/**
 * El tiempo de la máquina: cuánto duró cada tramo y cuánto lleva acumulado cada
 * trabajador (D-87).
 *
 * Funciones PURAS. Aquí y no en el servicio porque los casos que importan —el
 * tramo vigente contando hasta hoy, el tramo de un solo día, el cambio de manos
 * el mismo día— hay que poder probarlos sin levantar una base y sin esperar a
 * que pase el tiempo.
 *
 * **Los días son naturales e inclusivos**: cuentan el día de entrega y el de
 * devolución. Entregada y devuelta el mismo día es **1 día**, no 0, que es como
 * lo cuenta quien renta maquinaria. Por eso el día en que la máquina cambia de
 * manos lo cuentan los dos trabajadores: ese día la tuvieron los dos.
 */

const { daysBetween, today, isBefore } = require('../dates')
const { idAString } = require('../ids')
const { MACHINE_RELEASE_REASON_LABELS } = require('../../constants')

/**
 * Días naturales que duró un tramo. El vigente —sin `fechaDevolucion`— cuenta
 * hasta hoy, así que crece solo y nadie tiene que cerrarlo para saber cuánto va.
 *
 * @param {string} fechaAsignacion `'YYYY-MM-DD'`
 * @param {object} [opciones]
 * @param {?string} [opciones.fechaDevolucion] `null` = sigue vigente
 * @param {string} [opciones.hoy] `'YYYY-MM-DD'`
 * @returns {?number} null si no hay fecha de inicio
 */
function stintDays(fechaAsignacion, { fechaDevolucion = null, hoy = today() } = {}) {
  if (!fechaAsignacion) return null
  const fin = fechaDevolucion ?? hoy
  // Un tramo con fecha futura no lleva días negativos: no ha empezado.
  if (isBefore(fin, fechaAsignacion)) return 0
  return daysBetween(fechaAsignacion, fin) + 1
}

/**
 * Un tramo en la forma exacta en la que viaja al front.
 *
 * Acepta el documento con `empleadoId` y `proyectoId` **populados**; sin poblar,
 * los nombres van en `null` y los ids siguen siendo correctos (`idAString`
 * responde igual en los dos casos).
 *
 * `empleadoId: null` **no es un hueco**: es el estado «en la obra, sin
 * trabajador» que deja la baja de la persona o su salida de la obra (D-87).
 */
function stintToJson(tramo, { hoy = today() } = {}) {
  if (!tramo) return null

  const empleado = tramo.empleadoId ?? null
  const proyecto = tramo.proyectoId ?? null
  const vigente = tramo.activo === true

  return {
    _id: String(tramo._id),
    maquinaId: idAString(tramo.maquinaId),
    empleadoId: idAString(empleado),
    empleadoNombre: empleado?.nombre ?? null,
    proyectoId: idAString(proyecto),
    proyectoNombre: proyecto?.nombre ?? null,
    // La asignación del trabajador de la que la máquina tomó la obra.
    asignacionId: idAString(tramo.asignacionId),
    fechaAsignacion: tramo.fechaAsignacion,
    fechaDevolucion: tramo.fechaDevolucion ?? null,
    motivoCierre: tramo.motivoCierre ?? null,
    motivoCierreTexto: tramo.motivoCierre
      ? (MACHINE_RELEASE_REASON_LABELS[tramo.motivoCierre] ?? null)
      : null,
    vigente,
    dias: stintDays(tramo.fechaAsignacion, {
      fechaDevolucion: tramo.fechaDevolucion ?? null,
      hoy
    })
  }
}

/**
 * Cuánto ha usado esa máquina cada trabajador, de más a menos.
 *
 * Los tramos **sin trabajador** no acumulan para nadie: la máquina estuvo en la
 * obra, pero no en manos de alguien. Se quedan fuera de este resumen y siguen
 * apareciendo en la historia, que es donde explican el hueco.
 *
 * @param {Array<object>} tramos ya en la forma de `stintToJson`
 */
function accumulateByEmployee(tramos = []) {
  const porTrabajador = new Map()

  for (const tramo of tramos) {
    if (!tramo?.empleadoId) continue

    const clave = String(tramo.empleadoId)
    const acumulado = porTrabajador.get(clave) ?? {
      empleadoId: clave,
      empleadoNombre: tramo.empleadoNombre ?? null,
      tramos: 0,
      dias: 0
    }

    acumulado.tramos += 1
    acumulado.dias += tramo.dias ?? 0
    if (!acumulado.empleadoNombre && tramo.empleadoNombre) {
      acumulado.empleadoNombre = tramo.empleadoNombre
    }
    porTrabajador.set(clave, acumulado)
  }

  // Quién la ha usado más, primero. A igualdad de días, por nombre.
  return [...porTrabajador.values()].sort(
    (a, b) =>
      b.dias - a.dias || (a.empleadoNombre ?? '').localeCompare(b.empleadoNombre ?? '')
  )
}

module.exports = { stintDays, stintToJson, accumulateByEmployee }
