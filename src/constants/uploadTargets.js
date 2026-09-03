/**
 * A qué se le puede adjuntar un archivo con una subida directa (D-83).
 *
 * Es **contrato con el front**: el valor viaja en `POST /subidas` y se compara
 * por igualdad estricta al confirmar. Cada destino dice qué ids exige y por qué
 * ruta se confirma; la tabla completa está en `ENDPOINTS-SUBIDAS.md`.
 */
const UPLOAD_TARGETS = Object.freeze([
  'expediente',
  'contrato',
  'siroc-aviso',
  'siroc-actualizacion',
  'registro-obra',
  'maquina'
])

module.exports = { UPLOAD_TARGETS }
