const request = require('supertest')
const mongoose = require('mongoose')
const app = require('../../src/app')
const Client = require('../../src/api/v1/clients/clientModel')
const {
  crearEmpleadoConSesion,
  crearEmpresa,
  agregarACartera,
  auth
} = require('../helpers/factories')

const RUTA = '/api/v1/clientes'

const nuevo = {
  nombre: 'Grupo Alvarado',
  rfc: 'GAL210101AB1',
  contactoNombre: 'Luis Alvarado',
  contactoEmail: 'luis@grupoalvarado.com',
  contactoTelefono: '3312345678'
}

/** Sesión de un nivel que puede administrar clientes. */
const sesionAdmin = () => crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })

/**
 * Administrador de plataforma: ve el catálogo completo. Se usa en las pruebas de
 * paginación, orden y búsqueda para que midan eso y no el filtro por cartera,
 * que tiene su propio bloque más abajo.
 */
const sesionGlobal = () =>
  crearEmpleadoConSesion({ alcanceGlobal: true, sinAdscripcion: true })

describe('POST /api/v1/clientes', () => {
  beforeAll(() => Client.init())

  it('crea el cliente del catálogo global, sin empresa dueña', async () => {
    const { token } = await sesionAdmin()

    const res = await request(app).post(RUTA).set(auth(token)).send(nuevo)

    expect(res.status).toBe(201)
    expect(res.body.data.cliente).toMatchObject({
      nombre: 'Grupo Alvarado',
      rfc: 'GAL210101AB1',
      contactoNombre: 'Luis Alvarado',
      contactoEmail: 'luis@grupoalvarado.com',
      activo: true
    })
    // Es global: no lleva empresa.
    expect(res.body.data.cliente.empresaId).toBeUndefined()
    expect(res.body.data.cliente.nombreNormalizado).toBeUndefined()
  })

  it('el jefe de área también puede: es la corrección de la matriz', async () => {
    const { token } = await crearEmpleadoConSesion({
      nivelAcceso: 'jefe_area',
      areas: ['obra']
    })

    const res = await request(app).post(RUTA).set(auth(token)).send(nuevo)
    expect(res.status).toBe(201)
  })

  it('403 para rh_consulta', async () => {
    const { token } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_consulta' })

    const res = await request(app).post(RUTA).set(auth(token)).send(nuevo)
    expect(res.status).toBe(403)
  })

  it('409 si el nombre ya existe, ignorando acentos y mayúsculas', async () => {
    const { token } = await sesionAdmin()
    const existente = await Client.create({ nombre: 'Grupo Alvarado' })

    const res = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send({ nombre: 'grupo alvarado' })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('CLIENTE_DUPLICADO')
    expect(res.body.errors[0].path).toBe('nombre')
    // Con el id, la interfaz puede ofrecer «ya existe, ¿lo usas?».
    expect(res.body.data.cliente._id).toBe(existente._id.toString())
  })

  it('409 si el RFC ya existe', async () => {
    const { token } = await sesionAdmin()
    await Client.create({ nombre: 'Otro Cliente', rfc: 'GAL210101AB1' })

    const res = await request(app).post(RUTA).set(auth(token)).send(nuevo)

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('RFC_DUPLICADO')
    expect(res.body.data.cliente.nombre).toBe('Otro Cliente')
  })

  it('el RFC y los contactos son opcionales', async () => {
    const { token } = await sesionAdmin()

    const uno = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send({ nombre: 'Cliente Uno' })
    const dos = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send({ nombre: 'Cliente Dos' })

    expect(uno.status).toBe(201)
    expect(dos.status).toBe(201)
    // Varios sin RFC conviven: el índice único es parcial.
    expect(dos.body.data.cliente.rfc).toBeNull()
    expect(dos.body.data.cliente.contactoNombre).toBeNull()
  })

  it('400 con nombre corto, RFC mal formado o correo inválido', async () => {
    const { token } = await sesionAdmin()
    const casos = [
      [{ nombre: 'ab' }, 'nombre'],
      [{ ...nuevo, rfc: 'NO-ES-RFC' }, 'rfc'],
      [{ ...nuevo, contactoEmail: 'no-es-correo' }, 'contactoEmail']
    ]

    for (const [cuerpo, campo] of casos) {
      const res = await request(app).post(RUTA).set(auth(token)).send(cuerpo)
      expect(res.status).toBe(400)
      expect(res.body.errors.some((e) => e.path === campo)).toBe(true)
      expect(res.body.errors[0].msg).not.toBe('Invalid value')
    }
  })

  it('401 sin sesión', async () => {
    expect((await request(app).post(RUTA).send(nuevo)).status).toBe(401)
  })
})

