/**
 * Esqueleto real del backend: qué colecciones, campos, índices y rutas EXISTEN.
 *
 * POR QUÉ EXISTE: la pregunta «¿esto que dice el documento sigue siendo cierto?»
 * se contestaba leyendo otro documento. Aquí se contesta contra el código: los
 * campos salen de los esquemas de Mongoose y las rutas del stack de Express
 * (`routeInventory`), las mismas fuentes que usa el servidor de verdad. Si algo
 * no aparece aquí, no existe.
 *
 * Este módulo es PURO: recibe los modelos y el router, no los importa. No abre
 * conexión, no lee `process.env` y no imprime nada — de eso se encarga
 * `scripts/printSchemaSkeleton.js`. Así se puede probar sin levantar la app.
 *
 * La salida es DETERMINISTA a propósito (sin fecha de generación, con las llaves
 * ordenadas): su consumidor la compara contra la documentación, y un diff que
 * cambia en cada corrida no sirve para comparar nada.
 */
const { listRoutes } = require('./routeInventory')

/** Los campos que Mongoose agrega y no son parte del modelo. */
const CAMPOS_INTERNOS = new Set(['__v'])

/**
 * Serializa un valor por defecto de forma que sobreviva a `JSON.stringify`.
 * `default: Date.now` y `default: () => []` son funciones: se anuncian como
 * tales, porque el valor concreto depende de cuándo se cree el documento.
 */
function describirDefault(valor) {
  if (typeof valor === 'function') return '<fn>'
  if (valor instanceof Date) return valor.toISOString()
  if (valor === undefined) return undefined
  return valor
}

/**
 * El tipo del elemento de un arreglo de primitivos (`[String]`, `[ObjectId]`).
 * Sin esto, `areas: [String]` se vería como `Array` a secas.
 */
function describirElemento(caster) {
  if (!caster) return null
  const elemento = { tipo: caster.instance }
  if (caster.options?.ref) elemento.ref = caster.options.ref
  if (caster.enumValues?.length) elemento.enum = [...caster.enumValues]
  return elemento
}

/**
 * Describe un campo. Si es subdocumento —embebido o arreglo de embebidos—
 * baja a su esquema y describe sus campos también: el checklist de un
 * expediente o el SIROC de un contrato son el detalle que importa, y
 * `eachPath` por sí solo los reporta como `Array`.
 */
function describirCampo(tipo) {
  const esSubdocumento = Boolean(tipo.schema)
  const esArreglo = tipo.instance === 'Array'

  const campo = {
    tipo: esSubdocumento
      ? esArreglo
        ? 'Array<Subdocumento>'
        : 'Subdocumento'
      : tipo.instance,
    requerido: Boolean(tipo.isRequired)
  }

  if (tipo.options?.ref) campo.ref = tipo.options.ref
  if (tipo.enumValues?.length) campo.enum = [...tipo.enumValues]
  if (tipo.options?.select === false) campo.select = false
  if (tipo.options?.unique) campo.unico = true

  const porDefecto = describirDefault(tipo.options?.default)
  if (porDefecto !== undefined) campo.default = porDefecto

  if (esSubdocumento) {
    campo.campos = describirEsquema(tipo.schema)
  } else if (esArreglo) {
    const elemento = describirElemento(tipo.caster)
    if (elemento) campo.elemento = elemento
  }

  return campo
}

/**
 * Los campos de un esquema, en el orden en que se declararon.
 * @param {import('mongoose').Schema} schema
 * @returns {Record<string, object>}
 */
function describirEsquema(schema) {
  const campos = {}
  schema.eachPath((ruta, tipo) => {
    if (CAMPOS_INTERNOS.has(ruta)) return
    campos[ruta] = describirCampo(tipo)
  })
  return campos
}

/**
 * Los índices DECLARADOS en el esquema (los de campo y los de `schema.index()`).
 * Son los que `npm run db:indices` sincroniza; no se consulta la base.
 */
function describirIndices(schema) {
  return schema.indexes().map(([llaves, opciones = {}]) => {
    const indice = {
      llaves,
      unico: Boolean(opciones.unique),
      parcial: Boolean(opciones.partialFilterExpression)
    }
    if (opciones.partialFilterExpression) {
      indice.filtro = opciones.partialFilterExpression
    }
    if (opciones.name) indice.nombre = opciones.name
    return indice
  })
}

/**
 * @param {import('mongoose').Model} Model
 * @returns {{coleccion: string, campos: object, indices: object[]}}
 */
function describirModelo(Model) {
  return {
    coleccion: Model.collection.name,
    campos: describirEsquema(Model.schema),
    indices: describirIndices(Model.schema)
  }
}

/** Cuenta campos de forma recursiva: los de los subdocumentos también cuentan. */
function contarCampos(campos) {
  return Object.values(campos).reduce(
    (total, campo) => total + 1 + (campo.campos ? contarCampos(campo.campos) : 0),
    0
  )
}

