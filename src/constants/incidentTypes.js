/**
 * Semilla del catálogo de **tipos de incidencia** de maquinaria (D-88).
 *
 * Igual que las áreas base: esto NO es el catálogo, es sólo con qué arranca en
 * una base vacía. La verdad vive en la colección `incident_types`, se alimenta
 * desde la API y para validar está `incidentTypeService`.
 *
 * Son del **grupo**, no de cada empresa: una falla hidráulica es la misma en
 * Maquinaria CAMES que en Urbanizadora. Los sembrados no se pueden dar de baja,
 * como las categorías y las áreas base.
 */
const INCIDENT_TYPES_BASE = Object.freeze([
  'Falla mecánica',
  'Falla hidráulica',
  'Falla eléctrica',
  'Llantas u orugas',
  'Golpe o daño',
  'Mantenimiento preventivo',
  'Accidente o siniestro'
])

module.exports = { INCIDENT_TYPES_BASE }
