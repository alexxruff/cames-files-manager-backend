const request = require('supertest')
const mongoose = require('mongoose')
const app = require('../../src/app')
const Company = require('../../src/api/v1/companies/companyModel')
const {
  crearEmpresa,
  crearEmpleado,
  crearEmpleadoConSesion,
  adscribir,
  crearCliente,
  agregarACartera,
  crearProyecto,
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
      clientes: 0,
      proyectosActivos: 0,
      // Sigue en null: el módulo de alertas no existe, y 0 diría "ninguna".
      alertasPendientes: null
    })
  })

  it('403 para todos los demás niveles, incluido un rh_admin sin alcance global', async () => {
    for (const datos of [
      { nivelAcceso: 'rh_admin' },
      { nivelAcceso: 'rh_consulta' },
      { nivelAcceso: 'jefe_area', areas: ['operaciones_urbanizadora'] }
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

  it('trae los conteos resueltos en el servidor', async () => {
    const empresa = await crearEmpresa()
    const { token } = await crearEmpleadoConSesion({ empresa })

    const uno = await crearEmpleado()
    const dos = await crearEmpleado()
    await adscribir(empresa, uno)
    await adscribir(empresa, dos)
    // Una adscripción dada de baja no cuenta como plantilla actual.
    const tres = await crearEmpleado()
    await adscribir(empresa, tres, { activo: false, motivoBaja: 'Renuncia' })

    // Dos clientes en cartera —uno sacado, que no cuenta— y dos proyectos, uno
    // ya finalizado: la tarjeta anuncia los que están en curso.
    const cliente = await crearCliente()
    await agregarACartera(empresa, cliente)
    await agregarACartera(empresa, await crearCliente(), { activo: false })
    // `sinCartera` porque el vínculo ya existe y es único por par empresa+cliente.
    await crearProyecto(empresa, { cliente, nombre: 'En curso', sinCartera: true })
    await crearProyecto(empresa, {
      cliente,
      nombre: 'Terminado',
      sinCartera: true,
      estado: 'finalizado',
      fechaFinReal: '2026-12-01'
    })

    const res = await request(app).get(RUTA).set(auth(token))
    const fila = res.body.data.empresas[0]

    // Los dos nuevos más el propio usuario de la sesión.
    expect(fila.conteos.empleados).toBe(3)
    // Sólo la cartera activa.
    expect(fila.conteos.clientes).toBe(1)
    // Sólo los proyectos en curso.
    expect(fila.conteos.proyectosActivos).toBe(1)
    // Lo único que sigue pendiente.
    expect(fila.conteos.alertasPendientes).toBeNull()
  })

  it('los conteos son de cada empresa, no del grupo', async () => {
    const propia = await crearEmpresa({ nombre: 'Propia' })
    const otra = await crearEmpresa({ nombre: 'Otra' })
    const { token, empleado } = await crearEmpleadoConSesion({
      alcanceGlobal: true,
      empresa: propia
    })
    await adscribir(otra, empleado)

    // Propia: sólo un cliente en cartera. Otra: sólo un proyecto. Así cada
    // contador se comprueba por separado.
    await agregarACartera(propia, await crearCliente())
    await crearProyecto(otra, { nombre: 'De la otra', sinCartera: true })

    const res = await request(app).get(RUTA).set(auth(token))
    const porNombre = Object.fromEntries(
      res.body.data.empresas.map((e) => [e.empresa.nombre, e.conteos])
    )

    expect(porNombre.Propia.clientes).toBe(1)
    expect(porNombre.Propia.proyectosActivos).toBe(0)
    expect(porNombre.Otra.clientes).toBe(0)
    expect(porNombre.Otra.proyectosActivos).toBe(1)
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

/**
 * Editar y dar de baja una empresa (D-64). Faltaban: sólo se podía crear y
 * consultar, así que un RFC mal capturado no había forma de arreglarlo.
 */
describe('PATCH /api/v1/empresas/:id', () => {
  const admin = () =>
    crearEmpleadoConSesion({ nivelAcceso: 'rh_admin', alcanceGlobal: true })

  it('corrige nombre y RFC', async () => {
    const { token } = await admin()
    const empresa = await crearEmpresa({ nombre: 'Con Nombre Malo' })

    const res = await request(app)
      .patch(`${RUTA}/${empresa._id}`)
      .set(auth(token))
      .send({ nombre: 'Maquinaria Cames', rfc: 'MCA180611HF1' })

    expect(res.status).toBe(200)
    expect(res.body.data.empresa).toMatchObject({
      nombre: 'Maquinaria Cames',
      rfc: 'MCA180611HF1'
    })
  })

  it('ya NO acepta registrosPatronales: dice a dónde fueron (D-65)', async () => {
    const { token } = await admin()
    const empresa = await crearEmpresa()

    const res = await request(app)
      .patch(`${RUTA}/${empresa._id}`)
      .set(auth(token))
      .send({ registrosPatronales: [{ numero: 'R13-77767-10-5' }] })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('/registros-patronales')
  })

  it('409 si el nombre o el RFC ya son de otra empresa', async () => {
    const { token } = await admin()
    await crearEmpresa({ nombre: 'Ya Existe', rfc: 'MCA180611HF1' })
    const empresa = await crearEmpresa({ nombre: 'La Que Se Edita' })

    const porNombre = await request(app)
      .patch(`${RUTA}/${empresa._id}`)
      .set(auth(token))
      .send({ nombre: 'Ya Existe' })
    expect(porNombre.status).toBe(409)

    const porRfc = await request(app)
      .patch(`${RUTA}/${empresa._id}`)
      .set(auth(token))
      .send({ rfc: 'MCA180611HF1' })
    expect(porRfc.status).toBe(409)
  })

  it('400 con campos que no se editan aquí, diciendo a dónde van', async () => {
    const { token } = await admin()
    const empresa = await crearEmpresa()

    const res = await request(app)
      .patch(`${RUTA}/${empresa._id}`)
      .set(auth(token))
      .send({ activo: false })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('/estado')
  })

  it('403 sin alcance global; 404 si no existe', async () => {
    const empresa = await crearEmpresa()
    const { token } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })

    const sinPermiso = await request(app)
      .patch(`${RUTA}/${empresa._id}`)
      .set(auth(token))
      .send({ nombre: 'Otro Nombre' })
    expect(sinPermiso.status).toBe(403)

    const { token: global } = await admin()
    const noExiste = await request(app)
      .patch(`${RUTA}/${new mongoose.Types.ObjectId()}`)
      .set(auth(global))
      .send({ nombre: 'Otro Nombre' })
    expect(noExiste.status).toBe(404)
  })
})

describe('PATCH /api/v1/empresas/:id/estado', () => {
  const admin = () =>
    crearEmpleadoConSesion({ nivelAcceso: 'rh_admin', alcanceGlobal: true })

  it('da de baja una empresa vacía y la reactiva', async () => {
    const { token } = await admin()
    const empresa = await crearEmpresa()

    const baja = await request(app)
      .patch(`${RUTA}/${empresa._id}/estado`)
      .set(auth(token))
      .send({ activo: false })

    expect(baja.status).toBe(200)
    expect(baja.body.data.empresa.activo).toBe(false)

    const alta = await request(app)
      .patch(`${RUTA}/${empresa._id}/estado`)
      .set(auth(token))
      .send({ activo: true })
    expect(alta.body.data.empresa.activo).toBe(true)
  })

  it('400 si todavía tiene gente adscrita, diciendo cuánta', async () => {
    const { token } = await admin()
    const empresa = await crearEmpresa()
    const persona = await crearEmpleado({ nombre: 'Sigue Adscrita' })
    await adscribir(empresa, persona)

    const res = await request(app)
      .patch(`${RUTA}/${empresa._id}/estado`)
      .set(auth(token))
      .send({ activo: false })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('1 persona adscrita')
  })
})

/**
 * Registros patronales como entidad con identidad propia (D-65).
 *
 * Nacieron como cadenas sueltas (D-64). En cuanto el proyecto tiene que apuntar
 * a uno, eso deja de servir: hace falta un `_id` que sobreviva a que se corrija
 * el número.
 */
describe('registros patronales de una empresa', () => {
  const admin = () =>
    crearEmpleadoConSesion({ nivelAcceso: 'rh_admin', alcanceGlobal: true })
  const RP = (id) => `${RUTA}/${id}/registros-patronales`

  it('se agregan con _id propio, en mayúsculas', async () => {
    const { token } = await admin()
    const empresa = await crearEmpresa()

    const res = await request(app)
      .post(RP(empresa._id))
      .set(auth(token))
      .send({ numero: 'r13-77767-10-5', descripcion: 'Zapopan' })

    expect(res.status).toBe(201)
    expect(res.body.data.registro).toMatchObject({
      numero: 'R13-77767-10-5',
      descripcion: 'Zapopan',
      activo: true
    })
    expect(res.body.data.registro._id).toMatch(/^[0-9a-f]{24}$/)
    expect(res.body.data.empresa.registrosPatronales).toHaveLength(1)
  })

  it('varios por empresa, sin tope', async () => {
    const { token } = await admin()
    const empresa = await crearEmpresa()

    for (const numero of ['R13-77767-10-5', 'H67-29973-10-5', 'Z61-14090-10-9']) {
      const res = await request(app)
        .post(RP(empresa._id))
        .set(auth(token))
        .send({ numero })
      expect(res.status).toBe(201)
    }

    const empresaFinal = await Company.findById(empresa._id)
    expect(empresaFinal.registrosPatronales).toHaveLength(3)
  })

  it('es idempotente por número: el mismo dos veces no lo duplica', async () => {
    const { token } = await admin()
    const empresa = await crearEmpresa()
    const primera = await request(app)
      .post(RP(empresa._id))
      .set(auth(token))
      .send({ numero: 'R13-77767-10-5' })

    const segunda = await request(app)
      .post(RP(empresa._id))
      .set(auth(token))
      .send({ numero: 'r13-77767-10-5' })

    expect(segunda.status).toBe(200)
    expect(segunda.body.data.registro._id).toBe(primera.body.data.registro._id)
    expect(segunda.body.data.empresa.registrosPatronales).toHaveLength(1)
  })

  it('el mismo número SÍ puede estar en otra empresa', async () => {
    const { token } = await admin()
    const una = await crearEmpresa({ nombre: 'Una SA' })
    const otra = await crearEmpresa({ nombre: 'Otra SA' })

    await request(app)
      .post(RP(una._id))
      .set(auth(token))
      .send({ numero: 'R13-77767-10-5' })
    const res = await request(app)
      .post(RP(otra._id))
      .set(auth(token))
      .send({ numero: 'R13-77767-10-5' })

    expect(res.status).toBe(201)
  })

  it('se corrige el número sin perder el _id: es para lo que sirve', async () => {
    const { token } = await admin()
    const empresa = await crearEmpresa()
    const alta = await request(app)
      .post(RP(empresa._id))
      .set(auth(token))
      .send({ numero: 'R13-77767-10-4' })
    const registroId = alta.body.data.registro._id

    const res = await request(app)
      .patch(`${RP(empresa._id)}/${registroId}`)
      .set(auth(token))
      .send({ numero: 'R13-77767-10-5', descripcion: 'Corregido' })

    expect(res.status).toBe(200)
    expect(res.body.data.registro).toMatchObject({
      _id: registroId,
      numero: 'R13-77767-10-5',
      descripcion: 'Corregido'
    })
  })

  it('se da de baja sin borrar, y se reactiva', async () => {
    const { token } = await admin()
    const empresa = await crearEmpresa()
    const alta = await request(app)
      .post(RP(empresa._id))
      .set(auth(token))
      .send({ numero: 'R13-77767-10-5' })
    const registroId = alta.body.data.registro._id

    const baja = await request(app)
      .patch(`${RP(empresa._id)}/${registroId}/estado`)
      .set(auth(token))
      .send({ activo: false })

    expect(baja.body.data.registro.activo).toBe(false)
    // Sigue ahí: no se borró.
    expect(baja.body.data.empresa.registrosPatronales).toHaveLength(1)

    const alta2 = await request(app)
      .patch(`${RP(empresa._id)}/${registroId}/estado`)
      .set(auth(token))
      .send({ activo: true })
    expect(alta2.body.data.registro.activo).toBe(true)
  })

  it('403 sin alcance global; 404 con un registro que no existe', async () => {
    const empresa = await crearEmpresa()
    const { token } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const sinPermiso = await request(app)
      .post(RP(empresa._id))
      .set(auth(token))
      .send({ numero: 'R13-77767-10-5' })
    expect(sinPermiso.status).toBe(403)

    const { token: global } = await admin()
    const noExiste = await request(app)
      .patch(`${RP(empresa._id)}/${new mongoose.Types.ObjectId()}`)
      .set(auth(global))
      .send({ numero: 'R13-77767-10-5' })
    expect(noExiste.status).toBe(404)
  })

  /*
   * Lo reportó el front: un registro sin número llegaba a la interfaz. No venía
   * del archivo ni de una prueba — era una base a medio migrar de D-64, donde
   * esto era `[String]`. Mongoose convierte la cadena en subdocumento, no sabe
   * dónde ponerla, y sale uno sin `numero` (D-68).
   */
  it('nunca devuelve un registro sin número, ni con datos a medio migrar', async () => {
    const { token } = await admin()
    const empresa = await crearEmpresa()

    // Se escribe con el driver crudo el formato VIEJO, saltándose el esquema.
    await mongoose.connection.db
      .collection('companies')
      .updateOne(
        { _id: empresa._id },
        { $set: { registrosPatronales: ['R13-77767-10-5'] } }
      )

    const res = await request(app).get(`${RUTA}/${empresa._id}`).set(auth(token))

    expect(res.status).toBe(200)
    // El roto no se emite: el contrato promete `numero: string`.
    expect(res.body.data.empresa.registrosPatronales).toEqual([])
    // Y el dato sigue en la base, listo para que la migración lo recupere.
    const crudo = await mongoose.connection.db
      .collection('companies')
      .findOne({ _id: empresa._id })
    expect(crudo.registrosPatronales).toEqual(['R13-77767-10-5'])
  })

  it('400 con un número demasiado corto', async () => {
    const { token } = await admin()
    const empresa = await crearEmpresa()

    const res = await request(app)
      .post(RP(empresa._id))
      .set(auth(token))
      .send({ numero: 'ab' })

    expect(res.status).toBe(400)
    expect(res.body.errors[0].path).toBe('numero')
  })
})
