const request = require('supertest')
const app = require('../../src/app')
const Client = require('../../src/api/v1/clients/clientModel')
const User = require('../../src/api/v1/users/userModel')
const { crearUsuario, crearUsuarioConSesion, auth } = require('../helpers/factories')

const RUTA = '/api/v1/usuarios'

/**
 * Alcance multi-cliente (spec 4 y criterios de aceptación § Multi-cliente).
 *
 * En fase 1 no hay clientes: todos los usuarios son `interno`. Estas pruebas
 * crean clientes a mano para ejercitar el middleware ANTES de que haga falta,
 * porque un olvido aquí significa mostrarle a un cliente los datos de otro.
 */
describe('Aislamiento por cliente', () => {
  let clienteA
  let clienteB

  beforeEach(async () => {
    clienteA = await Client.create({ nombre: 'Constructora A' })
    clienteB = await Client.create({ nombre: 'Constructora B' })
  })

  it('un usuario interno ve a todos: los de la casa y los de cada cliente', async () => {
    const { token } = await crearUsuarioConSesion({ email: 'interno@urbacames.com' })
    await crearUsuario({
      email: 'a@clientea.com',
      alcance: 'cliente',
      clienteId: clienteA._id
    })
    await crearUsuario({
      email: 'b@clienteb.com',
      alcance: 'cliente',
      clienteId: clienteB._id
    })

    const res = await request(app).get(RUTA).set(auth(token))

    expect(res.status).toBe(200)
    expect(res.body.data.usuarios).toHaveLength(3)
  })

  it('un usuario de cliente sólo ve a los de su cliente', async () => {
    const { token } = await crearUsuarioConSesion({
      email: 'admin@clientea.com',
      alcance: 'cliente',
      clienteId: clienteA._id
    })
    await crearUsuario({
      email: 'companero@clientea.com',
      alcance: 'cliente',
      clienteId: clienteA._id
    })
    await crearUsuario({
      email: 'ajeno@clienteb.com',
      alcance: 'cliente',
      clienteId: clienteB._id
    })
    await crearUsuario({ email: 'casa@urbacames.com' })

    const res = await request(app).get(RUTA).set(auth(token))

    const correos = res.body.data.usuarios.map((u) => u.email)
    expect(correos.sort()).toEqual(['admin@clientea.com', 'companero@clientea.com'])
  })

  it('pedir el usuario de otro cliente responde 404, no 403', async () => {
    const { token } = await crearUsuarioConSesion({
      email: 'admin@clientea.com',
      alcance: 'cliente',
      clienteId: clienteA._id
    })
    const ajeno = await crearUsuario({
      email: 'ajeno@clienteb.com',
      alcance: 'cliente',
      clienteId: clienteB._id
    })

    const detalle = await request(app).get(`${RUTA}/${ajeno._id}`).set(auth(token))
    const patch = await request(app)
      .patch(`${RUTA}/${ajeno._id}`)
      .set(auth(token))
      .send({ name: 'Secuestrado' })
    const baja = await request(app).delete(`${RUTA}/${ajeno._id}`).set(auth(token))

    // 403 confirmaría que el usuario existe. Para este cliente, no existe.
    expect(detalle.status).toBe(404)
    expect(patch.status).toBe(404)
    expect(baja.status).toBe(404)
  })

  it('mandar clienteId en el query string no amplía el alcance', async () => {
    const { token } = await crearUsuarioConSesion({
      email: 'admin@clientea.com',
      alcance: 'cliente',
      clienteId: clienteA._id
    })
    await crearUsuario({
      email: 'ajeno@clienteb.com',
      alcance: 'cliente',
      clienteId: clienteB._id
    })

    const res = await request(app)
      .get(`${RUTA}?clienteId=${clienteB._id}`)
      .set(auth(token))

    expect(res.status).toBe(200)
    expect(res.body.data.usuarios.map((u) => u.email)).toEqual(['admin@clientea.com'])
  })

  it('lo que crea un usuario de cliente hereda SU cliente, aunque mande otro', async () => {
    const { token } = await crearUsuarioConSesion({
      email: 'admin@clientea.com',
      alcance: 'cliente',
      clienteId: clienteA._id
    })

    const res = await request(app).post(RUTA).set(auth(token)).send({
      name: 'Nuevo De Cliente',
      email: 'nuevo@clientea.com',
      password: 'Urbacames1!',
      nivelAcceso: 'rh_consulta',
      // Intento de asignarlo al cliente ajeno: se ignora.
      alcance: 'cliente',
      clienteId: clienteB._id.toString()
    })

    expect(res.status).toBe(201)
    expect(res.body.data.usuario.clienteId).toBe(clienteA._id.toString())

    const creado = await User.findOne({ email: 'nuevo@clientea.com' })
    expect(creado.clienteId.toString()).toBe(clienteA._id.toString())
  })

  it('un usuario de cliente no puede mover a nadie a otro cliente', async () => {
    const { token } = await crearUsuarioConSesion({
      email: 'admin@clientea.com',
      alcance: 'cliente',
      clienteId: clienteA._id
    })
    const companero = await crearUsuario({
      email: 'companero@clientea.com',
      alcance: 'cliente',
      clienteId: clienteA._id
    })

    const res = await request(app)
      .patch(`${RUTA}/${companero._id}`)
      .set(auth(token))
      .send({ clienteId: clienteB._id.toString(), alcance: 'cliente' })

    expect(res.status).toBe(200)
    expect(res.body.data.usuario.clienteId).toBe(clienteA._id.toString())
  })
})

describe('Invariantes del modelo de usuario', () => {
  it('interno fuerza clienteId a null aunque se intente asignar', async () => {
    const cliente = await Client.create({ nombre: 'Constructora C' })
    const usuario = await crearUsuario({ alcance: 'interno', clienteId: cliente._id })
    expect(usuario.clienteId).toBeNull()
  })

  it('cliente sin clienteId no se puede guardar', async () => {
    await expect(crearUsuario({ alcance: 'cliente', clienteId: null })).rejects.toThrow(
      /cliente/i
    )
  })

  it('jefe_area sin área no se puede guardar', async () => {
    await expect(crearUsuario({ nivelAcceso: 'jefe_area', area: null })).rejects.toThrow(
      /área/i
    )
  })

  it('un nivel que no es jefe_area no conserva área', async () => {
    const usuario = await crearUsuario({ nivelAcceso: 'rh_consulta', area: 'obra' })
    expect(usuario.area).toBeNull()
  })
})
