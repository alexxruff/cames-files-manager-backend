const request = require('supertest')
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

const login = (datos) => request(app).post('/api/v1/auth/login').send(datos)

describe('POST /api/v1/auth/login', () => {
  it('devuelve el AuthUser nuevo, con empresas y sin role ni clienteId', async () => {
    const empresa = await crearEmpresa({ nombre: 'Urbacames Edificación' })
    const { user } = await crearEmpleadoConSesion({
      nombre: 'Marisol Herrera',
      email: 'marisol@urbacames.com',
      nivelAcceso: 'rh_admin',
      empresa,
      areas: ['recursos_humanos']
    })

    expect(user).toMatchObject({
      name: 'Marisol Herrera',
      email: 'marisol@urbacames.com',
      nivelAcceso: 'rh_admin',
      alcanceGlobal: false,
      active: true
    })
    expect(user.empresas).toEqual([
      {
        _id: empresa._id.toString(),
        nombre: 'Urbacames Edificación',
        areas: ['recursos_humanos']
      }
    ])
    // Campos del modelo anterior que ya no existen.
    expect(user.role).toBeUndefined()
    expect(user.alcance).toBeUndefined()
    expect(user.clienteId).toBeUndefined()
    expect(user.area).toBeUndefined()
    // Y nada de material secreto.
    expect(JSON.stringify(user)).not.toMatch(/\$2[aby]\$/)
    expect(user.password).toBeUndefined()
    expect(user.acceso).toBeUndefined()
  })

  it('lista todas las empresas donde tiene adscripción activa', async () => {
    const edificacion = await crearEmpresa({ nombre: 'Urbacames Edificación' })
    const infraestructura = await crearEmpresa({ nombre: 'Urbacames Infraestructura' })
    const cerrada = await crearEmpresa({ nombre: 'Urbacames Histórica' })

    const { empleado } = await crearEmpleadoConSesion({
      empresa: edificacion,
      areas: ['operaciones_urbanizadora']
    })
    await adscribir(infraestructura, empleado, { areas: ['costos_y_presupuestos'] })
    await adscribir(cerrada, empleado, {
      areas: ['operaciones_urbanizadora'],
      activo: false,
      motivoBaja: 'Fin de contrato'
    })

    const respuesta = await login({
      email: empleado.acceso.email,
      password: PASSWORD_VALIDA
    })
    const empresas = respuesta.body.data.user.empresas

    expect(empresas.map((e) => e.nombre).sort()).toEqual([
      'Urbacames Edificación',
      'Urbacames Infraestructura'
    ])
    // La adscripción dada de baja no aparece.
    expect(empresas.map((e) => e.nombre)).not.toContain('Urbacames Histórica')
  })

  it('un administrador de plataforma entra aunque no tenga ninguna empresa', async () => {
    const { user } = await crearEmpleadoConSesion({
      nivelAcceso: 'rh_admin',
      alcanceGlobal: true,
      sinAdscripcion: true
    })

    expect(user.alcanceGlobal).toBe(true)
    expect(user.empresas).toEqual([])
  })

  it('registra el último acceso en la credencial, no en el empleado', async () => {
    const { empleado } = await crearEmpleadoConSesion()

    const credencial = await Credential.findOne({ empleadoId: empleado._id })
    expect(credencial.ultimoAccesoEn).toBeInstanceOf(Date)

    // El documento de la persona no se toca al entrar.
    const recargado = await Employee.findById(empleado._id)
    expect(recargado.updatedAt.getTime()).toBe(empleado.updatedAt.getTime())
  })

  it('da el mismo error con contraseña mala, correo inexistente o sin credencial', async () => {
    const conAcceso = await crearEmpleado({ acceso: { email: 'existe@urbacames.com' } })
    // Estado inconsistente: acceso sin credencial.
    await Credential.deleteMany({ empleadoId: conAcceso._id })

    const malaPassword = await login({
      email: 'existe@urbacames.com',
      password: 'OtraCosa1!'
    })
    const noExiste = await login({
      email: 'nadie@urbacames.com',
      password: PASSWORD_VALIDA
    })
    const sinCredencial = await login({
      email: 'existe@urbacames.com',
      password: PASSWORD_VALIDA
    })

    for (const res of [malaPassword, noExiste, sinCredencial]) {
      expect(res.status).toBe(401)
      expect(res.body.message).toBe('Correo o contraseña incorrectos')
    }
  })

  it('cuenta los intentos fallidos y los limpia al entrar bien', async () => {
    const empleado = await crearEmpleado({ acceso: { email: 'contador@urbacames.com' } })

    await login({ email: 'contador@urbacames.com', password: 'Incorrecta1!' })
    await login({ email: 'contador@urbacames.com', password: 'Incorrecta2!' })
    let credencial = await Credential.findOne({ empleadoId: empleado._id })
    expect(credencial.intentosFallidos).toBe(2)

    await login({ email: 'contador@urbacames.com', password: PASSWORD_VALIDA })
    credencial = await Credential.findOne({ empleadoId: empleado._id })
    expect(credencial.intentosFallidos).toBe(0)
  })

  it('respeta un bloqueo temporal puesto por un administrador', async () => {
    const empleado = await crearEmpleado({ acceso: { email: 'bloqueado@urbacames.com' } })
    await Credential.updateOne(
      { empleadoId: empleado._id },
      { $set: { bloqueadaHasta: new Date(Date.now() + 60_000) } }
    )

    const res = await login({
      email: 'bloqueado@urbacames.com',
      password: PASSWORD_VALIDA
    })
    expect(res.status).toBe(401)
    expect(res.body.message).toMatch(/bloqueado/i)
  })

  it('rechaza a la persona dada de baja y a quien le quitaron el acceso', async () => {
    const deBaja = await crearEmpleado({
      activo: false,
      motivoBaja: 'Renuncia',
      acceso: { email: 'baja@urbacames.com' }
    })
    const sinAcceso = await crearEmpleado({
      acceso: { email: 'sinacceso@urbacames.com', activo: false }
    })

    const uno = await login({ email: deBaja.acceso.email, password: PASSWORD_VALIDA })
    const dos = await login({ email: sinAcceso.acceso.email, password: PASSWORD_VALIDA })

    expect(uno.status).toBe(401)
    expect(uno.body.message).toMatch(/desactivada/i)
    expect(dos.status).toBe(401)
    expect(dos.body.message).toMatch(/acceso a la plataforma/i)
  })

  it('un empleado sin acceso no puede entrar de ninguna forma', async () => {
    const persona = await crearEmpleado({ nombre: 'Sin Acceso' })
    expect(persona.acceso).toBeNull()

    const res = await login({ email: 'sin@urbacames.com', password: PASSWORD_VALIDA })
    expect(res.status).toBe(401)
  })
})