/**
 * Arma el esqueleto completo.
 *
 * @param {object} opciones
 * @param {Record<string, import('mongoose').Model>} opciones.modelos Registro de
 *   `src/models` (o un subconjunto, en pruebas).
 * @param {object} [opciones.router] Router de Express del que derivar las rutas.
 * @param {string} [opciones.prefijo] Prefijo con el que se monta ese router.
 * @returns {object} Estructura serializable a JSON.
 */
function buildSkeleton({ modelos, router = null, prefijo = '/api/v1' } = {}) {
  const nombres = Object.keys(modelos).filter(
    (nombre) => typeof modelos[nombre]?.schema?.eachPath === 'function'
  )

  const salida = { schemaVersion: 1, modelos: {}, rutas: [], totales: {} }

  for (const nombre of nombres.sort()) {
    salida.modelos[nombre] = describirModelo(modelos[nombre])
  }

  salida.rutas = router ? listRoutes(router, prefijo) : []

  const modelosDescritos = Object.values(salida.modelos)
  salida.totales = {
    modelos: modelosDescritos.length,
    campos: modelosDescritos.reduce((t, m) => t + contarCampos(m.campos), 0),
    indices: modelosDescritos.reduce((t, m) => t + m.indices.length, 0),
    indicesUnicos: modelosDescritos.reduce(
      (t, m) => t + m.indices.filter((i) => i.unico).length,
      0
    ),
    rutas: salida.rutas.length,
    // Una ruta con GET y PATCH son dos cosas que el front puede llamar.
    endpoints: salida.rutas.reduce((t, r) => t + r.metodos.length, 0)
  }

  return salida
}

/** Una línea por campo, con los subdocumentos sangrados bajo el suyo. */
function camposComoTexto(campos, sangria = '    ') {
  const lineas = []

  for (const [nombre, campo] of Object.entries(campos)) {
    const notas = []
    if (campo.requerido) notas.push('requerido')
    if (campo.unico) notas.push('único')
    if (campo.ref) notas.push(`→ ${campo.ref}`)
    if (campo.elemento) {
      notas.push(
        `de ${campo.elemento.tipo}${campo.elemento.ref ? ` → ${campo.elemento.ref}` : ''}`
      )
    }
    if (campo.enum) notas.push(`enum: ${campo.enum.join(' | ')}`)
    if (campo.elemento?.enum) notas.push(`enum: ${campo.elemento.enum.join(' | ')}`)
    if (campo.select === false) notas.push('select:false')
    if (campo.default !== undefined)
      notas.push(`default: ${JSON.stringify(campo.default)}`)

    const etiqueta = `${sangria}${nombre}`.padEnd(46)
    lineas.push(
      `${etiqueta}${campo.tipo}${notas.length ? `  (${notas.join(', ')})` : ''}`
    )

    if (campo.campos) lineas.push(...camposComoTexto(campo.campos, `${sangria}  `))
  }

  return lineas
}

/**
 * El mismo esqueleto, para leerlo con los ojos (`--texto`). El JSON es la
 * salida por defecto porque quien más lo consume es otra herramienta.
 */
function renderText(esqueleto) {
  const lineas = []

  for (const [nombre, modelo] of Object.entries(esqueleto.modelos)) {
    const totalCampos = contarCampos(modelo.campos)
    lineas.push(`${nombre} · ${modelo.coleccion}`)
    lineas.push(`  campos (${totalCampos})`)
    lineas.push(...camposComoTexto(modelo.campos))

    lineas.push(`  índices (${modelo.indices.length})`)
    if (modelo.indices.length === 0) lineas.push('    —')
    for (const indice of modelo.indices) {
      const notas = [
        indice.unico ? 'único' : null,
        indice.parcial ? 'parcial' : null
      ].filter(Boolean)
      lineas.push(
        `    ${JSON.stringify(indice.llaves)}${notas.length ? `  (${notas.join(', ')})` : ''}`
      )
    }
    lineas.push('')
  }

  lineas.push(`rutas (${esqueleto.rutas.length})`)
  for (const ruta of esqueleto.rutas) {
    lineas.push(`  ${ruta.metodos.join(',').padEnd(18)}${ruta.ruta}`)
  }
  lineas.push('')

  const t = esqueleto.totales
  lineas.push(
    `TOTALES: ${t.modelos} colecciones · ${t.campos} campos · ${t.indices} índices ` +
      `(${t.indicesUnicos} únicos) · ${t.rutas} rutas · ${t.endpoints} endpoints`
  )

  return lineas.join('\n')
}

module.exports = {
  buildSkeleton,
  describirModelo,
  describirEsquema,
  describirIndices,
  contarCampos,
  renderText
}
