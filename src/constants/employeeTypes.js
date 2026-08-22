/**
 * Clasificación general de la persona (modelo-datos §5.2).
 *
 * Es una propiedad del empleado, no de su relación con una empresa: su
 * ubicación real (áreas, contrato) sale de la adscripción.
 *
 * Un `administrativo` necesita al menos un área en cada adscripción; el personal
 * de `mano_de_obra` se ubica por proyecto, vía asignaciones.
 */
const EMPLOYEE_TYPES = Object.freeze(['administrativo', 'mano_de_obra'])

const EMPLOYEE_TYPE_LABELS = Object.freeze({
  administrativo: 'Administrativo',
  mano_de_obra: 'Mano de obra'
})

module.exports = { EMPLOYEE_TYPES, EMPLOYEE_TYPE_LABELS }
