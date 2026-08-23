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

describe('utils/ids — referencias populadas o no', () => {
  const { idAString, idsAString } = require('../../src/utils/ids')
  const mongoose = require('mongoose')

  it('devuelve lo mismo con el id pelón que con el documento populado', () => {
    const id = new mongoose.Types.ObjectId()

    expect(idAString(id)).toBe(id.toString())
    // Lo que llega tras un populate(): con `.toString()` esto daba
    // "[object Object]" y se publicaba al front.
    expect(idAString({ _id: id, nombre: 'Ana' })).toBe(id.toString())
    expect(idAString(id.toString())).toBe(id.toString())
  })

  it('tolera nulos y listas', () => {
    expect(idAString(null)).toBeNull()
    expect(idAString(undefined)).toBeNull()
    expect(idsAString(null)).toEqual([])

    const uno = new mongoose.Types.ObjectId()
    const dos = new mongoose.Types.ObjectId()
    expect(idsAString([uno, { _id: dos }])).toEqual([uno.toString(), dos.toString()])
  })
})
