/**
 * Por qué se cerró un tramo de máquina (D-87).
 *
 * El motivo NO es decorativo: es lo que permite que la ficha explique por qué
 * una máquina está en una obra sin operador. Los tres primeros los provoca una
 * acción sobre la máquina; los dos últimos los provoca algo que le pasó a la
 * persona, y son los que dejan la máquina en la obra sin trabajador.
 */
const MACHINE_RELEASE_REASONS = Object.freeze([
  'devolucion',
  'reasignacion',
  'baja_de_maquina',
  'salida_de_obra',
  'baja_de_trabajador'
])

const MACHINE_RELEASE_REASON_LABELS = Object.freeze({
  devolucion: 'Devuelta al patio',
  reasignacion: 'Reasignada a otra persona',
  baja_de_maquina: 'Baja de la máquina',
  salida_de_obra: 'El trabajador salió de la obra',
  baja_de_trabajador: 'Baja del trabajador'
})

/**
 * Los motivos que **conservan la obra**: la máquina pierde al trabajador, no la
 * obra (D-87). Tras uno de estos se abre otro tramo en la misma obra con
 * `empleadoId: null`, y sólo una acción a mano la mueve de ahí.
 */
const REASONS_KEEPING_PROJECT = Object.freeze(['salida_de_obra', 'baja_de_trabajador'])

module.exports = {
  MACHINE_RELEASE_REASONS,
  MACHINE_RELEASE_REASON_LABELS,
  REASONS_KEEPING_PROJECT
}