describe('GET /api/v1/clientes', () => {
  it('cualquiera con sesión lee los clientes de la cartera de su empresa', async () => {
    const cliente = await Client.create({ nombre: 'Grupo Alvarado' })

    for (const nivel of ['rh_admin', 'rh_consulta', 'jefe_area']) {
      const { token, empresa } = await crearEmpleadoConSesion({
        nivelAcceso: nivel,
        areas: ['obra']
      })
      await agregarACartera(empresa, cliente)

      const res = await request(app).get(RUTA).set(auth(token))
      expect(res.status).toBe(200)
      expect(res.body.data.clientes.map((c) => c.nombre)).toEqual(['Grupo Alvarado'])
    }
  })

  it('devuelve total, pagina y porPagina, y corta después de ordenar', async () => {
    const { token } = await sesionGlobal()
    for (const nombre of ['Cliente C', 'Cliente A', 'Cliente B']) {
      await Client.create({ nombre })
    }

    const primera = await request(app).get(`${RUTA}?porPagina=2`).set(auth(token))
    const segunda = await request(app)
      .get(`${RUTA}?porPagina=2&pagina=2`)
      .set(auth(token))

    expect(primera.body.data).toMatchObject({ total: 3, pagina: 1, porPagina: 2 })
    expect(primera.body.data.clientes.map((c) => c.nombre)).toEqual([
      'Cliente A',
      'Cliente B'
    ])
    expect(segunda.body.data.clientes.map((c) => c.nombre)).toEqual(['Cliente C'])
  })

  it('una página más allá del final devuelve lista vacía y el total real', async () => {
    const { token } = await sesionGlobal()
    await Client.create({ nombre: 'Grupo Alvarado' })

    const res = await request(app).get(`${RUTA}?pagina=99`).set(auth(token))
    expect(res.body.data.clientes).toEqual([])
    expect(res.body.data.total).toBe(1)
  })

  it('busca ignorando acentos y con coincidencia parcial', async () => {
    const { token } = await sesionGlobal()
    await Client.create({ nombre: 'Constructora Ángeles' })
    await Client.create({ nombre: 'Grupo Alvarado' })

    const res = await request(app).get(`${RUTA}?busqueda=angel`).set(auth(token))
    expect(res.body.data.clientes.map((c) => c.nombre)).toEqual(['Constructora Ángeles'])
  })

  it('ordena en los dos sentidos con criterio español', async () => {
    const { token } = await sesionGlobal()
    for (const nombre of ['Zamora', 'Ávila', 'Núñez']) await Client.create({ nombre })

    const asc = await request(app).get(`${RUTA}?orden=nombre_asc`).set(auth(token))
    const desc = await request(app).get(`${RUTA}?orden=nombre_desc`).set(auth(token))

    expect(asc.body.data.clientes.map((c) => c.nombre)).toEqual([
      'Ávila',
      'Núñez',
      'Zamora'
    ])
    expect(desc.body.data.clientes.map((c) => c.nombre)).toEqual([
      'Zamora',
      'Núñez',
      'Ávila'
    ])
  })

  it('oculta los inactivos salvo que se pidan', async () => {
    const { token } = await sesionGlobal()
    await Client.create({ nombre: 'Activo' })
    await Client.create({ nombre: 'Desactivado', activo: false })

    const normal = await request(app).get(RUTA).set(auth(token))
    const conInactivos = await request(app)
      .get(`${RUTA}?incluirInactivos=true`)
      .set(auth(token))

    expect(normal.body.data.clientes.map((c) => c.nombre)).toEqual(['Activo'])
    expect(conInactivos.body.data.total).toBe(2)
  })

  it('400 con parámetros inválidos', async () => {
    const { token } = await sesionGlobal()
    for (const ruta of [
      `${RUTA}?pagina=0`,
      `${RUTA}?porPagina=500`,
      `${RUTA}?orden=raro`
    ]) {
      const res = await request(app).get(ruta).set(auth(token))
      expect(res.status).toBe(400)
    }
  })

  it('el detalle existe y 404 si no', async () => {
    const { token } = await sesionGlobal()
    const cliente = await Client.create({ nombre: 'Grupo Alvarado' })

    const existe = await request(app).get(`${RUTA}/${cliente._id}`).set(auth(token))
    const noExiste = await request(app)
      .get(`${RUTA}/${new mongoose.Types.ObjectId()}`)
      .set(auth(token))
    const idMalo = await request(app).get(`${RUTA}/no-es-id`).set(auth(token))

    expect(existe.body.data.cliente.nombre).toBe('Grupo Alvarado')
    expect(noExiste.status).toBe(404)
    expect(idMalo.status).toBe(400)
  })
})

