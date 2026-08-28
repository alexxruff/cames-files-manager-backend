const { normalize } = require('../../../src/utils/text')
const {
  COL,
  COLUMNAS_REQUERIDAS,
  mapearFila,
  columnasFaltantes,
  aFechaCalendario,
  aNumero,
  aBooleano,
  tipoContratoDesde,
  activoDesdeEstatus,
  tipoEmpleadoDesdePuesto,
  nombreCompleto
} = require('../../../src/utils/domain/employeeImport')

/**
 * Mapeo del archivo de nómina — SIN base de datos.
 *
 * `employeeImport.js` es puro a propósito: aquí se prueban los 19 puestos, los 5
 * tipos de contrato, los 3 estatus y —lo más importante— que las fechas no se
 * corran un día, que es el bug de D-09 y el que este archivo puede reintroducir
 * más fácil.
 */

/** Arma las celdas como las entrega `utils/spreadsheet.js`: llaves normalizadas. */
const celdas = (valores) => {
  const salida = {}
  for (const columna of Object.values(COL)) salida[normalize(columna)] = null
  for (const [columna, valor] of Object.entries(valores)) {
    salida[normalize(columna)] = valor
  }
  return salida
}

const fechaUtc = (fecha) => {
  const [a, m, d] = fecha.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d))
}

/** Una fila completa y válida, sobre la que cada prueba cambia lo suyo. */
const filaValida = (extra = {}) =>
  mapearFila({
    numero: 6,
    celdas: celdas({
      [COL.ID]: '0001',
      [COL.NOMBRE]: 'JOSE LUCIANO',
      [COL.PRIMER_APELLIDO]: 'GONZALEZ',
      [COL.SEGUNDO_APELLIDO]: 'MEZA',
      [COL.RFC]: 'XAFN900404FN3',
      [COL.CURP]: 'XAFN900404HJCFNF03',
      [COL.ESTATUS]: 'Alta',
      [COL.FECHA_INGRESO]: fechaUtc('2021-09-20'),
      [COL.TIPO_CONTRATO]: '01 Contrato de trabajo por tiempo indeterminado',
      [COL.PUESTO]: 'Operador',
      [COL.DEPARTAMENTO]: 'Operaciones',
      ...extra
    })
  })

