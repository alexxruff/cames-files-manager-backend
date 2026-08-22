const request = require('supertest')
const app = require('../../src/app')
const Employee = require('../../src/api/v1/employees/employeeModel')
const Credential = require('../../src/api/v1/credentials/credentialModel')
const Category = require('../../src/api/v1/categories/categoryModel')
const { ensureBootstrapAdmin } = require('../../src/services/bootstrapAdmin')
const { crearEmpleado, auth } = require('../helpers/factories')

const CREDENCIALES = { email: 'alexxruff@yahoo.com', password: '1234' }
const login = (datos) => request(app).post('/api/v1/auth/login').send(datos)

describe('Administrador de plataforma inicial (bootstrap)', () => {
  it('crea al administrador de plataforma cuando nadie puede entrar', async () => {
    const resultado = await ensureBootstrapAdmin()
    expect(resultado).toMatchObject({ creado: true, email: CREDENCIALES.email })

    const admin = await Employee.findOne({ 'acceso.email': CREDENCIALES.email })
    expect(admin.acceso).toMatchObject({
      nivelAcceso: 'rh_admin',
      alcanceGlobal: true,
      activo: true
    })
    expect(admin.tipo).toBe('administrativo')
    // Y su credencial, en su propia colección.
    expect(await Credential.countDocuments({ empleadoId: admin._id })).toBe(1)
  })

  it('siembra la categoría mínima que el empleado necesita', async () => {
    await ensureBootstrapAdmin()
    const categoria = await Category.findOne({ nombre: 'Administración' })
    expect(categoria.esBase).toBe(true)
  })

  it('deja entrar con la contraseña de arranque y devuelve alcanceGlobal', async () => {
    await ensureBootstrapAdmin()
    const res = await login(CREDENCIALES)

    expect(res.status).toBe(200)
    expect(res.body.data.user).toMatchObject({
      email: CREDENCIALES.email,
      nivelAcceso: 'rh_admin',
      alcanceGlobal: true,
      active: true,
      empresas: []
    })
  })

  it('el administrador inicial puede ver todos los empleados y dar accesos', async () => {
    await ensureBootstrapAdmin()
    const { body } = await login(CREDENCIALES)
    const token = body.data.token

    const persona = await crearEmpleado({ nombre: 'Alguien Sin Empresa' })

    const listado = await request(app).get('/api/v1/empleados').set(auth(token))
    expect(listado.status).toBe(200)
    expect(listado.body.data.empleados.map((e) => e.empleado.nombre)).toContain(
      'Alguien Sin Empresa'
    )

    const acceso = await request(app)
      .post(`/api/v1/empleados/${persona._id}/acceso`)
      .set(auth(token))
      .send({
        email: 'nuevo@urbacames.com',
        password: 'Urbacames1!',
        nivelAcceso: 'rh_consulta'
      })
    expect(acceso.status).toBe(201)
  })

  it('la contraseña se guarda hasheada, nunca en claro', async () => {
    await ensureBootstrapAdmin()
    const admin = await Employee.findOne({ 'acceso.email': CREDENCIALES.email })
    const credencial = await Credential.findOne({ empleadoId: admin._id }).select(
      '+passwordHash'
    )

    expect(credencial.passwordHash).not.toBe('1234')
    expect(credencial.passwordHash).toMatch(/^\$2[aby]\$/)
  })

  it('es idempotente y no corre si ya hay alguien con acceso', async () => {
    await ensureBootstrapAdmin()
    const segunda = await ensureBootstrapAdmin()

    expect(segunda).toEqual({ creado: false, motivo: 'ya-hay-accesos' })
    expect(await Employee.countDocuments({ acceso: { $ne: null } })).toBe(1)
  })

  it('no corre si ya existe otro acceso, aunque no sea el suyo', async () => {
    await crearEmpleado({ acceso: { email: 'alguien@urbacames.com' } })

    const resultado = await ensureBootstrapAdmin()
    expect(resultado.creado).toBe(false)
    expect(await Employee.findOne({ 'acceso.email': CREDENCIALES.email })).toBeNull()
  })

  it('sí corre si hay empleados importados pero ninguno puede entrar', async () => {
    await crearEmpleado({ nombre: 'Importado Uno' })
    await crearEmpleado({ nombre: 'Importado Dos' })

    const resultado = await ensureBootstrapAdmin()
    expect(resultado.creado).toBe(true)
  })

  it('se puede desactivar sin tocar código', async () => {
    const resultado = await ensureBootstrapAdmin({ enabled: false })
    expect(resultado).toEqual({ creado: false, motivo: 'deshabilitado' })
    expect(await Employee.countDocuments({})).toBe(0)
  })

  it('el cambio de contraseña es permanente: reiniciar no revive la de arranque', async () => {
    await ensureBootstrapAdmin()
    const { body } = await login(CREDENCIALES)

    await request(app)
      .post('/api/v1/auth/cambiar-password')
      .set(auth(body.data.token))
      .send({ passwordActual: '1234', passwordNueva: 'Urbacames2026#' })

    const trasReinicio = await ensureBootstrapAdmin()
    expect(trasReinicio.creado).toBe(false)
    expect((await login(CREDENCIALES)).status).toBe(401)
    expect((await login({ ...CREDENCIALES, password: 'Urbacames2026#' })).status).toBe(
      200
    )
  })
})
