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
/**
 * Dos propiedades del PERMISO que antes eran valores de la matriz por nivel
 * (D-93). Salieron de ahí porque un rol es una **lista de casillas marcadas**, y
 * una lista no puede llevar tres valores por casilla.
 *
 * - `exigeAlcanceGlobal` — la acción afecta a TODO el grupo, así que además de
 *   tener la casilla hay que ser administrador de plataforma. Es propiedad de la
 *   acción, no de quien la tiene: crear una empresa afecta al grupo lo haga
 *   quien lo haga. Antes era el valor `'global'`, y sólo lo tenía `rh_admin`.
 * - `acotableAAreas` — la casilla puede quedar limitada a las áreas que la
 *   persona dirige, si su rol lo dice (`soloSusAreas`). Antes era el valor
 *   `'own_area'`, y sólo lo tenía `jefe_area`.
 *
 * Ninguna de las dos cambia lo que puede nadie: ver D-93 y la prueba de paridad.
 */
const EXIGEN_ALCANCE_GLOBAL = Object.freeze([
  'manageCompanies',
  'manageEmployerRegistries',
  'manageAreas',
  'manageCategories',
  'manageRoles'
])

const ACOTABLES_A_AREAS = Object.freeze([
  'viewEmployees',
  'viewAffiliations',
  'viewRecords',
  'viewAlerts'
])

