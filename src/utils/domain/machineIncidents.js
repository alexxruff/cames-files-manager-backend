/**
 * Las incidencias de una máquina y **quién la tenía cuando pasaron** (D-88).
 *
 * Funciones PURAS. Aquí y no en el servicio por lo mismo que `machineTime`: los
 * casos que importan —la incidencia del día en que la máquina cambió de manos,
 * la del hueco en que estaba en el patio, la de una máquina que nunca se
 * asignó— hay que poder probarlos sin levantar una base.
 *
 * **El contexto no se guarda, se deriva.** La incidencia sólo sabe de qué
 * máquina es y qué día pasó; el trabajador y la obra salen de cruzar esa fecha
 * con los tramos de `machine_assignments`. Así, si mañana se corrige la
 * historia, las incidencias viejas dejan de mentir solas.
 */

const { today } = require('../dates')
const { stintDays } = require('./machineTime')

/** Un tramo cubre la fecha si empezó antes o ese día y no había terminado. */
const cubre = (tramo, fecha) =>
  Boolean(tramo?.fechaAsignacion) &&
  tramo.fechaAsignacion <= fecha &&
  (!tramo.fechaDevolucion || fecha <= tramo.fechaDevolucion)

/** El hueco: la máquina estaba en el patio, con nadie. */
const SIN_ASIGNAR = Object.freeze({
  sinAsignar: true,
  tramoId: null,
  empleadoId: null,
  empleadoNombre: null,
  proyectoId: null,
  proyectoNombre: null,
  fechaAsignacion: null,
  fechaDevolucion: null,
  texto: 'Sin asignar: la máquina estaba en el patio'
})

/**
 * El tramo que cubría esa fecha, o `null` si la máquina estaba en el patio.
 *
 * **El día del cambio de manos lo cubren dos tramos** —el que cerró y el que
 * abrió, porque ese día la máquina la tuvieron los dos (D-87)—. La incidencia se
 * le atribuye a **quien la recibió**: es quien la tenía al final del día, y es
 * la lectura que menos sorprende cuando se captura al día siguiente.
 *
 * @param {Array<object>} tramos en la forma de `stintToJson`
 * @param {string} fecha `'YYYY-MM-DD'`
 */
function stintAt(tramos = [], fecha) {
  if (!fecha) return null

  const candidatos = tramos.filter((t) => cubre(t, fecha))
  if (candidatos.length === 0) return null

  return candidatos.sort(
    (a, b) =>
      b.fechaAsignacion.localeCompare(a.fechaAsignacion) ||
      // A igual fecha de entrega, el que sigue vigente es el que la recibió.
      Number(b.vigente) - Number(a.vigente)
  )[0]
}

/**
 * Quién tenía la máquina y en qué obra ese día, en la forma en que viaja al
 * front.
 *
 * Tres desenlaces, y los tres son información, no huecos:
 *   1. con trabajador y obra;
 *   2. en la obra pero **sin operador** (`empleadoId: null`), que es lo que deja
 *      la baja del trabajador o su salida de la obra;
 *   3. `sinAsignar: true`: estaba en el patio.
 */
function incidentContext(tramos = [], fecha) {
  const tramo = stintAt(tramos, fecha)
  if (!tramo) return { ...SIN_ASIGNAR }

  const obra = tramo.proyectoNombre ?? 'la obra'

  return {
    sinAsignar: false,
    tramoId: tramo._id,
    empleadoId: tramo.empleadoId ?? null,
    empleadoNombre: tramo.empleadoNombre ?? null,
    proyectoId: tramo.proyectoId ?? null,
    proyectoNombre: tramo.proyectoNombre ?? null,
    fechaAsignacion: tramo.fechaAsignacion,
    fechaDevolucion: tramo.fechaDevolucion ?? null,
    texto: tramo.empleadoNombre
      ? `${tramo.empleadoNombre} · ${obra}`
      : `En ${obra}, sin operador`
  }
}

/**
 * Una incidencia como viaja al front: con su tipo resuelto, si está abierta,
 * cuántos días lleva y el contexto de aquel día.
 *
 * Acepta el documento con `tipoId` **populado**; sin poblar, `tipo` va en `null`
 * y `tipoId` sigue siendo correcto.
 *
 * `dias` cuenta días naturales e inclusivos, igual que los tramos: lo que lleva
 * abierta, o lo que tardó en resolverse si ya se cerró.
 */
function incidentToJson(incidencia, { tramos = [], hoy = today() } = {}) {
  if (!incidencia) return null

  const json = incidencia.toJSON ? incidencia.toJSON() : incidencia
  const tipo = incidencia.tipoId ?? null
  const abierta = !json.fechaResolucion

  return {
    ...json,
    tipo: tipo?.nombre
      ? { _id: String(tipo._id), nombre: tipo.nombre, activo: tipo.activo }
      : null,
    abierta,
    dias: stintDays(json.fechaIncidencia, {
      fechaDevolucion: json.fechaResolucion ?? null,
      hoy
    }),
    contexto: incidentContext(tramos, json.fechaIncidencia)
  }
}

module.exports = { stintAt, incidentContext, incidentToJson }
