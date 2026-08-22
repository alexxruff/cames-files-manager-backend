const request = require('supertest')
const app = require('../../src/app')
const { crearEmpleadoConSesion, auth } = require('../helpers/factories')

/**
 * Inventario de la API (`GET /api/v1`).
 *
 * Existe para que el front pueda verificar por sí mismo qué endpoints hay, sin
 * depender de que la documentación esté al día. Estas pruebas son el candado
 * anti-desincronización: si alguien monta un recurso nuevo y no aparece en el
 * inventario, o si el inventario anuncia algo que responde 404, fallan.
 */
describe('GET /api/v1 — inventario de la API', () => {
  it('es público y lista los endpoints implementados y los pendientes', async () => {
    const res = await request(app).get('/api/v1')

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('success')
    expect(Array.isArray(res.body.data.implementados)).toBe(true)
    expect(Array.isArray(res.body.data.pendientes)).toBe(true)
  })

  it('incluye lo que sí existe hoy', async () => {
    const { body } = await request(app).get('/api/v1')
    const rutas = body.data.implementados.map((r) => r.ruta)

    expect(rutas).toEqual(
      expect.arrayContaining([
        '/api/v1/health',
        '/api/v1/ready',
        '/api/v1/auth/login',
        '/api/v1/auth/me',
        '/api/v1/auth/logout',
        '/api/v1/auth/cambiar-password',
        '/api/v1/empleados',
        '/api/v1/empleados/:id',
        '/api/v1/empleados/:id/acceso',
        '/api/v1/empleados/:id/acceso/restablecer-password'
      ])
    )
  })

  it('no anuncia como implementado nada del dominio de expedientes', async () => {
    const { body } = await request(app).get('/api/v1')
    const rutas = body.data.implementados.map((r) => r.ruta).join(' ')

    // Dominios que todavía NO tienen rutas. Al implementar uno, quítalo de aquí:
    // esta prueba es el candado que avisa si el inventario se desincroniza.
    for (const pendiente of [
      'expedientes',
      'alertas',
      'plantillas',
      'reportes',
      'proyectos',
      'adscripciones',
      'carteras'
    ]) {
      expect(rutas).not.toContain(pendiente)
    }
  })

  it('cada ruta pendiente responde 404 de verdad', async () => {
    const { empleado, token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const { body } = await request(app).get('/api/v1')

    for (const pendiente of body.data.pendientes) {
      const ruta = pendiente.ruta
        .replace(':id', empleado._id.toString())
        .replace(':tipo', 'ine')
        .replace(':version', '1')
      const metodo = pendiente.metodos[0].toLowerCase()

      const res = await request(app)[metodo](ruta).set(auth(token)).send({})

      expect([404]).toContain(res.status)
      expect(res.body.message).toMatch(/La ruta .* no existe/)
    }
  })

  it('cada ruta que anuncia como implementada existe de verdad (no da 404 de ruta)', async () => {
    const { empleado, token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const { body } = await request(app).get('/api/v1')

    for (const implementada of body.data.implementados) {
      // `ALL` es la ruta movida (410): no es una ruta de trabajo y supertest no
      // tiene un método equivalente.
      if (implementada.metodos.includes('ALL')) continue

      for (const metodo of implementada.metodos) {
        const ruta = implementada.ruta.replace(':id', empleado._id.toString())
        const res = await request(app)
          [metodo.toLowerCase()](ruta)
          .set(auth(token))
          .send({})

        // Puede dar 200, 400, 204… lo que no puede es "esta ruta no existe".
        expect(res.body?.message || '').not.toMatch(/La ruta .* no existe/)
      }
    }
  })

  it('explica cómo distinguir un 404 de ruta de un 401 de sesión', async () => {
    const { body } = await request(app).get('/api/v1')
    expect(body.data.nota).toMatch(/NO IMPLEMENTADO/)

    const inexistente = await request(app).get('/api/v1/expedientes')
    const sinSesion = await request(app).get('/api/v1/empleados')
    const movida = await request(app).get('/api/v1/usuarios')

    expect(inexistente.status).toBe(404)
    expect(inexistente.body.message).toMatch(/La ruta .* no existe/)
    expect(sinSesion.status).toBe(401)
    // Y un tercer caso propio de esta migración: la ruta que se movió.
    expect(movida.status).toBe(410)
  })
})
