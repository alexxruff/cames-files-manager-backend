const {
  PERIODO_SIROC_MESES,
  requiredSirocRenewals,
  deriveSirocTracking,
  deriveContractTracking,
  pickCurrentSirocContract
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

    it('y un contrato cerrado no arrastra pendientes de su predicción', () => {
      const largo = contrato({ fechaFin: '2026-12-31', estado: 'finalizado' })
      const s = seguimiento(largo, '2026-06-01')

      // Antes decía «no requiere» y «5 pendientes» a la vez.
      expect(s.actualizacionesRequeridas).toBe(5)
      expect(s.actualizacionesPendientes).toBe(0)
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
     * D-84: la fecha de fin es el techo del cálculo. Antes esto pedía refrendos
     * cada dos meses para siempre, y toda obra terminada que nadie cerró —que
     * son casi todas— se quedaba en rojo hasta que alguien capturaba un trámite
     * que el IMSS no exigió, sólo para apagarlo.
     */
    describe('un contrato que se pasó de su fecha de fin sin finalizarse', () => {
      const vencido = contrato({ fechaFin: '2026-02-15' })

      it('deja de pedir actualizaciones, y lo dice por lo que es', () => {
        const s = seguimiento(vencido, '2026-03-04')

        expect(s.estado).toBe('no_requiere')
        expect(s.requiereActualizacion).toBe(false)
        expect(s.mensaje).toBe(
          'El contrato terminó el 2026-02-15: su SIROC ya no requiere actualizaciones.'
        )
      })

      it('no las cuenta como pendientes, ni deja días que invitar a pintar rojo', () => {
        const s = seguimiento(vencido, '2026-03-04')

        expect(s.actualizacionesPendientes).toBe(0)
        expect(s.diasParaActualizacion).toBeNull()
      })

      it('sigue diciendo hasta cuándo llegó el aviso, que es un hecho', () => {
        expect(seguimiento(vencido, '2026-03-04').vigenciaPeriodoHasta).toBe('2026-03-01')
      })

      it('el día de la fecha de fin todavía cuenta como dentro', () => {
        expect(seguimiento(vencido, '2026-02-15').mensaje).toBe(
          'El SIROC vigente cubre lo que queda del contrato.'
        )
      })

      /*
       * La revisión del 3 de septiembre: el techo corta la cuenta, no la borra.
       * Contrato de enero al 30 de mayo, SIROC del 1 de enero y un refrendo del
       * 2 de enero: el aviso dejó de cubrir el 2 de marzo y el contrato siguió
       * hasta mayo. Se debían dos refrendos ANTES de que terminara, y se siguen
       * debiendo aunque hoy ya haya pasado la fecha.
       */
      describe('pero lo que debía antes de terminar lo sigue debiendo', () => {
        const conDeuda = contrato({
          fechaFin: '2026-05-30',
          siroc: {
            numero: 'SIROC-001',
            fechaRegistro: '2026-01-01',
            actualizaciones: [{ fecha: '2026-01-02' }]
          }
        })

        it('sigue vencida, con los refrendos que faltaron hasta la fecha de fin', () => {
          const s = seguimiento(conDeuda, '2026-09-03')

          expect(s.estado).toBe('vencida')
          expect(s.requiereActualizacion).toBe(true)
          // Del 2 de marzo al 30 de mayo caben dos ventanas: ni una más.
          expect(s.actualizacionesPendientes).toBe(2)
          expect(s.diasParaActualizacion).toBe(-185)
        })

        it('y el mensaje dice que se capture con la fecha de entonces', () => {
          expect(seguimiento(conDeuda, '2026-09-03').mensaje).toBe(
            'El SIROC requiere actualización desde el 2026-03-02: venció hace 185 días, con el contrato todavía en curso. Regístrala con la fecha en que se presentó, a más tardar el 2026-05-30.'
          )
        })

        it('la deuda se paga con refrendos de dentro del contrato, y queda en paz solo', () => {
          const pagado = contrato({
            fechaFin: '2026-05-30',
            siroc: {
              numero: 'SIROC-001',
              fechaRegistro: '2026-01-01',
              actualizaciones: [
                { fecha: '2026-01-02' },
                { fecha: '2026-03-02' },
                { fecha: '2026-05-02' }
              ]
            }
          })
          const s = seguimiento(pagado, '2026-09-03')

          expect(s.estado).toBe('no_requiere')
          expect(s.actualizacionesPendientes).toBe(0)
          expect(s.mensaje).toBe(
            'El contrato terminó el 2026-05-30: su SIROC ya no requiere actualizaciones.'
          )
        })

        it('no acumula refrendos de después de la fecha de fin, por mucho que pase el tiempo', () => {
          // Hoy es dos años después: la cuenta sigue siendo la de mayo.
          expect(seguimiento(conDeuda, '2028-09-03').actualizacionesPendientes).toBe(2)
        })
      })

      it('sin SIROC sigue debiendo lo que sus fechas preveían: el techo ya era la fecha de fin', () => {
        const s = seguimiento(
          contrato({ fechaFin: '2026-05-30', siroc: null }),
          '2026-09-03'
        )

        expect(s.estado).toBe('sin_siroc')
        expect(s.actualizacionesPendientes).toBe(2)
      })
    })

    /*
     * El otro lado de la misma regla, y el que sería una trampa equivocarse: un
     * contrato DENTRO de sus fechas no cambia en nada. Si su aviso cumplió los
     * dos meses y la obra sigue, hay que refrendarlo aunque ya se hayan capturado
     * todos los que sus fechas preveían.
     */
    describe('un contrato dentro de sus fechas', () => {
      /*
       * Enero → 31 de diciembre, con sus 5 refrendos previstos ya capturados.
       * Se tramitaron un mes antes cada vez —lo normal: nadie espera al último
       * día—, así que la última ventana se agota el 1 de diciembre y todavía le
       * queda contrato por cubrir.
       */
      const conTodosLosPrevistos = contrato({
        fechaFin: '2026-12-31',
        siroc: {
          numero: 'SIROC-001',
          fechaRegistro: '2026-01-01',
          actualizaciones: [
            { fecha: '2026-02-01' },
            { fecha: '2026-04-01' },
            { fecha: '2026-06-01' },
            { fecha: '2026-08-01' },
            { fecha: '2026-10-01' }
          ]
        }
      })

      it('sigue pidiendo refrendo aunque ya tenga todos los previstos', () => {
        const s = seguimiento(conTodosLosPrevistos, '2026-12-15')

        expect(s.actualizacionesRequeridas).toBe(5)
        expect(s.actualizacionesRegistradas).toBe(5)
        expect(s.estado).toBe('vencida')
        expect(s.requiereActualizacion).toBe(true)
      })

      it('y esa que exige la cuenta como pendiente, sin contradecirse', () => {
        expect(
          seguimiento(conTodosLosPrevistos, '2026-12-15').actualizacionesPendientes
        ).toBe(1)
      })
    })

    /*
     * Lo que más va a pasar: la obra se alarga o se recorta y alguien edita el
     * contrato. Como todo se deriva al leer, el número tiene que cambiar en el
     * momento y **contando los refrendos que ya hay**, sin arreglos a mano.
     */
    describe('al mover las fechas del contrato', () => {
      /** Enero → 2 de mayo, con sus dos refrendos ya presentados. */
      const conDosRefrendos = (fechaFin) =>
        contrato({
          fechaFin,
          siroc: {
            numero: 'SIROC-001',
            fechaRegistro: '2026-01-01',
            actualizaciones: [{ fecha: '2026-03-01' }, { fecha: '2026-05-01' }]
          }
        })

      it('aplazarla vuelve a pedir, contando desde donde va el aviso y no desde cero', () => {
        const s = seguimiento(conDosRefrendos('2026-12-31'), '2026-07-02')

        // De la ventana vigente (1 jul) a diciembre son 3, no las 5 de enero.
        expect(s.actualizacionesPendientes).toBe(3)
        expect(s.actualizacionesRequeridas).toBe(5)
        expect(s.actualizacionesRegistradas).toBe(2)
      })

      it('y no le reclama los refrendos que ya presentó', () => {
        const s = seguimiento(conDosRefrendos('2026-12-31'), '2026-07-02')

        expect(s.actualizacionesPendientes).toBe(
          s.actualizacionesRequeridas - s.actualizacionesRegistradas
        )
      })

      it('recortarla deja de pedir lo que los refrendos ya cubren', () => {
        const s = seguimiento(conDosRefrendos('2026-03-15'), '2026-03-10')

        expect(s.actualizacionesPendientes).toBe(0)
        expect(s.estado).toBe('no_requiere')
        expect(s.mensaje).toBe('El SIROC vigente cubre lo que queda del contrato.')
      })

      it('recortarla por debajo de lo registrado no es un error ni rompe la cuenta', () => {
        const s = seguimiento(conDosRefrendos('2026-02-15'), '2026-02-10')

        // Se presentaron de verdad ante el IMSS: se dicen como lo que son.
        expect(s.actualizacionesRegistradas).toBe(2)
        expect(s.actualizacionesRequeridas).toBe(0)
        expect(s.actualizacionesPendientes).toBe(0)
        expect(s.estado).toBe('no_requiere')
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

describe('deriveContractTracking — el contrato como cabo suelto (D-84)', () => {
  const seguimientoDe = (c, hoy) => deriveContractTracking(c, { hoy })

  it('dentro de sus fechas está en curso y no pide nada', () => {
    const s = seguimientoDe(contrato(), '2026-03-01')

    expect(s.estado).toBe('en_curso')
    expect(s.requiereCierre).toBe(false)
    expect(s.diasDesdeFin).toBeNull()
    expect(s.mensaje).toBe('Este contrato está en curso hasta el 2026-07-01.')
  })

  it('antes de empezar dice cuándo empieza', () => {
    expect(seguimientoDe(contrato(), '2025-12-01').estado).toBe('por_iniciar')
  })

  /*
   * El caso que motiva todo esto: la obra terminó, nadie cerró el contrato, y
   * hasta D-84 el sistema lo señalaba pidiéndole un SIROC. Lo que le falta es
   * otra cosa, y se dice por su nombre.
   */
  it('pasado de fecha y sin cerrar pide que lo cierren, no un SIROC', () => {
    const s = seguimientoDe(contrato({ fechaFin: '2026-05-02' }), '2026-07-02')

    expect(s.estado).toBe('terminado_sin_cerrar')
    expect(s.requiereCierre).toBe(true)
    expect(s.diasDesdeFin).toBe(61)
    expect(s.mensaje).toBe(
      'Este contrato terminó el 2026-05-02 hace 61 días y sigue abierto: finalízalo, o corrige su fecha de fin si la obra sigue.'
    )
  })

  it('el día de la fecha de fin todavía es «en curso»', () => {
    expect(seguimientoDe(contrato(), '2026-07-01').estado).toBe('en_curso')
  })

  it('finalizarlo apaga el aviso, sin tocar nada más', () => {
    const s = seguimientoDe(
      contrato({ fechaFin: '2026-05-02', estado: 'finalizado' }),
      '2026-07-02'
    )

    expect(s.estado).toBe('finalizado')
    expect(s.requiereCierre).toBe(false)
    // Los días transcurridos siguen siendo un hecho, cerrado o no.
    expect(s.diasDesdeFin).toBe(61)
  })

  it('la baja manda sobre las fechas: no es un contrato que haya que cerrar', () => {
    const s = seguimientoDe(
      contrato({ fechaFin: '2026-05-02', activo: false }),
      '2026-07-02'
    )

    expect(s.estado).toBe('baja')
    expect(s.requiereCierre).toBe(false)
  })

  it('corregir la fecha de fin lo devuelve a en curso, sin arreglos a mano', () => {
    const alargado = contrato({ fechaFin: '2026-12-31' })

    expect(seguimientoDe(alargado, '2026-07-02').estado).toBe('en_curso')
  })
})

describe('pickCurrentSirocContract — cuál de las fases cubre a la gente', () => {
  /** Una fase con SIROC, que es lo único que la hace elegible. */
  const fase = (extra = {}) => ({
    _id: extra._id ?? 'c1',
    numero: extra.numero ?? 1,
    fechaInicio: '2026-01-01',
    fechaFin: '2026-03-01',
    estado: 'en_curso',
    activo: true,
    siroc: { numero: 'SIROC-001', fechaRegistro: '2026-01-01', actualizaciones: [] },
    ...extra
  })

  it('sin contratos, no hay nada que vincular', () => {
    expect(pickCurrentSirocContract([], '2026-02-01')).toBeNull()
  })

  it('un contrato sin SIROC no cuenta: la fase existe, el aviso no', () => {
    expect(pickCurrentSirocContract([fase({ siroc: null })], '2026-02-01')).toBeNull()
  })

  it('toma el que cubre el día de la consulta', () => {
    const elegido = pickCurrentSirocContract(
      [
        fase({ _id: 'vieja', fechaInicio: '2025-01-01', fechaFin: '2025-06-01' }),
        fase({ _id: 'hoy', fechaInicio: '2026-01-01', fechaFin: '2026-06-01' })
      ],
      '2026-02-01'
    )

    expect(elegido.contrato._id).toBe('hoy')
    expect(elegido.vigente).toBe(true)
  })

  it('los bordes de la ventana cuentan como dentro', () => {
    const uno = [fase({ fechaInicio: '2026-01-01', fechaFin: '2026-03-01' })]

    expect(pickCurrentSirocContract(uno, '2026-01-01').vigente).toBe(true)
    expect(pickCurrentSirocContract(uno, '2026-03-01').vigente).toBe(true)
  })

  it('si dos fases se traslapan, manda la que empezó después', () => {
    const elegido = pickCurrentSirocContract(
      [
        fase({ _id: 'primera', fechaInicio: '2026-01-01', fechaFin: '2026-06-01' }),
        fase({ _id: 'segunda', fechaInicio: '2026-02-01', fechaFin: '2026-08-01' })
      ],
      '2026-03-01'
    )

    expect(elegido.contrato._id).toBe('segunda')
  })

  describe('cuando ninguna cubre hoy', () => {
    it('cae en la última que estuvo activa, aunque esté finalizada', () => {
      const elegido = pickCurrentSirocContract(
        [
          fase({ _id: 'vieja', fechaInicio: '2025-01-01', fechaFin: '2025-06-01' }),
          fase({
            _id: 'ultima',
            fechaInicio: '2025-07-01',
            fechaFin: '2025-12-01',
            estado: 'finalizado'
          })
        ],
        '2026-02-01'
      )

      expect(elegido.contrato._id).toBe('ultima')
      expect(elegido.vigente).toBe(false)
    })

    it('una fase que todavía no arranca no es «la última activa»', () => {
      const futura = [fase({ fechaInicio: '2026-09-01', fechaFin: '2026-12-01' })]

      expect(pickCurrentSirocContract(futura, '2026-02-01')).toBeNull()
    })
  })

  it('nunca elige un contrato dado de baja, ni aunque sea el único', () => {
    const cancelado = [fase({ activo: false })]

    expect(pickCurrentSirocContract(cancelado, '2026-02-01')).toBeNull()
  })
})
