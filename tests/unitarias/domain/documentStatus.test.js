const {
  effectiveStatus,
  resolveDocuments,
  daysUntilExpiry
} = require('../../../src/utils/domain')

const HOY = '2026-08-20'
const doc = (extra) => ({
  tipo: 'examen_medico',
  requerido: true,
  estatus: 'validated',
  versiones: [],
  ...extra
})

describe('domain/effectiveStatus — spec 7.3', () => {
  it('el día del vencimiento todavía cuenta como vigente', () => {
    // dias === 0 es expiring, no expired: se vence al día SIGUIENTE.
    expect(effectiveStatus(doc({ vigenciaHasta: HOY }), { hoy: HOY })).toBe('expiring')
  })

  it('con vigencia de ayer está vencido', () => {
    expect(effectiveStatus(doc({ vigenciaHasta: '2026-08-19' }), { hoy: HOY })).toBe(
      'expired'
    )
  })

  it('el umbral es inclusivo: 30 días es expiring, 31 es validated', () => {
    expect(effectiveStatus(doc({ vigenciaHasta: '2026-09-19' }), { hoy: HOY })).toBe(
      'expiring'
    )
    expect(effectiveStatus(doc({ vigenciaHasta: '2026-09-20' }), { hoy: HOY })).toBe(
      'validated'
    )
  })

  it('lo que no está validado no vence', () => {
    for (const estatus of ['pending', 'in_review', 'rejected']) {
      expect(
        effectiveStatus(doc({ estatus, vigenciaHasta: '2020-01-01' }), { hoy: HOY })
      ).toBe(estatus)
    }
  })

  it('un validado sin vigencia sigue validado', () => {
    expect(effectiveStatus(doc({ vigenciaHasta: null }), { hoy: HOY })).toBe('validated')
    expect(effectiveStatus(doc({}), { hoy: HOY })).toBe('validated')
  })

  it('respeta un umbral distinto (fase 2: por cliente)', () => {
    const dentroDe45 = doc({ vigenciaHasta: '2026-10-01' })
    expect(effectiveStatus(dentroDe45, { hoy: HOY, diasAlerta: 30 })).toBe('validated')
    expect(effectiveStatus(dentroDe45, { hoy: HOY, diasAlerta: 60 })).toBe('expiring')
  })

  it('resolveDocuments no muta los documentos originales', () => {
    const documentos = [doc({ vigenciaHasta: '2020-01-01' })]
    const resueltos = resolveDocuments(documentos, { hoy: HOY })

    expect(resueltos[0].estatus).toBe('expired')
    expect(documentos[0].estatus).toBe('validated')
  })

  it('daysUntilExpiry es negativo si ya venció y null si no caduca', () => {
    expect(daysUntilExpiry(doc({ vigenciaHasta: '2026-08-25' }), { hoy: HOY })).toBe(5)
    expect(daysUntilExpiry(doc({ vigenciaHasta: '2026-08-15' }), { hoy: HOY })).toBe(-5)
    expect(daysUntilExpiry(doc({ vigenciaHasta: null }), { hoy: HOY })).toBeNull()
  })
})