describe('GET /api/v1/auth/me', () => {
  it('revalida la sesión con la forma nueva', async () => {
    const { empleado, token } = await crearEmpleadoConSesion({ nombre: 'Ana Ruiz' })
    const res = await request(app).get('/api/v1/auth/me').set(auth(token))

    expect(res.status).toBe(200)
    expect(res.body.data.user._id).toBe(empleado._id.toString())
    expect(res.body.data.user.name).toBe('Ana Ruiz')
    expect(res.body.data.user.ultimoAccesoEn).toEqual(expect.any(String))
  })

  it('401 si le quitan el acceso o dan de baja a la persona después de emitir el token', async () => {
    const sinAcceso = await crearEmpleadoConSesion()
    await Employee.updateOne(
      { _id: sinAcceso.empleado._id },
      { $set: { 'acceso.activo': false } }
    )
    const uno = await request(app).get('/api/v1/auth/me').set(auth(sinAcceso.token))
    expect(uno.status).toBe(401)

    const deBaja = await crearEmpleadoConSesion()
    await Employee.updateOne(
      { _id: deBaja.empleado._id },
      { $set: { activo: false, motivoBaja: 'Renuncia' } }
    )
    const dos = await request(app).get('/api/v1/auth/me').set(auth(deBaja.token))
    expect(dos.status).toBe(401)
  })
})