const CATALOGO = Object.freeze([
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
    clave: 'manageRoles',
    etiqueta: 'Crear y editar roles',
    seccion: 'plataforma',
    subseccion: null,
    /*
     * Exige `manageAccess` porque un rol se arma para dárselo a alguien, y exige
     * además ser administrador de plataforma (`exigeAlcanceGlobal`): un rol vale
     * para todo el grupo. Administrar accesos NO alcanza — decisión del usuario,
     * 4 sept 2026: repartir accesos y decidir qué puede un perfil son dos cosas.
     */
    requiere: ['manageAccess']
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
 * El catálogo publicado: cada casilla con sus dos banderas ya resueltas, para que
 * nadie tenga que cruzar tres listas para saber qué exige una.
 */
const PERMISSIONS = Object.freeze(
  CATALOGO.map((permiso) =>
    Object.freeze({
      ...permiso,
      exigeAlcanceGlobal: EXIGEN_ALCANCE_GLOBAL.includes(permiso.clave),
      acotableAAreas: ACOTABLES_A_AREAS.includes(permiso.clave)
    })
  )
)

/** Por clave, para no recorrer 41 objetos en cada `can`. */
const PERMISSION_BY_KEY = Object.freeze(
  Object.fromEntries(PERMISSIONS.map((permiso) => [permiso.clave, permiso]))
)

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
    // Nace exigiendo alcance global: un rol vale para todo el grupo (D-93).
    manageRoles: 'global',
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
    manageRoles: false,
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
    manageRoles: false,
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
 * Una copia PLANA de un acceso, con el rol que se le quiera imponer.
 *
 * Existe por una trampa concreta: `acceso` suele ser un **subdocumento de
 * Mongoose**, y `{ ...acceso }` no copia sus campos —devuelve `$__`, `_doc` y
 * compañía—, así que `nivelAcceso` y `permisosExtra` salían `undefined` y el
 * respaldo por nivel contestaba que no a todo. Sólo se notaba cuando NO había
 * rol, que es justo el caso que el respaldo existe para cubrir.
 */
function accesoPlano(acceso, rolId) {
  return {
    nivelAcceso: acceso.nivelAcceso,
    alcanceGlobal: acceso.alcanceGlobal,
    permisosExtra: acceso.permisosExtra || [],
    rolId
  }
}

/**
 * El rol resuelto de un acceso, o `null` si no trae.
 *
 * `acceso.rolId` llega **poblado** desde `protect`, que lo trae en la misma
 * consulta con la que ya releía al empleado. Si es un `ObjectId` sin poblar
 * —alguien llamó a `can` con un empleado leído a mano—, no hay rol que leer y se
 * responde por la matriz, que es el camino seguro.
 */
function rolDe(acceso) {
  const rol = acceso?.rolId
  return rol && typeof rol === 'object' && Array.isArray(rol.permisos) ? rol : null
}

/**
 * ¿Este acceso tiene la capacidad, aunque sea acotada?
 *
 * **Dos caminos, y el orden importa** (D-93):
 *
 * 1. **Con rol** —lo normal desde que los roles son dato—: la casilla sale del
 *    rol, o de las excepciones de la persona, que son **sólo aditivas**. Encima,
 *    lo que `exigeAlcanceGlobal` sigue exigiéndolo.
 * 2. **Sin rol**: se responde por `PERMISSION_MATRIX` según `nivelAcceso`,
 *    exactamente como antes de que los roles existieran.
 *
 * El segundo camino **no es transitorio**. Es lo que hace que la migración no sea
 * un despliegue bloqueante, y que un acceso creado por un script viejo —o por una
 * prueba que arma un `acceso` a mano— nunca se quede sin permisos por un campo
 * que nadie llenó. Los tres roles sembrados se derivan de esa misma matriz, así
 * que los dos caminos contestan lo mismo.
 *
 * @param {{nivelAcceso: string, alcanceGlobal?: boolean, rolId?: object,
 *          permisosExtra?: string[]}|null|undefined} acceso
 * @param {string} capability
 */
function can(acceso, capability) {
  if (!acceso) return false

  /*
   * Las excepciones se miran en los DOS caminos, no sólo en el del rol. Sólo
   * suman, así que no hay nada que puedan romper — y si sólo valieran con rol,
   * dárselas a alguien que todavía no tiene uno se guardaría y no haría nada:
   * un permiso que se ve en la ficha y no funciona.
   */
  const porExcepcion = (acceso.permisosExtra || []).includes(capability)

  const rol = rolDe(acceso)
  if (rol) {
    if (rol.activo === false && !porExcepcion) return false

    const tiene =
      Boolean(rol.todosLosPermisos) || rol.permisos.includes(capability) || porExcepcion

    return tiene && cumpleAlcance(acceso, capability)
  }

  const fila = PERMISSION_MATRIX[acceso.nivelAcceso]
  if (!fila) return porExcepcion && cumpleAlcance(acceso, capability)

  const valor = fila[capability]
  if (valor === 'global') return Boolean(acceso.alcanceGlobal)
  if (valor) return true

  return porExcepcion && cumpleAlcance(acceso, capability)
}

/**
 * La condición que se comprueba ENCIMA de tener la casilla: lo que afecta a todo
 * el grupo exige además ser administrador de plataforma. Y una clave que no está
 * en el catálogo no existe, la tenga quien la tenga.
 */
function cumpleAlcance(acceso, capability) {
  const permiso = PERMISSION_BY_KEY[capability]
  if (!permiso) return false
  return permiso.exigeAlcanceGlobal ? Boolean(acceso.alcanceGlobal) : true
}

/**
 * ¿La capacidad está limitada a sus propias áreas?
 *
 * Con rol, son dos condiciones: que el rol sea de los que ven **sólo sus áreas**
 * y que la casilla sea de las que se pueden acotar. Sin las dos, acotar
 * `manageProjects` —que nunca estuvo acotado— habría cambiado el alcance de un
 * jefe de área sin que nadie lo pidiera.
 */
function isLimitedToOwnArea(acceso, capability) {
  if (!acceso) return false

  const rol = rolDe(acceso)
  if (rol) {
    return (
      Boolean(rol.soloSusAreas) &&
      Boolean(PERMISSION_BY_KEY[capability]?.acotableAAreas) &&
      can(acceso, capability)
    )
  }

  return PERMISSION_MATRIX[acceso.nivelAcceso]?.[capability] === 'own_area'
}

/**
 * Las casillas de un acceso, con **de dónde le viene cada una**.
 *
 * Es lo que contesta «¿por qué ve esto?» sin que nadie tenga que cruzar el rol
 * con las excepciones a mano. `origen` sólo puede ser `'rol'` o `'excepcion'`
 * porque las excepciones son aditivas: no existe «el rol menos algo», y por eso
 * siempre hay una respuesta.
 *
 * @returns {Array<{clave: string, origen: 'rol'|'excepcion'}>}
 */
function permissionsOf(acceso) {
  if (!acceso) return []

  const rol = rolDe(acceso)
  const extras = new Set(acceso.permisosExtra || [])
  // El mismo acceso sin sus excepciones: sirve para saber qué le daba la base.
  const sinExcepciones = { ...accesoPlano(acceso, rol), permisosExtra: [] }

  return PERMISSIONS.filter(({ clave }) => can(acceso, clave)).map(({ clave }) => ({
    clave,
    /*
     * `'excepcion'` sólo si la casilla NO la daba ya lo de base —su rol, o su
     * nivel de acceso si todavía no tiene rol—. Si las dos la dan, el origen es
     * la base: quitarle la excepción no se la quitaría, y decir «excepción»
     * mentiría sobre lo que pasaría al quitarla.
     */
    origen: extras.has(clave) && !can(sinExcepciones, clave) ? 'excepcion' : 'rol'
  }))
}

/**
 * Las claves que trae un acceso **en una empresa concreta** (D-94).
 *
 * La cadena de respaldo, en orden, y cada eslabón sólo entra si falta el
 * anterior:
 *
 * 1. **El rol de esa empresa** (`adscripciones.rolId`) — jefe de área en la
 *    constructora y sólo consulta en la de maquinaria.
 * 2. **Su rol base** (`acceso.rolId`), si la adscripción no dice ninguno. Es lo
 *    normal: quien no use el rol por empresa no nota nada.
 * 3. **Su `nivelAcceso`** contra la matriz, si tampoco tiene rol base. El mismo
 *    respaldo de D-93, que es lo que hace que las migraciones no bloqueen.
 *
 * Las **excepciones son de la persona** (`acceso.permisosExtra`) y valen en
 * todas sus empresas: se le dieron a ella, no a su puesto en una de ellas.
 *
 * @param {object} acceso
 * @param {{rolDeLaEmpresa?: object|null}} [opciones]
 * @returns {string[]} claves, en el orden del catálogo
 */
function permissionKeysOf(acceso, { rolDeLaEmpresa = null } = {}) {
  if (!acceso) return []

  const rol =
    rolDeLaEmpresa && Array.isArray(rolDeLaEmpresa.permisos)
      ? rolDeLaEmpresa
      : acceso.rolId

  const efectivo = accesoPlano(acceso, rol)
  return PERMISSIONS.filter(({ clave }) => can(efectivo, clave)).map(({ clave }) => clave)
}

/**
 * Las casillas que faltan para que esta lista sea coherente: por cada una
 * marcada, las que `requiere` y no están.
 *
 * Se usa al **guardar un rol**, no al autorizar: cada ruta pide la casilla que le
 * toca y no le importa el resto. Un rol que puede modificar máquinas pero no
 * verlas no es ilegal, es un error de captura, y se atrapa donde se captura.
 *
 * @returns {Array<{clave: string, requiere: string}>}
 */
function missingRequirements(claves) {
  const marcadas = new Set(claves)
  const faltantes = []

  for (const clave of claves) {
    for (const exigida of PERMISSION_BY_KEY[clave]?.requiere || []) {
      if (!marcadas.has(exigida)) faltantes.push({ clave, requiere: exigida })
    }
  }

  return faltantes
}

/** ¿Es administrador de plataforma? Ve todas las empresas y los catálogos. */
function isPlatformAdmin(acceso) {
  return Boolean(acceso?.alcanceGlobal)
}

module.exports = {
  PERMISSIONS,
  PERMISSION_BY_KEY,
  permissionsOf,
  permissionKeysOf,
  missingRequirements,
  PERMISSION_SECTIONS,
  PERMISSION_KEYS,
  CAPABILITIES,
  PERMISSION_MATRIX,
  can,
  canManageEmployeeType,
  isLimitedToOwnArea,
  isPlatformAdmin
}
