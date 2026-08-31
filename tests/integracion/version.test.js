const request = require('supertest')
const app = require('../../src/app')

/**
 * Identidad del release (`GET /api/v1/version`).
 *
 * Contesta qué commit está corriendo. Es pública a propósito —quien despliega
 * necesita saberlo antes de tener sesión— y por eso lo que devuelve está
 * acotado a identidad de release: ni entorno, ni configuración, ni versiones de
 * dependencias. Estas pruebas son el candado de ese límite: si alguien agrega
 * un campo "para depurar", fallan.
 *
 * Los valores salen de la imagen (ver Dockerfile), así que aquí se inyectan por
 * `process.env` y se restauran al terminar.
 */
describe('GET /api/v1/version', () => {
  const COMMIT = 'a'.repeat(40)
  const CONSTRUIDO = '2026-08-30T12:34:56Z'
  const original = {
    commit: process.env.CAMES_GIT_COMMIT,
    builtAt: process.env.CAMES_BUILD_TIME
  }

  beforeEach(() => {
    process.env.CAMES_GIT_COMMIT = COMMIT
    process.env.CAMES_BUILD_TIME = CONSTRUIDO
  })

  afterAll(() => {
    if (original.commit === undefined) delete process.env.CAMES_GIT_COMMIT
    else process.env.CAMES_GIT_COMMIT = original.commit
    if (original.builtAt === undefined) delete process.env.CAMES_BUILD_TIME
    else process.env.CAMES_BUILD_TIME = original.builtAt
  })

  // OJO: la ausencia del encabezado ES la aserción. No le pongas un token para
  // "arreglarla": esta prueba es lo único que sostiene que la ruta sea pública,
  // y con `Authorization` pasaría igual aunque alguien la metiera tras `protect`.
  it('sin Authorization responde 200 con el envelope público', async () => {
    const res = await request(app).get('/api/v1/version')

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('success')
    expect(res.body.data).toEqual({
      schemaVersion: 1,
      service: 'cames-api',
      commit: COMMIT,
      builtAt: CONSTRUIDO
    })
  })

  it('devuelve exactamente cuatro campos y nada del entorno', async () => {
    const { body } = await request(app).get('/api/v1/version')

    expect(Object.keys(body.data).sort()).toEqual([
      'builtAt',
      'commit',
      'schemaVersion',
      'service'
    ])

    // Lo que NO puede filtrarse, aunque cambie la forma del resto.
    const serializado = JSON.stringify(body)
    for (const prohibido of [
      'NODE_ENV',
      'MONGODB_URI',
      'JWT_SECRET',
      'R2_',
      'BOOTSTRAP_',
      process.env.MONGODB_URI
    ]) {
      expect(serializado).not.toContain(prohibido)
    }
  })

  it('lee el commit y la hora de construcción del entorno de la imagen', async () => {
    process.env.CAMES_GIT_COMMIT = 'b'.repeat(40)
    process.env.CAMES_BUILD_TIME = '2026-01-02T03:04:05Z'

    const { body } = await request(app).get('/api/v1/version')

    expect(body.data.commit).toBe('b'.repeat(40))
    expect(body.data.builtAt).toBe('2026-01-02T03:04:05Z')
  })

  it('no se cachea: una respuesta guardada mentiría sobre lo que corre', async () => {
    const res = await request(app).get('/api/v1/version')

    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('aparece en el inventario de GET /api/v1', async () => {
    const { body } = await request(app).get('/api/v1')
    const rutas = body.data.implementados.map((r) => r.ruta)

    expect(rutas).toContain('/api/v1/version')
    // Y no se coló en la lista de lo que falta: está implementada.
    expect(body.data.pendientes.map((p) => p.ruta)).not.toContain('/api/v1/version')
  })
})