describe('POST /api/v1/auth/cambiar-password', () => {
  it('cambia la contraseña, devuelve token nuevo y cierra las otras sesiones', async () => {
    const { empleado, token } = await crearEmpleadoConSesion()

    // Una segunda sesión abierta, que debe morir con el cambio.
    const otraSesion = await login({
      email: empleado.acceso.email,
      password: PASSWORD_VALIDA
    })
    const tokenViejo = otraSesion.body.data.token

    const res = await request(app)
      .post('/api/v1/auth/cambiar-password')
      .set(auth(token))
      .send({ passwordActual: PASSWORD_VALIDA, passwordNueva: 'NuevaClave9#' })

    expect(res.status).toBe(200)
    expect(res.body.data.token).toEqual(expect.any(String))
    expect(res.body.data.token).not.toBe(token)

    // El token nuevo sirve; el viejo ya no.
    const conNuevo = await request(app)
      .get('/api/v1/auth/me')
      .set(auth(res.body.data.token))
    const conViejo = await request(app).get('/api/v1/auth/me').set(auth(tokenViejo))

    expect(conNuevo.status).toBe(200)
    expect(conViejo.status).toBe(401)
    expect(conViejo.body.message).toMatch(/contraseña cambió/i)

    // Y se entra con la nueva, no con la anterior.
    expect(
      (await login({ email: empleado.acceso.email, password: 'NuevaClave9#' })).status
    ).toBe(200)
    expect(
      (await login({ email: empleado.acceso.email, password: PASSWORD_VALIDA })).status
    ).toBe(401)
  })

  it('guarda el hash nuevo en la credencial y la marca en el empleado', async () => {
    const { empleado, token } = await crearEmpleadoConSesion()
    const antes = await Credential.findOne({ empleadoId: empleado._id }).select(
      '+passwordHash'
    )

    await request(app)
      .post('/api/v1/auth/cambiar-password')
      .set(auth(token))
      .send({ passwordActual: PASSWORD_VALIDA, passwordNueva: 'NuevaClave9#' })

    const despues = await Credential.findOne({ empleadoId: empleado._id }).select(
      '+passwordHash'
    )
    const recargado = await Employee.findById(empleado._id)

    expect(despues.passwordHash).not.toBe(antes.passwordHash)
    expect(recargado.acceso.passwordActualizadaEn).toBeInstanceOf(Date)
  })

  it('400 si la actual no coincide, es igual a la nueva o la nueva es débil', async () => {
    const { token } = await crearEmpleadoConSesion()
    const cambiar = (cuerpo) =>
      request(app).post('/api/v1/auth/cambiar-password').set(auth(token)).send(cuerpo)

    const malaActual = await cambiar({
      passwordActual: 'NoEsMiClave1!',
      passwordNueva: 'NuevaClave9#'
    })
    const igual = await cambiar({
      passwordActual: PASSWORD_VALIDA,
      passwordNueva: PASSWORD_VALIDA
    })
    const debil = await cambiar({
      passwordActual: PASSWORD_VALIDA,
      passwordNueva: 'sencilla'
    })

    expect(malaActual.status).toBe(400)
    expect(malaActual.body.errors[0].path).toBe('passwordActual')
    expect(igual.status).toBe(400)
    expect(debil.status).toBe(400)
  })
})

describe('/usuarios ya no existe', () => {
  it('responde 410 y dice a dónde se movió', async () => {
    for (const peticion of [
      request(app).get('/api/v1/usuarios'),
      request(app).post('/api/v1/usuarios').send({}),
      request(app).patch('/api/v1/usuarios/123').send({})
    ]) {
      const res = await peticion
      expect(res.status).toBe(410)
      expect(res.body.message).toMatch(/empleado con acceso/i)
      expect(res.body.message).toMatch(/empleados\/:id\/acceso/)
      expect(res.body.code).toBe('RUTA_MOVIDA')
    }
  })
})
