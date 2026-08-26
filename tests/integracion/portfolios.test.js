const request = require('supertest')
const mongoose = require('mongoose')
const app = require('../../src/app')
const Portfolio = require('../../src/api/v1/portfolios/portfolioModel')
const {
  crearEmpresa,
  crearCliente,
  crearEmpleadoConSesion,
  agregarACartera,
  crearProyecto,
  auth
} = require('../helpers/factories')

/**
 * Carteras — empresa ↔ cliente. Es la pieza que hace posible el proyecto: no hay
 * proyecto sin un cliente en la cartera activa de su empresa.
 */
describe('POST /api/v1/empresas/:id/clientes — meter a la cartera', () => {
  beforeAll(() => Portfolio.init())

  it('agrega un cliente del catálogo a la cartera de la empresa', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const cliente = await crearCliente({ nombre: 'Grupo Alvarado' })

    const res = await request(app)
      .post(`/api/v1/empresas/${empresa._id}/clientes`)
      .set(auth(token))
      .send({ clienteId: cliente._id.toString(), contactoNombre: 'Luis Alvarado' })

    expect(res.status).toBe(201)
    expect(res.body.data.cartera).toMatchObject({
      empresaId: empresa._id.toString(),
      clienteId: cliente._id.toString(),
      contactoNombre: 'Luis Alvarado',
      activo: true
    })
  })

  it('el contacto de la cartera puede diferir del del catálogo', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const cliente = await crearCliente({
      nombre: 'Grupo Alvarado',
      contactoNombre: 'Contacto del catálogo'
    })

    const res = await request(app)
      .post(`/api/v1/empresas/${empresa._id}/clientes`)
      .set(auth(token))
      .send({
        clienteId: cliente._id.toString(),
        contactoNombre: 'Contacto de esta empresa'
      })

    expect(res.body.data.cartera.contactoNombre).toBe('Contacto de esta empresa')
  })

  it('el jefe de área también puede; rh_consulta no', async () => {
    const cliente = await crearCliente()

    const jefe = await crearEmpleadoConSesion({
      nivelAcceso: 'jefe_area',
      areas: ['operaciones_urbanizadora']
    })
    const conJefe = await request(app)
      .post(`/api/v1/empresas/${jefe.empresa._id}/clientes`)
      .set(auth(jefe.token))
      .send({ clienteId: cliente._id.toString() })
    expect(conJefe.status).toBe(201)

    const consulta = await crearEmpleadoConSesion({ nivelAcceso: 'rh_consulta' })
    const conConsulta = await request(app)
      .post(`/api/v1/empresas/${consulta.empresa._id}/clientes`)
      .set(auth(consulta.token))
      .send({ clienteId: cliente._id.toString() })
    expect(conConsulta.status).toBe(403)
  })

  it('409 si el cliente ya está en la cartera', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const cliente = await crearCliente()
    await agregarACartera(empresa, cliente)

    const res = await request(app)
      .post(`/api/v1/empresas/${empresa._id}/clientes`)
      .set(auth(token))
      .send({ clienteId: cliente._id.toString() })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('CARTERA_DUPLICADA')
  })

  it('si estaba sacado, lo REACTIVA en vez de duplicar el vínculo', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const cliente = await crearCliente()
    await agregarACartera(empresa, cliente, { activo: false, notas: 'Notas de antes' })

    const res = await request(app)
      .post(`/api/v1/empresas/${empresa._id}/clientes`)
      .set(auth(token))
      .send({ clienteId: cliente._id.toString() })

    // 200 y no 201: no se creó nada nuevo.
    expect(res.status).toBe(200)
    expect(res.body.message).toMatch(/volvió a la cartera/i)
    expect(res.body.data.cartera.activo).toBe(true)
    expect(await Portfolio.countDocuments({ empresaId: empresa._id })).toBe(1)
  })

  it('400 si el cliente está desactivado en el catálogo; 404 si no existe', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const desactivado = await crearCliente({ activo: false })

    const inactivo = await request(app)
      .post(`/api/v1/empresas/${empresa._id}/clientes`)
      .set(auth(token))
      .send({ clienteId: desactivado._id.toString() })
    const inexistente = await request(app)
      .post(`/api/v1/empresas/${empresa._id}/clientes`)
      .set(auth(token))
      .send({ clienteId: new mongoose.Types.ObjectId().toString() })

    expect(inactivo.status).toBe(400)
    expect(inexistente.status).toBe(404)
  })

  it('404 si la empresa no es suya', async () => {
    const { token } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const ajena = await crearEmpresa()
    const cliente = await crearCliente()

    const res = await request(app)
      .post(`/api/v1/empresas/${ajena._id}/clientes`)
      .set(auth(token))
      .send({ clienteId: cliente._id.toString() })

    expect(res.status).toBe(404)
  })
})

