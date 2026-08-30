const {
  findRegistry,
  normalizeRegistryNumber,
  matchesEmployerRegistry,
  employerRegistryWarning
} = require('../../../src/utils/domain')

/**
 * Registros patronales y de obra (Fase 6, G2).
 *
 * Los cuatro números son los reales de Maquinaria CAMES: 144 personas repartidas
 * entre ellos son la razón por la que esto avisa en vez de bloquear.
 */
const R13 = 'R13-77767-10-5'
const H67 = 'H67-29973-10-5'

describe('domain/registries — findRegistry', () => {
  const registros = [
    { _id: 'aaa', numero: R13, descripcion: 'Zapopan', activo: true },
    { _id: 'bbb', numero: H67, descripcion: undefined, activo: false }
  ]

  it('resuelve el subdocumento a la forma del contrato', () => {
    expect(findRegistry(registros, 'aaa')).toEqual({
      _id: 'aaa',
      numero: R13,
      descripcion: 'Zapopan',
      activo: true
    })
  })

  it('la descripción ausente sale en null, nunca en cadena vacía', () => {
    expect(findRegistry(registros, 'bbb').descripcion).toBeNull()
  })

  it('sin id, sin lista o sin coincidencia devuelve null', () => {
    expect(findRegistry(registros, null)).toBeNull()
    expect(findRegistry(registros, 'zzz')).toBeNull()
    expect(findRegistry(undefined, 'aaa')).toBeNull()
  })
})

describe('domain/registries — normalizeRegistryNumber', () => {
  it('ignora guiones, espacios y mayúsculas: es el mismo registro', () => {
    expect(normalizeRegistryNumber('r13 77767 10 5')).toBe('R1377767105')
    expect(normalizeRegistryNumber(R13)).toBe('R1377767105')
  })

  it('lo que no es texto o queda vacío es null', () => {
    expect(normalizeRegistryNumber(null)).toBeNull()
    expect(normalizeRegistryNumber('   ')).toBeNull()
    expect(normalizeRegistryNumber('---')).toBeNull()
    expect(normalizeRegistryNumber(12345)).toBeNull()
  })
})

describe('domain/registries — matchesEmployerRegistry', () => {
  it('el mismo registro capturado distinto sigue coincidiendo', () => {
    expect(matchesEmployerRegistry('r13 77767 10 5', R13)).toBe(true)
  })

  it('dos registros distintos de la misma empresa no coinciden', () => {
    expect(matchesEmployerRegistry(H67, R13)).toBe(false)
  })

  it('null —no false— cuando falta alguno de los dos: no es lo mismo', () => {
    expect(matchesEmployerRegistry(null, R13)).toBeNull()
    expect(matchesEmployerRegistry(R13, null)).toBeNull()
    expect(matchesEmployerRegistry('', '')).toBeNull()
  })
})

describe('domain/registries — employerRegistryWarning', () => {
  it('avisa, con los dos números, cuando la persona cotiza en otro', () => {
    const aviso = employerRegistryWarning({
      empleadoNombre: 'Ana Ruiz',
      registroEmpleado: R13,
      registroProyecto: H67
    })

    expect(aviso).toContain('Ana Ruiz')
    expect(aviso).toContain(R13)
    expect(aviso).toContain(H67)
    // El punto de G2: se registra igual.
    expect(aviso).toMatch(/queda registrada/i)
  })

  it('callado cuando coincide, aunque venga capturado distinto', () => {
    expect(
      employerRegistryWarning({
        empleadoNombre: 'Ana Ruiz',
        registroEmpleado: 'r13777671 05',
        registroProyecto: R13
      })
    ).toBeNull()
  })

  it('distingue "no coincide" de "no se pudo comprobar"', () => {
    const aviso = employerRegistryWarning({
      empleadoNombre: 'Ana Ruiz',
      registroEmpleado: null,
      registroProyecto: H67
    })

    expect(aviso).toMatch(/no tiene registro patronal en su adscripción/i)
    expect(aviso).toContain(H67)
  })

  it('sin registro en el proyecto no hay contra qué comparar: nada que decir', () => {
    expect(
      employerRegistryWarning({
        empleadoNombre: 'Ana Ruiz',
        registroEmpleado: R13,
        registroProyecto: null
      })
    ).toBeNull()
  })
})
