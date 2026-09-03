const IncidentType = require('../api/v1/incidentTypes/incidentTypeModel')
const logger = require('../utils/logger')
const { INCIDENT_TYPES_BASE } = require('../constants')
const { normalize } = require('../utils/text')

/**
 * Siembra el catálogo de tipos de incidencia (D-88). Idempotente: corre en cada
 * arranque, igual que las áreas.
 *
 * Sin tipos no se puede levantar ninguna incidencia —el tipo es obligatorio y
 * sale de la lista—, así que una base recién creada tiene que traer con qué
 * empezar. Se comparan por nombre normalizado y **no se toca lo que ya existe**:
 * alguien pudo renombrar un tipo base, y un arranque no debería deshacerlo.
 */
async function ensureBaseIncidentTypes() {
  const creados = []

  for (const nombre of INCIDENT_TYPES_BASE) {
    if (await IncidentType.exists({ nombreNormalizado: normalize(nombre) })) continue
    await IncidentType.create({ nombre, esBase: true })
    creados.push(nombre)
  }

  if (creados.length > 0) {
    logger.info('Catálogo de tipos de incidencia sembrado', { creados })
  }

  return { creados }
}

module.exports = { ensureBaseIncidentTypes }