describe('Importación de colaboradores · mapeo puro', () => {
  describe('fechas — la trampa de D-09', () => {
    /*
     * Ésta es LA prueba del archivo. `exceljs` entrega un `Date` a medianoche
     * UTC del día que dice la celda; leerlo con `getFullYear()/getMonth()/
     * getDate()` en un servidor al oeste de Greenwich —México lo está— devuelve
     * el día ANTERIOR, en todas las fechas del archivo a la vez. Si alguien
     * "simplifica" esta conversión, aquí se cae.
     */
    it('no corre la fecha un día: cada día del año se lee tal cual', () => {
      const inicio = Date.UTC(2024, 0, 1)
      for (let dia = 0; dia < 366; dia += 1) {
        const fecha = new Date(inicio + dia * 86400000)
        const esperado = fecha.toISOString().slice(0, 10)
        expect(aFechaCalendario(fecha)).toBe(esperado)
      }
    })

    it('deja la fecha de ingreso del archivo tal cual, no un día antes', () => {
      const fila = filaValida({ [COL.FECHA_INGRESO]: fechaUtc('2021-09-20') })
      expect(fila.adscripcion.fechaIngreso).toBe('2021-09-20')
      expect(fila.errores).toEqual([])
    })

    it('el 1 de enero y el 31 de diciembre no se van de año', () => {
      expect(aFechaCalendario(fechaUtc('2022-01-01'))).toBe('2022-01-01')
      expect(aFechaCalendario(fechaUtc('2021-12-31'))).toBe('2021-12-31')
    })

    it('acepta fechas ya escritas como texto, en los dos formatos usuales', () => {
      expect(aFechaCalendario('2021-09-20')).toBe('2021-09-20')
      expect(aFechaCalendario('2021-09-20T00:00:00.000Z')).toBe('2021-09-20')
      // Convención mexicana: día primero.
      expect(aFechaCalendario('20/09/2021')).toBe('2021-09-20')
      expect(aFechaCalendario('5/9/2021')).toBe('2021-09-05')
    })

    it('devuelve null en lo que no es una fecha, en vez de inventar una', () => {
      expect(aFechaCalendario(null)).toBeNull()
      expect(aFechaCalendario('')).toBeNull()
      expect(aFechaCalendario('sin fecha')).toBeNull()
      expect(aFechaCalendario('2021-02-30')).toBeNull()
      expect(aFechaCalendario(new Date('no es fecha'))).toBeNull()
    })
  })

  describe('tipo de contrato', () => {
    it.each([
      ['01 Contrato de trabajo por tiempo indeterminado', 'indeterminado'],
      ['02 Contrato de trabajo por obra determinada', 'obra_determinada'],
      ['03 Contrato de trabajo por tiempo determinado', 'determinado'],
      ['05 Contrato de trabajo sujeto a prueba', 'prueba'],
      ['06 Contrato de trabajo con capacitación inicial', 'capacitacion_inicial']
    ])('traduce %s', (crudo, esperado) => {
      expect(tipoContratoDesde(crudo)).toBe(esperado)
    })

    it('resuelve por texto cuando no viene el código del SAT', () => {
      expect(tipoContratoDesde('Contrato por obra determinada')).toBe('obra_determinada')
      expect(tipoContratoDesde('TIEMPO INDETERMINADO')).toBe('indeterminado')
      expect(tipoContratoDesde('Capacitación inicial')).toBe('capacitacion_inicial')
    })

    /*
     * "obra determinada" CONTIENE "determinada": si se mirara primero el
     * genérico, los 85 contratos de obra del archivo entrarían como
     * `determinado`. El orden de las reglas es la prueba.
     */
    it('no confunde obra determinada con tiempo determinado', () => {
      expect(tipoContratoDesde('02 Contrato de trabajo por obra determinada')).toBe(
        'obra_determinada'
      )
      expect(tipoContratoDesde('03 Contrato de trabajo por tiempo determinado')).toBe(
        'determinado'
      )
    })

    it('no adivina un contrato desconocido', () => {
      expect(tipoContratoDesde('99 Contrato raro')).toBe('indeterminado')
      expect(tipoContratoDesde('Convenio de colaboración')).toBeNull()
      expect(tipoContratoDesde(null)).toBeNull()
    })

    it('marca la fecha de término como pendiente sólo en los temporales', () => {
      const temporal = filaValida({
        [COL.TIPO_CONTRATO]: '02 Contrato de trabajo por obra determinada'
      })
      expect(temporal.adscripcion.tipoContrato).toBe('obra_determinada')
      expect(temporal.adscripcion.fechaTerminoContrato).toBeNull()
      expect(temporal.adscripcion.datosPendientes).toEqual(['fechaTerminoContrato'])

      const fijo = filaValida()
      expect(fijo.adscripcion.datosPendientes).toEqual([])
    })
  })

  describe('estatus', () => {
    it('Alta y Reingreso son personal activo; Baja no', () => {
      expect(activoDesdeEstatus('Alta')).toBe(true)
      expect(activoDesdeEstatus('Reingreso')).toBe(true)
      expect(activoDesdeEstatus('Baja')).toBe(false)
    })

    it('no le importan los acentos ni las mayúsculas', () => {
      expect(activoDesdeEstatus('REINGRESO')).toBe(true)
      expect(activoDesdeEstatus(' baja ')).toBe(false)
    })

    it('un estatus desconocido es un error de la fila, no un supuesto', () => {
      expect(activoDesdeEstatus('Suspendido')).toBeNull()
      const fila = filaValida({ [COL.ESTATUS]: 'Suspendido' })
      expect(fila.errores.join(' ')).toContain('Suspendido')
      expect(fila.errores.join(' ')).toContain('Alta, Baja o Reingreso')
    })
  })

  describe('nombre', () => {
    it('une las tres columnas del archivo', () => {
      expect(
        nombreCompleto(
          celdas({
            [COL.NOMBRE]: 'JOSE LUCIANO',
            [COL.PRIMER_APELLIDO]: 'GONZALEZ',
            [COL.SEGUNDO_APELLIDO]: 'MEZA'
          })
        )
      ).toBe('JOSE LUCIANO GONZALEZ MEZA')
    })

    it('funciona con quien no tiene segundo apellido, sin dejar espacios dobles', () => {
      expect(
        nombreCompleto(celdas({ [COL.NOMBRE]: 'ANA', [COL.PRIMER_APELLIDO]: 'RUIZ' }))
      ).toBe('ANA RUIZ')
    })
  })

  describe('puesto → tipo de persona', () => {
    it.each([
      ['Operador', 'mano_de_obra'],
      ['Ayudante General', 'mano_de_obra'],
      ['Peon', 'mano_de_obra'],
      ['Peón', 'mano_de_obra'],
      ['Segurista', 'mano_de_obra'],
      ['Topógrafo', 'mano_de_obra'],
      ['Residente ', 'administrativo'],
      ['Analista', 'administrativo'],
      ['Director de Proyectos', 'administrativo'],
      ['Gerente Administrativo', 'administrativo'],
      ['Supervisor de Flotilla', 'administrativo'],
      ['Director General', 'administrativo'],
      ['Director Comercial', 'administrativo'],
      ['Coordinador de Recursos Humanos', 'administrativo'],
      ['Contador General', 'administrativo'],
      ['Auxiliar', 'administrativo'],
      ['Vendedor', 'administrativo'],
      ['Gerente de Operaciones', 'administrativo'],
      ['Gerente de Obra', 'administrativo'],
      ['Administrador', 'administrativo']
    ])('%s → %s', (puesto, esperado) => {
      expect(tipoEmpleadoDesdePuesto(puesto)).toBe(esperado)
    })

    it('compara por palabra completa, no por trozo', () => {
      // "Gerente de Obra" es administrativo aunque diga "obra": no está en la
      // lista de palabras de mano de obra, y "obrador" no debe colar por dentro.
      expect(tipoEmpleadoDesdePuesto('Gerente de Obra')).toBe('administrativo')
      expect(tipoEmpleadoDesdePuesto('Cooperador')).toBe('administrativo')
      expect(tipoEmpleadoDesdePuesto('Oficial Albañil')).toBe('mano_de_obra')
    })
  })

  describe('departamento', () => {
    /*
     * Desde D-58 este módulo YA NO traduce el departamento a un área: lo lee tal
     * cual y la resolución contra el catálogo vive en el servicio, que es quien
     * puede consultar la base y dar de alta las temporales. Aquí sólo se
     * comprueba que el texto llegue intacto y que la fila salga sin área.
     */
    it.each(['Axis Zapopan', 'Axis 3', 'Plenares', 'Kulkana', 'Operaciones'])(
      '%s se conserva tal cual y la fila sale sin área',
      (departamento) => {
        const fila = filaValida({
          [COL.DEPARTAMENTO]: departamento,
          [COL.PUESTO]: 'Operador'
        })
        expect(fila.adscripcion.departamento).toBe(departamento)
        expect(fila.departamento).toBe(departamento)
        expect(fila.adscripcion.areas).toEqual([])
        expect(fila.errores).toEqual([])
      }
    )

    it('sin departamento, tampoco inventa un área', () => {
      const fila = filaValida({ [COL.PUESTO]: 'Analista', [COL.DEPARTAMENTO]: null })
      expect(fila.persona.tipo).toBe('administrativo')
      expect(fila.adscripcion.departamento).toBeNull()
      expect(fila.adscripcion.areas).toEqual([])
    })
  })

  describe('filas que no se pueden importar', () => {
    it('sin CURP: no habría con qué reconocerla al volver a importar', () => {
      const fila = filaValida({ [COL.CURP]: null })
      expect(fila.errores.join(' ')).toContain('CURP')
      expect(fila.fila).toBe(6)
    })

    it('CURP con formato inválido', () => {
      const fila = filaValida({ [COL.CURP]: 'ABC123' })
      expect(fila.errores.join(' ')).toContain('no tiene un formato válido')
    })

    it('sin fecha de ingreso', () => {
      const fila = filaValida({ [COL.FECHA_INGRESO]: null })
      expect(fila.errores).toContain('La fila no trae fecha de ingreso')
    })

    it('con fecha de ingreso ilegible', () => {
      const fila = filaValida({ [COL.FECHA_INGRESO]: 'el mes pasado' })
      expect(fila.errores).toContain('No se pudo leer la fecha de ingreso')
    })

    it('sin puesto y sin nombre', () => {
      const fila = filaValida({
        [COL.PUESTO]: null,
        [COL.NOMBRE]: null,
        [COL.PRIMER_APELLIDO]: null,
        [COL.SEGUNDO_APELLIDO]: null
      })
      expect(fila.errores).toContain('La fila no trae puesto')
      expect(fila.errores).toContain('La fila no trae nombre')
    })

    it('acumula todos los errores de la fila, no sólo el primero', () => {
      const fila = filaValida({
        [COL.CURP]: null,
        [COL.FECHA_INGRESO]: null,
        [COL.TIPO_CONTRATO]: 'Convenio raro'
      })
      expect(fila.errores.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('datos que se avisan pero no detienen la importación', () => {
    it('un RFC con mal formato entra como null, con aviso', () => {
      const fila = filaValida({ [COL.RFC]: 'XX' })
      expect(fila.persona.rfc).toBeNull()
      expect(fila.avisos.join(' ')).toContain('RFC')
      expect(fila.errores).toEqual([])
    })

    it('un NSS de más de 11 dígitos entra como null, con aviso', () => {
      const fila = filaValida({ [COL.NSS]: '123456789012345' })
      expect(fila.persona.nss).toBeNull()
      expect(fila.avisos.join(' ')).toContain('NSS')
      expect(fila.errores).toEqual([])
    })

    it('una fecha de nacimiento ilegible entra como null, con aviso', () => {
      const fila = filaValida({ [COL.FECHA_NACIMIENTO]: 'no sé' })
      expect(fila.persona.fechaNacimiento).toBeNull()
      expect(fila.avisos.join(' ')).toContain('fecha de nacimiento')
      expect(fila.errores).toEqual([])
    })
  })

  describe('limpieza de valores', () => {
    it('"N/A" es sin dato, no el texto "N/A"', () => {
      const fila = filaValida({ [COL.BANCO]: 'N/A' })
      expect(fila.adscripcion.nomina.banco).toBeNull()
    })

    it('el NSS, el teléfono y la cuenta se quedan sólo con dígitos', () => {
      const fila = filaValida({
        [COL.NSS]: '75-97822-18-04',
        [COL.CELULAR]: '(33) 2567 2496',
        [COL.CUENTA]: '0723-2001-0550-2413'
      })
      expect(fila.persona.nss).toBe('75978221804')
      expect(fila.persona.telefono).toBe('3325672496')
      expect(fila.adscripcion.nomina.cuenta).toBe('0723200105502413')
    })

    it('lee los números de nómina, con símbolos o sin ellos', () => {
      expect(aNumero(1146.95)).toBe(1146.95)
      expect(aNumero('$1,146.95')).toBe(1146.95)
      expect(aNumero('')).toBeNull()
      expect(aNumero('no aplica')).toBeNull()
    })

    it('lee el teletrabajador venga como booleano o como texto', () => {
      expect(aBooleano(false)).toBe(false)
      expect(aBooleano(true)).toBe(true)
      expect(aBooleano('Sí')).toBe(true)
      expect(aBooleano('No')).toBe(false)
      expect(aBooleano(null)).toBe(false)
    })

    it('un opcional vacío queda en null, nunca en cadena vacía (regla #5)', () => {
      const fila = filaValida({ [COL.EMAIL]: '   ', [COL.CELULAR]: '' })
      expect(fila.persona.email).toBeNull()
      expect(fila.persona.telefono).toBeNull()
    })
  })

  describe('columnas', () => {
    it('compara sin acentos ni mayúsculas', () => {
      expect(columnasFaltantes(COLUMNAS_REQUERIDAS)).toEqual([])
      expect(columnasFaltantes(COLUMNAS_REQUERIDAS.map((c) => c.toUpperCase()))).toEqual(
        []
      )
    })

    it('dice exactamente cuáles faltan', () => {
      const sinCurp = COLUMNAS_REQUERIDAS.filter((c) => c !== COL.CURP)
      expect(columnasFaltantes(sinCurp)).toEqual([COL.CURP])
      expect(columnasFaltantes([])).toEqual([...COLUMNAS_REQUERIDAS])
    })
  })

  it('reparte las columnas por SENSIBILIDAD, no por origen (D-63)', () => {
    const fila = filaValida({
      [COL.SALARIO_DIARIO]: 1146.95,
      [COL.SBC_PARTE_FIJA]: 1209.8,
      [COL.SBC_PARTE_VARIABLE]: 0,
      [COL.SBC_TOPE_UMA]: 1209.8,
      [COL.BASE_COTIZACION]: 'Fijo',
      [COL.REGISTRO_PATRONAL]: 'R13-77767-10-5',
      [COL.PERIODICIDAD_PAGO]: 'Semanal Cames',
      [COL.TELETRABAJADOR]: false,
      [COL.CUENTA]: '072320010550241376'
    })

    // Importes y datos bancarios: no se muestran hasta decidir permisos.
    expect(fila.adscripcion.nomina).toEqual({
      salarioDiario: 1146.95,
      sbcParteFija: 1209.8,
      sbcParteVariable: 0,
      sbcTopeUMA: 1209.8,
      banco: null,
      sucursal: null,
      cuenta: '072320010550241376'
    })

    // Condiciones laborales: se muestran como cualquier otro campo.
    expect(fila.adscripcion.condiciones).toMatchObject({
      baseCotizacion: 'Fijo',
      registroPatronal: 'R13-77767-10-5',
      periodicidadPago: 'Semanal Cames',
      teletrabajador: false
    })
    // Y ningún importe se coló al grupo que sí se muestra.
    expect(Object.keys(fila.adscripcion.condiciones)).not.toContain('salarioDiario')
    expect(Object.keys(fila.adscripcion.condiciones)).not.toContain('cuenta')
    // De la persona desde D-54, aunque la columna venga en la misma fila.
    expect(fila.persona.numeroEmpleado).toBe('0001')
  })
})
