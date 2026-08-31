const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..', '..')

/**
 * El esquema de entorno se separó de `env.js` para poder LEER los requisitos sin
 * dispararlos: otro repo necesita saber qué variables hacen falta sin que el
 * proceso valide su propio entorno y se muera. Ese contrato se rompe con una
 * sola línea distraída —un `require('dotenv')`, un `safeParse`—, así que se
 * comprueba aquí.
 */
describe('src/config/env.schema.js — describe sin ejecutar', () => {
  /*
   * Se mira el CÓDIGO, no la prosa: los comentarios del módulo nombran
   * `dotenv` y `process.env` justamente para explicar que no los usa, y sin
   * quitarlos la prueba se quejaría de su propia documentación.
   */
  const sinComentarios = (texto) =>
    texto
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((linea) => !linea.trim().startsWith('//'))
      .join('\n')

  const fuente = sinComentarios(
    fs.readFileSync(path.join(RAIZ, 'src/config/env.schema.js'), 'utf8')
  )

  it.each([
    ['dotenv', /require\(['"]dotenv['"]\)/],
    ['process.env', /process\.env/],
    ['safeParse o parse', /\.safeParse\(|\bschema\.parse\(/],
    ['process.exit', /process\.exit/],
    ['salida por consola', /console\./]
  ])('no tiene efectos: nada de %s', (_que, patron) => {
    expect(fuente).not.toMatch(patron)
  })

  it('exporta el esquema y se puede cargar sin entorno válido', () => {
    const { schema } = require('../../src/config/env.schema')

    expect(typeof schema.shape).toBe('object')
    expect(Object.keys(schema.shape)).toEqual(
      expect.arrayContaining(['MONGODB_URI', 'JWT_SECRET', 'STORAGE_DRIVER'])
    )
  })

  it('env.js sigue siendo el que valida y el que corta el arranque', () => {
    const consumidor = fs.readFileSync(path.join(RAIZ, 'src/config/env.js'), 'utf8')

    expect(consumidor).toMatch(/require\(['"]dotenv['"]\)/)
    expect(consumidor).toMatch(/require\(['"]\.\/env\.schema['"]\)/)
    expect(consumidor).toMatch(/safeParse\(process\.env\)/)
    expect(consumidor).toMatch(/process\.exit\(1\)/)
  })
})

/**
 * `scripts/printEnvRequirements.js` DESCRIBE los requisitos; no los comprueba.
 * Se corre en un proceso aparte y con el entorno mutilado a propósito: si
 * validara algo, aquí saldría distinto de cero.
 */
describe('scripts/printEnvRequirements.js', () => {
  const correr = () => {
    const entorno = { ...process.env }
    // Las dos únicas obligatorias, fuera. Y sin ellas debe seguir funcionando.
    delete entorno.MONGODB_URI
    delete entorno.JWT_SECRET

    return JSON.parse(
      execFileSync(
        process.execPath,
        [path.join(RAIZ, 'scripts/printEnvRequirements.js')],
        {
          env: entorno,
          encoding: 'utf8'
        }
      )
    )
  }

  it('imprime un JSON válido aunque falte todo lo obligatorio', () => {
    const requisitos = correr()

    expect(Array.isArray(requisitos)).toBe(true)
    const { schema } = require('../../src/config/env.schema')
    expect(requisitos).toHaveLength(Object.keys(schema.shape).length)
  })

  it('cada entrada trae las cuatro llaves del contrato', () => {
    for (const requisito of correr()) {
      expect(Object.keys(requisito).sort()).toEqual([
        'default',
        'hasDefault',
        'name',
        'required'
      ])
    }
  })

  it('obligatoria es la que no tiene default ni es opcional', () => {
    const porNombre = Object.fromEntries(correr().map((r) => [r.name, r]))

    expect(porNombre.MONGODB_URI).toMatchObject({ required: true, hasDefault: false })
    expect(porNombre.JWT_SECRET).toMatchObject({ required: true, hasDefault: false })
    // Opcional sin default: no es obligatoria, pero tampoco tiene valor.
    expect(porNombre.R2_BUCKET).toMatchObject({ required: false, hasDefault: false })
  })

  it('reporta el valor por defecto, incluso detrás de un transform', () => {
    const porNombre = Object.fromEntries(correr().map((r) => [r.name, r]))

    /*
     * El caso que motiva el campo, y el que consume OPS para decidir si exige
     * las credenciales de R2: ausente de la configuración y aun así vale 'r2'.
     * Se fija la terna COMPLETA a propósito — con sólo `hasDefault` y `default`,
     * un cambio a obligatoria pasaría sin que nadie se entere.
     */
    expect(porNombre.STORAGE_DRIVER).toEqual({
      name: 'STORAGE_DRIVER',
      required: false,
      hasDefault: true,
      default: 'r2'
    })
    expect(porNombre.PORT).toMatchObject({ hasDefault: true, default: 8080 })
    // `.default().transform()`: el default queda envuelto y hay que desenvolverlo.
    expect(porNombre.CORS_ORIGINS.default).toBe(
      'http://localhost:5173,http://localhost:5174'
    )
    expect(porNombre.LOG_TO_FILE).toMatchObject({ hasDefault: true, default: 'false' })
  })
})
