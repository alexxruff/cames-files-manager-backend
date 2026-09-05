const { PERMISSION_SECTIONS, PERMISSION_BY_KEY } = require('./permissions')

/**
 * Los MÓDULOS de la plataforma: qué secciones existen en cada empresa (D-95).
 *
 * # Es un eje distinto de los permisos
 *
 * | Eje                 | Contesta                       | Es de       |
 * | ------------------- | ------------------------------ | ----------- |
 * | Permisos            | ¿qué puede hacer esta persona? | del usuario |
 * | Alcance             | ¿sobre qué empresas y áreas?   | del usuario |
 * | **Módulos activos** | ¿qué existe en esta empresa?   | de la EMPRESA |
 *
 * **Se componen:** una sección se ve si el módulo está activo en esa empresa
 * **y** la persona tiene la casilla. Apagar un módulo lo apaga para todos —el
 * administrador de plataforma incluido—; quitarle una casilla a alguien no se la
 * quita a nadie más.
 *
 * # Los valores por omisión son opuestos a propósito
 *
 * Un permiso que nadie concedió tiene que **negar**; un módulo que nadie
 * mencionó tiene que **existir**. Por eso lo que se guarda en la empresa es la
 * lista de lo que está **APAGADO** (`companies.modulosApagados`): las empresas
 * que ya existían siguen con todo sin migración, y un módulo que se construya
 * después nace encendido en todas, para que se descubra.
 *
 * # Un módulo son SECCIONES de permisos, no una lista de rutas
 *
 * Cada módulo declara las secciones del catálogo de permisos que agrupa, y de
 * ahí sale la única regla de autorización: una ruta pide su casilla, la casilla
 * pertenece a una sección, la sección a un módulo. `requireCapability` mira ese
 * módulo y saca del alcance a las empresas que lo tienen apagado, así que **no
 * hay que tocar ninguna ruta** para que una sección entera deje de responder.
 *
 * Volver opcional otro módulo más adelante es cambiar su `opcional` aquí: no se
 * toca un solo dato de ninguna empresa.
 */

/**
 * El catálogo. `clave` es lo que viaja en el contrato y lo que se guarda;
 * `etiqueta` y `descripcion` son lo único que se muestra, y por eso van en
 * español.
 */
const CATALOGO = Object.freeze([
  {
    clave: 'empresas',
    etiqueta: 'Empresas',
    descripcion: 'La empresa, sus registros patronales y su organización',
    opcional: false,
    secciones: ['empresas']
  },
  {
    clave: 'personal',
    etiqueta: 'Personal',
    descripcion: 'El catálogo de personas, sus adscripciones y las jefaturas',
    opcional: false,
    secciones: ['personal']
  },
  {
    clave: 'expedientes',
    etiqueta: 'Expedientes',
    descripcion: 'Los documentos de cada colaborador, sus vigencias y sus alertas',
    opcional: false,
    secciones: ['expedientes', 'alertas']
  },
  {
    clave: 'proyectos',
    etiqueta: 'Obras',
    descripcion: 'Las obras, su personal, sus contratos y el SIROC',
    opcional: false,
    secciones: ['proyectos', 'contratos']
  },
  {
    clave: 'clientes',
    etiqueta: 'Clientes',
    descripcion:
      'El catálogo de clientes, la cartera de la empresa y los registros de obra',
    opcional: false,
    secciones: ['clientes']
  },
  {
    clave: 'maquinaria',
    etiqueta: 'Maquinaria',
    descripcion: 'El catálogo de máquinas, sus asignaciones y sus incidencias',
    /*
     * La única opcional por ahora (decisión del usuario, 4 sept 2026): no todas
     * las empresas del grupo tienen maquinaria propia, y las que no la tienen
     * cargaban igual con la pestaña y el catálogo vacío.
     */
    opcional: true,
    secciones: ['maquinaria']
  },
  {
    clave: 'plataforma',
    etiqueta: 'Plataforma',
    descripcion: 'Los catálogos del grupo, los accesos, los roles y los reportes',
    opcional: false,
    secciones: ['catalogos', 'plataforma']
  }
])

const MODULES = Object.freeze(
  CATALOGO.map((modulo) =>
    Object.freeze({ ...modulo, secciones: Object.freeze(modulo.secciones) })
  )
)

const MODULE_BY_KEY = Object.freeze(
  Object.fromEntries(MODULES.map((modulo) => [modulo.clave, modulo]))
)

const MODULE_KEYS = Object.freeze(MODULES.map(({ clave }) => clave))

/** Los únicos que se pueden apagar, y por lo tanto lo único que se guarda. */
const OPTIONAL_MODULE_KEYS = Object.freeze(
  MODULES.filter(({ opcional }) => opcional).map(({ clave }) => clave)
)

/** Sección de permisos → módulo. Cada sección pertenece a UNO. */
const MODULE_BY_SECTION = Object.freeze(
  Object.fromEntries(
    MODULES.flatMap((modulo) => modulo.secciones.map((seccion) => [seccion, modulo]))
  )
)

/**
 * El módulo al que pertenece una casilla, o `null` si la casilla no existe.
 *
 * Es lo que consulta `requireCapability`: de la casilla que pide la ruta sale la
 * sección, y de la sección el módulo que puede estar apagado.
 */
function moduleOfCapability(capability) {
  const seccion = PERMISSION_BY_KEY[capability]?.seccion
  return seccion ? MODULE_BY_SECTION[seccion] || null : null
}

/**
 * Los módulos ACTIVOS de una empresa, en el orden del catálogo.
 *
 * @param {string[]} modulosApagados lo que la empresa tiene apagado
 * @returns {string[]} claves activas
 */
function activeModuleKeys(modulosApagados = []) {
  const apagados = new Set(modulosApagados || [])
  return MODULE_KEYS.filter((clave) => !apagados.has(clave))
}

/** ¿Está apagado este módulo en esa lista? Los obligatorios, nunca. */
function isModuleOff(modulosApagados, clave) {
  if (!MODULE_BY_KEY[clave]?.opcional) return false
  return (modulosApagados || []).includes(clave)
}

/**
 * Traduce lo que manda la pantalla —la lista de módulos ACTIVOS— a lo que se
 * guarda —la lista de apagados—.
 *
 * Los obligatorios se ignoran: están siempre activos, vengan o no en la lista.
 *
 * @param {string[]} modulosActivos
 * @returns {string[]} claves apagadas, en el orden del catálogo
 */
function offModulesFrom(modulosActivos = []) {
  const activos = new Set(modulosActivos || [])
  return OPTIONAL_MODULE_KEYS.filter((clave) => !activos.has(clave))
}

/** Las secciones del catálogo de permisos que ningún módulo reclama. */
function sectionsWithoutModule() {
  return PERMISSION_SECTIONS.map(({ clave }) => clave).filter(
    (seccion) => !MODULE_BY_SECTION[seccion]
  )
}

module.exports = {
  MODULES,
  MODULE_BY_KEY,
  MODULE_KEYS,
  MODULE_BY_SECTION,
  OPTIONAL_MODULE_KEYS,
  moduleOfCapability,
  activeModuleKeys,
  isModuleOff,
  offModulesFrom,
  sectionsWithoutModule
}
