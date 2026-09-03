const {
  stintAt,
  incidentContext,
  incidentToJson
} = require('../../../src/utils/domain/machineIncidents')

/**
 * De quién era la máquina cuando pasó la incidencia (D-88).
 *
 * Lo que se vigila aquí es que el contexto se DERIVE bien de la historia: el día
 * del cambio de manos, el hueco en que la máquina estaba en el patio, y la obra
 * sin operador. Sin base de datos y con fechas fijas: son casos que se
 * equivocan al escribirlos, no al desplegarlos.
 */

/** Un tramo en la forma en que sale de `stintToJson`. */
const tramo = (datos) => ({
  _id: datos._id,
  maquinaId: 'maq',
  empleadoId: datos.empleadoId ?? null,
  empleadoNombre: datos.empleadoNombre ?? null,
  proyectoId: datos.proyectoId ?? 'obra-1',
  proyectoNombre: datos.proyectoNombre ?? 'Obra Norte',
  asignacionId: null,
  fechaAsignacion: datos.fechaAsignacion,
  fechaDevolucion: datos.fechaDevolucion ?? null,
  motivoCierre: datos.motivoCierre ?? null,
  motivoCierreTexto: null,
  vigente: datos.vigente ?? false,
  dias: 1
})

/** Juan la tuvo del 1 al 10; Pedro la tiene desde el 10, sin cerrar. */
const HISTORIA = [
  tramo({
    _id: 't2',
    empleadoId: 'pedro',
    empleadoNombre: 'Pedro Ruiz',
    fechaAsignacion: '2026-08-10',
    vigente: true
  }),
  tramo({
    _id: 't1',
    empleadoId: 'juan',
    empleadoNombre: 'Juan Pérez',
    fechaAsignacion: '2026-08-01',
    fechaDevolucion: '2026-08-10',
    motivoCierre: 'reasignacion'
  })
]

describe('stintAt: qué tramo cubría esa fecha', () => {
  it('devuelve el tramo que la cubre', () => {
    expect(stintAt(HISTORIA, '2026-08-05')._id).toBe('t1')
    expect(stintAt(HISTORIA, '2026-08-20')._id).toBe('t2')
  })

  it('el día del cambio de manos se lo lleva quien la recibió', () => {
    // Ese día la tuvieron los dos (D-87); la incidencia se atribuye al que la
    // tenía al final del día.
    expect(stintAt(HISTORIA, '2026-08-10')._id).toBe('t2')
  })

  it('null cuando la máquina estaba en el patio', () => {
    expect(stintAt(HISTORIA, '2026-07-31')).toBeNull()
    expect(stintAt([], '2026-08-05')).toBeNull()
  })

  it('null en el hueco entre dos tramos cerrados', () => {
    const conHueco = [
      tramo({
        _id: 'a',
        empleadoId: 'juan',
        fechaAsignacion: '2026-08-01',
        fechaDevolucion: '2026-08-05'
      }),
      tramo({
        _id: 'b',
        empleadoId: 'pedro',
        fechaAsignacion: '2026-08-20',
        fechaDevolucion: '2026-08-25'
      })
    ]
    expect(stintAt(conHueco, '2026-08-10')).toBeNull()
  })
})

describe('incidentContext: quién la tenía y dónde', () => {
  it('con trabajador y obra', () => {
    expect(incidentContext(HISTORIA, '2026-08-05')).toMatchObject({
      sinAsignar: false,
      tramoId: 't1',
      empleadoId: 'juan',
      empleadoNombre: 'Juan Pérez',
      proyectoNombre: 'Obra Norte',
      texto: 'Juan Pérez · Obra Norte'
    })
  })

  it('en la obra pero sin operador: no es un hueco, es un estado', () => {
    const sinOperador = [
      tramo({ _id: 'x', empleadoId: null, fechaAsignacion: '2026-08-01', vigente: true })
    ]
    expect(incidentContext(sinOperador, '2026-08-05')).toMatchObject({
      sinAsignar: false,
      empleadoId: null,
      proyectoNombre: 'Obra Norte',
      texto: 'En Obra Norte, sin operador'
    })
  })

  it('sin asignar cuando estaba en el patio', () => {
    expect(incidentContext(HISTORIA, '2026-07-01')).toMatchObject({
      sinAsignar: true,
      empleadoId: null,
      proyectoId: null,
      texto: 'Sin asignar: la máquina estaba en el patio'
    })
  })
})

describe('incidentToJson', () => {
  const incidencia = {
    _id: 'i1',
    maquinaId: 'maq',
    empresaId: 'emp',
    tipoId: { _id: 'tipo-1', nombre: 'Falla hidráulica', activo: true },
    descripcion: 'Botó aceite',
    fechaIncidencia: '2026-08-05',
    fechaResolucion: null,
    notaResolucion: null,
    toJSON() {
      return {
        _id: this._id,
        maquinaId: this.maquinaId,
        empresaId: this.empresaId,
        tipoId: this.tipoId._id,
        descripcion: this.descripcion,
        fechaIncidencia: this.fechaIncidencia,
        fechaResolucion: this.fechaResolucion,
        notaResolucion: this.notaResolucion
      }
    }
  }

  it('abierta: cuenta los días hasta hoy y trae el tipo resuelto', () => {
    const json = incidentToJson(incidencia, { tramos: HISTORIA, hoy: '2026-08-09' })

    expect(json).toMatchObject({
      abierta: true,
      tipoId: 'tipo-1',
      tipo: { _id: 'tipo-1', nombre: 'Falla hidráulica', activo: true },
      // Días naturales e inclusivos, como los tramos: del 5 al 9 son 5.
      dias: 5
    })
    expect(json.contexto.empleadoNombre).toBe('Juan Pérez')
  })

  it('resuelta: los días son los que tardó en cerrarse, no los que van', () => {
    const resuelta = {
      ...incidencia,
      fechaResolucion: '2026-08-07',
      toJSON: () => ({
        ...incidencia.toJSON(),
        fechaResolucion: '2026-08-07',
        notaResolucion: 'Se cambió la manguera'
      })
    }

    expect(
      incidentToJson(resuelta, { tramos: HISTORIA, hoy: '2026-09-30' })
    ).toMatchObject({ abierta: false, dias: 3, notaResolucion: 'Se cambió la manguera' })
  })

  it('sin el tipo populado, `tipo` va en null y el id sigue siendo correcto', () => {
    const sinPoblar = {
      ...incidencia,
      tipoId: 'tipo-1',
      toJSON: () => incidencia.toJSON()
    }
    const json = incidentToJson(sinPoblar, { tramos: [], hoy: '2026-08-09' })

    expect(json.tipo).toBeNull()
    expect(json.tipoId).toBe('tipo-1')
    expect(json.contexto.sinAsignar).toBe(true)
  })
})
