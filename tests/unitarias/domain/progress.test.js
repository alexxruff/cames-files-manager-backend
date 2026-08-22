const { computeProgress } = require('../../../src/utils/domain')

const HOY = '2026-08-20'
const d = (tipo, estatus, requerido = true, extra = {}) => ({
  tipo,
  requerido,
  estatus,
  versiones: [],
  ...extra
})

describe('domain/computeProgress — spec 7.4 y 7.5', () => {
  it('un checklist sin requeridos da 100 % y no divide entre cero', () => {
    const avance = computeProgress([d('cv', 'pending', false)], { hoy: HOY })

    expect(avance.requeridos).toBe(0)
    expect(avance.porcentaje).toBe(100)
    expect(Number.isNaN(avance.porcentaje)).toBe(false)
    expect(avance.estatus).toBe('complete')
  })

  it('el porcentaje sólo mira los requeridos', () => {
    const avance = computeProgress(
      [
        d('ine', 'validated'),
        d('curp', 'validated'),
        // Opcional sin subir: no puede impedir llegar al 100 %.
        d('cv', 'pending', false)
      ],
      { hoy: HOY }
    )

    expect(avance.requeridos).toBe(2)
    expect(avance.entregados).toBe(2)
    expect(avance.porcentaje).toBe(100)
    expect(avance.estatus).toBe('complete')
  })

  it('un documento por vencer sigue contando como entregado', () => {
    const avance = computeProgress(
      [
        d('ine', 'validated'),
        d('examen_medico', 'validated', true, { vigenciaHasta: HOY })
      ],
      { hoy: HOY }
    )

    expect(avance.entregados).toBe(2)
    expect(avance.porcentaje).toBe(100)
    expect(avance.porVencer).toBe(1)
    // El checklist está completo; lo que pasa es que hay que renovar.
    expect(avance.estatus).toBe('expiring')
  })

  it('los contadores de revisión y vigencia miran TODOS los documentos', () => {
    const avance = computeProgress(
      [
        d('ine', 'in_review'),
        d('cv', 'in_review', false),
        d('curp', 'rejected'),
        d('referencias_laborales', 'rejected', false)
      ],
      { hoy: HOY }
    )

    expect(avance.enRevision).toBe(2)
    expect(avance.rechazados).toBe(2)
  })

  it('un opcional vencido pone el expediente en expired aunque el avance sea 100 %', () => {
    const avance = computeProgress(
      [
        d('ine', 'validated'),
        d('examen_medico', 'validated', false, { vigenciaHasta: '2026-01-01' })
      ],
      { hoy: HOY }
    )

    expect(avance.porcentaje).toBe(100)
    expect(avance.vencidos).toBe(1)
    expect(avance.estatus).toBe('expired')
  })

  it('redondea el porcentaje', () => {
    const documentos = ['ine', 'curp', 'rfc'].map((t) => d(t, 'pending'))
    documentos[0].estatus = 'validated'

    // 1 de 3 = 33.33… → 33
    expect(computeProgress(documentos, { hoy: HOY }).porcentaje).toBe(33)
  })

  it('cuenta los faltantes sólo entre los requeridos', () => {
    const avance = computeProgress(
      [d('ine', 'pending'), d('cv', 'pending', false), d('curp', 'validated')],
      { hoy: HOY }
    )

    expect(avance.faltantes).toBe(1)
    expect(avance.estatus).toBe('incomplete')
  })

  describe('semáforo, en orden de urgencia', () => {
    it('vencido gana sobre incompleto', () => {
      const avance = computeProgress(
        [
          d('ine', 'pending'),
          d('examen_medico', 'validated', true, { vigenciaHasta: '2020-01-01' })
        ],
        { hoy: HOY }
      )
      expect(avance.estatus).toBe('expired')
    })

    it('incompleto gana sobre por vencer', () => {
      const avance = computeProgress(
        [
          d('ine', 'pending'),
          d('examen_medico', 'validated', true, { vigenciaHasta: HOY })
        ],
        { hoy: HOY }
      )
      expect(avance.estatus).toBe('incomplete')
    })

    it('completo cuando todo está entregado y nada vence pronto', () => {
      const avance = computeProgress([d('ine', 'validated'), d('curp', 'validated')], {
        hoy: HOY
      })
      expect(avance.estatus).toBe('complete')
    })
  })
})
