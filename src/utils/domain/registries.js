/**
 * Registros patronales y de obra: resolverlos y compararlos (Fase 6, G2).
 *
 * Funciones PURAS. Aquí y no en los servicios porque el caso que importa —el
 * registro patronal del proyecto contra el de la adscripción de la persona— hay
 * que poder probarlo con las cuatro variantes reales de Maquinaria CAMES sin
 * levantar una base.
 */

/**
 * La forma del subdocumento en el contrato, o `null`.
 *
 * Es la MISMA para el registro patronal de la empresa y el de obra del cliente:
 * los dos son subdocumentos `{ _id, numero, descripcion, activo }` y el front
 * los pinta igual. Una sola función evita que los dos formatos deriven.
 *
 * @param {Array} registros subdocumentos del padre, ya cargados
 * @param {*} id el que referencia el proyecto
 */
function findRegistry(registros, id) {
  if (!id || !Array.isArray(registros)) return null

  const encontrado = registros.find((r) => String(r._id) === String(id))
  if (!encontrado) return null

  return {
    _id: encontrado._id.toString(),
    numero: encontrado.numero,
    descripcion: encontrado.descripcion ?? null,
    activo: encontrado.activo
  }
}

/**
 * Sólo letras y dígitos, en mayúsculas.
 *
 * Los registros patronales se capturan `R13-77767-10-5`, `R13 77767 10 5` o
 * `r13777671 05` según quién los teclee, y **son el mismo registro**. Comparar
 * la cadena cruda produciría avisos falsos en masa; esto es una comparación, no
 * una normalización que se guarde.
 */
function normalizeRegistryNumber(numero) {
  if (typeof numero !== 'string') return null
  const limpio = numero.replace(/[^0-9a-z]/gi, '').toUpperCase()
  return limpio || null
}

/**
 * ¿La persona cotiza en el registro patronal del proyecto?
 *
 * `null` cuando **no se puede comparar** —falta uno de los dos—, que no es lo
 * mismo que `false`. Es la misma convención de `rfcCoincide` en la importación
 * (D-46): tres estados, porque «no coincide» y «no se sabe» llevan a acciones
 * distintas.
 */
function matchesEmployerRegistry(delEmpleado, delProyecto) {
  const a = normalizeRegistryNumber(delEmpleado)
  const b = normalizeRegistryNumber(delProyecto)
  if (!a || !b) return null
  return a === b
}

/**
 * El aviso mostrable, o `null` si no hay nada que advertir.
 *
 * **Avisa, no bloquea** (G2): Maquinaria CAMES ya tiene 144 personas repartidas
 * en cuatro registros patronales, así que impedir la asignación frenaría trabajo
 * legítimo. El dato queda a la vista y quien lo lee decide.
 *
 * @param {object} datos
 * @param {string} datos.empleadoNombre
 * @param {?string} datos.registroEmpleado el de su adscripción (texto libre)
 * @param {?string} datos.registroProyecto el número del registro del proyecto
 * @returns {?string}
 */
function employerRegistryWarning({ empleadoNombre, registroEmpleado, registroProyecto }) {
  const delProyecto =
    typeof registroProyecto === 'string' ? registroProyecto.trim() : null
  // Sin registro en el proyecto no hay contra qué comparar y no hay nada que
  // decir: desde D-69 es obligatorio, así que esto sólo pasa con datos rotos.
  if (!delProyecto) return null

  const coincide = matchesEmployerRegistry(registroEmpleado, delProyecto)
  if (coincide === true) return null

  const quien = empleadoNombre || 'La persona asignada'

  if (coincide === null) {
    return `${quien} no tiene registro patronal en su adscripción, así que no se pudo comprobar contra el ${delProyecto} del proyecto. La asignación queda registrada.`
  }

  return `${quien} cotiza en el registro patronal ${registroEmpleado.trim()} y este proyecto es del ${delProyecto}. La asignación queda registrada; revisa si hay que moverla de registro.`
}

module.exports = {
  findRegistry,
  normalizeRegistryNumber,
  matchesEmployerRegistry,
  employerRegistryWarning
}
