const request = require('supertest')
const mongoose = require('mongoose')
const app = require('../../src/app')
const User = require('../../src/api/v1/users/userModel')
const {
  PASSWORD_VALIDA,
  crearUsuario,
  crearUsuarioConSesion,
  auth
} = require('../helpers/factories')

const RUTA = '/api/v1/usuarios'

describe('GET /api/v1/usuarios', () => {
  it('lista los activos bajo la llave nombrada `usuarios`', async () => {
    const { token } = await crearUsuarioConSesion({ name: 'Admin Uno' })
    await crearUsuario({ name: 'Bruno Vega', nivelAcceso: 'rh_consulta' })

    const res = await request(app).get(RUTA).set(auth(token))

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data.usuarios)).toBe(true)
    expect(res.body.data.usuarios).toHaveLength(2)
    expect(res.body.data.usuarios[0].password).toBeUndefined()
  })

  it('oculta los inactivos salvo que se pidan con incluirInactivos', async () => {
    const { token } = await crearUsuarioConSesion()
    await crearUsuario({ name: 'Dada de baja', active: false })

    const soloActivos = await request(app).get(RUTA).set(auth(token))
    const conInactivos = await request(app)
      .get(`${RUTA}?incluirInactivos=true`)
      .set(auth(token))

    expect(soloActivos.body.data.usuarios).toHaveLength(1)
    expect(conInactivos.body.data.usuarios).toHaveLength(2)
  })

  it('busca ignorando acentos y mayúsculas', async () => {
    const { token } = await crearUsuarioConSesion({ name: 'Admin Base' })
    await crearUsuario({ name: 'Rocío Gómez', email: 'rocio@urbacames.com' })

    const porNombre = await request(app).get(`${RUTA}?busqueda=gomez`).set(auth(token))
    const porNombreConAcento = await request(app)
      .get(`${RUTA}?busqueda=GÓMEZ`)
      .set(auth(token))
    const porCorreo = await request(app).get(`${RUTA}?busqueda=rocio@`).set(auth(token))

    expect(porNombre.body.data.usuarios).toHaveLength(1)
    expect(porNombreConAcento.body.data.usuarios).toHaveLength(1)
    expect(porCorreo.body.data.usuarios).toHaveLength(1)
    expect(porNombre.body.data.usuarios[0].name).toBe('Rocío Gómez')
  })

  it('exige sesión y nivel rh_admin', async () => {
    expect((await request(app).get(RUTA)).status).toBe(401)

    const { token } = await crearUsuarioConSesion({ nivelAcceso: 'rh_consulta' })
    const consulta = await request(app).get(RUTA).set(auth(token))
    expect(consulta.status).toBe(403)
    expect(consulta.body.message).toMatch(/permiso/i)

    const jefe = await crearUsuarioConSesion({
      nivelAcceso: 'jefe_area',
      area: 'obra',
      email: 'jefe@urbacames.com'
    })
    expect((await request(app).get(RUTA).set(auth(jefe.token))).status).toBe(403)
  })
})

