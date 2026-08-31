const { execFileSync } = require('child_process')
const os = require('os')
const path = require('path')
const mongoose = require('mongoose')

const {
  buildSkeleton,
  describirEsquema,
  contarCampos,
  renderText
} = require('../../src/utils/schemaSkeleton')

const RAIZ = path.join(__dirname, '..', '..')

/**
 * El extractor del esqueleto: qué colecciones, campos, índices y rutas EXISTEN.
 *
 * Lo que se prueba aquí no es el contenido —ése cambia con cada modelo nuevo—
 * sino que la extracción no MIENTA por omisión: que un arreglo de subdocumentos
 * se abra en sus campos en vez de reportarse como `Array`, que los índices
 * únicos se distingan, y que el script corra sin base de datos y sin `.env`.
 */
describe('src/utils/schemaSkeleton.js', () => {
  const subSchema = new mongoose.Schema(
    {
      tipo: { type: String, required: true, enum: ['ine', 'curp'] },
      archivo: new mongoose.Schema(
        { clave: { type: String, select: false } },
        { _id: false }
      )
    },
    { _id: false }
  )

  const juguete = new mongoose.Schema({
    nombre: { type: String, required: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    areas: [String],
    documentos: { type: [subSchema], default: [] }
  })
  juguete.index({ empresaId: 1, nombre: 1 }, { unique: true })
  juguete.index(
    { correo: 1 },
    { unique: true, partialFilterExpression: { correo: { $type: 'string' } } }
  )

  const modeloDeJuguete = mongoose.model('SkeletonJuguete', juguete, 'juguetes')
  const esqueleto = () => buildSkeleton({ modelos: { Juguete: modeloDeJuguete } })

  it('describe cada campo con su tipo, si es obligatorio y a qué referencia', () => {
    const campos = esqueleto().modelos.Juguete.campos

    expect(campos.nombre).toMatchObject({ tipo: 'String', requerido: true })
    expect(campos.empresaId).toMatchObject({ tipo: 'ObjectId', ref: 'Company' })
  })

  it('un arreglo de subdocumentos se abre en sus campos, no queda en «Array»', () => {
    const documentos = esqueleto().modelos.Juguete.campos.documentos

    expect(documentos.tipo).toBe('Array<Subdocumento>')
    expect(documentos.campos.tipo).toMatchObject({
      tipo: 'String',
      requerido: true,
      enum: ['ine', 'curp']
    })
  })

  it('baja hasta el subdocumento del subdocumento, y conserva select:false', () => {
    const archivo = esqueleto().modelos.Juguete.campos.documentos.campos.archivo

    expect(archivo.tipo).toBe('Subdocumento')
    expect(archivo.campos.clave).toMatchObject({ tipo: 'String', select: false })
  })

  it('un arreglo de primitivos dice de qué es', () => {
    expect(esqueleto().modelos.Juguete.campos.areas).toMatchObject({
      tipo: 'Array',
      elemento: { tipo: 'String' }
    })
  })

  it('distingue el índice único y el parcial, con su filtro', () => {
    const indices = esqueleto().modelos.Juguete.indices
    const compuesto = indices.find((i) => i.llaves.nombre === 1)
    const parcial = indices.find((i) => i.llaves.correo === 1)

    expect(compuesto).toMatchObject({ unico: true, parcial: false })
    expect(parcial).toMatchObject({
      unico: true,
      parcial: true,
      filtro: { correo: { $type: 'string' } }
    })
  })

  it('no incluye `__v`, que es de Mongoose y no del modelo', () => {
    expect(Object.keys(describirEsquema(juguete))).not.toContain('__v')
  })

  it('cuenta los campos anidados: contarlos sólo en la raíz esconde el detalle', () => {
    const campos = esqueleto().modelos.Juguete.campos

    // nombre, empresaId, areas, documentos, _id, y dentro: tipo, archivo, clave.
    expect(contarCampos(campos)).toBe(8)
    expect(esqueleto().totales.campos).toBe(8)
  })

  it('sin router, las rutas vienen vacías y no truena', () => {
    expect(esqueleto().rutas).toEqual([])
    expect(esqueleto().totales.rutas).toBe(0)
  })

  it('deriva las rutas del router que se le pase, con su prefijo', () => {
    const express = require('express')
    const router = express.Router()
    router.get('/pruebas', (req, res) => res.end())
    router.patch('/pruebas/:id', (req, res) => res.end())

    const salida = buildSkeleton({ modelos: {}, router, prefijo: '/api/v1' })

    expect(salida.rutas).toEqual([
      { metodos: ['GET'], ruta: '/api/v1/pruebas' },
      { metodos: ['PATCH'], ruta: '/api/v1/pruebas/:id' }
    ])
    expect(salida.totales).toMatchObject({ rutas: 2, endpoints: 2 })
  })

  it('la salida es determinista: dos corridas dan exactamente lo mismo', () => {
    expect(JSON.stringify(esqueleto())).toBe(JSON.stringify(esqueleto()))
  })

  it('el texto legible sangra los subdocumentos bajo su campo', () => {
    const texto = renderText(esqueleto())

    expect(texto).toMatch(/documentos\s+Array<Subdocumento>/)
    expect(texto).toMatch(/ {6}tipo\s+String/)
    expect(texto).toMatch(/TOTALES: 1 colecciones/)
  })
})

/**
 * `scripts/printSchemaSkeleton.js` corre en un proceso aparte, con el entorno
 * mutilado y desde otro directorio: sin `.env` que cargar (dotenv lo busca en el
 * cwd) y sin las dos variables obligatorias. Si algo del extractor exigiera
 * configuración real o abriera conexión, aquí saldría distinto de cero.
 */
describe('scripts/printSchemaSkeleton.js', () => {
  const correr = (args = []) =>
    execFileSync(
      process.execPath,
      [path.join(RAIZ, 'scripts/printSchemaSkeleton.js'), ...args],
      {
        cwd: os.tmpdir(),
        env: { PATH: process.env.PATH },
        encoding: 'utf8',
        timeout: 60000
      }
    )

  it('imprime JSON por defecto, sin base de datos y sin .env', () => {
    const salida = JSON.parse(correr())

    expect(salida.schemaVersion).toBe(1)
    expect(salida.totales.modelos).toBeGreaterThanOrEqual(14)
    expect(salida.totales.rutas).toBeGreaterThan(0)
  })

  it('trae las colecciones reales y sus subdocumentos abiertos', () => {
    const salida = JSON.parse(correr())

    expect(salida.modelos.Record.coleccion).toBe('records')
    expect(salida.modelos.Record.campos.documentos.tipo).toBe('Array<Subdocumento>')
    expect(salida.modelos.Record.campos.documentos.campos.estatus.enum).toContain(
      'validated'
    )
    // La contraseña vive aparte (D-27) y no se serializa: debe verse aquí.
    expect(salida.modelos.Credential.campos.passwordHash.select).toBe(false)
  })

  it('las rutas salen del router, con el prefijo de la API', () => {
    const rutas = JSON.parse(correr()).rutas.map(
      (r) => `${r.metodos.join(',')} ${r.ruta}`
    )

    expect(rutas).toContain('POST /api/v1/auth/login')
    expect(rutas).toContain('GET /api/v1/health')
  })

  it('con --texto imprime lo legible en vez del JSON', () => {
    const salida = correr(['--texto'])

    expect(salida).toMatch(/^Record · records$/m)
    expect(salida).toMatch(/TOTALES: \d+ colecciones · \d+ campos/)
    expect(() => JSON.parse(salida)).toThrow()
  })
})
