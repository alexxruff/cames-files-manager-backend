const ExcelJS = require('exceljs')
const { AppError } = require('../middlewares/errorHandler')
const { normalize } = require('./text')

/**
 * Lectura de hojas de cálculo — envoltura fina sobre `exceljs`.
 *
 * Este archivo sabe de FORMATO, no de dominio: entrega filas con valores de
 * JavaScript planos (`string`, `number`, `boolean`, `Date`, `null`) y nada más.
 * La traducción a empleados y adscripciones vive en
 * `utils/domain/employeeImport.js`, que es puro y no depende de `exceljs`.
 *
 * ─── Las dos cosas que no son obvias ─────────────────────────────────────────
 *
 * **1. Las fechas NO se convierten aquí.** `exceljs` devuelve un `Date` a
 * medianoche **UTC** del día civil que dice la celda. Convertirlo a
 * `YYYY-MM-DD` es una decisión de dominio (D-09) y se hace en el mapeo, con su
 * propia prueba: si se hiciera aquí con `getDate()`, en México saldría el día
 * anterior en TODAS las fechas del archivo.
 *
 * **2. La fila de encabezados se busca, no se supone.** Los reportes de nómina
 * traen dos o tres renglones de título antes de la tabla (en el de Urbacames
 * son cuatro), y el número cambia entre versiones del reporte. Se localiza la
 * fila que más columnas esperadas contiene: así un archivo "parecido" con un
 * renglón más de encabezado sigue funcionando.
 */

/** `PK\x03\x04` — un .xlsx es un ZIP. Lo que no empieza así no se intenta abrir. */
const FIRMA_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04])

/** Hasta dónde se busca la fila de encabezados. */
const MAX_FILAS_ENCABEZADO = 25

/** Coincidencias mínimas para aceptar una fila como la de los encabezados. */
const MIN_COLUMNAS_RECONOCIDAS = 3

/** ¿El contenido es un libro de Excel? Se mira el contenido, no la extensión. */
function esLibroExcel(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length > FIRMA_ZIP.length &&
    buffer.subarray(0, FIRMA_ZIP.length).equals(FIRMA_ZIP)
  )
}

/**
 * Aplana el valor de una celda de `exceljs` a un valor de JavaScript.
 *
 * `cell.value` no siempre es un escalar: puede ser texto enriquecido, una
 * fórmula con su resultado, un hipervínculo o un error de Excel. Sin esto,
 * `String(valor)` sobre una celda con formato daría `[object Object]`.
 */
function valorPlano(valor) {
  if (valor === null || valor === undefined) return null
  if (valor instanceof Date) return valor

  if (typeof valor === 'object') {
    if (Array.isArray(valor.richText)) {
      return valorPlano(valor.richText.map((t) => t.text).join(''))
    }
    if ('formula' in valor || 'sharedFormula' in valor) return valorPlano(valor.result)
    if ('text' in valor) return valorPlano(valor.text)
    // `{ error: '#N/A' }` y cualquier otra cosa: se trata como vacío.
    return null
  }

  if (typeof valor === 'string') {
    const texto = valor.trim()
    return texto === '' ? null : texto
  }
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null
  if (typeof valor === 'boolean') return valor

  return null
}

/** Texto de una celda de encabezado, o null si está vacía. */
function textoDeCelda(celda) {
  const valor = valorPlano(celda?.value)
  if (valor === null) return null
  return valor instanceof Date ? valor.toISOString() : String(valor).trim() || null
}

/**
 * Busca la fila de encabezados: la que más nombres de `columnasEsperadas`
 * contiene, comparando sin acentos ni mayúsculas.
 *
 * @returns {{numero: number, columnas: Array<{indice: number, nombre: string}>}|null}
 */
function localizarEncabezados(hoja, columnasEsperadas) {
  const buscadas = new Set(columnasEsperadas.map((c) => normalize(c)))
  const hasta = Math.min(hoja.rowCount, MAX_FILAS_ENCABEZADO)

  let mejor = null
  for (let numero = 1; numero <= hasta; numero += 1) {
    const columnas = []
    let reconocidas = 0

    hoja.getRow(numero).eachCell({ includeEmpty: false }, (celda, indice) => {
      const nombre = textoDeCelda(celda)
      if (!nombre) return
      columnas.push({ indice, nombre })
      if (buscadas.has(normalize(nombre))) reconocidas += 1
    })

    if (
      reconocidas >= MIN_COLUMNAS_RECONOCIDAS &&
      (!mejor || reconocidas > mejor.reconocidas)
    ) {
      mejor = { numero, columnas, reconocidas }
    }
  }

  return mejor ? { numero: mejor.numero, columnas: mejor.columnas } : null
}

