/**
 * Tipos de contrato. Los temporales exigen `fechaTerminoContrato` y su
 * documento `contrato` se vigila por vigencia (spec 6.3 y 7.7).
 */
const CONTRACT_TYPES = Object.freeze([
  'indeterminado',
  'determinado',
  'obra_determinada',
  'prueba',
  'capacitacion_inicial'
])

const CONTRACT_TYPE_LABELS = Object.freeze({
  indeterminado: 'Tiempo indeterminado',
  determinado: 'Tiempo determinado',
  obra_determinada: 'Obra determinada',
  prueba: 'Periodo a prueba',
  capacitacion_inicial: 'Capacitación inicial'
})

const TEMPORARY_CONTRACT_TYPES = Object.freeze([
  'determinado',
  'obra_determinada',
  'prueba',
  'capacitacion_inicial'
])

function isTemporaryContract(tipoContrato) {
  return TEMPORARY_CONTRACT_TYPES.includes(tipoContrato)
}

module.exports = {
  CONTRACT_TYPES,
  CONTRACT_TYPE_LABELS,
  TEMPORARY_CONTRACT_TYPES,
  isTemporaryContract
}
