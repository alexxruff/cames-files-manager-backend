const request = require('supertest')
const app = require('../../src/app')
const Category = require('../../src/api/v1/categories/categoryModel')
const {
  crearCategoria,
  crearEmpleado,
  crearEmpleadoConSesion,
  adscribir,
  auth
} = require('../helpers/factories')

const RUTA = '/api/v1/categorias'

describe('POST /api/v1/categorias', () => {
  beforeAll(() => Category.init())

  it('el administrador de plataforma crea la categoría con su tipo', async () => {
    const { token } = await crearEmpleadoConSesion({
      alcanceGlobal: true,
      sinAdscripcion: true
    })

    const res = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send({ nombre: 'Auxiliar contable', tipo: 'administrativo' })

    expect(res.status).toBe(201)
    expect(res.body.data.categoria).toMatchObject({
      nombre: 'Auxiliar contable',
      tipo: 'administrativo',
      activo: true,
      esBase: false
    })
  })

  it('403 para los demás niveles: el catálogo es de todo el grupo', async () => {
    for (const nivel of ['rh_admin', 'rh_consulta', 'jefe_area']) {
      const { token } = await crearEmpleadoConSesion({
        nivelAcceso: nivel,
        areas: ['operaciones_urbanizadora']
      })
      const res = await request(app)
        .post(RUTA)
        .set(auth(token))
        .send({ nombre: `Puesto de ${nivel}`, tipo: 'mano_de_obra' })

      expect(res.status).toBe(403)
    }
  })

  it('es idempotente por nombre: si ya existe la devuelve con 200', async () => {
    const { token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const existente = await crearCategoria('Albañil', 'mano_de_obra')
    const antes = await Category.countDocuments({})

    const res = await request(app)
      .post(RUTA)
      .set(auth(token))
      // Mismo nombre con otra capitalización y acentos: es la misma.
      .send({ nombre: 'albañil', tipo: 'mano_de_obra' })

    expect(res.status).toBe(200)
    expect(res.body.message).toMatch(/ya existía/i)
    expect(res.body.data.categoria._id).toBe(existente._id.toString())
    // No creó otra.
    expect(await Category.countDocuments({})).toBe(antes)
  })

  it('409 si el mismo nombre se pide con otro tipo', async () => {
    const { token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    await crearCategoria('Supervisor', 'administrativo')

    const res = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send({ nombre: 'Supervisor', tipo: 'mano_de_obra' })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('CATEGORIA_OTRO_TIPO')
    expect(res.body.data.categoria.tipo).toBe('administrativo')
  })

  it('400 sin tipo o con un tipo inventado', async () => {
    const { token } = await crearEmpleadoConSesion({ alcanceGlobal: true })

    const sinTipo = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send({ nombre: 'Peón' })
    const tipoMalo = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send({ nombre: 'Peón', tipo: 'obrero' })

    expect(sinTipo.status).toBe(400)
    expect(tipoMalo.status).toBe(400)
    expect(sinTipo.body.errors[0].path).toBe('tipo')
  })
})

describe('GET /api/v1/categorias', () => {
  it('cualquiera con sesión las lee: pueblan el desplegable del alta', async () => {
    await crearCategoria('Albañil', 'mano_de_obra')
    await crearCategoria('Contador', 'administrativo')

    for (const nivel of ['rh_admin', 'rh_consulta', 'jefe_area']) {
      const { token } = await crearEmpleadoConSesion({
        nivelAcceso: nivel,
        areas: ['operaciones_urbanizadora']
      })
      const res = await request(app).get(RUTA).set(auth(token))
      expect(res.status).toBe(200)
      expect(res.body.data.categorias.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('filtra por tipo', async () => {
    const { token } = await crearEmpleadoConSesion()
    await crearCategoria('Albañil', 'mano_de_obra')
    await crearCategoria('Contador', 'administrativo')

    const obra = await request(app).get(`${RUTA}?tipo=mano_de_obra`).set(auth(token))
    expect(obra.body.data.categorias.map((c) => c.nombre)).toEqual(['Albañil'])
  })

  it('ordena alfabéticamente con criterio español', async () => {
    const { token } = await crearEmpleadoConSesion()
    for (const nombre of ['Zapatero', 'Ávila', 'Albañil']) {
      await crearCategoria(nombre, 'mano_de_obra')
    }

    const res = await request(app).get(`${RUTA}?tipo=mano_de_obra`).set(auth(token))
    expect(res.body.data.categorias.map((c) => c.nombre)).toEqual([
      'Albañil',
      'Ávila',
      'Zapatero'
    ])
  })

  it('400 con un tipo inválido en el query', async () => {
    const { token } = await crearEmpleadoConSesion()
    const res = await request(app).get(`${RUTA}?tipo=obrero`).set(auth(token))
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/v1/categorias/:id/estado', () => {
  it('desactiva una categoría que nadie usa', async () => {
    const { token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const categoria = await crearCategoria('Sin uso', 'mano_de_obra')

    const res = await request(app)
      .patch(`${RUTA}/${categoria._id}/estado`)
      .set(auth(token))
      .send({ activo: false })

    expect(res.status).toBe(200)
    expect(res.body.data.categoria.activo).toBe(false)
  })

  it('no la desactiva si hay personas con ese puesto', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const categoria = await crearCategoria('En uso', 'mano_de_obra')
    const persona = await crearEmpleado({
      tipo: 'mano_de_obra',
      categoriaId: categoria._id
    })
    await adscribir(
      empresa || (await require('../helpers/factories').crearEmpresa()),
      persona
    )

    const res = await request(app)
      .patch(`${RUTA}/${categoria._id}/estado`)
      .set(auth(token))
      .send({ activo: false })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/1 persona la tiene/i)
  })

  it('las categorías base no se desactivan', async () => {
    const { token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const base = await Category.create({
      nombre: 'Base',
      tipo: 'administrativo',
      esBase: true
    })

    const res = await request(app)
      .patch(`${RUTA}/${base._id}/estado`)
      .set(auth(token))
      .send({ activo: false })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/base/i)
  })
})
