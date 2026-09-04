/**
 * Catálogo de permisos y matriz por nivel de acceso (modelo-datos §8.2). Fuente
 * única de verdad del servidor.
 *
 * El front tiene la misma matriz para apagar botones, pero **la autorización real
 * es de aquí**.
 *
 * # Un permiso por sección, y **ver también es un permiso** (D-92)
 *
 * Antes eran veinte capacidades sueltas y ocho secciones que **no comprobaban
 * nada para leerse**: proyectos, contratos, maquinaria, incidencias, clientes,
 * empresas, el personal de la obra y la importación de nómina las veía cualquiera
 * con sesión. Y `manageProjects` autorizaba, además de los proyectos, los
 * contratos, el SIROC, la maquinaria, las asignaciones, las incidencias y su
 * catálogo de tipos: quien podía lo uno podía lo otro, forzosamente.
 *
 * Ahora cada sección tiene su `viewX` y cada acción su `manageX`, y son 40
 * casillas. El reparto **no cambió el comportamiento de nadie**: los nueve `view`
 * nuevos nacieron encendidos para los tres niveles —porque leer sólo pedía
 * sesión— y los que salieron de `manageProjects`, `manageClients` y
 * `manageCompanies` heredaron su fila tal cual. `tests/unitarias/permissionsParity.test.js`
 * congela la matriz anterior y falla si alguna respuesta se movió.
 *
 * # Los metadatos son para la pantalla, no para el servidor
 *
 * `seccion`, `subseccion` y `etiqueta` los usa el front para agrupar las casillas
 * al armar un rol; `requiere` es lo que le deja avisar «para modificar hay que
 * poder ver» sin adivinarlo. El servidor **no** los interpreta: `requiere` no se
 * comprueba al autorizar —cada ruta pide la casilla que le toca— sino al guardar
 * un rol (tarea del catálogo de roles).
 *
 * # Tres clases de valor, y la diferencia importa
 *
 * - `true`  — permitido sin más.
 * - `'own_area'` — permitido, pero acotado a sus áreas dentro de cada empresa.
 *   No es un booleano: es un permiso con filtro, y se traduce a `req.areasPorEmpresa`.
 *   El filtro cuelga de `viewEmployees`: es la casilla que consultan
 *   `scopeMiddleware` y `employeeService`. Las demás lo llevan porque describen
 *   la verdad —el jefe de área ve el expediente y las alertas de SU gente—, no
 *   porque cada una filtre por su cuenta.
 * - `'global'` — exige además `acceso.alcanceGlobal` (administrador de
 *   plataforma). Es lo que protege los catálogos compartidos: dar de alta una
 *   persona o un cliente afecta a TODAS las empresas del grupo, así que no puede
 *   hacerlo el administrador de una sola.
 */

/**
 * Las 40 casillas, en el orden en que se pintan.
 *
 * `clave` es lo que viaja en el contrato y lo que compara el servidor; `etiqueta`
 * es lo único que se muestra, y por eso va en español (decisión del 4 sept 2026:
 * claves en inglés, etiquetas del catálogo).
 */
