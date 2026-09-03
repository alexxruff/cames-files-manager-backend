const request = require('supertest')
const app = require('../../src/app')
const IncidentType = require('../../src/api/v1/incidentTypes/incidentTypeModel')
const { ensureBaseIncidentTypes } = require('../../src/services/seedIncidentTypes')
const { crearEmpleadoConSesion, auth } = require('../helpers/factories')

/**
 * El catálogo de tipos de incidencia (D-88).
 *
 * Es **compartido del grupo**, como clientes, categorías y áreas, pero con una
 * diferencia que estas pruebas fijan a propósito: **dar de baja un tipo en uso
 * sí se permite**. No deja nada inconsistente —la incidencia vieja conserva el
 * suyo— y bloquearlo obligaría a arrastrar para siempre un tipo mal capturado.
 */
const TIPOS = '/api/v1/tipos-incidencia'

describe('Catálogo de tipos de incidencia', () => {
  beforeAll(() => IncidentType.init())

  let admin

  beforeEach(async () => {
    admin = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
  })

  const crearTipo = (nombre, sesion = admin) =>
    request(app).post(TIPOS).set(auth(sesion.token)).send({ nombre })

  const listar = (query = '', sesion = admin) =>
    request(app).get(`${TIPOS}${query}`).set(auth(sesion.token))

  describe('alta', () => {
    it('crea el tipo y lo devuelve con 201', async () => {
      const res = await crearTipo('Falla hidráulica')

      expect(res.status).toBe(201)
      expect(res.body.data.tipo).toMatchObject({
        nombre: 'Falla hidráulica',
        esBase: false,
        activo: true
      })
      expect(typeof res.body.data.tipo._id).toBe('string')
    })

    it('es idempotente por nombre: repetirlo devuelve 200 con el que ya está', async () => {
      const primera = await crearTipo('Falla hidráulica')
      // Sin acentos y en minúsculas: es el mismo tipo, no uno nuevo.
      const segunda = await crearTipo('falla hidraulica')

      expect(segunda.status).toBe(200)
      expect(segunda.body.message).toMatch(/ya existía/i)
      expect(segunda.body.data.tipo._id).toBe(primera.body.data.tipo._id)
      expect(await IncidentType.countDocuments()).toBe(1)
    })

    it('rechaza un nombre vacío con 400 en español', async () => {
      const res = await crearTipo('  ')

      expect(res.status).toBe(400)
      expect(res.body.errors[0].msg).toBe('El nombre del tipo de incidencia es requerido')
    })
  })

  describe('renombrar', () => {
    it('corrige el nombre', async () => {
      const { body } = await crearTipo('Falla hidralica')

      const res = await request(app)
        .patch(`${TIPOS}/${body.data.tipo._id}`)
        .set(auth(admin.token))
        .send({ nombre: 'Falla hidráulica' })

      expect(res.status).toBe(200)
      expect(res.body.data.tipo.nombre).toBe('Falla hidráulica')
    })

    it('409 si ya existe otro con ese nombre', async () => {
      await crearTipo('Falla hidráulica')
      const { body } = await crearTipo('Falla eléctrica')

      const res = await request(app)
        .patch(`${TIPOS}/${body.data.tipo._id}`)
        .set(auth(admin.token))
        .send({ nombre: 'falla hidraulica' })

      expect(res.status).toBe(409)
      expect(res.body.errors[0].msg).toBe('Ya existe un tipo con ese nombre')
    })
  })

  describe('baja y reactivación', () => {
    it('el tipo de baja deja de ofrecerse, pero se puede pedir', async () => {
      const { body } = await crearTipo('Llanta ponchada')
      const tipoId = body.data.tipo._id

      const baja = await request(app)
        .patch(`${TIPOS}/${tipoId}/estado`)
        .set(auth(admin.token))
        .send({ activo: false })
      expect(baja.status).toBe(200)
      expect(baja.body.data.tipo.activo).toBe(false)

      const activos = await listar()
      expect(activos.body.data.tipos.map((t) => t._id)).not.toContain(tipoId)

      const todos = await listar('?incluirInactivos=true')
      expect(todos.body.data.tipos.map((t) => t._id)).toContain(tipoId)
    })

    it('reactivar lo vuelve a ofrecer', async () => {
      const { body } = await crearTipo('Llanta ponchada')
      const tipoId = body.data.tipo._id

      await request(app)
        .patch(`${TIPOS}/${tipoId}/estado`)
        .set(auth(admin.token))
        .send({ activo: false })
      const alta = await request(app)
        .patch(`${TIPOS}/${tipoId}/estado`)
        .set(auth(admin.token))
        .send({ activo: true })

      expect(alta.status).toBe(200)
      expect((await listar()).body.data.tipos.map((t) => t._id)).toContain(tipoId)
    })

    it('los tipos base no se dan de baja', async () => {
      await ensureBaseIncidentTypes()
      const base = await IncidentType.findOne({ esBase: true })

      const res = await request(app)
        .patch(`${TIPOS}/${base._id}/estado`)
        .set(auth(admin.token))
        .send({ activo: false })

      expect(res.status).toBe(400)
      expect(res.body.message).toBe(
        'Los tipos de incidencia base no se pueden dar de baja'
      )
    })

    it('404 si el tipo no existe', async () => {
      const res = await request(app)
        .patch(`${TIPOS}/64b7f1a2c3d4e5f6a7b8c9d0/estado`)
        .set(auth(admin.token))
        .send({ activo: false })

      expect(res.status).toBe(404)
      expect(res.body.message).toBe('El tipo de incidencia no existe')
    })
  })

  describe('la semilla', () => {
    it('siembra los tipos base y no los duplica al repetirse', async () => {
      const primera = await ensureBaseIncidentTypes()
      expect(primera.creados.length).toBeGreaterThan(0)

      const total = await IncidentType.countDocuments()
      const segunda = await ensureBaseIncidentTypes()

      expect(segunda.creados).toEqual([])
      expect(await IncidentType.countDocuments()).toBe(total)
    })

    it('no deshace un renombre: lo sembrado se respeta', async () => {
      await ensureBaseIncidentTypes()
      const base = await IncidentType.findOne({ nombre: 'Falla mecánica' })

      await request(app)
        .patch(`${TIPOS}/${base._id}`)
        .set(auth(admin.token))
        .send({ nombre: 'Falla mecánica (motor)' })
      await ensureBaseIncidentTypes()

      expect(await IncidentType.findById(base._id)).toMatchObject({
        nombre: 'Falla mecánica (motor)'
      })
    })
  })

  describe('permisos', () => {
    it('cualquiera con sesión lo lee: puebla el desplegable del alta', async () => {
      await crearTipo('Falla hidráulica')
      const consulta = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_consulta',
        empresa: admin.empresa
      })

      const res = await listar('', consulta)

      expect(res.status).toBe(200)
      expect(res.body.data.total).toBe(1)
    })

    it('quien no gestiona proyectos no lo escribe: 403', async () => {
      const consulta = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_consulta',
        empresa: admin.empresa
      })

      const alta = await crearTipo('Falla hidráulica', consulta)
      expect(alta.status).toBe(403)

      const { body } = await crearTipo('Falla eléctrica')
      const baja = await request(app)
        .patch(`${TIPOS}/${body.data.tipo._id}/estado`)
        .set(auth(consulta.token))
        .send({ activo: false })
      expect(baja.status).toBe(403)
    })

    it('sin sesión, 401', async () => {
      expect((await request(app).get(TIPOS)).status).toBe(401)
      expect((await request(app).post(TIPOS).send({ nombre: 'Falla' })).status).toBe(401)
    })
  })
})
