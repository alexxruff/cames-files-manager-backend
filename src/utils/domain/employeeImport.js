const { isCalendarDate } = require('../dates')
const { normalize } = require('../text')
const { CONTRACT_TYPES, isTemporaryContract } = require('../../constants')

/**
 * Traducción del archivo de nómina a nuestro modelo. **Función pura**: no toca
 * la base, no lee el sistema de archivos y no depende de `exceljs`.
 *
 * Recibe una fila ya aplanada por `utils/spreadsheet.js` (valores de JavaScript
 * planos, indexados por el nombre de la columna normalizado) y devuelve la
 * persona, su adscripción, los avisos y los errores de esa fila. Que sea pura es
 * lo que permite probar los 19 puestos, los 5 tipos de contrato y las 280 fechas
 * reales del archivo sin levantar Mongo.
 *
 * Lo que decide este archivo, y por qué:
 *
 * - **Las fechas se extraen en UTC.** `exceljs` entrega un `Date` a medianoche
 *   UTC del día civil correcto. Sacar el día con `getDate()` en un servidor en
 *   GMT-6 da el día ANTERIOR en las 280 fechas del archivo — es exactamente el
 *   bug de D-09, y hay una prueba dedicada a que no vuelva.
 * - **Nada se inventa.** Lo que no se puede traducir con certeza no se rellena
 *   con un valor plausible: se deja en `null` y se levanta un aviso, para que
 *   aparezca en la previsualización antes de escribir nada.
 */

// ─── Columnas ─────────────────────────────────────────────────────────────────

/**
 * Nombres tal como vienen en el reporte. Se comparan normalizados (sin acentos
 * ni mayúsculas), así que "Correo electrónico" y "CORREO ELECTRONICO" son la
 * misma columna.
 */
const COL = Object.freeze({
  ID: 'ID',
  NOMBRE: 'Nombre',
  PRIMER_APELLIDO: 'Primer Apellido',
  SEGUNDO_APELLIDO: 'Segundo Apellido',
  RFC: 'RFC',
  CURP: 'CURP',
  ESTATUS: 'Estatus',
  FECHA_NACIMIENTO: 'Fecha de nacimiento',
  CELULAR: 'Celular',
  EMAIL: 'Correo electrónico',
  FECHA_INGRESO: 'Fecha de ingreso',
  TIPO_CONTRATO: 'Tipo de contrato',
  TIPO_REGIMEN: 'Tipo de régimen',
  PERIODICIDAD_PAGO: 'Periodicidad de pago',
  TURNO: 'Turno',
  TIPO_PRESTACION: 'Tipo de prestación',
  ZONA_SALARIO: 'Zona de salario',
  SALARIO_DIARIO: 'Salario diario',
  DEPARTAMENTO: 'Departamento',
  PUESTO: 'Puesto',
  NSS: 'NSS',
  REGISTRO_PATRONAL: 'Registro patronal',
  BASE_COTIZACION: 'Base de cotización',
  SBC_PARTE_FIJA: 'SBC Parte Fija',
  SBC_PARTE_VARIABLE: 'SBC Parte Variable',
  SBC_TOPE_UMA: 'SBC (tope 25 UMA)',
  BANCO: 'Banco',
  SUCURSAL: 'Sucursal',
  CUENTA: 'Cuenta',
  TELETRABAJADOR: 'Teletrabajador'
})

/**
 * Sin estas columnas no se puede dar de alta a nadie con seguridad, así que el
 * archivo se rechaza entero con un 400 que dice cuáles faltan.
 *
 * La CURP está aquí aunque el modelo la permita nula (D-28): es la llave con la
 * que la RE-importación reconoce a quien ya existe. Sin ella, subir el archivo
 * dos veces duplicaría a las 145 personas.
 */
const COLUMNAS_REQUERIDAS = Object.freeze([
  COL.ID,
  COL.NOMBRE,
  COL.PRIMER_APELLIDO,
  COL.RFC,
  COL.CURP,
  COL.ESTATUS,
  COL.FECHA_INGRESO,
  COL.TIPO_CONTRATO,
  COL.PUESTO
])