// prettier-ignore -- una casilla por renglón se lee como la tabla que es.
const PERMISSIONS = Object.freeze([
  // ── Personal ───────────────────────────────────────────────────────────────
  {
    clave: 'viewEmployees',
    etiqueta: 'Ver el personal',
    seccion: 'personal',
    subseccion: 'empleados',
    requiere: []
  },
  {
    clave: 'manageFieldEmployees',
    etiqueta: 'Dar de alta y editar personal de obra',
    seccion: 'personal',
    subseccion: 'empleados',
    requiere: ['viewEmployees']
  },
  {
    clave: 'manageAdminEmployees',
    etiqueta: 'Dar de alta y editar personal administrativo',
    seccion: 'personal',
    subseccion: 'empleados',
    requiere: ['viewEmployees']
  },
  {
    clave: 'deactivateEmployees',
    etiqueta: 'Dar de baja del sistema',
    seccion: 'personal',
    subseccion: 'empleados',
    requiere: ['viewEmployees']
  },
  {
    clave: 'importEmployees',
    etiqueta: 'Importar el archivo de nómina',
    seccion: 'personal',
    subseccion: 'empleados',
    requiere: ['viewEmployees']
  },
  {
    clave: 'viewAffiliations',
    etiqueta: 'Ver las adscripciones',
    seccion: 'personal',
    subseccion: 'adscripciones',
    requiere: ['viewEmployees']
  },
  {
    clave: 'manageAffiliations',
    etiqueta: 'Adscribir a una empresa y editar la relación laboral',
    seccion: 'personal',
    subseccion: 'adscripciones',
    requiere: ['viewAffiliations']
  },
  {
    clave: 'manageAreaLeadership',
    etiqueta: 'Decir quién dirige cada área',
    seccion: 'personal',
    subseccion: 'adscripciones',
    requiere: ['viewAffiliations']
  },

  // ── Expedientes ────────────────────────────────────────────────────────────
  {
    clave: 'viewRecords',
    etiqueta: 'Ver el expediente',
    seccion: 'expedientes',
    subseccion: null,
    requiere: ['viewEmployees']
  },
  {
    clave: 'uploadDocuments',
    etiqueta: 'Subir documentos',
    seccion: 'expedientes',
    subseccion: null,
    requiere: ['viewRecords']
  },
  {
    clave: 'reviewDocuments',
    etiqueta: 'Validar y rechazar documentos',
    seccion: 'expedientes',
    subseccion: null,
    requiere: ['viewRecords']
  },
  {
    clave: 'openSensitiveDocuments',
    etiqueta: 'Abrir los documentos sensibles',
    seccion: 'expedientes',
    subseccion: null,
    requiere: ['viewRecords']
  },

  // ── Alertas ────────────────────────────────────────────────────────────────
  {
    clave: 'viewAlerts',
    etiqueta: 'Ver la bandeja de alertas',
    seccion: 'alertas',
    subseccion: null,
    requiere: ['viewEmployees']
  },

  // ── Proyectos ──────────────────────────────────────────────────────────────
  {
    clave: 'viewProjects',
    etiqueta: 'Ver las obras',
    seccion: 'proyectos',
    subseccion: null,
    requiere: []
  },
  {
    clave: 'manageProjects',
    etiqueta: 'Crear y editar obras',
    seccion: 'proyectos',
    subseccion: null,
    requiere: ['viewProjects']
  },
  {
    clave: 'viewProjectStaff',
    etiqueta: 'Ver el personal de la obra',
    seccion: 'proyectos',
    subseccion: 'personal',
    requiere: ['viewProjects']
  },
  {
    clave: 'assignToProjects',
    etiqueta: 'Asignar personal a la obra',
    seccion: 'proyectos',
    subseccion: 'personal',
    requiere: ['viewProjectStaff', 'viewEmployees']
  },

  // ── Contratos ──────────────────────────────────────────────────────────────
  {
    clave: 'viewContracts',
    etiqueta: 'Ver los contratos y sus montos',
    seccion: 'contratos',
    subseccion: null,
    requiere: ['viewProjects']
  },
  {
    clave: 'manageContracts',
    etiqueta: 'Registrar y modificar contratos',
    seccion: 'contratos',
    subseccion: null,
    requiere: ['viewContracts']
  },
  {
    clave: 'viewSiroc',
    etiqueta: 'Ver el SIROC y sus reportes bimestrales',
    seccion: 'contratos',
    subseccion: 'siroc',
    requiere: ['viewContracts']
  },
  {
    clave: 'manageSiroc',
    etiqueta: 'Registrar el SIROC y sus reportes bimestrales',
    seccion: 'contratos',
    subseccion: 'siroc',
    requiere: ['viewSiroc']
  },

  // ── Maquinaria ─────────────────────────────────────────────────────────────
  {
    clave: 'viewMachines',
    etiqueta: 'Ver la maquinaria',
    seccion: 'maquinaria',
    subseccion: null,
    requiere: []
  },
  {
    clave: 'manageMachines',
    etiqueta: 'Dar de alta y editar máquinas',
    seccion: 'maquinaria',
    subseccion: null,
    requiere: ['viewMachines']
  },
  {
    clave: 'assignMachines',
    etiqueta: 'Asignar y devolver máquinas',
    seccion: 'maquinaria',
    subseccion: null,
    requiere: ['viewMachines']
  },
  {
    clave: 'viewMachineIncidents',
    etiqueta: 'Ver las incidencias',
    seccion: 'maquinaria',
    subseccion: 'incidencias',
    requiere: ['viewMachines']
  },
  {
    clave: 'manageMachineIncidents',
    etiqueta: 'Levantar y resolver incidencias',
    seccion: 'maquinaria',
    subseccion: 'incidencias',
    requiere: ['viewMachineIncidents']
  },
  {
    clave: 'manageIncidentTypes',
    etiqueta: 'Administrar el catálogo de tipos de incidencia',
    seccion: 'maquinaria',
    subseccion: 'incidencias',
    requiere: ['viewMachineIncidents']
  },

  // ── Clientes ───────────────────────────────────────────────────────────────
  {
    clave: 'viewClients',
    etiqueta: 'Ver los clientes',
    seccion: 'clientes',
    subseccion: null,
    requiere: []
  },
  {
    clave: 'manageClients',
    etiqueta: 'Dar de alta y editar clientes',
    seccion: 'clientes',
    subseccion: null,
    requiere: ['viewClients']
  },
  {
    clave: 'manageClientPortfolio',
    etiqueta: 'Vincular clientes a la cartera de una empresa',
    seccion: 'clientes',
    subseccion: null,
    requiere: ['viewClients']
  },
  {
    clave: 'manageWorkRegistries',
    etiqueta: 'Registrar los registros de obra',
    seccion: 'clientes',
    subseccion: 'registros_obra',
    requiere: ['viewClients']
  },

  // ── Empresas ───────────────────────────────────────────────────────────────
  {
    clave: 'viewCompanies',
    etiqueta: 'Ver las empresas',
    seccion: 'empresas',
    subseccion: null,
    requiere: []
  },
  {
    clave: 'manageCompanies',
    etiqueta: 'Dar de alta y editar empresas',
    seccion: 'empresas',
    subseccion: null,
    requiere: ['viewCompanies']
  },
  {
    clave: 'manageEmployerRegistries',
    etiqueta: 'Administrar los registros patronales',
    seccion: 'empresas',
    subseccion: 'registros_patronales',
    requiere: ['viewCompanies']
  },

  // ── Catálogos del grupo ────────────────────────────────────────────────────
  {
    clave: 'manageAreas',
    etiqueta: 'Administrar el catálogo de áreas',
    seccion: 'catalogos',
    subseccion: null,
    requiere: []
  },
  {
    clave: 'closeTemporaryAreas',
    etiqueta: 'Dar de baja las áreas temporales',
    seccion: 'catalogos',
    subseccion: null,
    requiere: []
  },
  {
    clave: 'manageCategories',
    etiqueta: 'Administrar el catálogo de puestos',
    seccion: 'catalogos',
    subseccion: null,
    requiere: []
  },

  // ── Plataforma ─────────────────────────────────────────────────────────────
  {
    clave: 'manageAccess',
    etiqueta: 'Dar y quitar accesos a la plataforma',
    seccion: 'plataforma',
    subseccion: null,
    requiere: ['viewEmployees']
  },
  {
    clave: 'manageTemplates',
    etiqueta: 'Administrar las plantillas de checklist',
    seccion: 'plataforma',
    subseccion: null,
    requiere: []
  },
  {
    clave: 'generateReports',
    etiqueta: 'Generar reportes',
    seccion: 'plataforma',
    subseccion: null,
    requiere: ['viewEmployees']
  }
])

