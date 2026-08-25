const {
  isCalendarDate,
  addMonths,
  addDays,
  nextAnniversary,
  daysUntilAnniversary,
  ageOnNextAnniversary,
  daysBetween,
  today,
  compare
} = require('../../src/utils/dates')

describe('utils/dates — fechas de calendario', () => {
  describe('isCalendarDate', () => {
    it('acepta YYYY-MM-DD válido', () => {
      expect(isCalendarDate('2026-08-19')).toBe(true)
      expect(isCalendarDate('2024-02-29')).toBe(true)
    })

    it('rechaza fechas que no existen', () => {
      expect(isCalendarDate('2026-02-30')).toBe(false)
      expect(isCalendarDate('2026-13-01')).toBe(false)
      expect(isCalendarDate('2026-00-10')).toBe(false)
      expect(isCalendarDate('2025-02-29')).toBe(false)
    })

    it('rechaza otros formatos y valores no string', () => {
      expect(isCalendarDate('19/08/2026')).toBe(false)
      expect(isCalendarDate('2026-08-19T00:00:00.000Z')).toBe(false)
      expect(isCalendarDate(null)).toBe(false)
      expect(isCalendarDate(new Date())).toBe(false)
    })
  })

  describe('addMonths — respeta el fin de mes (spec 7.7)', () => {
    it('31 de enero + 1 mes es el último día de febrero, no el 3 de marzo', () => {
      expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
      expect(addMonths('2024-01-31', 1)).toBe('2024-02-29')
    })

    it('suma normal y cruza el año', () => {
      expect(addMonths('2026-08-19', 6)).toBe('2027-02-19')
      expect(addMonths('2026-11-30', 13)).toBe('2027-12-30')
      expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
    })

    it('acepta meses negativos', () => {
      expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    })
  })

  describe('daysBetween', () => {
    it('cuenta días completos y es negativo hacia atrás', () => {
      expect(daysBetween('2026-08-19', '2026-08-19')).toBe(0)
      expect(daysBetween('2026-08-19', '2026-09-18')).toBe(30)
      expect(daysBetween('2026-08-19', '2026-09-19')).toBe(31)
      expect(daysBetween('2026-08-19', '2026-08-18')).toBe(-1)
    })

    it('no se descuadra con el cambio de horario de verano', () => {
      // En México el cambio ocurría a inicios de abril; con aritmética UTC el
      // conteo de días no depende de husos ni de DST.
      expect(daysBetween('2026-03-31', '2026-04-30')).toBe(30)
      expect(daysBetween('2026-10-25', '2026-11-01')).toBe(7)
    })
  })

  describe('addDays', () => {
    it('cruza mes y año', () => {
      expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
      expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    })
  })

  describe('today', () => {
    it('devuelve la fecha de la zona de negocio, no la del servidor', () => {
      // 2026-08-20 06:00 UTC es todavía el 19 de agosto en México.
      const instante = new Date('2026-08-20T05:00:00.000Z')
      expect(today('America/Mexico_City', instante)).toBe('2026-08-19')
      expect(today('UTC', instante)).toBe('2026-08-20')
    })

    it('tiene el formato de fecha de calendario', () => {
      expect(isCalendarDate(today())).toBe(true)
    })
  })

  describe('aniversarios (cumpleaños)', () => {
    describe('nextAnniversary', () => {
      it('si el cumpleaños es hoy, el próximo aniversario es hoy', () => {
        expect(nextAnniversary('1982-08-20', '2026-08-20')).toBe('2026-08-20')
      })

      it('si todavía no llega, es de este año', () => {
        expect(nextAnniversary('1982-12-25', '2026-08-20')).toBe('2026-12-25')
      })

      it('si ya pasó, es del año que viene', () => {
        expect(nextAnniversary('1982-01-15', '2026-08-20')).toBe('2027-01-15')
      })

      /*
       * Mismo criterio de fin de mes que `addMonths`: se elige el último día real
       * del mes en vez de saltar al 1 de marzo. Sin esto, quien nació un 29 de
       * febrero no cumpliría años tres de cada cuatro años.
       */
      it('el 29 de febrero cae el 28 en los años no bisiestos', () => {
        expect(nextAnniversary('2000-02-29', '2027-01-01')).toBe('2027-02-28')
        expect(nextAnniversary('2000-02-29', '2028-01-01')).toBe('2028-02-29')
      })

      it('devuelve null si la fecha no es una fecha de calendario', () => {
        expect(nextAnniversary('no es fecha', '2026-08-20')).toBeNull()
        expect(nextAnniversary(null, '2026-08-20')).toBeNull()
        expect(nextAnniversary('1982-08-20', 'ayer')).toBeNull()
      })
    })

    describe('daysUntilAnniversary', () => {
      it('el mismo día es 0, no 365', () => {
        expect(daysUntilAnniversary('1982-08-20', '2026-08-20')).toBe(0)
      })

      it('cuenta los días que faltan', () => {
        expect(daysUntilAnniversary('1982-08-27', '2026-08-20')).toBe(7)
      })

      it('cruza el fin de año sin equivocarse', () => {
        expect(daysUntilAnniversary('1990-01-02', '2026-12-30')).toBe(3)
      })

      it('el día después del cumpleaños faltan casi 365 días', () => {
        expect(daysUntilAnniversary('1990-08-20', '2026-08-21')).toBe(364)
      })
    })

    describe('ageOnNextAnniversary', () => {
      it('devuelve los años que va a cumplir', () => {
        expect(ageOnNextAnniversary('1982-08-27', '2026-08-20')).toBe(44)
      })

      it('el día del cumpleaños ya es la edad que cumple', () => {
        expect(ageOnNextAnniversary('1982-08-20', '2026-08-20')).toBe(44)
      })

      it('al cruzar el año cuenta contra el año del aniversario', () => {
        expect(ageOnNextAnniversary('1990-01-02', '2026-12-30')).toBe(37)
      })

      it('null si la fecha no sirve o está en el futuro', () => {
        expect(ageOnNextAnniversary('no es fecha', '2026-08-20')).toBeNull()
        expect(ageOnNextAnniversary('2030-08-20', '2026-08-20')).toBeNull()
      })
    })
  })

  describe('compare', () => {
    it('ordena lexicográficamente, que en ISO es cronológico', () => {
      expect(compare('2026-01-01', '2026-02-01')).toBe(-1)
      expect(compare('2026-02-01', '2026-01-01')).toBe(1)
      expect(compare('2026-01-01', '2026-01-01')).toBe(0)
    })
  })
})