/** Etiquetas del bloque de título que se usan para validar la empresa destino. */
const META_EMPRESA = 'empresa'
const META_RFC = 'rfc'

// ─── Catálogos de traducción ──────────────────────────────────────────────────

/**
 * Tipo de contrato. El archivo trae los códigos del catálogo del SAT
 * (`02 Contrato de trabajo por obra determinada`), que mapean 1:1 con nuestro
 * enum. Se resuelve primero por código —es estable— y sólo si no lo trae se
 * intenta por texto.
 */
const CONTRATO_POR_CODIGO = Object.freeze({
  '01': 'indeterminado',
  '02': 'obra_determinada',
  '03': 'determinado',
  '04': 'obra_determinada',
  '05': 'prueba',
  '06': 'capacitacion_inicial',
  '07': 'indeterminado',
  99: 'indeterminado'
})

/*
 * Por texto, en ESTE orden: "obra determinada" contiene "determinada", así que
 * mirar primero el genérico clasificaría los 85 contratos de obra como
 * `determinado`.
 */
const CONTRATO_POR_TEXTO = Object.freeze([
  ['obra determinada', 'obra_determinada'],
  ['obra o tiempo determinado', 'obra_determinada'],
  ['capacitacion', 'capacitacion_inicial'],
  ['prueba', 'prueba'],
  ['tiempo indeterminado', 'indeterminado'],
  ['indeterminado', 'indeterminado'],
  ['tiempo determinado', 'determinado'],
  ['determinado', 'determinado']
])

/** `Alta` y `Reingreso` son gente trabajando hoy; `Baja` ya no. */
const ESTATUS_ACTIVO = Object.freeze({ alta: true, reingreso: true, baja: false })

/**
 * Palabras del puesto que lo hacen personal de obra. Todo lo demás es
 * administrativo.
 *
 * Es una lista, no un catálogo en la base, a propósito: se revisa de un vistazo
 * y la previsualización muestra el resultado de cada puesto antes de aplicar,
 * así que un puesto mal clasificado se ve y se corrige aquí. Si una categoría ya
 * existe en el catálogo, **manda su tipo** y esta lista no se consulta.
 */
const PALABRAS_MANO_DE_OBRA = Object.freeze([
  'operador',
  'ayudante',
  'peon',
  'segurista',
  'topografo',
  'albanil',
  'oficial',
  'chofer',
  'velador',
  'soldador',
  'electricista',
  'carpintero',
  'fierrero',
  'mecanico',
  'jardinero',
  'limpieza'
])

/**
 * Departamento → área. Sólo los que **son** áreas de la organización.
 *
 * `Axis Zapopan`, `Axis 3`, `Plenares`, `Kulkana` y `FlexPark` son OBRAS, no
 * departamentos: 53 de las 145 filas. Mapearlas a un área sería inventar un
 * dato, así que caen al área por defecto según el tipo y el nombre original se
 * conserva en `adscripcion.departamento`, que es donde de verdad dice en qué
 * obra está la persona. Cuando existan proyectos de verdad, de ahí sale la
 * asignación (que es una decisión, no un efecto secundario de importar).
 */
/** Valores de relleno del reporte que significan "sin dato". */
const RELLENOS = Object.freeze(['n/a', 'na', 'n.a.', 'no aplica', 'sin dato', '-', '--'])

// ─── Conversiones ─────────────────────────────────────────────────────────────

const leer = (celdas, columna) => {
  const valor = celdas[normalize(columna)]
  return valor === undefined ? null : valor
}

/** Texto limpio, o `null`. Un opcional vacío es `null`, nunca `''` (regla #5). */
function aTexto(valor) {
  if (valor === null || valor === undefined) return null
  if (valor instanceof Date) return valor.toISOString()
  const texto = String(valor).trim().replace(/\s+/g, ' ')
  if (texto === '') return null
  return RELLENOS.includes(texto.toLowerCase()) ? null : texto
}