describe('PATCH /api/v1/clientes/:id', () => {
  it('actualiza nombre, RFC y contactos', async () => {
    const { token } = await sesionAdmin()
    const cliente = await Client.create({ nombre: 'Grupo Alvarado' })

    const res = await request(app).patch(`${RUTA}/${cliente._id}`).set(auth(token)).send({
      nombre: 'Grupo Alvarado y Asociados',
      rfc: 'GAL210101AB1',
      contactoNombre: 'Luis Alvarado'
    })

    expect(res.status).toBe(200)
    expect(res.body.data.cliente).toMatchObject({
      nombre: 'Grupo Alvarado y Asociados',
      rfc: 'GAL210101AB1',
      contactoNombre: 'Luis Alvarado'
    })
  })

  it('deja reenviar su propio nombre sin chocar consigo mismo', async () => {
    const { token } = await sesionAdmin()
    const cliente = await Client.create({ nombre: 'Grupo Alvarado' })

    const res = await request(app)
      .patch(`${RUTA}/${cliente._id}`)
      .set(auth(token))
      .send({ nombre: 'Grupo Alvarado', contactoTelefono: '3312345678' })

    expect(res.status).toBe(200)
  })

  it('409 si el nombre o el RFC nuevos son de otro cliente', async () => {
    const { token } = await sesionAdmin()
    await Client.create({ nombre: 'Otro Cliente', rfc: 'OTR210101AB1' })
    const cliente = await Client.create({ nombre: 'Grupo Alvarado' })

    const porNombre = await request(app)
      .patch(`${RUTA}/${cliente._id}`)
      .set(auth(token))
      .send({ nombre: 'otro cliente' })
    const porRfc = await request(app)
      .patch(`${RUTA}/${cliente._id}`)
      .set(auth(token))
      .send({ rfc: 'OTR210101AB1' })

    expect(porNombre.status).toBe(409)
    expect(porRfc.status).toBe(409)
  })

  it('vacía un contacto con null, nunca con cadena vacía', async () => {
    const { token } = await sesionAdmin()
    const cliente = await Client.create({
      nombre: 'Grupo Alvarado',
      contactoNombre: 'Luis'
    })

    const res = await request(app)
      .patch(`${RUTA}/${cliente._id}`)
      .set(auth(token))
      .send({ contactoNombre: null })

    expect(res.body.data.cliente.contactoNombre).toBeNull()
  })

  it('400 con el cuerpo vacío o con campos de otro recurso', async () => {
    const { token } = await sesionAdmin()
    const cliente = await Client.create({ nombre: 'Grupo Alvarado' })

    const vacio = await request(app)
      .patch(`${RUTA}/${cliente._id}`)
      .set(auth(token))
      .send({})
    const ajeno = await request(app)
      .patch(`${RUTA}/${cliente._id}`)
      .set(auth(token))
      .send({ nombre: 'Otro', activo: false })

    expect(vacio.status).toBe(400)
    expect(vacio.body.message).toMatch(/nada que actualizar/i)
    expect(ajeno.status).toBe(400)
    expect(ajeno.body.message).toMatch(/estado/)
  })

  it('403 para rh_consulta; 404 si no existe', async () => {
    const cliente = await Client.create({ nombre: 'Grupo Alvarado' })

    const consulta = await crearEmpleadoConSesion({ nivelAcceso: 'rh_consulta' })
    const sinPermiso = await request(app)
      .patch(`${RUTA}/${cliente._id}`)
      .set(auth(consulta.token))
      .send({ nombre: 'Cambiado' })
    expect(sinPermiso.status).toBe(403)

    const { token } = await sesionAdmin()
    const noExiste = await request(app)
      .patch(`${RUTA}/${new mongoose.Types.ObjectId()}`)
      .set(auth(token))
      .send({ nombre: 'Cambiado' })
    expect(noExiste.status).toBe(404)
  })
})

