const {
  MODULES,
  MODULE_KEYS,
  OPTIONAL_MODULE_KEYS,
  moduleOfCapability,
  activeModuleKeys,
  isModuleOff,
  offModulesFrom,
  sectionsWithoutModule
} = require('../../src/utils/modules')
const { PERMISSIONS, PERMISSION_SECTIONS } = require('../../src/utils/permissions')

/**
 * El catálogo de módulos (D-95).
 *
 * Lo que vigila: que el mapa sección → módulo sea completo —una sección
 * huérfana dejaría rutas que ningún módulo puede apagar, y nadie lo notaría—, y
 * que lo que se guarda siga siendo lo APAGADO, que es lo que hace que las
 * empresas de antes sigan con todo sin migración.
 */
describe('El catálogo de módulos', () => {
  it('cada sección de permisos pertenece a un módulo', () => {
    expect(sectionsWithoutModule()).toEqual([])
  })

  it('ninguna sección la reclaman dos módulos', () => {
    const reclamadas = MODULES.flatMap((m) => m.secciones)
    expect(reclamadas).toHaveLength(new Set(reclamadas).size)
    expect(reclamadas.sort()).toEqual(PERMISSION_SECTIONS.map((s) => s.clave).sort())
  })

  it('por ahora la única opcional es maquinaria', () => {
    expect(OPTIONAL_MODULE_KEYS).toEqual(['maquinaria'])
  })

  it('cada casilla del catálogo de permisos cae en un módulo', () => {
    const sinModulo = PERMISSIONS.filter(({ clave }) => !moduleOfCapability(clave))
    expect(sinModulo).toEqual([])
  })

  it('las casillas de maquinaria son las que puede apagar la empresa', () => {
    const deMaquinaria = PERMISSIONS.filter(
      ({ clave }) => moduleOfCapability(clave)?.clave === 'maquinaria'
    ).map(({ clave }) => clave)

    expect(deMaquinaria).toEqual([
      'viewMachines',
      'manageMachines',
      'assignMachines',
      'viewMachineIncidents',
      'manageMachineIncidents',
      'manageIncidentTypes'
    ])
  })

  it('una casilla que no existe no tiene módulo', () => {
    expect(moduleOfCapability('inventada')).toBeNull()
  })

  describe('lo que se guarda es lo apagado', () => {
    it('una empresa sin nada apagado tiene todos los módulos', () => {
      expect(activeModuleKeys([])).toEqual(MODULE_KEYS)
      expect(activeModuleKeys(undefined)).toEqual(MODULE_KEYS)
    })

    it('lo apagado desaparece de los activos', () => {
      expect(activeModuleKeys(['maquinaria'])).not.toContain('maquinaria')
      expect(activeModuleKeys(['maquinaria'])).toHaveLength(MODULE_KEYS.length - 1)
    })

    it('los obligatorios no se pueden apagar, digan lo que digan los datos', () => {
      expect(isModuleOff(['personal'], 'personal')).toBe(false)
      expect(isModuleOff(['maquinaria'], 'maquinaria')).toBe(true)
    })

    it('la lista de activos que manda la pantalla se traduce a apagados', () => {
      // Los obligatorios se ignoran: están siempre activos, vengan o no.
      expect(offModulesFrom(['personal'])).toEqual(['maquinaria'])
      expect(offModulesFrom(['maquinaria'])).toEqual([])
      expect(offModulesFrom([])).toEqual(['maquinaria'])
    })
  })
})
