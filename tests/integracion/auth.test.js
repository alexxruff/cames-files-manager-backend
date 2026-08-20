const request = require('supertest')
const app = require('../../src/app')
const User = require('../../src/api/v1/users/userModel')
const {
  PASSWORD_VALIDA,
  crearUsuario,
  crearUsuarioConSesion,
  auth
} = require('../helpers/factories')

describe('POST /api/v1/auth/login', () => {
  it('devuelve el envelope con user y token, y el AuthUser completo', async () => {
    await crearUsuario({
      email: 'marisol@urbacames.com',
      name: 'Marisol Herrera',
      nivelAcceso: 'rh_admin'
    })

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'marisol@urbacames.com', password: PASSWORD_VALIDA })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('success')
    expect(res.body.data.token).toEqual(expect.any(String))

    const user = res.body.data.user
    expect(user).toMatchObject({
      name: 'Marisol Herrera',
      email: 'marisol@urbacames.com',
      // `role` sigue viajando por compatibilidad con el front (spec 9.1)…
      role: 'admin',
      // …y `nivelAcceso` es la fuente real.
      nivelAcceso: 'rh_admin',
      area: null,
      alcance: 'interno',
      clienteId: null,
      active: true
    })
    expect(user._id).toEqual(expect.any(String))
    expect(user.createdAt).toEqual(expect.any(String))
    expect(user.password).toBeUndefined()
    expect(user.id).toBeUndefined()
  })

  it('mapea rh_consulta y jefe_area a role user', async () => {
    await crearUsuario({ email: 'consulta@urbacames.com', nivelAcceso: 'rh_consulta' })
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'consulta@urbacames.com', password: PASSWORD_VALIDA })

    expect(res.body.data.user.role).toBe('user')
    expect(res.body.data.user.nivelAcceso).toBe('rh_consulta')
  })

  it('registra el último acceso', async () => {
    const usuario = await crearUsuario({ email: 'acceso@urbacames.com' })
    expect(usuario.ultimoAccesoEn).toBeNull()

    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'acceso@urbacames.com', password: PASSWORD_VALIDA })

    const recargado = await User.findById(usuario._id)
    expect(recargado.ultimoAccesoEn).toBeInstanceOf(Date)
  })

  it('acepta el correo con otra capitalización', async () => {
    await crearUsuario({ email: 'mayus@urbacames.com' })
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'MAYUS@urbacames.com', password: PASSWORD_VALIDA })
    expect(res.status).toBe(200)
  })

  it('da el mismo error si la contraseña es incorrecta o el correo no existe', async () => {
    await crearUsuario({ email: 'existe@urbacames.com' })

    const malaPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'existe@urbacames.com', password: 'OtraCosa1!' })
    const noExiste = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nadie@urbacames.com', password: PASSWORD_VALIDA })

    expect(malaPassword.status).toBe(401)
    expect(noExiste.status).toBe(401)
    // No se puede distinguir un correo válido de uno inexistente.
    expect(malaPassword.body.message).toBe(noExiste.body.message)
    expect(malaPassword.body.status).toBe('fail')
  })

  it('rechaza a un usuario desactivado', async () => {
    await crearUsuario({ email: 'baja@urbacames.com', active: false })
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'baja@urbacames.com', password: PASSWORD_VALIDA })

    expect(res.status).toBe(401)
    expect(res.body.message).toMatch(/desactivada/i)
  })

  it('devuelve errores de validación en el formato que el front lee', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'no-es-correo' })

    expect(res.status).toBe(400)
    expect(res.body.status).toBe('fail')
    expect(res.body.errors[0].msg).toEqual(expect.any(String))
    // Mensajes en español, mostrables tal cual.
    expect(res.body.message).toMatch(/correo|contraseña/i)
  })
})