describe('PATCH /api/v1/clientes/:id/estado — la "eliminación"', () => {
  it('desactiva sin borrar, y lo dice en el mensaje', async () => {
    const { token } = await sesionAdmin()
    const cliente = await Client.create({ nombre: 'Grupo Alvarado' })

    const res = await request(app)
      .patch(`${RUTA}/${cliente._id}/estado`)
      .set(auth(token))
      .send({ activo: false })

    expect(res.status).toBe(200)
    expect(res.body.data.cliente.activo).toBe(false)
    expect(res.body.message).toMatch(/no se borra/i)

    // El documento sigue ahí: puede tener proyectos e historial colgando.
    expect(await Client.findById(cliente._id)).not.toBeNull()
  })

  it('desaparece del listado normal y vuelve al reactivarlo', async () => {
    const { token } = await sesionGlobal()
    const cliente = await Client.create({ nombre: 'Grupo Alvarado' })

    await request(app)
      .patch(`${RUTA}/${cliente._id}/estado`)
      .set(auth(token))
      .send({ activo: false })
    expect((await request(app).get(RUTA).set(auth(token))).body.data.total).toBe(0)

    await request(app)
      .patch(`${RUTA}/${cliente._id}/estado`)
      .set(auth(token))
      .send({ activo: true })
    expect((await request(app).get(RUTA).set(auth(token))).body.data.total).toBe(1)
  })

  it('el jefe de área puede; rh_consulta no', async () => {
    const cliente = await Client.create({ nombre: 'Grupo Alvarado' })

    const jefe = await crearEmpleadoConSesion({
      nivelAcceso: 'jefe_area',
      areas: ['obra']
    })
    const consulta = await crearEmpleadoConSesion({ nivelAcceso: 'rh_consulta' })

    const conJefe = await request(app)
      .patch(`${RUTA}/${cliente._id}/estado`)
      .set(auth(jefe.token))
      .send({ activo: false })
    const conConsulta = await request(app)
      .patch(`${RUTA}/${cliente._id}/estado`)
      .set(auth(consulta.token))
      .send({ activo: true })

    expect(conJefe.status).toBe(200)
    expect(conConsulta.status).toBe(403)
  })

  it('400 sin el campo activo, 404 si no existe', async () => {
    const { token } = await sesionAdmin()
    const cliente = await Client.create({ nombre: 'Grupo Alvarado' })

    const sinCampo = await request(app)
      .patch(`${RUTA}/${cliente._id}/estado`)
      .set(auth(token))
      .send({})
    const noExiste = await request(app)
      .patch(`${RUTA}/${new mongoose.Types.ObjectId()}/estado`)
      .set(auth(token))
      .send({ activo: false })

    expect(sinCampo.status).toBe(400)
    expect(noExiste.status).toBe(404)
  })
})

