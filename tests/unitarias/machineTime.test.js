const {
  stintDays,
  stintToJson,
  accumulateByEmployee
} = require('../../src/utils/domain/machineTime')

/**
 * El tiempo de la máquina (D-87), sin base de datos.
 *
 * Lo que se vigila aquí es lo que es fácil equivocar y caro descubrir tarde: que
 * los días sean **inclusivos** —quien renta maquinaria cuenta el día de entrega
 * y el de devolución—, que el tramo vigente crezca solo hasta hoy, y que un
 * tramo sin trabajador no le sume días a nadie.
 */
describe('stintDays', () => {
  it('cuenta el día de entrega y el de devolución', () => {
    expect(stintDays('2026-09-01', { fechaDevolucion: '2026-09-10' })).toBe(10)
  })

  it('entregada y devuelta el mismo día es un día, no cero', () => {
    expect(stintDays('2026-09-01', { fechaDevolucion: '2026-09-01' })).toBe(1)
  })

  it('el tramo vigente cuenta hasta hoy', () => {
    expect(stintDays('2026-09-01', { hoy: '2026-09-03' })).toBe(3)
  })

  it('un tramo que todavía no empieza no da días negativos', () => {
    expect(stintDays('2026-09-30', { hoy: '2026-09-03' })).toBe(0)
  })

  it('sin fecha de inicio no hay días que contar', () => {
    expect(stintDays(null)).toBeNull()
  })
})

describe('stintToJson', () => {
  const tramo = (extra = {}) => ({
    _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    maquinaId: 'mmmmmmmmmmmmmmmmmmmmmmmm',
    empleadoId: { _id: 'eeeeeeeeeeeeeeeeeeeeeeee', nombre: 'Juan Pérez' },
    proyectoId: { _id: 'pppppppppppppppppppppppp', nombre: 'Fraccionamiento Sur' },
    asignacionId: 'ssssssssssssssssssssssss',
    fechaAsignacion: '2026-09-01',
    fechaDevolucion: null,
    motivoCierre: null,
    activo: true,
    ...extra
  })

  it('resuelve los nombres del empleado y de la obra', () => {
    expect(stintToJson(tramo(), { hoy: '2026-09-03' })).toMatchObject({
      empleadoId: 'eeeeeeeeeeeeeeeeeeeeeeee',
      empleadoNombre: 'Juan Pérez',
      proyectoId: 'pppppppppppppppppppppppp',
      proyectoNombre: 'Fraccionamiento Sur',
      vigente: true,
      dias: 3,
      motivoCierre: null,
      motivoCierreTexto: null
    })
  })

  it('un tramo sin trabajador dice la obra y deja al empleado en null', () => {
    const json = stintToJson(tramo({ empleadoId: null }), { hoy: '2026-09-03' })

    expect(json.empleadoId).toBeNull()
    expect(json.empleadoNombre).toBeNull()
    // Pero sigue en su obra: eso es justo lo que este estado significa.
    expect(json.proyectoNombre).toBe('Fraccionamiento Sur')
  })

  it('el motivo del cierre viaja también en texto, listo para mostrar', () => {
    const json = stintToJson(
      tramo({
        activo: false,
        fechaDevolucion: '2026-09-05',
        motivoCierre: 'salida_de_obra'
      })
    )

    expect(json.vigente).toBe(false)
    expect(json.motivoCierreTexto).toBe('El trabajador salió de la obra')
    expect(json.dias).toBe(5)
  })
})

describe('accumulateByEmployee', () => {
  const usos = [
    { empleadoId: 'a', empleadoNombre: 'Ana', dias: 10 },
    { empleadoId: 'b', empleadoNombre: 'Beto', dias: 30 },
    { empleadoId: 'a', empleadoNombre: 'Ana', dias: 25 },
    // Sin trabajador: la máquina estuvo en la obra, pero no en manos de nadie.
    { empleadoId: null, empleadoNombre: null, dias: 100 }
  ]

  it('suma por trabajador y ordena por quién la ha usado más', () => {
    expect(accumulateByEmployee(usos)).toEqual([
      { empleadoId: 'a', empleadoNombre: 'Ana', tramos: 2, dias: 35 },
      { empleadoId: 'b', empleadoNombre: 'Beto', tramos: 1, dias: 30 }
    ])
  })

  it('los tramos sin trabajador no le suman a nadie', () => {
    const total = accumulateByEmployee(usos).reduce((suma, t) => suma + t.dias, 0)
    expect(total).toBe(65)
  })

  it('sin tramos, la lista viene vacía', () => {
    expect(accumulateByEmployee([])).toEqual([])
  })
})