describe('POST /api/v1/usuarios', () => {
  const nuevo = {
    name: 'Claudia Serrano',
    email: 'claudia@urbacames.com',
    password: PASSWORD_VALIDA,
    nivelAcceso: 'rh_consulta',
    area: null,
    alcance: 'interno',
    clienteId: null
  }

  it('crea el usuario con 201 y NO devuelve token', async () => {
    const { token } = await crearUsuarioConSesion()

    const res = await request(app).post(RUTA).set(auth(token)).send(nuevo)

    expect(res.status).toBe(201)
    expect(res.body.data.usuario).toMatchObject({
      name: 'Claudia Serrano',
      email: 'claudia@urbacames.com',
      nivelAcceso: 'rh_consulta',
      role: 'user',
      area: null,
      alcance: 'interno',
      clienteId: null,
      active: true
    })
    expect(res.body.data.token).toBeUndefined()

    // La contraseña queda hasheada, nunca en claro.
    const enBase = await User.findOne({ email: nuevo.email }).select('+password')
    expect(enBase.password).not.toBe(PASSWORD_VALIDA)
    expect(enBase.password).toMatch(/^\$2[aby]\$/)
  })

  it('400 si el correo ya existe, con el campo señalado', async () => {
    const { token } = await crearUsuarioConSesion()
    await crearUsuario({ email: nuevo.email })

    const res = await request(app).post(RUTA).set(auth(token)).send(nuevo)

    expect(res.status).toBe(400)
    expect(res.body.errors[0].path).toBe('email')
    expect(res.body.message).toMatch(/correo/i)
  })

  it('acepta nombres con acentos y ñ', async () => {
    const { token } = await crearUsuarioConSesion()
    const res = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send({ ...nuevo, name: "José Muñoz O'Higgins" })

    expect(res.status).toBe(201)
    expect(res.body.data.usuario.name).toBe("José Muñoz O'Higgins")
  })

  it('rechaza contraseñas débiles con mensaje en español', async () => {
    const { token } = await crearUsuarioConSesion()
    const res = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send({ ...nuevo, password: 'sencilla' })

    expect(res.status).toBe(400)
    expect(res.body.errors[0].msg).toMatch(/contraseña/i)
  })

  it('exige área para jefe_area y la ignora para los demás niveles', async () => {
    const { token } = await crearUsuarioConSesion()

    const sinArea = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send({ ...nuevo, nivelAcceso: 'jefe_area', area: null })
    expect(sinArea.status).toBe(400)
    expect(sinArea.body.errors[0].msg).toMatch(/área/i)

    const conArea = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send({ ...nuevo, nivelAcceso: 'jefe_area', area: 'obra' })
    expect(conArea.status).toBe(201)
    expect(conArea.body.data.usuario.area).toBe('obra')

    const areaIgnorada = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send({
        ...nuevo,
        email: 'otro@urbacames.com',
        nivelAcceso: 'rh_consulta',
        area: 'obra'
      })
    expect(areaIgnorada.status).toBe(201)
    expect(areaIgnorada.body.data.usuario.area).toBeNull()
  })

  it('rechaza áreas y niveles inventados', async () => {
    const { token } = await crearUsuarioConSesion()

    const areaMala = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send({ ...nuevo, nivelAcceso: 'jefe_area', area: 'taller' })
    const nivelMalo = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send({ ...nuevo, nivelAcceso: 'superadmin' })

    expect(areaMala.status).toBe(400)
    expect(nivelMalo.status).toBe(400)
  })

  it('exige cliente cuando el alcance es cliente', async () => {
    const { token } = await crearUsuarioConSesion()
    const res = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send({ ...nuevo, alcance: 'cliente', clienteId: null })

    expect(res.status).toBe(400)
    expect(res.body.errors[0].path).toBe('clienteId')
  })

  it('no acepta un cliente que no existe', async () => {
    const { token } = await crearUsuarioConSesion()
    const res = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send({
        ...nuevo,
        alcance: 'cliente',
        clienteId: new mongoose.Types.ObjectId().toString()
      })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/cliente/i)
  })

  it('en fase 1 todo lo que se crea queda con clienteId null', async () => {
    const { token } = await crearUsuarioConSesion()
    await request(app).post(RUTA).set(auth(token)).send(nuevo)

    const creado = await User.findOne({ email: nuevo.email })
    expect(creado.clienteId).toBeNull()
    expect(creado.alcance).toBe('interno')
  })
})

