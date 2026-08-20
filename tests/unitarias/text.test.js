const {
  normalize,
  escapeRegex,
  buildSearchFilter,
  compareNames
} = require('../../src/utils/text')

describe('utils/text — búsqueda insensible a acentos', () => {
  it('normaliza acentos, mayúsculas y espacios', () => {
    expect(normalize('  Gómez   MUÑOZ ')).toBe('gomez munoz')
    expect(normalize('José Ángel')).toBe(normalize('jose angel'))
  })

  it('devuelve cadena vacía para valores que no son texto', () => {
    expect(normalize(null)).toBe('')
    expect(normalize(42)).toBe('')
  })

  it('escapa metacaracteres para poder buscar texto libre', () => {
    expect(escapeRegex('a.b*c')).toBe('a\\.b\\*c')
    expect(() => new RegExp(escapeRegex('('))).not.toThrow()
  })

  it('construye un $or sobre los campos indicados', () => {
    const filtro = buildSearchFilter('Gómez', {
      camposNormalizados: ['nameNormalized'],
      camposDirectos: ['email']
    })
    expect(filtro.$or).toHaveLength(2)
    expect(filtro.$or[0].nameNormalized.test('juan gomez')).toBe(true)
  })

  it('sin término no filtra nada', () => {
    expect(buildSearchFilter('', { camposDirectos: ['email'] })).toBeNull()
    expect(buildSearchFilter(undefined, { camposDirectos: ['email'] })).toBeNull()
  })

  it('ordena nombres con criterio español: la ñ va después de la n', () => {
    const nombres = ['Zamora', 'Ávila', 'Ñandú', 'Núñez']
    expect([...nombres].sort(compareNames)).toEqual(['Ávila', 'Núñez', 'Ñandú', 'Zamora'])
  })

  it('ignora acentos al ordenar', () => {
    expect(compareNames('Avila', 'Ávila')).toBe(0)
    expect(compareNames('Ángel', 'Bruno')).toBeLessThan(0)
  })
})
