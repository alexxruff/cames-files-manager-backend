/**
 * Matriz de permisos (modelo-datos §8.2). Fuente única de verdad del servidor.
 *
 * El front tiene la misma matriz para apagar botones, pero **la autorización real
 * es de aquí**.
 *
 * Tres clases de valor, y la diferencia importa:
 * - `true`  — permitido sin más.
 * - `'own_area'` — permitido, pero acotado a sus áreas dentro de cada empresa.
 *   No es un booleano: es un permiso con filtro, y se traduce a `req.areasPorEmpresa`.
 * - `'global'` — exige además `acceso.alcanceGlobal` (administrador de
 *   plataforma). Es lo que protege los catálogos compartidos: dar de alta una
 *   persona o un cliente afecta a TODAS las empresas del grupo, así que no puede
 *   hacerlo el administrador de una sola.
 */
const CAPABILITIES = Object.freeze({
  VIEW_EMPLOYEES: 'viewEmployees',
  /**
   * Dar de baja del sistema (y reactivar). Sigue siendo exclusivo de `rh_admin`:
   * sacar a alguien del sistema no es lo mismo que corregir sus datos.
   */
  DEACTIVATE_EMPLOYEES: 'deactivateEmployees',
  /** Crear **y editar** personal de obra. Los tres niveles pueden. */
  MANAGE_FIELD_EMPLOYEES: 'manageFieldEmployees',
  /** Crear **y editar** personal administrativo. Sólo `rh_admin`. */
  MANAGE_ADMIN_EMPLOYEES: 'manageAdminEmployees',
  MANAGE_AFFILIATIONS: 'manageAffiliations',
  UPLOAD_DOCUMENTS: 'uploadDocuments',
  REVIEW_DOCUMENTS: 'reviewDocuments',
  OPEN_SENSITIVE_DOCUMENTS: 'openSensitiveDocuments',
  MANAGE_PROJECTS: 'manageProjects',
  ASSIGN_TO_PROJECTS: 'assignToProjects',
  /**
   * Alta, edición y baja de clientes del catálogo global. Como en el personal,
   * quien puede crear puede también corregir: `rh_admin` y `jefe_area`.
   */
  MANAGE_CLIENTS: 'manageClients',
  /** Vincular un cliente a la cartera de una empresa propia. */
  MANAGE_CLIENT_PORTFOLIO: 'manageClientPortfolio',
  MANAGE_TEMPLATES: 'manageTemplates',
  GENERATE_REPORTS: 'generateReports',
  MANAGE_ACCESS: 'manageAccess',
  /** Crear empresas y categorías: afecta a todo el grupo. Exige `alcanceGlobal`. */
  MANAGE_COMPANIES: 'manageCompanies',
  MANAGE_CATEGORIES: 'manageCategories'
})

const PERMISSION_MATRIX = Object.freeze({
  rh_admin: Object.freeze({
    viewEmployees: true,
    deactivateEmployees: true,
    manageFieldEmployees: true,
    manageAdminEmployees: true,
    manageAffiliations: true,
    uploadDocuments: true,
    reviewDocuments: true,
    openSensitiveDocuments: true,
    manageProjects: true,
    assignToProjects: true,
    manageClients: true,
    manageClientPortfolio: true,
    manageTemplates: true,
    generateReports: true,
    manageAccess: true,
    manageCompanies: 'global',
    manageCategories: 'global'
  }),
  rh_consulta: Object.freeze({
    viewEmployees: true,
    deactivateEmployees: false,
    // Corrección confirmada con Urbacames: el "administrador analista" da de
    // alta personal de obra, que es la mayor parte del alta diaria, y por lo
    // tanto también lo edita.
    manageFieldEmployees: true,
    manageAdminEmployees: false,
    manageAffiliations: false,
    uploadDocuments: true,
    reviewDocuments: false,
    openSensitiveDocuments: true,
    manageProjects: false,
    assignToProjects: false,
    manageClients: false,
    manageClientPortfolio: false,
    manageTemplates: false,
    generateReports: true,
    manageAccess: false,
    manageCompanies: false,
    manageCategories: false
  }),
  jefe_area: Object.freeze({
    viewEmployees: 'own_area',
    deactivateEmployees: false,
    manageFieldEmployees: true,
    manageAdminEmployees: false,
    manageAffiliations: false,
    uploadDocuments: false,
    reviewDocuments: false,
    openSensitiveDocuments: false,
    manageProjects: true,
    assignToProjects: true,
    // También da de alta clientes y los vincula a la cartera de SUS empresas.
    manageClients: true,
    manageClientPortfolio: true,
    manageTemplates: false,
    generateReports: false,
    manageAccess: false,
    manageCompanies: false,
    manageCategories: false
  })
})

/**
 * ¿Puede **crear o editar** a un empleado de este tipo?
 *
 * No es una capacidad única: se decide por el **tipo de persona** (matriz
 * confirmada con Urbacames).
 *
 * | Quien pide | `mano_de_obra` | `administrativo` |
 * | --- | :---: | :---: |
 * | `rh_admin` | ✓ | ✓ |
 * | `rh_consulta` | ✓ | ✗ |
 * | `jefe_area` | ✓ | ✗ |
 *
 * **Quien puede dar de alta a alguien de un tipo, puede también editarlo.** Sin
 * eso, `rh_consulta` y `jefe_area` capturaban personal de obra y luego no podían
 * corregir su propio error de dedo: tenían que pedírselo a un administrador.
 *
 * Lo que NO se abre: cambiar el `tipo` a `administrativo` exige poder crear
 * administrativos, y **dar de baja del sistema sigue siendo de `rh_admin`**
 * (`DEACTIVATE_EMPLOYEES`). Corregir datos y sacar a alguien del sistema no son
 * la misma decisión.
 */
function canManageEmployeeType(acceso, tipo) {
  return tipo === 'administrativo'
    ? can(acceso, CAPABILITIES.MANAGE_ADMIN_EMPLOYEES)
    : can(acceso, CAPABILITIES.MANAGE_FIELD_EMPLOYEES)
}

/**
 * ¿Este acceso tiene la capacidad, aunque sea acotada?
 * @param {{nivelAcceso: string, alcanceGlobal?: boolean}|null|undefined} acceso
 * @param {string} capability
 */
function can(acceso, capability) {
  if (!acceso) return false
  const fila = PERMISSION_MATRIX[acceso.nivelAcceso]
  if (!fila) return false

  const valor = fila[capability]
  if (valor === 'global') return Boolean(acceso.alcanceGlobal)
  return Boolean(valor)
}

/** ¿La capacidad está limitada a sus propias áreas? */
function isLimitedToOwnArea(acceso, capability) {
  if (!acceso) return false
  return PERMISSION_MATRIX[acceso.nivelAcceso]?.[capability] === 'own_area'
}

/** ¿Es administrador de plataforma? Ve todas las empresas y los catálogos. */
function isPlatformAdmin(acceso) {
  return Boolean(acceso?.alcanceGlobal)
}

module.exports = {
  CAPABILITIES,
  PERMISSION_MATRIX,
  can,
  canManageEmployeeType,
  isLimitedToOwnArea,
  isPlatformAdmin
}
