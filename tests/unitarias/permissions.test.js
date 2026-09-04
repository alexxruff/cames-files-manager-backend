const {
  CAPABILITIES,
  can,
  canManageEmployeeType,
  isLimitedToOwnArea,
  isPlatformAdmin
} = require('../../src/utils/permissions')

const admin = { nivelAcceso: 'rh_admin' }
const adminPlataforma = { nivelAcceso: 'rh_admin', alcanceGlobal: true }
const consulta = { nivelAcceso: 'rh_consulta' }
const jefe = { nivelAcceso: 'jefe_area' }

describe('utils/permissions — matriz de modelo-datos §8.2', () => {
  const SOLO_GLOBALES = [
    CAPABILITIES.MANAGE_COMPANIES,
    // Los registros patronales se separaron de la empresa (D-92) pero siguen
    // donde estaban: son estructura del grupo, no dato operativo.
    CAPABILITIES.MANAGE_EMPLOYER_REGISTRIES,
    CAPABILITIES.MANAGE_CATEGORIES,
    // Administrar el catálogo de áreas afecta a todo el grupo, igual (D-58).
    CAPABILITIES.MANAGE_AREAS,
    // Y armar roles, que valen para todo el grupo (D-93). Administrar accesos
    // NO alcanza: repartir accesos y definir perfiles no son el mismo trabajo.
    CAPABILITIES.MANAGE_ROLES
  ]

  it('rh_admin puede todo dentro de su empresa', () => {
    for (const capacidad of Object.values(CAPABILITIES)) {
      if (SOLO_GLOBALES.includes(capacidad)) continue
      expect(can(admin, capacidad)).toBe(true)
    }
  })

  it('crear empresas y categorías exige alcance global, no sólo ser rh_admin', () => {
    // Una empresa o una categoría nuevas afectan a TODO el grupo.
    for (const capacidad of SOLO_GLOBALES) {
      expect(can(admin, capacidad)).toBe(false)
      expect(can(adminPlataforma, capacidad)).toBe(true)
    }
    expect(isPlatformAdmin(admin)).toBe(false)
    expect(isPlatformAdmin(adminPlataforma)).toBe(true)
  })

  describe('alta y edición de personal, por tipo (corrección de Urbacames)', () => {
    it('los tres niveles pueden dar de alta Y EDITAR personal de obra', () => {
      for (const acceso of [adminPlataforma, admin, consulta, jefe]) {
        expect(canManageEmployeeType(acceso, 'mano_de_obra')).toBe(true)
      }
    })

    it('sólo rh_admin puede dar de alta o editar personal administrativo', () => {
      expect(canManageEmployeeType(adminPlataforma, 'administrativo')).toBe(true)
      expect(canManageEmployeeType(admin, 'administrativo')).toBe(true)
      expect(canManageEmployeeType(consulta, 'administrativo')).toBe(false)
      expect(canManageEmployeeType(jefe, 'administrativo')).toBe(false)
    })

    it('sin acceso no se puede crear ni editar nada', () => {
      expect(canManageEmployeeType(null, 'mano_de_obra')).toBe(false)
    })

    it('pero dar de baja del sistema sigue siendo sólo de rh_admin', () => {
      // Corregir datos y sacar a alguien del sistema no son la misma decisión.
      expect(can(admin, CAPABILITIES.DEACTIVATE_EMPLOYEES)).toBe(true)
      expect(can(consulta, CAPABILITIES.DEACTIVATE_EMPLOYEES)).toBe(false)
      expect(can(jefe, CAPABILITIES.DEACTIVATE_EMPLOYEES)).toBe(false)
    })
  })

  it('el reparto de D-92 no le movió nada a ningún nivel', () => {
    /*
     * La comprobación de verdad está en `permissionsParity.test.js`, que congela
     * la matriz anterior entera. Aquí queda el caso que motivó partirla: quien
     * gestionaba proyectos gestionaba también contratos, SIROC y maquinaria, y
     * ahora son casillas que se pueden dar por separado.
     */
    for (const nivel of [admin, consulta, jefe]) {
      const proyectos = can(nivel, CAPABILITIES.MANAGE_PROJECTS)
      expect(can(nivel, CAPABILITIES.MANAGE_CONTRACTS)).toBe(proyectos)
      expect(can(nivel, CAPABILITIES.MANAGE_SIROC)).toBe(proyectos)
      expect(can(nivel, CAPABILITIES.MANAGE_MACHINES)).toBe(proyectos)
      expect(can(nivel, CAPABILITIES.ASSIGN_MACHINES)).toBe(proyectos)
      expect(can(nivel, CAPABILITIES.MANAGE_MACHINE_INCIDENTS)).toBe(proyectos)
      expect(can(nivel, CAPABILITIES.MANAGE_INCIDENT_TYPES)).toBe(proyectos)
    }
  })

  it('ver una sección es su propia casilla, y las ocho abiertas siguen abiertas', () => {
    for (const nivel of [admin, consulta, jefe]) {
      for (const capacidad of [
        CAPABILITIES.VIEW_PROJECTS,
        CAPABILITIES.VIEW_PROJECT_STAFF,
        CAPABILITIES.VIEW_CONTRACTS,
        CAPABILITIES.VIEW_SIROC,
        CAPABILITIES.VIEW_MACHINES,
        CAPABILITIES.VIEW_MACHINE_INCIDENTS,
        CAPABILITIES.VIEW_CLIENTS,
        CAPABILITIES.VIEW_COMPANIES
      ]) {
        expect(can(nivel, capacidad)).toBe(true)
      }
    }
  })

  it('el expediente se puede negar a quien sí ve a la persona', () => {
    // Hoy no hay ningún nivel así —los tres ven las dos cosas—, pero la casilla
    // ya existe: es lo que hace armable al auxiliar de operaciones (D-92).
    expect(CAPABILITIES.VIEW_RECORDS).not.toBe(CAPABILITIES.VIEW_EMPLOYEES)
    expect(can(jefe, CAPABILITIES.VIEW_RECORDS)).toBe(true)
    expect(isLimitedToOwnArea(jefe, CAPABILITIES.VIEW_RECORDS)).toBe(true)
  })

  it('importar la nómina es una casilla, no dos capacidades juntas', () => {
    expect(can(admin, CAPABILITIES.IMPORT_EMPLOYEES)).toBe(true)
    expect(can(consulta, CAPABILITIES.IMPORT_EMPLOYEES)).toBe(false)
    expect(can(jefe, CAPABILITIES.IMPORT_EMPLOYEES)).toBe(false)
  })

  it('el jefe de área también da de alta clientes y gestiona su cartera', () => {
    expect(can(jefe, CAPABILITIES.MANAGE_CLIENTS)).toBe(true)
    expect(can(jefe, CAPABILITIES.MANAGE_CLIENT_PORTFOLIO)).toBe(true)
    // rh_consulta no.
    expect(can(consulta, CAPABILITIES.MANAGE_CLIENTS)).toBe(false)
  })

  it('adscribir sigue siendo exclusivo de rh_admin', () => {
    expect(can(admin, CAPABILITIES.MANAGE_AFFILIATIONS)).toBe(true)
    expect(can(consulta, CAPABILITIES.MANAGE_AFFILIATIONS)).toBe(false)
    expect(can(jefe, CAPABILITIES.MANAGE_AFFILIATIONS)).toBe(false)
  })

  it('rh_consulta sube y revisa documentos, pero no administra accesos (D-44)', () => {
    expect(can(consulta, CAPABILITIES.VIEW_EMPLOYEES)).toBe(true)
    expect(can(consulta, CAPABILITIES.UPLOAD_DOCUMENTS)).toBe(true)
    expect(can(consulta, CAPABILITIES.REVIEW_DOCUMENTS)).toBe(true)
    expect(can(consulta, CAPABILITIES.OPEN_SENSITIVE_DOCUMENTS)).toBe(true)
    expect(can(consulta, CAPABILITIES.GENERATE_REPORTS)).toBe(true)

    expect(can(consulta, CAPABILITIES.MANAGE_ACCESS)).toBe(false)
    expect(can(consulta, CAPABILITIES.DEACTIVATE_EMPLOYEES)).toBe(false)
    expect(can(consulta, CAPABILITIES.MANAGE_AFFILIATIONS)).toBe(false)
    expect(can(consulta, CAPABILITIES.MANAGE_PROJECTS)).toBe(false)
    expect(can(consulta, CAPABILITIES.MANAGE_CLIENT_PORTFOLIO)).toBe(false)
  })

  it('jefe_area ve acotado a sus áreas y manda en proyectos', () => {
    expect(can(jefe, CAPABILITIES.VIEW_EMPLOYEES)).toBe(true)
    expect(isLimitedToOwnArea(jefe, CAPABILITIES.VIEW_EMPLOYEES)).toBe(true)

    // Novedad del modelo nuevo: el jefe de área sí gestiona proyectos.
    expect(can(jefe, CAPABILITIES.MANAGE_PROJECTS)).toBe(true)
    expect(can(jefe, CAPABILITIES.ASSIGN_TO_PROJECTS)).toBe(true)

    expect(can(jefe, CAPABILITIES.UPLOAD_DOCUMENTS)).toBe(false)
    expect(can(jefe, CAPABILITIES.REVIEW_DOCUMENTS)).toBe(false)
    expect(can(jefe, CAPABILITIES.OPEN_SENSITIVE_DOCUMENTS)).toBe(false)
    expect(can(jefe, CAPABILITIES.GENERATE_REPORTS)).toBe(false)
    expect(can(jefe, CAPABILITIES.MANAGE_ACCESS)).toBe(false)
  })

  it('sólo rh_admin administra accesos', () => {
    expect(can(admin, CAPABILITIES.MANAGE_ACCESS)).toBe(true)
    expect(can(consulta, CAPABILITIES.MANAGE_ACCESS)).toBe(false)
    expect(can(jefe, CAPABILITIES.MANAGE_ACCESS)).toBe(false)
  })

  it('un nivel, una capacidad o un acceso inexistentes no otorgan nada', () => {
    expect(can({ nivelAcceso: 'superadmin' }, CAPABILITIES.VIEW_EMPLOYEES)).toBe(false)
    expect(can(admin, 'capacidadInventada')).toBe(false)
    expect(can(null, CAPABILITIES.VIEW_EMPLOYEES)).toBe(false)
    expect(can(undefined, CAPABILITIES.VIEW_EMPLOYEES)).toBe(false)
    expect(isLimitedToOwnArea(null, CAPABILITIES.VIEW_EMPLOYEES)).toBe(false)
  })

  it('el alcance global no otorga capacidades que su nivel no tenga', () => {
    // Un rh_consulta con alcanceGlobal (que el modelo no permite) tampoco
    // podría administrar accesos: el nivel manda, el alcance sólo amplía el
    // universo de datos.
    const raro = { nivelAcceso: 'rh_consulta', alcanceGlobal: true }
    expect(can(raro, CAPABILITIES.MANAGE_ACCESS)).toBe(false)
    expect(can(raro, CAPABILITIES.MANAGE_COMPANIES)).toBe(false)
    expect(can(raro, CAPABILITIES.MANAGE_CATEGORIES)).toBe(false)
  })
})
