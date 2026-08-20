const {
  CAPABILITIES,
  can,
  isLimitedToOwnArea,
  areaFilter
} = require('../../src/utils/permissions')

describe('utils/permissions — matriz del spec 8', () => {
  it('rh_admin puede todo', () => {
    for (const capacidad of Object.values(CAPABILITIES)) {
      expect(can('rh_admin', capacidad)).toBe(true)
    }
  })

  it('rh_consulta sube documentos pero no los valida ni administra usuarios', () => {
    expect(can('rh_consulta', CAPABILITIES.UPLOAD_DOCUMENTS)).toBe(true)
    expect(can('rh_consulta', CAPABILITIES.OPEN_SENSITIVE_DOCUMENTS)).toBe(true)
    expect(can('rh_consulta', CAPABILITIES.GENERATE_REPORTS)).toBe(true)
    expect(can('rh_consulta', CAPABILITIES.REVIEW_DOCUMENTS)).toBe(false)
    expect(can('rh_consulta', CAPABILITIES.MANAGE_USERS)).toBe(false)
    expect(can('rh_consulta', CAPABILITIES.MANAGE_EMPLOYEES)).toBe(false)
    expect(can('rh_consulta', CAPABILITIES.MANAGE_TEMPLATES)).toBe(false)
  })

  it('jefe_area sólo consulta, y acotado a su área', () => {
    expect(can('jefe_area', CAPABILITIES.VIEW_RECORDS)).toBe(true)
    expect(isLimitedToOwnArea('jefe_area', CAPABILITIES.VIEW_RECORDS)).toBe(true)
    expect(can('jefe_area', CAPABILITIES.UPLOAD_DOCUMENTS)).toBe(false)
    expect(can('jefe_area', CAPABILITIES.OPEN_SENSITIVE_DOCUMENTS)).toBe(false)
    expect(can('jefe_area', CAPABILITIES.GENERATE_REPORTS)).toBe(false)
  })

  it('un nivel o capacidad desconocidos no otorgan nada', () => {
    expect(can('otro_nivel', CAPABILITIES.VIEW_RECORDS)).toBe(false)
    expect(can('rh_admin', 'capacidadInventada')).toBe(false)
    expect(can(undefined, CAPABILITIES.VIEW_RECORDS)).toBe(false)
  })

  describe('areaFilter', () => {
    it('no filtra para RH', () => {
      expect(areaFilter({ nivelAcceso: 'rh_admin' })).toEqual({})
      expect(areaFilter({ nivelAcceso: 'rh_consulta' })).toEqual({})
    })

    it('filtra por el área del jefe', () => {
      expect(areaFilter({ nivelAcceso: 'jefe_area', area: 'obra' })).toEqual({
        area: 'obra'
      })
    })

    it('un jefe sin área válida no ve nada, en vez de verlo todo', () => {
      const filtro = areaFilter({ nivelAcceso: 'jefe_area', area: null })
      expect(filtro).not.toEqual({})
      expect(filtro.area).toBe('__sin_area__')
    })
  })
})
