const {
  isCalendarDate,
  addMonths,
  addDays,
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

  describe('compare', () => {
    it('ordena lexicográficamente, que en ISO es cronológico', () => {
      expect(compare('2026-01-01', '2026-02-01')).toBe(-1)
      expect(compare('2026-02-01', '2026-01-01')).toBe(1)
      expect(compare('2026-01-01', '2026-01-01')).toBe(0)
    })
  })
})
