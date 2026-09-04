const {
  PERMISSIONS,
  PERMISSION_KEYS,
  PERMISSION_MATRIX,
  can
} = require('../../src/utils/permissions')

/**
 * Que partir los permisos no le haya cambiado nada a nadie (D-92).
 *
 * La tarea era abrir las 20 capacidades de siempre en 40 casillas por sección
 * **sin mover una sola respuesta**: ningún nivel de acceso gana ni pierde el día
 * que esto entra. Un cambio así no se comprueba leyendo la matriz nueva —se lee
 * igual de bien tenga o no un error—, así que aquí está **congelada la matriz
 * anterior**, tal como estaba antes del reparto, y el mapa de qué casilla nueva
 * heredó de cuál.
 *
 * Si esta prueba falla, hay dos lecturas y sólo una es válida:
 *
 * - **Se rompió la paridad sin querer** → el error está en `permissions.js`.
 * - **Se decidió cambiarle los permisos a un nivel** → entonces esa decisión se
 *   escribe primero en `DECISIONES.md` y se corrige aquí a propósito, no de
 *   pasada. Esta tabla es de la 44 y no debe reescribirse para «que pase».
 */

const NIVELES = ['rh_admin', 'rh_consulta', 'jefe_area']

/** Las 20 capacidades de antes, con sus valores exactos. NO se toca. */
const MATRIZ_ANTERIOR = Object.freeze({
  rh_admin: {
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
    manageAreaLeadership: true,
    manageCompanies: 'global',
    manageCategories: 'global',
    manageAreas: 'global',
    closeTemporaryAreas: true
  },
  rh_consulta: {
    viewEmployees: true,
    deactivateEmployees: false,
    manageFieldEmployees: true,
    manageAdminEmployees: false,
    manageAffiliations: false,
    uploadDocuments: true,
    reviewDocuments: true,
    openSensitiveDocuments: true,
    manageProjects: false,
    assignToProjects: false,
    manageClients: false,
    manageClientPortfolio: false,
    manageTemplates: false,
    generateReports: true,
    manageAccess: false,
    manageAreaLeadership: false,
    manageCompanies: false,
    manageCategories: false,
    manageAreas: false,
    closeTemporaryAreas: true
  },
  jefe_area: {
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
    manageClients: true,
    manageClientPortfolio: true,
    manageTemplates: false,
    generateReports: false,
    manageAccess: false,
    manageAreaLeadership: false,
    manageCompanies: false,
    manageCategories: false,
    manageAreas: false,
    closeTemporaryAreas: false
  }
})

/**
 * Qué casillas nuevas heredan de cada capacidad de antes.
 *
 * Los repartos que importan: `manageProjects` autorizaba SEIS módulos más
 * —contratos, SIROC, maquinaria, asignación de máquinas, incidencias y su
 * catálogo—, `manageClients` cargaba también los registros de obra,
 * `manageCompanies` los registros patronales, y `viewEmployees` era la llave del
 * expediente, de las adscripciones y de la bandeja de alertas.
 */
const HEREDEROS = Object.freeze({
  viewEmployees: ['viewEmployees', 'viewAffiliations', 'viewRecords', 'viewAlerts'],
  deactivateEmployees: ['deactivateEmployees'],
  manageFieldEmployees: ['manageFieldEmployees'],
  manageAdminEmployees: ['manageAdminEmployees'],
  manageAffiliations: ['manageAffiliations'],
  uploadDocuments: ['uploadDocuments'],
  reviewDocuments: ['reviewDocuments'],
  openSensitiveDocuments: ['openSensitiveDocuments'],
  manageProjects: [
    'manageProjects',
    'manageContracts',
    'manageSiroc',
    'manageMachines',
    'assignMachines',
    'manageMachineIncidents',
    'manageIncidentTypes'
  ],
  assignToProjects: ['assignToProjects'],
  manageClients: ['manageClients', 'manageWorkRegistries'],
  manageClientPortfolio: ['manageClientPortfolio'],
  manageTemplates: ['manageTemplates'],
  generateReports: ['generateReports'],
  manageAccess: ['manageAccess'],
  manageAreaLeadership: ['manageAreaLeadership'],
  manageCompanies: ['manageCompanies', 'manageEmployerRegistries'],
  manageCategories: ['manageCategories'],
  manageAreas: ['manageAreas'],
  closeTemporaryAreas: ['closeTemporaryAreas']
})

/**
 * Las ocho secciones que **no comprobaban nada para leerse**: las veía cualquiera
 * con sesión, dentro de sus empresas. Por eso su casilla nace encendida para los
 * tres niveles — apagársela a alguien es quitarle algo que hoy tiene.
 */
const LECTURA_ERA_LIBRE = Object.freeze([
  'viewProjects',
  'viewProjectStaff',
  'viewContracts',
  'viewSiroc',
  'viewMachines',
  'viewMachineIncidents',
  'viewClients',
  'viewCompanies'
])

/** Importar la nómina exigía las DOS a la vez, no una. */
const COMPUESTOS = Object.freeze({
  importEmployees: ['manageAffiliations', 'manageAdminEmployees']
})