/**
 * Las secciones, en orden y sin repetir. Es lo que agrupa la pantalla de roles.
 */
const PERMISSION_SECTIONS = Object.freeze([
  { clave: 'personal', etiqueta: 'Personal' },
  { clave: 'expedientes', etiqueta: 'Expedientes' },
  { clave: 'alertas', etiqueta: 'Alertas' },
  { clave: 'proyectos', etiqueta: 'Obras' },
  { clave: 'contratos', etiqueta: 'Contratos y SIROC' },
  { clave: 'maquinaria', etiqueta: 'Maquinaria' },
  { clave: 'clientes', etiqueta: 'Clientes' },
  { clave: 'empresas', etiqueta: 'Empresas' },
  { clave: 'catalogos', etiqueta: 'Catálogos del grupo' },
  { clave: 'plataforma', etiqueta: 'Plataforma' }
])

/**
 * `CAPABILITIES` se **deriva** del catálogo (`viewEmployees` → `VIEW_EMPLOYEES`),
 * no se escribe aparte: dos listas a mano se desincronizan, y ésta es justo la
 * que usan las rutas.
 */
const CAPABILITIES = Object.freeze(
  Object.fromEntries(
    PERMISSIONS.map(({ clave }) => [
      clave.replace(/[A-Z]/g, (letra) => `_${letra}`).toUpperCase(),
      clave
    ])
  )
)

/** Las claves, en el orden del catálogo. */
const PERMISSION_KEYS = Object.freeze(PERMISSIONS.map(({ clave }) => clave))

