const request = require('supertest')
const mongoose = require('mongoose')
const app = require('../../src/app')
const Company = require('../../src/api/v1/companies/companyModel')
const {
  crearEmpresa,
  crearEmpleado,
  crearEmpleadoConSesion,
  adscribir,
  auth
} = require('../helpers/factories')

const RUTA = '/api/v1/empresas'
const nueva = { nombre: 'Urbacames Edificación', rfc: 'UED210101AB1' }

describe('POST /api/v1/empresas', () => {
  beforeAll(() => Company.init())

  it('el administrador de plataforma crea la empresa', async () => {
    const { token } = await crearEmpleadoConSesion({
      alcanceGlobal: true,
      sinAdscripcion: true
    })

    const res = await request(app).post(RUTA).set(auth(token)).send(nueva)

    expect(res.status).toBe(201)
    expect(res.body.data.empresa).toMatchObject({
      nombre: 'Urbacames Edificación',
      rfc: 'UED210101AB1',
      activo: true
    })
    expect(res.body.data.conteos).toEqual({
      empleados: 0,
      clientes: null,
      proyectosActivos: null,
      alertasPendientes: null
    })
  })

  it('403 para todos los demás niveles, incluido un rh_admin sin alcance global', async () => {
    for (const datos of [
      { nivelAcceso: 'rh_admin' },
      { nivelAcceso: 'rh_consulta' },
      { nivelAcceso: 'jefe_area', areas: ['obra'] }
    ]) {
      const { token } = await crearEmpleadoConSesion(datos)
      const res = await request(app)
        .post(RUTA)
        .set(auth(token))
        .send({ ...nueva, nombre: `Empresa de ${datos.nivelAcceso}` })

      expect(res.status).toBe(403)
    }
  })

  it('409 si el nombre ya existe, ignorando acentos y mayúsculas', async () => {
    const { token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    await crearEmpresa({ nombre: 'Urbacames Edificación' })

    const res = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send({ nombre: 'urbacames edificacion' })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('EMPRESA_DUPLICADA')
    expect(res.body.errors[0].path).toBe('nombre')
  })

  it('409 si el RFC ya existe, y dice de quién es', async () => {
    const { token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const existente = await crearEmpresa({ nombre: 'Otra Empresa', rfc: 'UED210101AB1' })

    const res = await request(app).post(RUTA).set(auth(token)).send(nueva)

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('RFC_DUPLICADO')
    expect(res.body.data.empresaId).toBe(existente._id.toString())
    expect(res.body.data.nombre).toBe('Otra Empresa')
  })

  it('400 con nombre corto o RFC mal formado', async () => {
    const { token } = await crearEmpleadoConSesion({ alcanceGlobal: true })

    const sinNombre = await request(app).post(RUTA).set(auth(token)).send({ nombre: '' })
    const rfcMalo = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send({ ...nueva, rfc: 'NO-ES-RFC' })

    expect(sinNombre.status).toBe(400)
    expect(rfcMalo.status).toBe(400)
    expect(rfcMalo.body.errors[0].path).toBe('rfc')
  })

  it('el RFC es opcional y varias empresas pueden no tenerlo', async () => {
    const { token } = await crearEmpleadoConSesion({ alcanceGlobal: true })

    const una = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send({ nombre: 'Empresa Uno' })
    const dos = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send({ nombre: 'Empresa Dos' })

    expect(una.status).toBe(201)
    expect(dos.status).toBe(201)
    expect(dos.body.data.empresa.rfc).toBeNull()
  })
})

describe('GET /api/v1/empresas', () => {
  it('cada quien ve sólo las suyas; el admin de plataforma ve todas', async () => {
    const propia = await crearEmpresa({ nombre: 'Propia' })
    await crearEmpresa({ nombre: 'Ajena' })

    const { token } = await crearEmpleadoConSesion({ empresa: propia })
    const global = await crearEmpleadoConSesion({
      alcanceGlobal: true,
      sinAdscripcion: true
    })

    const suyas = await request(app).get(RUTA).set(auth(token))
    const todas = await request(app).get(RUTA).set(auth(global.token))

    expect(suyas.body.data.empresas.map((e) => e.empresa.nombre)).toEqual(['Propia'])
    expect(todas.body.data.empresas.map((e) => e.empresa.nombre).sort()).toEqual([
      'Ajena',
      'Propia'
    ])
  })

  it('trae el conteo de empleados resuelto en el servidor', async () => {
    const empresa = await crearEmpresa()
    const { token } = await crearEmpleadoConSesion({ empresa })

    const uno = await crearEmpleado()
    const dos = await crearEmpleado()
    await adscribir(empresa, uno)
    await adscribir(empresa, dos)
    // Una adscripción dada de baja no cuenta como plantilla actual.
    const tres = await crearEmpleado()
    await adscribir(empresa, tres, { activo: false, motivoBaja: 'Renuncia' })

    const res = await request(app).get(RUTA).set(auth(token))
    const fila = res.body.data.empresas[0]

    // Los dos nuevos más el propio usuario de la sesión.
    expect(fila.conteos.empleados).toBe(3)
    // Lo que todavía no existe va en null, no en 0: no es lo mismo.
    expect(fila.conteos.proyectosActivos).toBeNull()
    expect(fila.conteos.clientes).toBeNull()
  })

  it('oculta las inactivas salvo que se pidan', async () => {
    const activa = await crearEmpresa({ nombre: 'Activa' })
    const inactiva = await crearEmpresa({ nombre: 'Cerrada', activo: false })
    const { empleado, token } = await crearEmpleadoConSesion({ empresa: activa })
    await adscribir(inactiva, empleado)

    const soloActivas = await request(app).get(RUTA).set(auth(token))
    const conInactivas = await request(app)
      .get(`${RUTA}?incluirInactivas=true`)
      .set(auth(token))

    expect(soloActivas.body.data.empresas.map((e) => e.empresa.nombre)).toEqual([
      'Activa'
    ])
    expect(conInactivas.body.data.empresas).toHaveLength(2)
  })

  it('el detalle de una empresa ajena responde 404, no 403', async () => {
    const propia = await crearEmpresa()
    const ajena = await crearEmpresa()
    const { token } = await crearEmpleadoConSesion({ empresa: propia })

    const suya = await request(app).get(`${RUTA}/${propia._id}`).set(auth(token))
    const otra = await request(app).get(`${RUTA}/${ajena._id}`).set(auth(token))
    const inexistente = await request(app)
      .get(`${RUTA}/${new mongoose.Types.ObjectId()}`)
      .set(auth(token))

    expect(suya.status).toBe(200)
    expect(otra.status).toBe(404)
    expect(inexistente.status).toBe(404)
  })

  it('401 sin sesión', async () => {
    expect((await request(app).get(RUTA)).status).toBe(401)
  })
})
