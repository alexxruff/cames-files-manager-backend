const ExcelJS = require('exceljs')
const { COL } = require('../../src/utils/domain/employeeImport')

/**
 * Genera archivos .xlsx con la MISMA forma que el reporte de nómina real.
 *
 * ─── Por qué no se usa el archivo real como fixture ──────────────────────────
 * `docs/Colaboradores_20260824.xlsx` trae CURP, NSS, salario y número de cuenta
 * de 145 personas reales. El servicio de importación se niega a guardarlo —ni a
 * R2 ni a disco— justo para no tener un segundo lugar del que se puedan filtrar;
 * committearlo al repo, donde queda para siempre y en cada clon, sería peor que
 * lo que ese cuidado evita.
 *
 * Así que las pruebas construyen archivos con la misma **estructura** y los
 * mismos **casos borde** que el real, con datos inventados:
 *
 * - Cuatro renglones de título antes de la tabla, con `EMPRESA` y `RFC` (es de
 *   ahí de donde sale la validación de que el archivo sea de esta empresa).
 * - Las 30 columnas, con sus nombres y acentos exactos.
 * - Las fechas como `Date` a **medianoche UTC**, que es lo que entrega `exceljs`
 *   y la trampa de D-09.
 * - Los códigos del SAT en el tipo de contrato, los tres estatus, puestos con y
 *   sin acento, y departamentos que en realidad son obras.
 *
 * Además, `tests/integracion/employeesImport.test.js` corre una prueba extra
 * contra el archivo real **si está presente**, y se salta si no: así el equipo
 * lo comprueba con sus 145 filas sin que el repo cargue con ellas.
 */

/** Las 30 columnas del reporte, en su orden. */
const COLUMNAS = Object.freeze([
  COL.ID,
  COL.NOMBRE,
  COL.PRIMER_APELLIDO,
  COL.SEGUNDO_APELLIDO,
  COL.RFC,
  COL.CURP,
  COL.ESTATUS,
  COL.FECHA_NACIMIENTO,
  COL.CELULAR,
  COL.EMAIL,
  COL.FECHA_INGRESO,
  COL.TIPO_CONTRATO,
  COL.TIPO_REGIMEN,
  COL.PERIODICIDAD_PAGO,
  COL.TURNO,
  COL.TIPO_PRESTACION,
  COL.ZONA_SALARIO,
  COL.SALARIO_DIARIO,
  COL.DEPARTAMENTO,
  COL.PUESTO,
  COL.NSS,
  COL.REGISTRO_PATRONAL,
  COL.BASE_COTIZACION,
  COL.SBC_PARTE_FIJA,
  COL.SBC_PARTE_VARIABLE,
  COL.SBC_TOPE_UMA,
  COL.BANCO,
  COL.SUCURSAL,
  COL.CUENTA,
  COL.TELETRABAJADOR
])

/** Códigos del SAT tal como los escribe el reporte. */
const CONTRATOS = Object.freeze({
  indeterminado: '01 Contrato de trabajo por tiempo indeterminado',
  obra_determinada: '02 Contrato de trabajo por obra determinada',
  determinado: '03 Contrato de trabajo por tiempo determinado',
  prueba: '05 Contrato de trabajo sujeto a prueba',
  capacitacion_inicial: '06 Contrato de trabajo con capacitación inicial'
})

/** `'2021-09-20'` → el `Date` a medianoche UTC que entregaría `exceljs`. */
function fechaDeCelda(fecha) {
  if (fecha === null || fecha === undefined) return null
  const [anio, mes, dia] = String(fecha).split('-').map(Number)
  return new Date(Date.UTC(anio, mes - 1, dia))
}

const PREDETERMINADOS = Object.freeze({
  estatus: 'Alta',
  contrato: 'indeterminado',
  puesto: 'Operador',
  departamento: 'Operaciones',
  fechaIngreso: '2021-09-20',
  fechaNacimiento: '1982-05-25',
  salarioDiario: 1146.95
})

/**
 * Una fila del reporte. Sólo hace falta pasar lo que se quiere distinto.
 *
 * @param {object} datos
 * @param {string} [datos.contrato] llave de nuestro enum; se escribe el código
 *   del SAT correspondiente. Para probar un contrato desconocido, usa `contratoCrudo`.
 */
