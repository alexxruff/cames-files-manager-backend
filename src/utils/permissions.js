const { AREAS } = require('../constants')

/**
 * Matriz de permisos (spec 8). Fuente única de verdad del servidor.
 *
 * El front tiene la misma matriz en `src/utils/permisos.ts`, pero el front sólo
 * APAGA BOTONES: la autoridad es esta. Cualquier capacidad que se agregue aquí
 * hay que reflejarla allá, y viceversa.
 *
 * `'own_area'` significa "sí, pero acotado a su propia área": no es un permiso
 * booleano, es un permiso con filtro. Los servicios lo traducen a un filtro de
 * consulta, igual que el alcance por cliente.
 */
const CAPABILITIES = Object.freeze({
  VIEW_RECORDS: 'viewRecords',
  MANAGE_EMPLOYEES: 'manageEmployees',
  UPLOAD_DOCUMENTS: 'uploadDocuments',
  REVIEW_DOCUMENTS: 'reviewDocuments',
  OPEN_SENSITIVE_DOCUMENTS: 'openSensitiveDocuments',
  MANAGE_TEMPLATES: 'manageTemplates',
  GENERATE_REPORTS: 'generateReports',
  MANAGE_USERS: 'manageUsers'
})

const PERMISSION_MATRIX = Object.freeze({
  rh_admin: Object.freeze({
    viewRecords: true,
    manageEmployees: true,
    uploadDocuments: true,
    reviewDocuments: true,
    openSensitiveDocuments: true,
    manageTemplates: true,
    generateReports: true,
    manageUsers: true
  }),
  rh_consulta: Object.freeze({
    viewRecords: true,
    manageEmployees: false,
    uploadDocuments: true,
    reviewDocuments: false,
    openSensitiveDocuments: true,
    manageTemplates: false,
    generateReports: true,
    manageUsers: false
  }),
  jefe_area: Object.freeze({
    viewRecords: 'own_area',
    manageEmployees: false,
    uploadDocuments: false,
    reviewDocuments: false,
    openSensitiveDocuments: false,
    manageTemplates: false,
    generateReports: false,
    manageUsers: false
  })
})

/** ¿Este nivel de acceso tiene la capacidad, aunque sea acotada? */
function can(nivelAcceso, capability) {
  const fila = PERMISSION_MATRIX[nivelAcceso]
  return Boolean(fila && fila[capability])
}

/** ¿La capacidad está limitada a su propia área? */
function isLimitedToOwnArea(nivelAcceso, capability) {
  const fila = PERMISSION_MATRIX[nivelAcceso]
  return Boolean(fila && fila[capability] === 'own_area')
}

/**
 * Filtro de área que corresponde al usuario. `{}` para RH, `{ area: <la suya> }`
 * para un jefe de área. Se combina con el filtro de alcance por cliente: para
 * un jefe de área de un cliente aplican LOS DOS (spec 8).
 */
function areaFilter(usuario) {
  if (!usuario) return {}
  if (usuario.nivelAcceso !== 'jefe_area') return {}
  if (!AREAS.includes(usuario.area)) {
    // Invariante del modelo: un jefe_area sin área válida no debe existir.
    // Si llegara a pasar, no ve nada en vez de verlo todo.
    return { area: '__sin_area__' }
  }
  return { area: usuario.area }
}

module.exports = {
  CAPABILITIES,
  PERMISSION_MATRIX,
  can,
  isLimitedToOwnArea,
  areaFilter
}
