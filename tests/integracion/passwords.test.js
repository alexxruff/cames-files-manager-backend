const request = require('supertest')
const app = require('../../src/app')
const Employee = require('../../src/api/v1/employees/employeeModel')
const { ensureBootstrapAdmin } = require('../../src/services/bootstrapAdmin')
const {
  crearEmpleado,
  crearEmpleadoConSesion,
  adscribir,
  auth
} = require('../helpers/factories')

/**
 * Contraseñas temporales (D-49).
 *
 * Cuando un administrador da acceso o repone una contraseña, **él la conoce**; y
 * el administrador inicial nace con la contraseña de arranque. La sesión existe,
 * pero la plataforma queda bloqueada hasta que la persona ponga una suya.
 *
 * Lo que estas pruebas cuidan:
 *
 * 1. **Que el bloqueo sea del servidor, no del front.** Un token con contraseña
 *    temporal no puede leer ni escribir nada.
 * 2. **Que nadie quede atrapado**: cambiar la contraseña, verse a sí mismo y
 *    cerrar sesión siempre funcionan.
 * 3. **Que no se olvide en un recurso nuevo.** La última prueba recorre el
 *    inventario de rutas *derivado del router* y exige el 403 en todas.
 */

const PASSWORD_NUEVA = 'MiPropia2026#'
const CREDENCIALES_BOOTSTRAP = { email: 'alexxruff@yahoo.com', password: '1234' }

const login = (email, password) =>
  request(app).post('/api/v1/auth/login').send({ email, password })

/**
 * Una persona con acceso recién concedido por un administrador: su contraseña es
 * temporal porque la escribió alguien más.
 */
async function conPasswordTemporal() {
  const admin = await crearEmpleadoConSesion({ alcanceGlobal: true })
  const persona = await crearEmpleado({ nombre: 'Nueva Persona Prueba' })
  await adscribir(admin.empresa, persona)

  const email = 'temporal@urbacames.com'
  const passwordInicial = 'LaPusoRH2026$'

  const concedido = await request(app)
    .post(`/api/v1/empleados/${persona._id}/acceso`)
    .set(auth(admin.token))
    .send({ email, password: passwordInicial, nivelAcceso: 'rh_admin' })
  expect(concedido.status).toBe(201)

  const sesion = await login(email, passwordInicial)
  expect(sesion.status).toBe(200)

  return {
    admin,
    persona,
    empresa: admin.empresa,
    email,
    passwordInicial,
    token: sesion.body.data.token,
    user: sesion.body.data.user
  }
}

