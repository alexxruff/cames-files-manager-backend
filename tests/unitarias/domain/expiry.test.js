const { requiresExpiry, suggestedExpiry } = require('../../../src/utils/domain')

const HOY = '2026-08-20'
const temporal = { tipoContrato: 'determinado', fechaTerminoContrato: '2027-02-28' }
const indefinido = { tipoContrato: 'indeterminado', fechaTerminoContrato: null }

describe('domain/expiry — spec 7.7', () => {
  describe('requiresExpiry', () => {
    it('los documentos que no caducan nunca piden vigencia', () => {
      for (const tipo of ['ine', 'curp', 'cv', 'alta_imss']) {
        expect(requiresExpiry({ tipo }, temporal)).toBe(false)
      }
    })

    it('el contrato pide vigencia sólo si es temporal', () => {
      expect(requiresExpiry({ tipo: 'contrato' }, temporal)).toBe(true)
      expect(requiresExpiry({ tipo: 'contrato' }, indefinido)).toBe(false)
    })

    it('el examen médico pide vigencia si la plantilla define meses', () => {
      expect(requiresExpiry({ tipo: 'examen_medico', vigenciaMeses: 12 }, temporal)).toBe(
        true
      )
      expect(
        requiresExpiry({ tipo: 'examen_medico', vigenciaMeses: null }, temporal)
      ).toBe(false)
    })
  })

  describe('suggestedExpiry', () => {
    it('el contrato temporal hereda la fecha de término del colaborador', () => {
      expect(suggestedExpiry({ tipo: 'contrato' }, temporal, { hoy: HOY })).toBe(
        '2027-02-28'
      )
    })

    it('el contrato indeterminado no vence', () => {
      expect(suggestedExpiry({ tipo: 'contrato' }, indefinido, { hoy: HOY })).toBeNull()
    })

    it('los demás se cuentan desde hoy con los meses de la plantilla', () => {
      expect(
        suggestedExpiry({ tipo: 'examen_medico', vigenciaMeses: 6 }, temporal, {
          hoy: HOY
        })
      ).toBe('2027-02-20')
    })

    it('al sumar meses respeta el fin de mes', () => {
      // 31 de enero + 1 mes = 28 de febrero, no 3 de marzo.
      expect(
        suggestedExpiry({ tipo: 'examen_medico', vigenciaMeses: 1 }, temporal, {
          hoy: '2026-01-31'
        })
      ).toBe('2026-02-28')
      expect(
        suggestedExpiry({ tipo: 'examen_medico', vigenciaMeses: 1 }, temporal, {
          hoy: '2024-01-31'
        })
      ).toBe('2024-02-29')
    })

    it('un documento que no caduca no propone nada', () => {
      expect(suggestedExpiry({ tipo: 'ine' }, temporal, { hoy: HOY })).toBeNull()
    })

    it('devuelve null, nunca undefined ni cadena vacía (regla #7 del contrato)', () => {
      const resultado = suggestedExpiry({ tipo: 'contrato' }, indefinido, { hoy: HOY })
      expect(resultado).toBeNull()
      expect(resultado).not.toBeUndefined()
      expect(resultado).not.toBe('')
    })
  })
})