const PERMISSION_MATRIX = Object.freeze({
  rh_admin: Object.freeze({
    viewEmployees: true,
    manageFieldEmployees: true,
    manageAdminEmployees: true,
    deactivateEmployees: true,
    importEmployees: true,
    viewAffiliations: true,
    manageAffiliations: true,
    manageAreaLeadership: true,
    viewRecords: true,
    uploadDocuments: true,
    reviewDocuments: true,
    openSensitiveDocuments: true,
    viewAlerts: true,
    viewProjects: true,
    manageProjects: true,
    viewProjectStaff: true,
    assignToProjects: true,
    viewContracts: true,
    manageContracts: true,
    viewSiroc: true,
    manageSiroc: true,
    viewMachines: true,
    manageMachines: true,
    assignMachines: true,
    viewMachineIncidents: true,
    manageMachineIncidents: true,
    manageIncidentTypes: true,
    viewClients: true,
    manageClients: true,
    manageClientPortfolio: true,
    manageWorkRegistries: true,
    viewCompanies: true,
    manageCompanies: 'global',
    manageEmployerRegistries: 'global',
    manageAreas: 'global',
    closeTemporaryAreas: true,
    manageCategories: 'global',
    manageAccess: true,
    manageTemplates: true,
    generateReports: true
  }),
  rh_consulta: Object.freeze({
    viewEmployees: true,
    // Corrección confirmada con Urbacames: el "administrador analista" da de
    // alta personal de obra, que es la mayor parte del alta diaria, y por lo
    // tanto también lo edita.
    manageFieldEmployees: true,
    manageAdminEmployees: false,
    deactivateEmployees: false,
    // La importación exigía `manageAffiliations` Y `manageAdminEmployees` a la
    // vez, y la analista no tiene el primero: sigue sin poder importar.
    importEmployees: false,
    viewAffiliations: true,
    manageAffiliations: false,
    manageAreaLeadership: false,
    viewRecords: true,
    uploadDocuments: true,
    // Corrección confirmada con Urbacames (D-44): la analista también revisa lo
    // que ella misma sube, no sólo `rh_admin`.
    reviewDocuments: true,
    openSensitiveDocuments: true,
    viewAlerts: true,
    viewProjects: true,
    manageProjects: false,
    viewProjectStaff: true,
    assignToProjects: false,
    viewContracts: true,
    manageContracts: false,
    viewSiroc: true,
    manageSiroc: false,
    viewMachines: true,
    manageMachines: false,
    assignMachines: false,
    viewMachineIncidents: true,
    manageMachineIncidents: false,
    manageIncidentTypes: false,
    viewClients: true,
    manageClients: false,
    manageClientPortfolio: false,
    manageWorkRegistries: false,
    viewCompanies: true,
    manageCompanies: false,
    manageEmployerRegistries: false,
    manageAreas: false,
    // Cierra las obras terminadas que deja el archivo: es trabajo suyo (D-58).
    closeTemporaryAreas: true,
    manageCategories: false,
    manageAccess: false,
    manageTemplates: false,
    generateReports: true
  }),
  jefe_area: Object.freeze({
    viewEmployees: 'own_area',
    manageFieldEmployees: true,
    manageAdminEmployees: false,
    deactivateEmployees: false,
    importEmployees: false,
    viewAffiliations: 'own_area',
    manageAffiliations: false,
    manageAreaLeadership: false,
    viewRecords: 'own_area',
    uploadDocuments: false,
    reviewDocuments: false,
    openSensitiveDocuments: false,
    viewAlerts: 'own_area',
    viewProjects: true,
    manageProjects: true,
    viewProjectStaff: true,
    assignToProjects: true,
    viewContracts: true,
    manageContracts: true,
    viewSiroc: true,
    manageSiroc: true,
    viewMachines: true,
    manageMachines: true,
    assignMachines: true,
    viewMachineIncidents: true,
    manageMachineIncidents: true,
    manageIncidentTypes: true,
    viewClients: true,
    // También da de alta clientes y los vincula a la cartera de SUS empresas.
    manageClients: true,
    manageClientPortfolio: true,
    manageWorkRegistries: true,
    viewCompanies: true,
    manageCompanies: false,
    manageEmployerRegistries: false,
    manageAreas: false,
    closeTemporaryAreas: false,
    manageCategories: false,
    manageAccess: false,
    manageTemplates: false,
    generateReports: false
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
  PERMISSIONS,
  PERMISSION_SECTIONS,
  PERMISSION_KEYS,
  CAPABILITIES,
  PERMISSION_MATRIX,
  can,
  canManageEmployeeType,
  isLimitedToOwnArea,
  isPlatformAdmin
}
