const Role = require('../api/v1/roles/roleModel')
const logger = require('../utils/logger')
const { normalize } = require('../utils/text')
const { PERMISSION_MATRIX, PERMISSION_KEYS } = require('../utils/permissions')
const { ACCESS_LEVEL_LABELS } = require('../constants')

/**
 * Siembra los tres roles de sistema (D-93). Idempotente: corre en cada arranque,
 * igual que las áreas y los tipos de incidencia.
 *
 * # Se DERIVAN de la matriz, no se escriben a mano
 *
 * Es lo único que garantiza que nazcan diciendo **exactamente** lo que decían los
 * tres niveles de acceso. Una lista escrita a mano aquí sería una cuarta copia de
 * la misma tabla —después de la matriz, la de §8.2 y la del front— y la que se
 * desincronizara en silencio: nadie revisa una semilla.
 *
 * Por eso `PERMISSION_MATRIX` no desapareció al volverse dato los roles. Cambió
 * de trabajo: dejó de ser la autoridad de cada petición y pasó a ser **la
 * semilla**, más el respaldo de quien todavía no tiene rol.
 *
 * # Las dos banderas
 *
 * - `rh_admin` nace con `todosLosPermisos`, no con sus 41 casillas marcadas: es
 *   el administrador de plataforma y tiene que alcanzar también los permisos que
 *   se agreguen después. Lo que exige alcance global se lo sigue exigiendo el
 *   catálogo, así que «todos» no significa «sin condiciones».
 * - `jefe_area` nace con `soloSusAreas`, que es lo que era su `'own_area'`.
 */
const ROLES_DE_SISTEMA = Object.freeze([
  {
    nivelAcceso: 'rh_admin',
    descripcion:
      'Ve y hace todo. Los catálogos del grupo le exigen además ser administrador de plataforma.',
    todosLosPermisos: true
  },
  {
    nivelAcceso: 'rh_consulta',
    descripcion:
      'Captura personal de obra, sube y revisa documentos, y consulta el resto sin modificarlo.',
    todosLosPermisos: false
  },
  {
    nivelAcceso: 'jefe_area',
    descripcion:
      'Maneja obras, contratos y maquinaria; de su gente ve sólo las áreas que dirige.',
    todosLosPermisos: false,
    soloSusAreas: true
  }
])

/** Las casillas que el nivel tenía encendidas, acotadas o no. */
function permisosDelNivel(nivelAcceso) {
  const fila = PERMISSION_MATRIX[nivelAcceso] || {}
  return PERMISSION_KEYS.filter((clave) => fila[clave] !== false && fila[clave] != null)
}

/**
 * `{ rh_admin: <Role>, … }` — el rol de sistema de cada nivel, creándolo si falta.
 *
 * **No toca lo que ya existe.** Si alguien le cambió los permisos al rol de
 * consulta, un arranque no debería deshacerlo: para eso está la pantalla.
 */
async function ensureSystemRoles() {
  const creados = []
  const porNivel = {}

  for (const plantilla of ROLES_DE_SISTEMA) {
    const nombre = ACCESS_LEVEL_LABELS[plantilla.nivelAcceso]
    const existente = await Role.findOne({
      nombreNormalizado: normalize(nombre),
      empresaId: null
    })

    if (existente) {
      porNivel[plantilla.nivelAcceso] = existente
      continue
    }

    porNivel[plantilla.nivelAcceso] = await Role.create({
      nombre,
      descripcion: plantilla.descripcion,
      permisos: permisosDelNivel(plantilla.nivelAcceso),
      empresaId: null,
      esSistema: true,
      todosLosPermisos: Boolean(plantilla.todosLosPermisos),
      soloSusAreas: Boolean(plantilla.soloSusAreas)
    })
    creados.push(nombre)
  }

  if (creados.length > 0) logger.info('Roles de sistema sembrados', { creados })

  return { creados, porNivel }
}

module.exports = { ensureSystemRoles, ROLES_DE_SISTEMA, permisosDelNivel }