describe('Contraseñas temporales', () => {
  describe('cuándo se marca', () => {
    it('al conceder acceso: la contraseña la escribió el administrador', async () => {
      const { user } = await conPasswordTemporal()
      expect(user.passwordTemporal).toBe(true)
    })

    it('al reponer la contraseña un administrador', async () => {
      const admin = await crearEmpleadoConSesion({ alcanceGlobal: true })
      const persona = await crearEmpleado({
        acceso: { email: 'olvidadiza@urbacames.com' }
      })
      await adscribir(admin.empresa, persona)

      // Entró con su propia contraseña: no es temporal.
      const antes = await login('olvidadiza@urbacames.com', 'Urbacames1!')
      expect(antes.body.data.user.passwordTemporal).toBe(false)

      await request(app)
        .post(`/api/v1/empleados/${persona._id}/acceso/restablecer-password`)
        .set(auth(admin.token))
        .send({ password: 'RepuestaPorRH9#' })
        .expect(200)

      const despues = await login('olvidadiza@urbacames.com', 'RepuestaPorRH9#')
      expect(despues.body.data.user.passwordTemporal).toBe(true)
    })

    /*
     * El agujero que esto cierra: hasta ahora el administrador inicial nacía con
     * `1234` y el único aviso era una línea de log. Ver D-21 y D-49.
     */
    it('en el administrador inicial del bootstrap, que nace con la de arranque', async () => {
      await ensureBootstrapAdmin()

      const sesion = await login(
        CREDENCIALES_BOOTSTRAP.email,
        CREDENCIALES_BOOTSTRAP.password
      )

      expect(sesion.status).toBe(200)
      expect(sesion.body.data.user.passwordTemporal).toBe(true)
    })

    it('NO se marca cuando la persona la cambia ella misma', async () => {
      const { token, empleado } = await crearEmpleadoConSesion({ alcanceGlobal: true })

      const res = await request(app)
        .post('/api/v1/auth/cambiar-password')
        .set(auth(token))
        .send({ passwordActual: 'Urbacames1!', passwordNueva: PASSWORD_NUEVA })

      expect(res.status).toBe(200)
      const despues = await Employee.findById(empleado._id)
      expect(despues.acceso.passwordTemporal).toBe(false)
    })

    it('editar el acceso (nivel, correo) no vuelve temporal la contraseña', async () => {
      const admin = await crearEmpleadoConSesion({ alcanceGlobal: true })
      const persona = await crearEmpleado({ acceso: { email: 'estable@urbacames.com' } })
      await adscribir(admin.empresa, persona)

      await request(app)
        .patch(`/api/v1/empleados/${persona._id}/acceso`)
        .set(auth(admin.token))
        .send({ nivelAcceso: 'rh_consulta' })
        .expect(200)

      const despues = await Employee.findById(persona._id)
      expect(despues.acceso.passwordTemporal).toBe(false)
    })
  })

  describe('el bloqueo', () => {
    it('403 con code PASSWORD_TEMPORAL en cualquier recurso', async () => {
      const { token, empresa } = await conPasswordTemporal()

      const res = await request(app).get('/api/v1/empleados').set(auth(token))

      expect(res.status).toBe(403)
      expect(res.body.code).toBe('PASSWORD_TEMPORAL')
      expect(res.body.message).toContain('temporal')

      // Y no es sólo una ruta: tampoco puede escribir.
      const escritura = await request(app)
        .post(`/api/v1/empresas/${empresa._id}/adscripciones`)
        .set(auth(token))
        .send({ empleadoId: empresa._id.toString() })
      expect(escritura.status).toBe(403)
      expect(escritura.body.code).toBe('PASSWORD_TEMPORAL')
    })

    /*
     * 403 y no 401 a propósito: la sesión ES válida. Con un 401 el front cerraría
     * la sesión y volvería al login, que es el bucle que hay que evitar.
     */
    it('es 403, no 401: la sesión sigue siendo válida', async () => {
      const { token } = await conPasswordTemporal()

      const bloqueado = await request(app).get('/api/v1/alertas').set(auth(token))
      expect(bloqueado.status).toBe(403)

      const yo = await request(app).get('/api/v1/auth/me').set(auth(token))
      expect(yo.status).toBe(200)
    })

    it('el administrador inicial no puede hacer nada hasta cambiarla', async () => {
      await ensureBootstrapAdmin()
      const { body } = await login(
        CREDENCIALES_BOOTSTRAP.email,
        CREDENCIALES_BOOTSTRAP.password
      )
      const token = body.data.token

      const listado = await request(app).get('/api/v1/empleados').set(auth(token))
      expect(listado.status).toBe(403)
      expect(listado.body.code).toBe('PASSWORD_TEMPORAL')
    })
  })

  describe('la salida: nadie queda atrapado', () => {
    it('puede verse a sí mismo, cambiar la contraseña y cerrar sesión', async () => {
      const { token, email, passwordInicial } = await conPasswordTemporal()

      expect((await request(app).get('/api/v1/auth/me').set(auth(token))).status).toBe(
        200
      )

      const cambio = await request(app)
        .post('/api/v1/auth/cambiar-password')
        .set(auth(token))
        .send({ passwordActual: passwordInicial, passwordNueva: PASSWORD_NUEVA })
      expect(cambio.status).toBe(200)

      // Con el token nuevo que devuelve el cambio, ya puede trabajar.
      const nuevo = cambio.body.data.token
      expect((await request(app).get('/api/v1/empleados').set(auth(nuevo))).status).toBe(
        200
      )

      expect(
        (await request(app).post('/api/v1/auth/logout').set(auth(nuevo))).status
      ).toBe(200)
      expect((await login(email, PASSWORD_NUEVA)).status).toBe(200)
    })

    it('tras cambiarla, el AuthUser ya no la marca como temporal', async () => {
      const { token, email, passwordInicial } = await conPasswordTemporal()

      await request(app)
        .post('/api/v1/auth/cambiar-password')
        .set(auth(token))
        .send({ passwordActual: passwordInicial, passwordNueva: PASSWORD_NUEVA })
        .expect(200)

      const sesion = await login(email, PASSWORD_NUEVA)
      expect(sesion.body.data.user.passwordTemporal).toBe(false)
    })

    it('sigue exigiendo la contraseña actual: la temporal no es una puerta abierta', async () => {
      const { token } = await conPasswordTemporal()

      const res = await request(app)
        .post('/api/v1/auth/cambiar-password')
        .set(auth(token))
        .send({ passwordActual: 'LaQueSeMeOcurrio1#', passwordNueva: PASSWORD_NUEVA })

      expect(res.status).toBe(400)
      expect(res.body.errors[0].msg).toContain('contraseña actual')
    })

    it('la nueva sigue pasando las reglas de complejidad', async () => {
      const { token, passwordInicial } = await conPasswordTemporal()

      const res = await request(app)
        .post('/api/v1/auth/cambiar-password')
        .set(auth(token))
        .send({ passwordActual: passwordInicial, passwordNueva: 'sencilla' })

      expect(res.status).toBe(400)
    })
  })

  describe('lo que ve el administrador', () => {
    it('el renglón del empleado dice si su contraseña está pendiente de cambio', async () => {
      const { admin, persona } = await conPasswordTemporal()

      const res = await request(app)
        .get(`/api/v1/empleados/${persona._id}`)
        .set(auth(admin.token))

      expect(res.status).toBe(200)
      expect(res.body.data.empleado.empleado.acceso.passwordTemporal).toBe(true)
    })
  })

  /*
   * EL CANDADO. `requirePasswordDefinitiva` se aplica router por router, así que
   * se puede olvidar en un recurso nuevo. Esta prueba no depende de una lista
   * escrita a mano: recorre el inventario que `GET /api/v1` **deriva del router**
   * y exige el 403 en todas las rutas, salvo las tres que son la salida.
   */
  it('TODAS las rutas de la API quedan bloqueadas, salvo la salida', async () => {
    const { token, empresa } = await conPasswordTemporal()
    const { body } = await request(app).get('/api/v1')

    const permitidas = [
      '/api/v1',
      '/api/v1/health',
      '/api/v1/ready',
      '/api/v1/auth/login',
      '/api/v1/auth/me',
      '/api/v1/auth/logout',
      '/api/v1/auth/cambiar-password'
    ]

    const revisadas = []
    for (const ruta of body.data.implementados) {
      if (permitidas.includes(ruta.ruta)) continue
      // La ruta movida responde 410 antes de cualquier middleware.
      if (ruta.metodos.includes('ALL')) continue

      for (const metodo of ruta.metodos) {
        const url = ruta.ruta
          .replace(':id', empresa._id.toString())
          .replace(':tipo', 'ine')
          .replace(':version', '1')

        const res = await request(app)
          [metodo.toLowerCase()](url)
          .set(auth(token))
          .send({})

        expect({ url, metodo, status: res.status, code: res.body.code }).toEqual({
          url,
          metodo,
          status: 403,
          code: 'PASSWORD_TEMPORAL'
        })
        revisadas.push(`${metodo} ${url}`)
      }
    }

    // Si alguien vacía el inventario, la prueba no debe pasar por no hacer nada.
    expect(revisadas.length).toBeGreaterThan(20)
  })
})
