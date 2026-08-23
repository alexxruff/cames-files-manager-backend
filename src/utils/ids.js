/**
 * Serialización de referencias a string.
 *
 * POR QUÉ EXISTE: un campo `ObjectId` puede llegar al `toJSON` de dos formas —el
 * id pelón, o el documento completo si alguien hizo `populate()`—. Con
 * `ret.empleadoId.toString()` el segundo caso produce **`"[object Object]"`** y se
 * publica al front. Pasó de verdad en las asignaciones.
 *
 * `idAString` responde lo mismo en los dos casos, así que el contrato no depende
 * de si la consulta pobló o no.
 */
function idAString(valor) {
  if (valor === null || valor === undefined) return null
  // Documento populado: su `_id`. Si no, el propio valor.
  const id = valor._id ?? valor
  return id ? String(id) : null
}

/** Lo mismo para un arreglo de referencias. */
function idsAString(valores) {
  return (valores || []).map(idAString).filter(Boolean)
}

module.exports = { idAString, idsAString }
