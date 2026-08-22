const { EXPIRING_DOCUMENT_TYPES, isTemporaryContract } = require('../../constants')
const { addMonths, today } = require('../dates')

/**
 * Vigencia de los documentos que caducan (spec 7.7).
 *
 * - `contrato`: si el contrato es temporal, la vigencia es la
 *   `fechaTerminoContrato` del colaborador. Si es indeterminado, **no lleva
 *   vigencia**: un contrato por tiempo indeterminado no vence.
 * - Los demás que caducan (`examen_medico`): hoy + `vigenciaMeses` de la
 *   plantilla, respetando el fin de mes (`addMonths`).
 */

/** ¿Este documento exige `vigenciaHasta` al subirlo? */
function requiresExpiry(documento, colaborador) {
  if (!EXPIRING_DOCUMENT_TYPES.includes(documento?.tipo)) return false

  if (documento.tipo === 'contrato') {
    return isTemporaryContract(colaborador?.tipoContrato)
  }

  return Boolean(documento.vigenciaMeses)
}

/**
 * Fecha que el servidor propone (y valida) al subir un documento que caduca.
 * @returns {string|null} `'YYYY-MM-DD'` o null si el documento no vence
 */
function suggestedExpiry(documento, colaborador, { hoy = today() } = {}) {
  if (!EXPIRING_DOCUMENT_TYPES.includes(documento?.tipo)) return null

  if (documento.tipo === 'contrato') {
    return isTemporaryContract(colaborador?.tipoContrato)
      ? colaborador.fechaTerminoContrato || null
      : null
  }

  if (!documento.vigenciaMeses) return null
  return addMonths(hoy, documento.vigenciaMeses)
}

module.exports = { requiresExpiry, suggestedExpiry }