/**
 * Pares etiqueta → valor del bloque de título, arriba de la tabla.
 *
 * El reporte de nómina pone ahí la empresa y su RFC (`EMPRESA | MAQUINARIA
 * CAMES`), y eso es lo que permite avisar cuando el archivo no es de la empresa
 * a la que se está importando. Se leen las dos primeras columnas con texto de
 * cada fila anterior a los encabezados.
 */
function leerMeta(hoja, hastaFila) {
  const meta = {}
  for (let numero = 1; numero < hastaFila; numero += 1) {
    const celdas = []
    hoja.getRow(numero).eachCell({ includeEmpty: false }, (celda) => {
      const texto = textoDeCelda(celda)
      if (texto) celdas.push(texto)
    })
    if (celdas.length >= 2) meta[normalize(celdas[0])] = celdas[1]
  }
  return meta
}

/**
 * Lee la primera hoja de un .xlsx.
 *
 * @param {Buffer} buffer contenido del archivo
 * @param {object} opciones
 * @param {string[]} opciones.columnasEsperadas nombres con los que se localiza
 *   la fila de encabezados (comparados sin acentos ni mayúsculas)
 * @param {number} [opciones.maxFilas] tope de filas de datos; más allá, 400
 * @returns {Promise<{
 *   hoja: string,
 *   filaEncabezados: number,
 *   columnas: string[],
 *   meta: Record<string, string>,
 *   filas: Array<{numero: number, celdas: Record<string, any>}>
 * }>} `celdas` va indexado por el nombre de la columna **normalizado**, para que
 *   "Correo electrónico" y "CORREO ELECTRONICO" den la misma llave.
 */
async function leerHoja(buffer, { columnasEsperadas = [], maxFilas = 10000 } = {}) {
  if (!esLibroExcel(buffer)) {
    throw new AppError(
      415,
      'El archivo no es una hoja de cálculo de Excel (.xlsx). Guárdalo como .xlsx y vuelve a intentarlo.'
    )
  }

  const libro = new ExcelJS.Workbook()
  try {
    await libro.xlsx.load(buffer)
  } catch {
    throw new AppError(400, 'No se pudo leer el archivo de Excel: puede estar dañado')
  }

  const hoja = libro.worksheets[0]
  if (!hoja || hoja.rowCount === 0) {
    throw new AppError(400, 'El archivo no tiene ninguna hoja con datos')
  }

  const encabezados = localizarEncabezados(hoja, columnasEsperadas)
  if (!encabezados) {
    throw new AppError(
      400,
      'No se encontró la fila de encabezados: el archivo no tiene las columnas esperadas'
    )
  }

  const columnas = encabezados.columnas
  const filas = []

  for (let numero = encabezados.numero + 1; numero <= hoja.rowCount; numero += 1) {
    const fila = hoja.getRow(numero)
    const celdas = {}
    let tieneAlgo = false

    for (const { indice, nombre } of columnas) {
      const valor = valorPlano(fila.getCell(indice).value)
      // Columna repetida: gana la primera con valor, no la última vacía.
      const llave = normalize(nombre)
      if (celdas[llave] === undefined || (celdas[llave] === null && valor !== null)) {
        celdas[llave] = valor
      }
      if (valor !== null) tieneAlgo = true
    }

    // Las hojas traen filas vacías al final (totales borrados, formato suelto).
    if (!tieneAlgo) continue

    if (filas.length >= maxFilas) {
      throw new AppError(
        400,
        `El archivo tiene más de ${maxFilas} filas. Divídelo antes de importarlo.`
      )
    }
    filas.push({ numero, celdas })
  }

  if (filas.length === 0) {
    throw new AppError(
      400,
      'El archivo no tiene ninguna fila de datos debajo de los encabezados'
    )
  }

  return {
    hoja: hoja.name,
    filaEncabezados: encabezados.numero,
    columnas: columnas.map((c) => c.nombre),
    meta: leerMeta(hoja, encabezados.numero),
    filas
  }
}

module.exports = { leerHoja, esLibroExcel, valorPlano, localizarEncabezados }
