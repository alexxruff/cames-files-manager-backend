/**
 * Punto único de entrada a las enumeraciones del dominio.
 *
 *   const { AREAS, DOCUMENT_TYPES } = require('../../constants')
 *
 * Los valores son los literales del contrato con el front (spec 5). Cambiar
 * uno rompe el front: si hace falta, se avisa y se cambia en los dos lados.
 */
module.exports = {
  ...require('./areas'),
  ...require('./accessLevels'),
  ...require('./employeeTypes'),
  ...require('./contractTypes'),
  ...require('./documentTypes'),
  ...require('./statuses'),
  ...require('./alertTypes'),
  ...require('./uploadTargets')
}