describe('Alcance del catálogo de clientes', () => {
  it('sólo se ven los clientes de las carteras de sus empresas', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const enCartera = await Client.create({ nombre: 'En mi cartera' })
    await agregarACartera(empresa, enCartera)

    // De otra empresa del grupo, y uno que no está en ninguna cartera.
    const otra = await crearEmpresa()
    const deOtra = await Client.create({ nombre: 'De otra empresa' })
    await agregarACartera(otra, deOtra)
    await Client.create({ nombre: 'Sin cartera' })

    const res = await request(app).get(RUTA).set(auth(token))

    expect(res.body.data.clientes.map((c) => c.nombre)).toEqual(['En mi cartera'])
    expect(res.body.data.total).toBe(1)
  })

  it('un cliente sacado de la cartera deja de verse', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const cliente = await Client.create({ nombre: 'Sacado' })
    await agregarACartera(empresa, cliente, { activo: false })

    const res = await request(app).get(RUTA).set(auth(token))
    expect(res.body.data.clientes).toEqual([])
  })

  it('el administrador de plataforma ve el catálogo completo', async () => {
    const { token } = await crearEmpleadoConSesion({
      alcanceGlobal: true,
      sinAdscripcion: true
    })
    await Client.create({ nombre: 'Sin cartera de nadie' })

    const res = await request(app).get(RUTA).set(auth(token))
    expect(res.body.data.total).toBe(1)
  })

  it('quien administra clientes puede pedir el catálogo completo', async () => {
    // Es lo que evita crear duplicados al meter un cliente a la cartera: hay que
    // poder comprobar si ya existe en el grupo.
    const { token } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    await Client.create({ nombre: 'Ya existe en el grupo' })

    const suCartera = await request(app).get(RUTA).set(auth(token))
    const catalogo = await request(app)
      .get(`${RUTA}?catalogoCompleto=true`)
      .set(auth(token))

    expect(suCartera.body.data.total).toBe(0)
    expect(catalogo.body.data.clientes.map((c) => c.nombre)).toEqual([
      'Ya existe en el grupo'
    ])
  })

  it('el jefe de área también, porque también da de alta clientes', async () => {
    const { token } = await crearEmpleadoConSesion({
      nivelAcceso: 'jefe_area',
      areas: ['obra']
    })
    await Client.create({ nombre: 'Del catálogo' })

    const res = await request(app).get(`${RUTA}?catalogoCompleto=true`).set(auth(token))
    expect(res.status).toBe(200)
    expect(res.body.data.total).toBe(1)
  })

  it('403 si rh_consulta pide el catálogo completo', async () => {
    const { token } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_consulta' })

    const res = await request(app).get(`${RUTA}?catalogoCompleto=true`).set(auth(token))
    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/catálogo completo/i)
  })

  it('el detalle de un cliente fuera de su cartera responde 404 a rh_consulta', async () => {
    const cliente = await Client.create({ nombre: 'Ajeno' })

    const consulta = await crearEmpleadoConSesion({ nivelAcceso: 'rh_consulta' })
    const fuera = await request(app)
      .get(`${RUTA}/${cliente._id}`)
      .set(auth(consulta.token))
    expect(fuera.status).toBe(404)

    // Quien administra clientes sí lo ve: necesita el catálogo para no duplicar.
    const admin = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const conAdmin = await request(app)
      .get(`${RUTA}/${cliente._id}`)
      .set(auth(admin.token))
    expect(conAdmin.status).toBe(200)
  })

  it('rh_consulta sí ve el detalle de un cliente de su cartera', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({
      nivelAcceso: 'rh_consulta'
    })
    const cliente = await Client.create({ nombre: 'En mi cartera' })
    await agregarACartera(empresa, cliente)

    const res = await request(app).get(`${RUTA}/${cliente._id}`).set(auth(token))
    expect(res.status).toBe(200)
  })

  it('400 con catalogoCompleto inválido', async () => {
    const { token } = await sesionAdmin()
    const res = await request(app).get(`${RUTA}?catalogoCompleto=quizas`).set(auth(token))
    expect(res.status).toBe(400)
  })
})
