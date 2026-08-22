const request = require('supertest')
const mongoose = require('mongoose')
const app = require('../../src/app')
const Employee = require('../../src/api/v1/employees/employeeModel')
const Credential = require('../../src/api/v1/credentials/credentialModel')
const {
  PASSWORD_VALIDA,
  crearEmpleado,
  crearEmpleadoConSesion,
  crearEmpresa,
  adscribir,
  auth
} = require('../helpers/factories')

const login = (email, password = PASSWORD_VALIDA) =>
  request(app).post('/api/v1/auth/login').send({ email, password })

const nuevoAcceso = {
  email: 'claudia@urbacames.com',
  password: PASSWORD_VALIDA,
  nivelAcceso: 'rh_consulta'
}

describe('POST /api/v1/empleados/:id/acceso — dar acceso', () => {
  it('añade el acceso a una persona que YA existe, sin duplicarla', async () => {
    const { empresa, token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const persona = await crearEmpleado({ nombre: 'Claudia Serrano' })
    await adscribir(empresa, persona)

    const antes = await Employee.countDocuments({})
    const res = await request(app)
      .post(`/api/v1/empleados/${persona._id}/acceso`)
      .set(auth(token))
      .send(nuevoAcceso)

    expect(res.status).toBe(201)
    expect(res.body.data.empleado.empleado.acceso).toMatchObject({
      email: 'claudia@urbacames.com',
      nivelAcceso: 'rh_consulta',
      alcanceGlobal: false,
      activo: true
    })
    // La invariante que pidió el front: nunca dos registros de la misma persona.
    expect(await Employee.countDocuments({})).toBe(antes)
    expect(await Employee.countDocuments({ nombre: 'Claudia Serrano' })).toBe(1)
  })

  it('crea la credencial en su propia colección, con el hash', async () => {
    const { empresa, token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const persona = await crearEmpleado()
    await adscribir(empresa, persona)

    await request(app)
      .post(`/api/v1/empleados/${persona._id}/acceso`)
      .set(auth(token))
      .send(nuevoAcceso)

    const credencial = await Credential.findOne({ empleadoId: persona._id }).select(
      '+passwordHash'
    )
    expect(credencial).not.toBeNull()
    expect(credencial.passwordHash).toMatch(/^\$2[aby]\$/)
    expect(credencial.passwordHash).not.toBe(PASSWORD_VALIDA)
  })

  it('la persona ya puede iniciar sesión con esa contraseña', async () => {
    const { empresa, token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const persona = await crearEmpleado({ nombre: 'Puede Entrar' })
    await adscribir(empresa, persona)

    await request(app)
      .post(`/api/v1/empleados/${persona._id}/acceso`)
      .set(auth(token))
      .send(nuevoAcceso)

    const sesion = await login('claudia@urbacames.com')
    expect(sesion.status).toBe(200)
    expect(sesion.body.data.user.name).toBe('Puede Entrar')
  })

  it('409 si ya tiene acceso', async () => {
    const { empresa, token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const persona = await crearEmpleado({ acceso: { email: 'ya@urbacames.com' } })
    await adscribir(empresa, persona)

    const res = await request(app)
      .post(`/api/v1/empleados/${persona._id}/acceso`)
      .set(auth(token))
      .send(nuevoAcceso)

    expect(res.status).toBe(409)
    expect(res.body.message).toMatch(/ya tiene acceso/i)
  })

  it('400 si el correo de acceso ya lo usa otra persona', async () => {
    const { empresa, token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    await crearEmpleado({ acceso: { email: nuevoAcceso.email } })
    const persona = await crearEmpleado()
    await adscribir(empresa, persona)

    const res = await request(app)
      .post(`/api/v1/empleados/${persona._id}/acceso`)
      .set(auth(token))
      .send(nuevoAcceso)

    expect(res.status).toBe(400)
    expect(res.body.errors[0].path).toBe('email')
  })

  it('400 con contraseña débil o nivel inválido', async () => {
    const { empresa, token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const persona = await crearEmpleado()
    await adscribir(empresa, persona)
    const enviar = (cuerpo) =>
      request(app)
        .post(`/api/v1/empleados/${persona._id}/acceso`)
        .set(auth(token))
        .send({ ...nuevoAcceso, ...cuerpo })

    expect((await enviar({ password: '1234' })).status).toBe(400)
    expect((await enviar({ nivelAcceso: 'superadmin' })).status).toBe(400)
  })

  it('400 si la persona está dada de baja', async () => {
    const { empresa, token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const persona = await crearEmpleado({ activo: false, motivoBaja: 'Renuncia' })
    await adscribir(empresa, persona)

    const res = await request(app)
      .post(`/api/v1/empleados/${persona._id}/acceso`)
      .set(auth(token))
      .send(nuevoAcceso)

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/dada de baja/i)
  })

  describe('alcance global', () => {
    it('sólo un administrador de plataforma puede otorgarlo', async () => {
      const { empresa, token } = await crearEmpleadoConSesion({ alcanceGlobal: false })
      const persona = await crearEmpleado()
      await adscribir(empresa, persona)

      const res = await request(app)
        .post(`/api/v1/empleados/${persona._id}/acceso`)
        .set(auth(token))
        .send({ ...nuevoAcceso, nivelAcceso: 'rh_admin', alcanceGlobal: true })

      expect(res.status).toBe(403)
      expect(res.body.message).toMatch(/administrador de plataforma/i)
    })

    it('no se puede dar a un nivel que no sea rh_admin', async () => {
      const { empresa, token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
      const persona = await crearEmpleado()
      await adscribir(empresa, persona)

      const res = await request(app)
        .post(`/api/v1/empleados/${persona._id}/acceso`)
        .set(auth(token))
        .send({ ...nuevoAcceso, nivelAcceso: 'rh_consulta', alcanceGlobal: true })

      expect(res.status).toBe(400)
      expect(res.body.errors[0].msg).toMatch(/administrador de RH/i)
    })
  })
})

describe('PATCH /api/v1/empleados/:id/acceso', () => {
  it('cambia nivel, correo y lo desactiva', async () => {
    const { empresa, token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const persona = await crearEmpleado({ acceso: { email: 'antes@urbacames.com' } })
    await adscribir(empresa, persona)

    const res = await request(app)
      .patch(`/api/v1/empleados/${persona._id}/acceso`)
      .set(auth(token))
      .send({ email: 'despues@urbacames.com', nivelAcceso: 'jefe_area', activo: false })

    expect(res.status).toBe(200)
    expect(res.body.data.empleado.empleado.acceso).toMatchObject({
      email: 'despues@urbacames.com',
      nivelAcceso: 'jefe_area',
      activo: false
    })
    // Desactivado, ya no entra.
    expect((await login('despues@urbacames.com')).status).toBe(401)
  })

  it('no acepta la contraseña por aquí ni campos ajenos', async () => {
    const { empresa, token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const persona = await crearEmpleado({ acceso: { email: 'p@urbacames.com' } })
    await adscribir(empresa, persona)

    const res = await request(app)
      .patch(`/api/v1/empleados/${persona._id}/acceso`)
      .set(auth(token))
      .send({ password: 'OtraClave1!', nombre: 'Otro' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/password/)
    expect(res.body.message).toMatch(/nombre/)
  })

  it('404 si la persona no tiene acceso', async () => {
    const { empresa, token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const persona = await crearEmpleado()
    await adscribir(empresa, persona)

    const res = await request(app)
      .patch(`/api/v1/empleados/${persona._id}/acceso`)
      .set(auth(token))
      .send({ nivelAcceso: 'rh_consulta' })

    expect(res.status).toBe(404)
  })

  it('no deja al sistema sin administrador de plataforma', async () => {
    const { empleado, empresa, token } = await crearEmpleadoConSesion({
      alcanceGlobal: true
    })
    const otro = await crearEmpleado({ acceso: { email: 'otro@urbacames.com' } })
    await adscribir(empresa, otro)

    const res = await request(app)
      .patch(`/api/v1/empleados/${empleado._id}/acceso`)
      .set(auth(token))
      .send({ alcanceGlobal: false })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/administrador de plataforma/i)
  })

  it('nadie puede quitarse su propio acceso', async () => {
    const { empleado, token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    await crearEmpleado({
      acceso: {
        email: 'respaldo@urbacames.com',
        nivelAcceso: 'rh_admin',
        alcanceGlobal: true
      }
    })

    const res = await request(app)
      .patch(`/api/v1/empleados/${empleado._id}/acceso`)
      .set(auth(token))
      .send({ activo: false })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/tu propio acceso/i)
  })
})

describe('DELETE /api/v1/empleados/:id/acceso — quitar acceso', () => {
  it('borra la credencial y deja intacta a la persona', async () => {
    const { empresa, token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const persona = await crearEmpleado({
      nombre: 'Sigue Siendo Empleado',
      acceso: { email: 'quitar@urbacames.com' }
    })
    await adscribir(empresa, persona)

    const res = await request(app)
      .delete(`/api/v1/empleados/${persona._id}/acceso`)
      .set(auth(token))

    expect(res.status).toBe(204)

    const recargado = await Employee.findById(persona._id)
    expect(recargado).not.toBeNull()
    expect(recargado.nombre).toBe('Sigue Siendo Empleado')
    expect(recargado.activo).toBe(true)
    expect(recargado.acceso).toBeNull()
    expect(await Credential.countDocuments({ empleadoId: persona._id })).toBe(0)
    expect((await login('quitar@urbacames.com')).status).toBe(401)
  })

  it('el correo queda libre para otra persona', async () => {
    const { empresa, token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const primero = await crearEmpleado({ acceso: { email: 'reciclado@urbacames.com' } })
    await adscribir(empresa, primero)
    await request(app).delete(`/api/v1/empleados/${primero._id}/acceso`).set(auth(token))

    const segundo = await crearEmpleado()
    await adscribir(empresa, segundo)
    const res = await request(app)
      .post(`/api/v1/empleados/${segundo._id}/acceso`)
      .set(auth(token))
      .send({ ...nuevoAcceso, email: 'reciclado@urbacames.com' })

    expect(res.status).toBe(201)
  })
})

describe('POST /api/v1/empleados/:id/acceso/restablecer-password', () => {
  it('un administrador repone la contraseña y cierra las sesiones de esa persona', async () => {
    const { empresa, token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const persona = await crearEmpleado({ acceso: { email: 'olvidadiza@urbacames.com' } })
    await adscribir(empresa, persona)

    const sesionVieja = await login('olvidadiza@urbacames.com')
    expect(sesionVieja.status).toBe(200)

    const res = await request(app)
      .post(`/api/v1/empleados/${persona._id}/acceso/restablecer-password`)
      .set(auth(token))
      .send({ password: 'RepuestaPorRH9#' })

    expect(res.status).toBe(200)

    // Entra con la nueva, no con la anterior, y su sesión previa murió.
    expect((await login('olvidadiza@urbacames.com', 'RepuestaPorRH9#')).status).toBe(200)
    expect((await login('olvidadiza@urbacames.com')).status).toBe(401)
    const conTokenViejo = await request(app)
      .get('/api/v1/auth/me')
      .set(auth(sesionVieja.body.data.token))
    expect(conTokenViejo.status).toBe(401)
  })

  it('limpia el bloqueo y los intentos fallidos', async () => {
    const { empresa, token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const persona = await crearEmpleado({ acceso: { email: 'bloqueada@urbacames.com' } })
    await adscribir(empresa, persona)
    await Credential.updateOne(
      { empleadoId: persona._id },
      { $set: { intentosFallidos: 9, bloqueadaHasta: new Date(Date.now() + 60_000) } }
    )

    await request(app)
      .post(`/api/v1/empleados/${persona._id}/acceso/restablecer-password`)
      .set(auth(token))
      .send({ password: 'RepuestaPorRH9#' })

    const credencial = await Credential.findOne({ empleadoId: persona._id })
    expect(credencial.intentosFallidos).toBe(0)
    expect(credencial.bloqueadaHasta).toBeNull()
  })
})

describe('Permisos de la administración de accesos', () => {
  it('401 sin sesión', async () => {
    const persona = await crearEmpleado()
    const res = await request(app)
      .post(`/api/v1/empleados/${persona._id}/acceso`)
      .send(nuevoAcceso)
    expect(res.status).toBe(401)
  })

  it('403 para rh_consulta y jefe_area', async () => {
    for (const nivel of ['rh_consulta', 'jefe_area']) {
      const { empresa, token } = await crearEmpleadoConSesion({
        nivelAcceso: nivel,
        areas: ['obra']
      })
      const persona = await crearEmpleado()
      await adscribir(empresa, persona, { areas: ['obra'] })

      const res = await request(app)
        .post(`/api/v1/empleados/${persona._id}/acceso`)
        .set(auth(token))
        .send({ ...nuevoAcceso, email: `x-${nivel}@urbacames.com` })

      expect(res.status).toBe(403)
    }
  })

  it('404 si el empleado no existe o no es visible', async () => {
    const { token } = await crearEmpleadoConSesion()
    const inexistente = await request(app)
      .post(`/api/v1/empleados/${new mongoose.Types.ObjectId()}/acceso`)
      .set(auth(token))
      .send(nuevoAcceso)

    const otraEmpresa = await crearEmpresa()
    const ajeno = await crearEmpleado()
    await adscribir(otraEmpresa, ajeno)
    const fueraDeAlcance = await request(app)
      .post(`/api/v1/empleados/${ajeno._id}/acceso`)
      .set(auth(token))
      .send(nuevoAcceso)

    expect(inexistente.status).toBe(404)
    // Fuera de alcance también es 404, no 403.
    expect(fueraDeAlcance.status).toBe(404)
  })
})