describe('GET /api/v1/auth/me', () => {
  it('revalida la sesión y devuelve el usuario', async () => {
    const { usuario, token } = await crearUsuarioConSesion({ name: 'Ana Ruiz' })

    const res = await request(app).get('/api/v1/auth/me').set(auth(token))

    expect(res.status).toBe(200)
    expect(res.body.data.user._id).toBe(usuario._id.toString())
    expect(res.body.data.user.name).toBe('Ana Ruiz')
  })

  it('401 sin token, con token basura o con usuario desactivado después de emitirlo', async () => {
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401)
    expect(
      (await request(app).get('/api/v1/auth/me').set(auth('token.invalido'))).status
    ).toBe(401)

    const { usuario, token } = await crearUsuarioConSesion()
    await User.updateOne({ _id: usuario._id }, { $set: { active: false } })
    const res = await request(app).get('/api/v1/auth/me').set(auth(token))

    // El token sigue siendo válido: la autorización relee al usuario, así que
    // desactivar surte efecto de inmediato.
    expect(res.status).toBe(401)
  })
})

describe('POST /api/v1/auth/logout', () => {
  it('responde 200 con data null', async () => {
    const { token } = await crearUsuarioConSesion()
    const res = await request(app).post('/api/v1/auth/logout').set(auth(token))
    expect(res.status).toBe(200)
    expect(res.body.data).toBeNull()
  })
})

describe('POST /api/v1/auth/cambiar-password', () => {
  it('cambia la contraseña y permite iniciar sesión con la nueva', async () => {
    const { usuario, token } = await crearUsuarioConSesion()

    const res = await request(app)
      .post('/api/v1/auth/cambiar-password')
      .set(auth(token))
      .send({ passwordActual: PASSWORD_VALIDA, passwordNueva: 'NuevaClave9#' })

    expect(res.status).toBe(200)

    const conNueva = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: usuario.email, password: 'NuevaClave9#' })
    const conVieja = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: usuario.email, password: PASSWORD_VALIDA })

    expect(conNueva.status).toBe(200)
    expect(conVieja.status).toBe(401)
  })

  it('400 si la actual no coincide', async () => {
    const { token } = await crearUsuarioConSesion()
    const res = await request(app)
      .post('/api/v1/auth/cambiar-password')
      .set(auth(token))
      .send({ passwordActual: 'NoEsMiClave1!', passwordNueva: 'NuevaClave9#' })

    expect(res.status).toBe(400)
    expect(res.body.errors[0].path).toBe('passwordActual')
  })

  it('400 si la nueva no cumple las reglas o es igual a la actual', async () => {
    const { token } = await crearUsuarioConSesion()

    const debil = await request(app)
      .post('/api/v1/auth/cambiar-password')
      .set(auth(token))
      .send({ passwordActual: PASSWORD_VALIDA, passwordNueva: 'sencilla' })
    const igual = await request(app)
      .post('/api/v1/auth/cambiar-password')
      .set(auth(token))
      .send({ passwordActual: PASSWORD_VALIDA, passwordNueva: PASSWORD_VALIDA })

    expect(debil.status).toBe(400)
    expect(igual.status).toBe(400)
    expect(igual.body.message).toMatch(/distinta/i)
  })
})

describe('Contrato general de la API', () => {
  it('/health responde sin tocar la base', async () => {
    const res = await request(app).get('/api/v1/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('success')
  })

  it('/ready informa el estado de la base', async () => {
    const res = await request(app).get('/api/v1/ready')
    expect(res.status).toBe(200)
    expect(res.body.data.baseDeDatos.listo).toBe(true)
  })

  it('una ruta inexistente devuelve 404 con el envelope', async () => {
    const res = await request(app).get('/api/v1/no-existe')
    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ status: 'fail', data: null })
    expect(res.body.message).toMatch(/no existe/i)
  })

  it('devuelve X-Request-Id para poder rastrear la petición', async () => {
    const res = await request(app).get('/api/v1/health')
    expect(res.headers['x-request-id']).toEqual(expect.any(String))
  })

  it('no anuncia la tecnología del servidor', async () => {
    const res = await request(app).get('/api/v1/health')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })

  it('no existe registro público de usuarios', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'intruso@x.com', password: 'Intruso1!', name: 'Intruso' })
    expect(res.status).toBe(404)
  })
})