describe('GET /api/v1/empresas/:id/clientes', () => {
  it('devuelve la cartera con los datos del cliente resueltos', async () => {
    const { token, empresa } = await crearEmpleadoConSesion()
    const cliente = await crearCliente({ nombre: 'Grupo Alvarado', rfc: 'GAL210101AB1' })
    await agregarACartera(empresa, cliente, { notas: 'Paga a 30 días' })

    const res = await request(app)
      .get(`/api/v1/empresas/${empresa._id}/clientes`)
      .set(auth(token))

    expect(res.status).toBe(200)
    expect(res.body.data.cartera).toHaveLength(1)
    expect(res.body.data.cartera[0]).toMatchObject({
      notas: 'Paga a 30 días',
      cliente: { nombre: 'Grupo Alvarado', rfc: 'GAL210101AB1' }
    })
  })

  it('cualquiera con sesión la lee: puebla el selector de cliente del proyecto', async () => {
    const { empresa } = await crearEmpleadoConSesion()
    const cliente = await crearCliente()
    await agregarACartera(empresa, cliente)

    const consulta = await crearEmpleadoConSesion({
      nivelAcceso: 'rh_consulta',
      empresa
    })
    const res = await request(app)
      .get(`/api/v1/empresas/${empresa._id}/clientes`)
      .set(auth(consulta.token))

    expect(res.status).toBe(200)
    expect(res.body.data.cartera).toHaveLength(1)
  })

  it('filtra por activo', async () => {
    const { token, empresa } = await crearEmpleadoConSesion()
    await agregarACartera(empresa, await crearCliente({ nombre: 'Vigente' }))
    await agregarACartera(empresa, await crearCliente({ nombre: 'Sacado' }), {
      activo: false
    })

    const activos = await request(app)
      .get(`/api/v1/empresas/${empresa._id}/clientes?activo=true`)
      .set(auth(token))
    const todos = await request(app)
      .get(`/api/v1/empresas/${empresa._id}/clientes`)
      .set(auth(token))

    expect(activos.body.data.cartera).toHaveLength(1)
    expect(todos.body.data.cartera).toHaveLength(2)
  })

  it('404 si la empresa no es suya', async () => {
    const { token } = await crearEmpleadoConSesion()
    const ajena = await crearEmpresa()

    const res = await request(app)
      .get(`/api/v1/empresas/${ajena._id}/clientes`)
      .set(auth(token))
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/v1/carteras/:id', () => {
  it('actualiza el contacto y las notas de la relación', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const cartera = await agregarACartera(empresa, await crearCliente())

    const res = await request(app)
      .patch(`/api/v1/carteras/${cartera._id}`)
      .set(auth(token))
      .send({ contactoNombre: 'Nuevo contacto', notas: 'Cambió de responsable' })

    expect(res.status).toBe(200)
    expect(res.body.data.cartera).toMatchObject({
      contactoNombre: 'Nuevo contacto',
      notas: 'Cambió de responsable'
    })
  })

  it('400 con campos de otro recurso y dice a dónde van', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const cartera = await agregarACartera(empresa, await crearCliente())

    const res = await request(app)
      .patch(`/api/v1/carteras/${cartera._id}`)
      .set(auth(token))
      .send({ activo: false, clienteId: new mongoose.Types.ObjectId().toString() })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/estado/)
    expect(res.body.message).toMatch(/no se puede cambiar el cliente/)
  })

  it('404 si la cartera es de otra empresa', async () => {
    const ajena = await crearEmpresa()
    const cartera = await agregarACartera(ajena, await crearCliente())
    const { token } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })

    const res = await request(app)
      .patch(`/api/v1/carteras/${cartera._id}`)
      .set(auth(token))
      .send({ notas: 'Intento' })

    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/v1/carteras/:id/estado — sacar de la cartera', () => {
  it('saca al cliente y lo devuelve', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const cartera = await agregarACartera(empresa, await crearCliente())

    const sacar = await request(app)
      .patch(`/api/v1/carteras/${cartera._id}/estado`)
      .set(auth(token))
      .send({ activo: false })
    expect(sacar.status).toBe(200)
    expect(sacar.body.data.cartera.activo).toBe(false)

    const devolver = await request(app)
      .patch(`/api/v1/carteras/${cartera._id}/estado`)
      .set(auth(token))
      .send({ activo: true })
    expect(devolver.body.data.cartera.activo).toBe(true)
  })

  it('NO se puede sacar si la empresa tiene proyectos con ese cliente', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const { cliente } = await crearProyecto(empresa)
    const cartera = await Portfolio.findOne({
      empresaId: empresa._id,
      clienteId: cliente._id
    })

    const res = await request(app)
      .patch(`/api/v1/carteras/${cartera._id}/estado`)
      .set(auth(token))
      .send({ activo: false })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/1 proyecto con ese cliente/i)
  })
})