describe('PATCH /api/v1/usuarios/:id', () => {
  it('actualiza los campos permitidos', async () => {
    const { token } = await crearUsuarioConSesion()
    const otro = await crearUsuario({ name: 'Antes', nivelAcceso: 'rh_consulta' })

    const res = await request(app)
      .patch(`${RUTA}/${otro._id}`)
      .set(auth(token))
      .send({ name: 'Después', nivelAcceso: 'jefe_area', area: 'contabilidad' })

    expect(res.status).toBe(200)
    expect(res.body.data.usuario).toMatchObject({
      name: 'Después',
      nivelAcceso: 'jefe_area',
      area: 'contabilidad'
    })
  })

  it('400 con la lista de campos no permitidos', async () => {
    const { token } = await crearUsuarioConSesion()
    const otro = await crearUsuario()

    const res = await request(app)
      .patch(`${RUTA}/${otro._id}`)
      .set(auth(token))
      .send({ name: 'Nuevo', password: 'OtraClave1!', active: false })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/password/)
    expect(res.body.message).toMatch(/active/)
  })

  it('400 si el cuerpo viene vacío', async () => {
    const { token } = await crearUsuarioConSesion()
    const otro = await crearUsuario()
    const res = await request(app).patch(`${RUTA}/${otro._id}`).set(auth(token)).send({})
    expect(res.status).toBe(400)
  })

  it('400 si el correo nuevo ya lo usa alguien más', async () => {
    const { token } = await crearUsuarioConSesion()
    await crearUsuario({ email: 'ocupado@urbacames.com' })
    const otro = await crearUsuario({ email: 'libre@urbacames.com' })

    const res = await request(app)
      .patch(`${RUTA}/${otro._id}`)
      .set(auth(token))
      .send({ email: 'ocupado@urbacames.com' })

    expect(res.status).toBe(400)
    expect(res.body.errors[0].path).toBe('email')
  })

  it('404 si el usuario no existe y 400 si el id no tiene forma de id', async () => {
    const { token } = await crearUsuarioConSesion()

    const noExiste = await request(app)
      .patch(`${RUTA}/${new mongoose.Types.ObjectId()}`)
      .set(auth(token))
      .send({ name: 'Da igual' })
    const idMalo = await request(app)
      .patch(`${RUTA}/no-es-un-id`)
      .set(auth(token))
      .send({ name: 'Da igual' })

    expect(noExiste.status).toBe(404)
    expect(idMalo.status).toBe(400)
  })

  it('impide que el último administrador se quite la administración', async () => {
    const { usuario, token } = await crearUsuarioConSesion({ nivelAcceso: 'rh_admin' })

    const res = await request(app)
      .patch(`${RUTA}/${usuario._id}`)
      .set(auth(token))
      .send({ nivelAcceso: 'rh_consulta' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/administrador/i)
  })
})

describe('DELETE /api/v1/usuarios/:id', () => {
  it('da de baja lógicamente y responde 204 sin cuerpo', async () => {
    const { token } = await crearUsuarioConSesion()
    const otro = await crearUsuario({ nivelAcceso: 'rh_consulta' })

    const res = await request(app).delete(`${RUTA}/${otro._id}`).set(auth(token))

    expect(res.status).toBe(204)
    expect(res.body).toEqual({})

    // El documento sigue ahí: el histórico debe seguir siendo legible.
    const enBase = await User.findById(otro._id)
    expect(enBase).not.toBeNull()
    expect(enBase.active).toBe(false)
  })

  it('un administrador no puede darse de baja a sí mismo', async () => {
    const { usuario, token } = await crearUsuarioConSesion()
    const res = await request(app).delete(`${RUTA}/${usuario._id}`).set(auth(token))

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/a ti mismo/i)
  })

  it('no deja al sistema sin ningún administrador activo', async () => {
    const { token } = await crearUsuarioConSesion({ email: 'admin1@urbacames.com' })
    const otroAdmin = await crearUsuario({
      email: 'admin2@urbacames.com',
      nivelAcceso: 'rh_admin'
    })

    // Con dos administradores, dar de baja al otro se permite…
    const primera = await request(app).delete(`${RUTA}/${otroAdmin._id}`).set(auth(token))
    expect(primera.status).toBe(204)

    // …y el que queda ya no puede quedarse fuera (además de la regla de "a ti
    // mismo", la de "debe quedar un administrador" lo cubre desde otro usuario).
    const tercerAdmin = await crearUsuarioConSesion({
      email: 'admin3@urbacames.com',
      nivelAcceso: 'rh_admin'
    })
    const segunda = await request(app)
      .delete(`${RUTA}/${tercerAdmin.usuario._id}`)
      .set(auth(token))
    expect(segunda.status).toBe(204)
  })
})

describe('PATCH /api/v1/usuarios/:id/reactivar', () => {
  it('vuelve a activar a un usuario dado de baja', async () => {
    const { token } = await crearUsuarioConSesion()
    const inactivo = await crearUsuario({ active: false, nivelAcceso: 'rh_consulta' })

    const res = await request(app)
      .patch(`${RUTA}/${inactivo._id}/reactivar`)
      .set(auth(token))

    expect(res.status).toBe(200)
    expect(res.body.data.usuario.active).toBe(true)
  })

  it('es idempotente sobre alguien que ya está activo', async () => {
    const { token } = await crearUsuarioConSesion()
    const activo = await crearUsuario({ nivelAcceso: 'rh_consulta' })
    const res = await request(app)
      .patch(`${RUTA}/${activo._id}/reactivar`)
      .set(auth(token))
    expect(res.status).toBe(200)
    expect(res.body.data.usuario.active).toBe(true)
  })
})
