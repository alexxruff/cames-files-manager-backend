const {
  PERIODO_SIROC_MESES,
  requiredSirocRenewals,
  deriveSirocTracking
} = require('../../../src/utils/domain')

const DIAS_ALERTA = 5

/** Un contrato en curso con SIROC registrado el día que arrancó. */
const contrato = (extra = {}) => ({
  fechaInicio: '2026-01-01',
  fechaFin: '2026-07-01',
  estado: 'en_curso',
  activo: true,
  siroc: {
    numero: 'SIROC-001',
    fechaRegistro: '2026-01-01',
    actualizaciones: []
  },
  ...extra
})

const seguimiento = (c, hoy) => deriveSirocTracking(c, { hoy, diasAlerta: DIAS_ALERTA })

describe('domain/siroc — el aviso se actualiza cada 2 meses (D-76)', () => {
  it('el periodo es de dos meses', () => {
    expect(PERIODO_SIROC_MESES).toBe(2)
  })

  describe('requiredSirocRenewals — cuántas actualizaciones pide el contrato', () => {
    it('un contrato que cabe en la primera ventana no pide ninguna', () => {
      expect(requiredSirocRenewals('2026-01-01', '2026-03-01')).toBe(0)
      expect(requiredSirocRenewals('2026-01-01', '2026-02-10')).toBe(0)
      // Un contrato de un solo día tampoco.
      expect(requiredSirocRenewals('2026-01-01', '2026-01-01')).toBe(0)
    })

    it('pasar de los dos meses, aunque sea por un día, ya pide una', () => {
      expect(requiredSirocRenewals('2026-01-01', '2026-03-02')).toBe(1)
    })

    it('cada dos meses más suman una', () => {
      expect(requiredSirocRenewals('2026-01-01', '2026-05-01')).toBe(1)
      expect(requiredSirocRenewals('2026-01-01', '2026-06-01')).toBe(2)
      expect(requiredSirocRenewals('2026-01-01', '2026-07-01')).toBe(2)
      expect(requiredSirocRenewals('2026-01-01', '2027-01-01')).toBe(5)
    })

    it('al contar meses respeta el fin de mes', () => {
      // 31 de diciembre + 2 meses = 28 de febrero, y ahí se acaba la ventana.
      expect(requiredSirocRenewals('2025-12-31', '2026-02-28')).toBe(0)
      expect(requiredSirocRenewals('2025-12-31', '2026-03-01')).toBe(1)
    })

    it('fechas ausentes o al revés no piden nada, en vez de reventar', () => {
      expect(requiredSirocRenewals(null, '2026-07-01')).toBe(0)
      expect(requiredSirocRenewals('2026-07-01', null)).toBe(0)
      expect(requiredSirocRenewals('2026-07-01', '2026-01-01')).toBe(0)
    })
  })

  describe('deriveSirocTracking — el aviso del contrato', () => {
    it('sin SIROC lo dice y no inventa vencimientos', () => {
      const s = seguimiento(contrato({ siroc: null }), '2026-01-15')

      expect(s.estado).toBe('sin_siroc')
      expect(s.vigenciaPeriodoHasta).toBeNull()
      expect(s.requiereActualizacion).toBe(false)
      // La predicción sí se da: se sabe desde que se capturaron las fechas.
      expect(s.actualizacionesRequeridas).toBe(2)
    })

    it('recién registrado está al día y anuncia cuándo toca la siguiente', () => {
      const s = seguimiento(contrato(), '2026-01-15')

      expect(s.estado).toBe('al_dia')
      expect(s.vigenciaPeriodoHasta).toBe('2026-03-01')
      expect(s.diasParaActualizacion).toBe(45)
      expect(s.requiereActualizacion).toBe(false)
      expect(s.actualizacionesRegistradas).toBe(0)
      expect(s.actualizacionesPendientes).toBe(2)
    })

    it('dentro del umbral avisa que se acerca, sin exigir todavía', () => {
      const s = seguimiento(contrato(), '2026-02-27')

      expect(s.estado).toBe('por_vencer')
      expect(s.diasParaActualizacion).toBe(2)
      expect(s.requiereActualizacion).toBe(false)
      expect(s.mensaje).toBe(
        'El SIROC cumple sus dos meses el 2026-03-01: requiere actualización en 2 días.'
      )
    })

    it('el umbral es inclusivo y el día justo todavía no está vencido', () => {
      expect(seguimiento(contrato(), '2026-02-24').estado).toBe('por_vencer')
      expect(seguimiento(contrato(), '2026-02-23').estado).toBe('al_dia')

      const elDia = seguimiento(contrato(), '2026-03-01')
      expect(elDia.estado).toBe('por_vencer')
      expect(elDia.diasParaActualizacion).toBe(0)
      expect(elDia.mensaje).toBe(
        'El SIROC cumple hoy sus dos meses y requiere actualización.'
      )
    })

    it('pasados los dos meses con el contrato vivo, exige la actualización', () => {
      const s = seguimiento(contrato(), '2026-03-04')

      expect(s.estado).toBe('vencida')
      expect(s.requiereActualizacion).toBe(true)
      expect(s.diasParaActualizacion).toBe(-3)
      expect(s.mensaje).toBe(
        'El SIROC requiere actualización desde el 2026-03-01: venció hace 3 días.'
      )
    })

    it('registrar la actualización corre la ventana y apaga el aviso', () => {
      const conRenovacion = contrato({
        siroc: {
          numero: 'SIROC-001',
          fechaRegistro: '2026-01-01',
          actualizaciones: [{ fecha: '2026-03-02', nota: null }]
        }
      })
      const s = seguimiento(conRenovacion, '2026-03-04')

      expect(s.estado).toBe('al_dia')
      expect(s.vigenciaPeriodoHasta).toBe('2026-05-02')
      expect(s.ultimaActualizacion).toBe('2026-03-02')
      expect(s.actualizacionesRegistradas).toBe(1)
      expect(s.actualizacionesPendientes).toBe(1)
    })

    it('la ventana corre desde el registro, no desde el inicio del contrato', () => {
      // El SIROC se tramitó un mes tarde: sus dos meses empiezan ahí.
      const tardio = contrato({
        siroc: {
          numero: 'SIROC-001',
          fechaRegistro: '2026-02-01',
          actualizaciones: []
        }
      })
      expect(seguimiento(tardio, '2026-03-04').vigenciaPeriodoHasta).toBe('2026-04-01')
      expect(seguimiento(tardio, '2026-03-04').estado).toBe('al_dia')
    })

    it('un contrato finalizado deja de pedir actualizaciones', () => {
      const s = seguimiento(contrato({ estado: 'finalizado' }), '2026-06-01')

      expect(s.estado).toBe('no_requiere')
      expect(s.requiereActualizacion).toBe(false)
      expect(s.mensaje).toBe(
        'El contrato ya no está en curso: su SIROC no necesita actualizarse.'
      )
    })

    it('uno dado de baja, tampoco', () => {
      expect(seguimiento(contrato({ activo: false }), '2026-06-01').estado).toBe(
        'no_requiere'
      )
    })

    it('si la ventana vigente ya cubre el final del contrato, no hay más que pedir', () => {
      const corto = contrato({ fechaFin: '2026-02-15' })
      const s = seguimiento(corto, '2026-02-14')

      expect(s.actualizacionesRequeridas).toBe(0)
      expect(s.estado).toBe('no_requiere')
      expect(s.mensaje).toBe('El SIROC vigente cubre lo que queda del contrato.')
    })

    /*
     * La regresión que devolvió la tarea: el contrato se pasó de su fecha de fin
     * sin que nadie lo finalizara. Para el IMSS la obra sigue abierta, así que el
     * aviso vence igual y el atajo de arriba NO aplica.
     */
    describe('un contrato que se pasó de su fecha de fin sin finalizarse', () => {
      const vencido = contrato({ fechaFin: '2026-02-15' })

      it('exige la actualización en cuanto el aviso cumple sus dos meses', () => {
        const s = seguimiento(vencido, '2026-03-04')

        expect(s.estado).toBe('vencida')
        expect(s.requiereActualizacion).toBe(true)
        expect(s.diasParaActualizacion).toBe(-3)
        expect(s.mensaje).toBe(
          'El SIROC requiere actualización desde el 2026-03-01: venció hace 3 días.'
        )
      })

      it('y cuenta esa actualización como pendiente, aunque no estuviera prevista', () => {
        const s = seguimiento(vencido, '2026-03-04')

        // El contrato, por sus fechas, no pedía ninguna: se pasó de ellas.
        expect(s.actualizacionesRequeridas).toBe(0)
        expect(s.actualizacionesPendientes).toBe(1)
      })

      it('avisa desde antes, cuando el aviso está por cumplir los dos meses', () => {
        const s = seguimiento(vencido, '2026-02-27')

        expect(s.estado).toBe('por_vencer')
        expect(s.diasParaActualizacion).toBe(2)
      })

      it('pero si ya se finalizó, deja de pedir', () => {
        expect(
          seguimiento(
            contrato({ fechaFin: '2026-02-15', estado: 'finalizado' }),
            '2026-03-04'
          ).estado
        ).toBe('no_requiere')
      })
    })

    it('el contador de actualizaciones sólo cuenta las que hay, nunca negativo', () => {
      const dosRenovaciones = contrato({
        fechaFin: '2026-03-15',
        siroc: {
          numero: 'SIROC-001',
          fechaRegistro: '2026-01-01',
          actualizaciones: [
            { fecha: '2026-03-01', nota: null },
            { fecha: '2026-03-10', nota: 'acuse 22' }
          ]
        }
      })
      const s = seguimiento(dosRenovaciones, '2026-03-11')

      expect(s.actualizacionesRequeridas).toBe(1)
      expect(s.actualizacionesRegistradas).toBe(2)
      expect(s.actualizacionesPendientes).toBe(0)
    })
  })
})