function fila(datos = {}) {
  const d = { ...PREDETERMINADOS, ...datos }
  return {
    [COL.ID]: d.id ?? null,
    [COL.NOMBRE]: d.nombre ?? null,
    [COL.PRIMER_APELLIDO]: d.primerApellido ?? null,
    [COL.SEGUNDO_APELLIDO]: d.segundoApellido ?? null,
    [COL.RFC]: d.rfc ?? null,
    [COL.CURP]: d.curp ?? null,
    [COL.ESTATUS]: d.estatus ?? null,
    [COL.FECHA_NACIMIENTO]: fechaDeCelda(d.fechaNacimiento),
    [COL.CELULAR]: d.celular ?? null,
    [COL.EMAIL]: d.email ?? null,
    [COL.FECHA_INGRESO]:
      d.fechaIngresoCruda !== undefined
        ? d.fechaIngresoCruda
        : fechaDeCelda(d.fechaIngreso),
    [COL.TIPO_CONTRATO]:
      d.contratoCrudo !== undefined ? d.contratoCrudo : (CONTRATOS[d.contrato] ?? null),
    [COL.TIPO_REGIMEN]: '02 Sueldos',
    [COL.PERIODICIDAD_PAGO]: d.periodicidadPago ?? 'Semanal Cames',
    [COL.TURNO]: 'Turno diurno',
    [COL.TIPO_PRESTACION]: 'De ley',
    [COL.ZONA_SALARIO]: 'Resto del país',
    [COL.SALARIO_DIARIO]: d.salarioDiario ?? null,
    [COL.DEPARTAMENTO]: d.departamento ?? null,
    [COL.PUESTO]: d.puesto ?? null,
    [COL.NSS]: d.nss ?? null,
    [COL.REGISTRO_PATRONAL]: d.registroPatronal ?? 'R13-77767-10-5',
    [COL.BASE_COTIZACION]: d.baseCotizacion ?? 'Fijo',
    [COL.SBC_PARTE_FIJA]: d.sbcParteFija ?? 1209.8,
    [COL.SBC_PARTE_VARIABLE]: d.sbcParteVariable ?? 0,
    [COL.SBC_TOPE_UMA]: d.sbcTopeUMA ?? 1209.8,
    [COL.BANCO]: d.banco ?? 'N/A',
    [COL.SUCURSAL]: d.sucursal ?? null,
    [COL.CUENTA]: d.cuenta ?? null,
    [COL.TELETRABAJADOR]: d.teletrabajador ?? false
  }
}

/**
 * Construye el .xlsx y devuelve su `Buffer`.
 *
 * @param {object} opciones
 * @param {Array<object>} opciones.filas filas ya armadas con `fila()`
 * @param {string} [opciones.empresa] lo que va en el encabezado `EMPRESA`
 * @param {string} [opciones.rfc] lo que va en el encabezado `RFC`
 * @param {string[]} [opciones.columnas] para probar un archivo al que le faltan
 * @param {boolean} [opciones.sinEncabezadoEmpresa] omite los renglones de título
 */
async function construirArchivo({
  filas = [],
  empresa = 'MAQUINARIA CAMES',
  rfc = 'MCA180611HF1',
  columnas = COLUMNAS,
  sinEncabezadoEmpresa = false
} = {}) {
  const libro = new ExcelJS.Workbook()
  const hoja = libro.addWorksheet('Hoja 1')

  if (!sinEncabezadoEmpresa) {
    hoja.addRow(['CONSULTA', 'COLABORADORES'])
    hoja.addRow(['EMPRESA', empresa])
    hoja.addRow(['RFC', rfc])
    hoja.addRow([''])
  }

  hoja.addRow(columnas)
  for (const registro of filas) {
    hoja.addRow(columnas.map((columna) => registro[columna] ?? null))
  }

  const buffer = await libro.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

/** Una CURP y un RFC válidos y distintos por índice, para generar N personas. */
function identidad(indice) {
  const consonantes = 'BCDFGHJKLMNPQRSTVWXZ'
  const a = consonantes[indice % 20]
  const b = consonantes[(indice + 7) % 20]
  const dia = String((indice % 28) + 1).padStart(2, '0')
  const mes = String((indice % 12) + 1).padStart(2, '0')
  return {
    curp: `XA${a}${b}90${mes}${dia}HJC${a}${b}${a}0${indice % 10}`,
    rfc: `XA${a}${b}90${mes}${dia}${a}${b}${indice % 10}`
  }
}

module.exports = { construirArchivo, fila, identidad, fechaDeCelda, COLUMNAS, CONTRATOS }