/**
 * Fecha de calendario `YYYY-MM-DD` (D-09).
 *
 * **En UTC, y esto no es un detalle**: `exceljs` devuelve la medianoche UTC del
 * día que dice la celda. `toISOString()` recupera ese mismo día; leerlo con
 * `getFullYear()/getMonth()/getDate()` en un servidor al oeste de Greenwich
 * devuelve el día anterior.
 *
 * También acepta texto, para archivos exportados con las fechas ya como cadena:
 * `YYYY-MM-DD` (con o sin hora) y `DD/MM/YYYY`, que es la convención en México.
 */
function aFechaCalendario(valor) {
  if (valor === null || valor === undefined || valor === '') return null

  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null
    return valor.toISOString().slice(0, 10)
  }

  const texto = String(valor).trim()
  if (isCalendarDate(texto)) return texto

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(texto)
  if (iso) {
    const fecha = `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
    return isCalendarDate(fecha) ? fecha : null
  }

  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(texto)
  if (dmy) {
    const fecha = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
    return isCalendarDate(fecha) ? fecha : null
  }

  return null
}

/** Número, tolerando `$`, comas y espacios. `null` si no se puede leer. */
function aNumero(valor) {
  if (valor === null || valor === undefined || valor === '') return null
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null
  const limpio = String(valor).replace(/[$\s,]/g, '')
  if (limpio === '') return null
  const numero = Number(limpio)
  return Number.isFinite(numero) ? numero : null
}

/** Booleano tolerante: `Sí`, `1`, `true` y `X` son verdad; el resto, falso. */
function aBooleano(valor) {
  if (typeof valor === 'boolean') return valor
  if (valor === null || valor === undefined || valor === '') return false
  if (typeof valor === 'number') return valor !== 0
  return ['si', 'sí', 'true', 'verdadero', '1', 'x'].includes(
    String(valor).trim().toLowerCase()
  )
}

/** Sólo dígitos: los NSS y las cuentas vienen a veces con guiones o espacios. */
const soloDigitos = (texto) => (texto === null ? null : texto.replace(/\D/g, '') || null)

// ─── Traducciones de dominio ──────────────────────────────────────────────────

/** `'02 Contrato de trabajo por obra determinada'` → `'obra_determinada'`. */
function tipoContratoDesde(valor) {
  const texto = aTexto(valor)
  if (!texto) return null

  const codigo = /^(\d{2})\b/.exec(texto)
  if (codigo && CONTRATO_POR_CODIGO[codigo[1]]) return CONTRATO_POR_CODIGO[codigo[1]]

  // Ya viene con nuestro propio enum (un archivo generado por nosotros).
  if (CONTRACT_TYPES.includes(texto)) return texto

  const normalizado = normalize(texto)
  const porTexto = CONTRATO_POR_TEXTO.find(([clave]) => normalizado.includes(clave))
  return porTexto ? porTexto[1] : null
}

/** `Alta`/`Reingreso` → activo; `Baja` → inactivo. `null` si no se reconoce. */
function activoDesdeEstatus(valor) {
  const texto = aTexto(valor)
  if (!texto) return null
  const activo = ESTATUS_ACTIVO[normalize(texto)]
  return activo === undefined ? null : activo
}

/**
 * Puesto → tipo de persona, por palabras del puesto.
 *
 * Se compara por palabra completa y no con `includes` suelto: "Coordinador de
 * Recursos Humanos" no debe volverse mano de obra por contener "operac"…, y
 * "Gerente de Obra" —que es administrativo— no cae en la lista porque "obra" no
 * está en ella.
 */
function tipoEmpleadoDesdePuesto(puesto) {
  const normalizado = normalize(aTexto(puesto) || '')
  if (!normalizado) return 'administrativo'
  const palabras = normalizado.split(/[^a-z0-9]+/).filter(Boolean)
  return palabras.some((palabra) => PALABRAS_MANO_DE_OBRA.includes(palabra))
    ? 'mano_de_obra'
    : 'administrativo'
}

/*
 * `areasDesdeDepartamento` se fue en D-58.
 *
 * Traducía la columna `Departamento` con un mapa fijo escrito aquí, y lo que no
 * estaba en el mapa caía a un área por defecto inventada (`obra` /
 * `administracion`) que no tenía nada que ver con lo que decía el archivo. Ahora
 * el departamento se resuelve contra el CATÁLOGO de áreas y, si no existe, se
 * crea como área temporal — pero eso toca la base y no cabe en este módulo, que
 * es de reglas puras. Vive en `employeeImportService.#resolverAreas`.
 */

/** Nombre completo a partir de las tres columnas del archivo. */
function nombreCompleto(celdas) {
  return [
    aTexto(leer(celdas, COL.NOMBRE)),
    aTexto(leer(celdas, COL.PRIMER_APELLIDO)),
    aTexto(leer(celdas, COL.SEGUNDO_APELLIDO))
  ]
    .filter(Boolean)
    .join(' ')
    .trim()
}

const CURP_VALIDA = /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/
const RFC_VALIDO = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/

// ─── El mapeo de una fila ─────────────────────────────────────────────────────

/**
 * Traduce una fila del archivo a persona + adscripción.
 *
 * No lanza: acumula `errores` (la fila no se puede importar) y `avisos` (se
 * importa, pero hay algo que la persona que importa debe saber). Así una fila
 * mala no tumba las otras 144, y todo sale en la previsualización.
 *
 * @param {{numero: number, celdas: Record<string, any>}} fila
 * @returns {{
 *   fila: number,
 *   persona: object,
 *   adscripcion: object,
 *   puesto: string|null,
 *   estatus: string|null,
 *   departamento: string|null,
 *   errores: string[],
 *   avisos: string[]
 * }}
 */
function mapearFila({ numero, celdas }) {
  const errores = []
  const avisos = []

  // ─── Identidad ───────────────────────────────────────────────────────────
  const nombre = nombreCompleto(celdas)
  if (!nombre) errores.push('La fila no trae nombre')
  else if (nombre.length < 3) errores.push(`El nombre "${nombre}" es demasiado corto`)

  const curpCruda = aTexto(leer(celdas, COL.CURP))
  const curp = curpCruda ? curpCruda.toUpperCase().replace(/\s/g, '') : null
  if (!curp) {
    errores.push(
      'La fila no trae CURP, y sin ella no se puede reconocer a la persona al volver a importar'
    )
  } else if (!CURP_VALIDA.test(curp)) {
    errores.push(`La CURP "${curp}" no tiene un formato válido`)
  }

  const rfcCrudo = aTexto(leer(celdas, COL.RFC))
  let rfc = rfcCrudo ? rfcCrudo.toUpperCase().replace(/[\s-]/g, '') : null
  if (rfc && !RFC_VALIDO.test(rfc)) {
    avisos.push(`El RFC "${rfc}" no tiene un formato válido; se importa sin RFC`)
    rfc = null
  }

  let nss = soloDigitos(aTexto(leer(celdas, COL.NSS)))
  if (nss && nss.length > 11) {
    avisos.push(`El NSS "${nss}" tiene más de 11 dígitos; se importa sin NSS`)
    nss = null
  }

  const fechaNacimientoCruda = leer(celdas, COL.FECHA_NACIMIENTO)
  const fechaNacimiento = aFechaCalendario(fechaNacimientoCruda)
  if (fechaNacimientoCruda !== null && fechaNacimiento === null) {
    avisos.push('No se pudo leer la fecha de nacimiento; se importa sin ella')
  }

  const email = aTexto(leer(celdas, COL.EMAIL))
  const telefono = soloDigitos(aTexto(leer(celdas, COL.CELULAR)))

  // ─── Puesto y tipo ───────────────────────────────────────────────────────
  const puesto = aTexto(leer(celdas, COL.PUESTO))
  if (!puesto) errores.push('La fila no trae puesto')
  const tipo = tipoEmpleadoDesdePuesto(puesto)

  const numeroEmpleado = aTexto(leer(celdas, COL.ID))

  // ─── Relación laboral ────────────────────────────────────────────────────

  const fechaIngresoCruda = leer(celdas, COL.FECHA_INGRESO)
  const fechaIngreso = aFechaCalendario(fechaIngresoCruda)
  if (!fechaIngreso) {
    errores.push(
      fechaIngresoCruda === null
        ? 'La fila no trae fecha de ingreso'
        : 'No se pudo leer la fecha de ingreso'
    )
  }

  const estatus = aTexto(leer(celdas, COL.ESTATUS))
  const activo = activoDesdeEstatus(estatus)
  if (activo === null) {
    errores.push(
      estatus
        ? `Estatus no reconocido: "${estatus}". Se esperaba Alta, Baja o Reingreso`
        : 'La fila no trae estatus'
    )
  }

  const contratoCrudo = aTexto(leer(celdas, COL.TIPO_CONTRATO))
  const tipoContrato = tipoContratoDesde(contratoCrudo)
  if (!tipoContrato) {
    errores.push(
      contratoCrudo
        ? `Tipo de contrato no reconocido: "${contratoCrudo}"`
        : 'La fila no trae tipo de contrato'
    )
  }

  /*
   * El departamento se lee tal cual; el área que le corresponde la resuelve el
   * servicio contra el catálogo (D-58). Aquí no se decide nada: hacerlo exigiría
   * consultar la base, y este módulo es de reglas puras.
   */
  const departamento = aTexto(leer(celdas, COL.DEPARTAMENTO))

  /*
   * El archivo NO trae fecha de término, y 99 de 145 tienen contrato temporal.
   * En vez de rechazarlas, entran con la fecha pendiente: `datosPendientes` es
   * lo que releva al modelo de exigirla, y lo que permite listar después a quién
   * le falta. Ver D-46.
   */
  const datosPendientes = []
  if (tipoContrato && isTemporaryContract(tipoContrato)) {
    datosPendientes.push('fechaTerminoContrato')
  }

  return {
    fila: numero,
    puesto,
    estatus,
    departamento,
    persona: {
      nombre,
      numeroEmpleado,
      curp,
      rfc,
      nss,
      fechaNacimiento,
      email,
      telefono,
      tipo
    },
    adscripcion: {
      departamento,
      // Las llena `#resolverAreas` con la clave del catálogo (D-58).
      areas: [],
      tipoContrato,
      fechaIngreso,
      fechaTerminoContrato: null,
      datosPendientes,
      activo,
      nomina: {
        salarioDiario: aNumero(leer(celdas, COL.SALARIO_DIARIO)),
        sbcParteFija: aNumero(leer(celdas, COL.SBC_PARTE_FIJA)),
        sbcParteVariable: aNumero(leer(celdas, COL.SBC_PARTE_VARIABLE)),
        sbcTopeUMA: aNumero(leer(celdas, COL.SBC_TOPE_UMA)),
        baseCotizacion: aTexto(leer(celdas, COL.BASE_COTIZACION)),
        zonaSalario: aTexto(leer(celdas, COL.ZONA_SALARIO)),
        tipoPrestacion: aTexto(leer(celdas, COL.TIPO_PRESTACION)),
        periodicidadPago: aTexto(leer(celdas, COL.PERIODICIDAD_PAGO)),
        turno: aTexto(leer(celdas, COL.TURNO)),
        tipoRegimen: aTexto(leer(celdas, COL.TIPO_REGIMEN)),
        registroPatronal: aTexto(leer(celdas, COL.REGISTRO_PATRONAL)),
        teletrabajador: aBooleano(leer(celdas, COL.TELETRABAJADOR)),
        banco: aTexto(leer(celdas, COL.BANCO)),
        sucursal: aTexto(leer(celdas, COL.SUCURSAL)),
        cuenta: soloDigitos(aTexto(leer(celdas, COL.CUENTA)))
      }
    },
    errores,
    avisos
  }
}

/** Columnas del archivo que faltan, comparando sin acentos ni mayúsculas. */
function columnasFaltantes(columnas) {
  const presentes = new Set((columnas || []).map((c) => normalize(c)))
  return COLUMNAS_REQUERIDAS.filter((c) => !presentes.has(normalize(c)))
}

module.exports = {
  COL,
  COLUMNAS_REQUERIDAS,
  META_EMPRESA,
  META_RFC,
  PALABRAS_MANO_DE_OBRA,
  mapearFila,
  columnasFaltantes,
  aFechaCalendario,
  aNumero,
  aTexto,
  aBooleano,
  tipoContratoDesde,
  activoDesdeEstatus,
  tipoEmpleadoDesdePuesto,
  nombreCompleto
}