/**
 * Casillas que **no existían**, así que nadie las tenía y nadie las pierde.
 *
 * Van aparte de todo lo demás porque la pregunta que hay que hacerse al agregar
 * una es distinta: no «¿heredó bien?» sino «¿de verdad no había forma de hacer
 * esto antes?». Si la había, la casilla nueva le está quitando algo a alguien y
 * pertenece a `HEREDEROS`, no aquí.
 */
const NACIERON_NEGADAS = Object.freeze({
  // Los roles no existían: eran tres valores cerrados en el código (D-93).
  manageRoles: 'exige administrador de plataforma'
})

const accesoDe = (nivelAcceso) => ({ nivelAcceso, alcanceGlobal: false })
const accesoGlobalDe = (nivelAcceso) => ({ nivelAcceso, alcanceGlobal: true })

describe('el reparto de permisos no le cambió nada a ningún nivel', () => {
  describe.each(NIVELES)('%s', (nivel) => {
    const anterior = MATRIZ_ANTERIOR[nivel]

    it.each(Object.keys(HEREDEROS))(
      'lo que daba %s lo dan igual sus herederos, con el mismo valor',
      (capacidadAnterior) => {
        for (const heredera of HEREDEROS[capacidadAnterior]) {
          expect({ [heredera]: PERMISSION_MATRIX[nivel][heredera] }).toEqual({
            [heredera]: anterior[capacidadAnterior]
          })
        }
      }
    )

    it('las secciones que se leían con sólo tener sesión siguen abiertas', () => {
      for (const clave of LECTURA_ERA_LIBRE) {
        expect({ [clave]: can(accesoDe(nivel), clave) }).toEqual({ [clave]: true })
      }
    })

    it.each(Object.keys(COMPUESTOS))(
      '%s responde lo mismo que las dos capacidades que exigía juntas',
      (clave) => {
        const antes = COMPUESTOS[clave].every((c) => {
          const valor = anterior[c]
          return valor === 'global' ? false : Boolean(valor)
        })
        expect(can(accesoDe(nivel), clave)).toBe(antes)
      }
    )

    it.each(Object.keys(NACIERON_NEGADAS))(
      '%s no existía antes: nadie la tenía y nadie la pierde',
      (clave) => {
        // Sin alcance global no la tiene nadie, ni siquiera `rh_admin`.
        expect(can(accesoDe(nivel), clave)).toBe(false)
      }
    )

    it('lo que exigía administrador de plataforma lo sigue exigiendo', () => {
      const globales = Object.entries(anterior)
        .filter(([, valor]) => valor === 'global')
        .flatMap(([capacidad]) => HEREDEROS[capacidad])

      for (const clave of globales) {
        expect({ [clave]: can(accesoDe(nivel), clave) }).toEqual({ [clave]: false })
        expect({ [clave]: can(accesoGlobalDe(nivel), clave) }).toEqual({
          [clave]: true
        })
      }
    })
  })

  it('cada casilla del catálogo tiene explicado de dónde salió', () => {
    const explicadas = new Set([
      ...Object.values(HEREDEROS).flat(),
      ...LECTURA_ERA_LIBRE,
      ...Object.keys(COMPUESTOS),
      ...Object.keys(NACIERON_NEGADAS)
    ])
    const huerfanas = PERMISSION_KEYS.filter((clave) => !explicadas.has(clave))

    // Una casilla nueva sin renglón aquí es una que nadie comprobó si le cambia
    // los permisos a alguien. Agrégala a HEREDEROS, a LECTURA_ERA_LIBRE, a
    // COMPUESTOS o a NACIERON_NEGADAS según de dónde venga.
    expect(huerfanas).toEqual([])
  })

  it('las 20 capacidades de antes siguen existiendo, ninguna se perdió', () => {
    const perdidas = Object.keys(HEREDEROS).filter(
      (clave) => !PERMISSION_KEYS.includes(clave)
    )
    expect(perdidas).toEqual([])
  })
})

describe('el catálogo se puede pintar sin adivinar nada', () => {
  it('cada permiso dice a qué sección pertenece y qué otros exige', () => {
    for (const permiso of PERMISSIONS) {
      expect(typeof permiso.etiqueta).toBe('string')
      expect(permiso.etiqueta.length).toBeGreaterThan(0)
      expect(typeof permiso.seccion).toBe('string')
      expect(Array.isArray(permiso.requiere)).toBe(true)
    }
  })

  it('lo que un permiso exige existe en el catálogo, y nunca es él mismo', () => {
    for (const { clave, requiere } of PERMISSIONS) {
      for (const exigido of requiere) {
        expect(PERMISSION_KEYS).toContain(exigido)
        expect(exigido).not.toBe(clave)
      }
    }
  })

  it('un nivel que tiene un permiso tiene también los que ese permiso exige', () => {
    for (const nivel of NIVELES) {
      const acceso = accesoGlobalDe(nivel)
      for (const { clave, requiere } of PERMISSIONS) {
        if (!can(acceso, clave)) continue
        for (const exigido of requiere) {
          expect({ nivel, clave, exigido, tiene: can(acceso, exigido) }).toEqual({
            nivel,
            clave,
            exigido,
            tiene: true
          })
        }
      }
    }
  })

  it('no hay claves repetidas', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length)
  })
})
