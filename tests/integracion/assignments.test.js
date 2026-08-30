const request = require('supertest')
const mongoose = require('mongoose')
const app = require('../../src/app')
const Assignment = require('../../src/api/v1/assignments/assignmentModel')
const Affiliation = require('../../src/api/v1/affiliations/affiliationModel')
const {
  crearEmpresa,
  crearCategoria,
  crearEmpleado,
  crearEmpleadoConSesion,
  adscribir,
  crearProyecto,
  crearRegistroPatronal,
  asignar,
  auth
} = require('../helpers/factories')

const RUTA = '/api/v1/proyectos'

/**
 * Asignaciones: proyecto ↔ empleado. Las tres reglas que el servidor impone son
 * adscripción activa a la empresa del proyecto, categoría habilitada en él, y
 * nada de proyectos finalizados ni personas dadas de baja.
 */
async function escenario(datos = {}) {
  const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin', ...datos })
  const categoria = await crearCategoria('Albañil', 'mano_de_obra')
  const { proyecto } = await crearProyecto(sesion.empresa, {
    categorias: [categoria._id],
    fechaInicio: '2026-09-01'
  })

  /** Alguien adscrito a la empresa con la categoría habilitada: asignable. */
  const crearAsignable = async (extra = {}) => {
    const persona = await crearEmpleado({
      tipo: 'mano_de_obra',
      categoriaId: categoria._id,
      ...extra
    })
    await adscribir(sesion.empresa, persona, {
      areas: extra.areas || ['operaciones_urbanizadora']
    })
    return persona
  }

  return { ...sesion, categoria, proyecto, crearAsignable }
}

describe('POST /api/v1/proyectos/:id/asignaciones', () => {
  beforeAll(() => Assignment.init())

  it('asigna a alguien adscrito y con la categoría habilitada', async () => {
    const { token, proyecto, categoria, crearAsignable } = await escenario()
    const persona = await crearAsignable()

    const res = await request(app)
      .post(`${RUTA}/${proyecto._id}/asignaciones`)
      .set(auth(token))
      .send({
        empleadoId: persona._id.toString(),
        categoriaId: categoria._id.toString(),
        fechaAsignacion: '2026-09-15'
      })

    expect(res.status).toBe(201)
    expect(res.body.data.asignacion).toMatchObject({
      proyectoId: proyecto._id.toString(),
      empleadoId: persona._id.toString(),
      empleadoNombre: persona.nombre,
      categoriaNombre: 'Albañil',
      fechaAsignacion: '2026-09-15',
      fechaSalida: null,
      activo: true
    })
  })

  it('EXIGE adscripción activa a la empresa del proyecto', async () => {
    const { token, proyecto, categoria } = await escenario()
    // Existe y su categoría está habilitada, pero trabaja en otra empresa.
    const deOtraEmpresa = await crearEmpleado({
      tipo: 'mano_de_obra',
      categoriaId: categoria._id
    })
    await adscribir(await crearEmpresa(), deOtraEmpresa, {
      areas: ['operaciones_urbanizadora']
    })

    const res = await request(app)
      .post(`${RUTA}/${proyecto._id}/asignaciones`)
      .set(auth(token))
      .send({
        empleadoId: deOtraEmpresa._id.toString(),
        categoriaId: categoria._id.toString(),
        fechaAsignacion: '2026-09-15'
      })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/no está adscrito a la empresa/i)
    expect(res.body.errors[0].path).toBe('empleadoId')
  })

  it('tampoco vale una adscripción dada de baja', async () => {
    const { token, empresa, proyecto, categoria } = await escenario()
    const exempleado = await crearEmpleado({
      tipo: 'mano_de_obra',
      categoriaId: categoria._id
    })
    await adscribir(empresa, exempleado, {
      areas: ['operaciones_urbanizadora'],
      activo: false,
      motivoBaja: 'Renuncia voluntaria'
    })

    const res = await request(app)
      .post(`${RUTA}/${proyecto._id}/asignaciones`)
      .set(auth(token))
      .send({
        empleadoId: exempleado._id.toString(),
        categoriaId: categoria._id.toString(),
        fechaAsignacion: '2026-09-15'
      })

    expect(res.status).toBe(400)
  })

  it('EXIGE que la categoría esté habilitada en el proyecto', async () => {
    const { token, proyecto, crearAsignable } = await escenario()
    const persona = await crearAsignable()
    const noHabilitada = await crearCategoria('Soldador', 'mano_de_obra')

    const res = await request(app)
      .post(`${RUTA}/${proyecto._id}/asignaciones`)
      .set(auth(token))
      .send({
        empleadoId: persona._id.toString(),
        categoriaId: noHabilitada._id.toString(),
        fechaAsignacion: '2026-09-15'
      })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/no está habilitada en el proyecto/i)
    expect(res.body.errors[0].path).toBe('categoriaId')
  })

  it('no asigna a una persona dada de baja ni a un proyecto finalizado', async () => {
    const { token, empresa, proyecto, categoria, crearAsignable } = await escenario()

    const deBaja = await crearAsignable({ activo: false, motivoBaja: 'Renuncia' })
    const conBaja = await request(app)
      .post(`${RUTA}/${proyecto._id}/asignaciones`)
      .set(auth(token))
      .send({
        empleadoId: deBaja._id.toString(),
        categoriaId: categoria._id.toString(),
        fechaAsignacion: '2026-09-15'
      })
    expect(conBaja.status).toBe(400)
    expect(conBaja.body.message).toMatch(/dada de baja/i)

    const cerrado = await crearProyecto(empresa, {
      nombre: 'Terminado',
      categorias: [categoria._id],
      estado: 'finalizado',
      fechaFinReal: '2026-12-01'
    })
    const persona = await crearAsignable()
    const enCerrado = await request(app)
      .post(`${RUTA}/${cerrado.proyecto._id}/asignaciones`)
      .set(auth(token))
      .send({
        empleadoId: persona._id.toString(),
        categoriaId: categoria._id.toString(),
        fechaAsignacion: '2026-09-15'
      })
    expect(enCerrado.status).toBe(400)
    expect(enCerrado.body.message).toMatch(/finalizado/i)
  })

  it('409 si ya está asignado, pero se puede reincorporar tras su salida', async () => {
    const { token, proyecto, categoria, crearAsignable } = await escenario()
    const persona = await crearAsignable()
    const asignar1 = () =>
      request(app).post(`${RUTA}/${proyecto._id}/asignaciones`).set(auth(token)).send({
        empleadoId: persona._id.toString(),
        categoriaId: categoria._id.toString(),
        fechaAsignacion: '2026-09-15'
      })

    const primera = await asignar1()
    const duplicada = await asignar1()

    expect(primera.status).toBe(201)
    expect(duplicada.status).toBe(409)
    expect(duplicada.body.code).toBe('ASIGNACION_DUPLICADA')

    // Se cierra y se puede volver a asignar: el índice único es parcial sobre
    // las activas, así que el histórico convive con la reincorporación.
    await request(app)
      .patch(`/api/v1/asignaciones/${primera.body.data.asignacion._id}/salida`)
      .set(auth(token))
      .send({ fechaSalida: '2026-10-31' })

    const reincorporacion = await asignar1()
    expect(reincorporacion.status).toBe(201)
    expect(await Assignment.countDocuments({ empleadoId: persona._id })).toBe(2)
  })

  it('la fecha de asignación no puede ser anterior al inicio del proyecto', async () => {
    const { token, proyecto, categoria, crearAsignable } = await escenario()
    const persona = await crearAsignable()

    const res = await request(app)
      .post(`${RUTA}/${proyecto._id}/asignaciones`)
      .set(auth(token))
      .send({
        empleadoId: persona._id.toString(),
        categoriaId: categoria._id.toString(),
        fechaAsignacion: '2026-01-01'
      })

    expect(res.status).toBe(400)
    expect(res.body.errors[0].path).toBe('fechaAsignacion')
  })

  it('un jefe de área sólo asigna personal de sus áreas', async () => {
    const jefe = await escenario({
      nivelAcceso: 'jefe_area',
      areas: ['operaciones_urbanizadora']
    })
    const deSuArea = await jefe.crearAsignable({ areas: ['operaciones_urbanizadora'] })
    const deOtraArea = await jefe.crearAsignable({ areas: ['comercial'] })

    const suyo = await request(app)
      .post(`${RUTA}/${jefe.proyecto._id}/asignaciones`)
      .set(auth(jefe.token))
      .send({
        empleadoId: deSuArea._id.toString(),
        categoriaId: jefe.categoria._id.toString(),
        fechaAsignacion: '2026-09-15'
      })
    const ajeno = await request(app)
      .post(`${RUTA}/${jefe.proyecto._id}/asignaciones`)
      .set(auth(jefe.token))
      .send({
        empleadoId: deOtraArea._id.toString(),
        categoriaId: jefe.categoria._id.toString(),
        fechaAsignacion: '2026-09-15'
      })

    expect(suyo.status).toBe(201)
    expect(ajeno.status).toBe(403)
    expect(ajeno.body.message).toMatch(/tus áreas: operaciones_urbanizadora/i)
  })

  it('403 para rh_consulta; 404 si el proyecto no es suyo', async () => {
    const { empresa, proyecto, categoria, crearAsignable } = await escenario()
    const persona = await crearAsignable()

    const consulta = await crearEmpleadoConSesion({ nivelAcceso: 'rh_consulta', empresa })
    const sinPermiso = await request(app)
      .post(`${RUTA}/${proyecto._id}/asignaciones`)
      .set(auth(consulta.token))
      .send({
        empleadoId: persona._id.toString(),
        categoriaId: categoria._id.toString(),
        fechaAsignacion: '2026-09-15'
      })
    expect(sinPermiso.status).toBe(403)

    const otro = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const fuera = await request(app)
      .post(`${RUTA}/${proyecto._id}/asignaciones`)
      .set(auth(otro.token))
      .send({
        empleadoId: persona._id.toString(),
        categoriaId: categoria._id.toString(),
        fechaAsignacion: '2026-09-15'
      })
    expect(fuera.status).toBe(404)
  })
})

describe('GET /api/v1/proyectos/:id/asignables — el selector', () => {
  it('lista a los adscritos y activos con categoría habilitada', async () => {
    const { token, proyecto, crearAsignable } = await escenario()
    const uno = await crearAsignable()
    await crearAsignable()

    const res = await request(app)
      .get(`${RUTA}/${proyecto._id}/asignables`)
      .set(auth(token))

    expect(res.status).toBe(200)
    expect(res.body.data.asignables).toHaveLength(2)
    expect(res.body.data.asignables.map((a) => a._id)).toContain(uno._id.toString())
    expect(res.body.data.asignables[0]).toMatchObject({ categoriaNombre: 'Albañil' })
  })

  it('deja fuera a los que ya están asignados', async () => {
    const { token, proyecto, categoria, crearAsignable } = await escenario()
    const asignado = await crearAsignable()
    const libre = await crearAsignable()
    await asignar(proyecto, asignado, categoria._id)

    const res = await request(app)
      .get(`${RUTA}/${proyecto._id}/asignables`)
      .set(auth(token))

    expect(res.body.data.asignables.map((a) => a._id)).toEqual([libre._id.toString()])
  })

  it('vuelve a incluirlo cuando su asignación se cierra', async () => {
    const { token, proyecto, categoria, crearAsignable } = await escenario()
    const persona = await crearAsignable()
    await asignar(proyecto, persona, categoria._id, {
      activo: false,
      fechaSalida: '2026-10-31'
    })

    const res = await request(app)
      .get(`${RUTA}/${proyecto._id}/asignables`)
      .set(auth(token))
    expect(res.body.data.asignables.map((a) => a._id)).toEqual([persona._id.toString()])
  })

  it('deja fuera a los de otra empresa, a los dados de baja y a los de otra categoría', async () => {
    const { token, empresa, proyecto, categoria, crearAsignable } = await escenario()
    await crearAsignable() // el único que debe salir

    const deBaja = await crearEmpleado({
      tipo: 'mano_de_obra',
      categoriaId: categoria._id,
      activo: false,
      motivoBaja: 'Renuncia'
    })
    await adscribir(empresa, deBaja, { areas: ['operaciones_urbanizadora'] })

    const otraCategoria = await crearCategoria('Soldador', 'mano_de_obra')
    const noHabilitado = await crearEmpleado({
      tipo: 'mano_de_obra',
      categoriaId: otraCategoria._id
    })
    await adscribir(empresa, noHabilitado, { areas: ['operaciones_urbanizadora'] })

    const deOtraEmpresa = await crearEmpleado({
      tipo: 'mano_de_obra',
      categoriaId: categoria._id
    })
    await adscribir(await crearEmpresa(), deOtraEmpresa, {
      areas: ['operaciones_urbanizadora']
    })

    const res = await request(app)
      .get(`${RUTA}/${proyecto._id}/asignables`)
      .set(auth(token))
    expect(res.body.data.asignables).toHaveLength(1)
  })

  it('para un jefe de área, sólo su gente', async () => {
    const jefe = await escenario({
      nivelAcceso: 'jefe_area',
      areas: ['operaciones_urbanizadora']
    })
    const suyo = await jefe.crearAsignable({ areas: ['operaciones_urbanizadora'] })
    await jefe.crearAsignable({ areas: ['comercial'] })

    const res = await request(app)
      .get(`${RUTA}/${jefe.proyecto._id}/asignables`)
      .set(auth(jefe.token))

    expect(res.body.data.asignables.map((a) => a._id)).toEqual([suyo._id.toString()])
  })
})

describe('GET /api/v1/proyectos/:id/asignaciones', () => {
  it('lista con nombres resueltos, activas primero', async () => {
    const { token, proyecto, categoria, crearAsignable } = await escenario()
    const activa = await crearAsignable()
    const cerrada = await crearAsignable()
    await asignar(proyecto, activa, categoria._id)
    await asignar(proyecto, cerrada, categoria._id, {
      activo: false,
      fechaSalida: '2026-10-31'
    })

    const todas = await request(app)
      .get(`${RUTA}/${proyecto._id}/asignaciones`)
      .set(auth(token))
    const soloActivas = await request(app)
      .get(`${RUTA}/${proyecto._id}/asignaciones?activo=true`)
      .set(auth(token))

    expect(todas.body.data.asignaciones).toHaveLength(2)
    expect(todas.body.data.asignaciones[0].activo).toBe(true)
    expect(todas.body.data.asignaciones[0].empleadoNombre).toBe(activa.nombre)
    expect(soloActivas.body.data.asignaciones).toHaveLength(1)
  })

  it('cualquiera con sesión puede verlas; 404 si el proyecto es ajeno', async () => {
    const { empresa, proyecto } = await escenario()
    const consulta = await crearEmpleadoConSesion({ nivelAcceso: 'rh_consulta', empresa })
    const otro = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })

    expect(
      (
        await request(app)
          .get(`${RUTA}/${proyecto._id}/asignaciones`)
          .set(auth(consulta.token))
      ).status
    ).toBe(200)
    expect(
      (
        await request(app)
          .get(`${RUTA}/${proyecto._id}/asignaciones`)
          .set(auth(otro.token))
      ).status
    ).toBe(404)
  })
})

describe('PATCH /api/v1/asignaciones/:id/salida', () => {
  it('cierra la asignación sin borrarla', async () => {
    const { token, proyecto, categoria, crearAsignable } = await escenario()
    const persona = await crearAsignable()
    const asignacion = await asignar(proyecto, persona, categoria._id)

    const res = await request(app)
      .patch(`/api/v1/asignaciones/${asignacion._id}/salida`)
      .set(auth(token))
      .send({ fechaSalida: '2026-10-31' })

    expect(res.status).toBe(200)
    expect(res.body.data.asignacion).toMatchObject({
      activo: false,
      fechaSalida: '2026-10-31'
    })
    // El registro se conserva: hay que poder responder quién estaba y cuándo.
    expect(await Assignment.findById(asignacion._id)).not.toBeNull()
  })

  it('la salida no puede ser anterior a la asignación', async () => {
    const { token, proyecto, categoria, crearAsignable } = await escenario()
    const persona = await crearAsignable()
    const asignacion = await asignar(proyecto, persona, categoria._id, {
      fechaAsignacion: '2026-09-15'
    })

    const res = await request(app)
      .patch(`/api/v1/asignaciones/${asignacion._id}/salida`)
      .set(auth(token))
      .send({ fechaSalida: '2026-09-01' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/anterior a la de asignación/i)
  })

  it('400 si ya estaba cerrada; 404 si no existe o el proyecto es ajeno', async () => {
    const { token, proyecto, categoria, crearAsignable } = await escenario()
    const persona = await crearAsignable()
    const asignacion = await asignar(proyecto, persona, categoria._id, {
      activo: false,
      fechaSalida: '2026-10-01'
    })

    const yaCerrada = await request(app)
      .patch(`/api/v1/asignaciones/${asignacion._id}/salida`)
      .set(auth(token))
      .send({ fechaSalida: '2026-11-01' })
    const inexistente = await request(app)
      .patch(`/api/v1/asignaciones/${new mongoose.Types.ObjectId()}/salida`)
      .set(auth(token))
      .send({ fechaSalida: '2026-11-01' })

    expect(yaCerrada.status).toBe(400)
    expect(inexistente.status).toBe(404)
  })

  it('403 para rh_consulta', async () => {
    const { empresa, proyecto, categoria, crearAsignable } = await escenario()
    const persona = await crearAsignable()
    const asignacion = await asignar(proyecto, persona, categoria._id)
    const consulta = await crearEmpleadoConSesion({ nivelAcceso: 'rh_consulta', empresa })

    const res = await request(app)
      .patch(`/api/v1/asignaciones/${asignacion._id}/salida`)
      .set(auth(consulta.token))
      .send({ fechaSalida: '2026-10-31' })

    expect(res.status).toBe(403)
  })
})

/**
 * Coherencia del registro patronal (Fase 6, G2) y la cadena resuelta.
 *
 * Los números son los reales de Maquinaria CAMES: 144 personas repartidas entre
 * cuatro registros son la razón por la que esto **avisa y no bloquea**.
 */
const R13 = 'R13-77767-10-5'
const H67 = 'H67-29973-10-5'

/** Proyecto con registro patronal conocido, para poder comparar contra él. */
async function escenarioDeRegistros(datos = {}) {
  const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin', ...datos })
  const categoria = await crearCategoria('Albañil', 'mano_de_obra')
  const registro = await crearRegistroPatronal(sesion.empresa, R13)
  const { proyecto, cliente, registroObra } = await crearProyecto(sesion.empresa, {
    categorias: [categoria._id],
    registroPatronalId: registro._id,
    fechaInicio: '2026-09-01'
  })

  /** Alguien asignable, con el registro patronal que se le indique. */
  const crearAsignable = async (registroPatronal) => {
    const persona = await crearEmpleado({
      tipo: 'mano_de_obra',
      categoriaId: categoria._id
    })
    await adscribir(sesion.empresa, persona, {
      areas: ['operaciones_urbanizadora'],
      condiciones: registroPatronal ? { registroPatronal } : {}
    })
    return persona
  }

  return {
    ...sesion,
    categoria,
    proyecto,
    cliente,
    registro,
    registroObra,
    crearAsignable
  }
}

describe('Coherencia del registro patronal al asignar (G2)', () => {
  beforeAll(() => Assignment.init())

  it('AVISA pero no bloquea a quien cotiza en otro registro de la misma empresa', async () => {
    const { token, proyecto, categoria, crearAsignable } = await escenarioDeRegistros()
    const persona = await crearAsignable(H67)

    const res = await request(app)
      .post(`${RUTA}/${proyecto._id}/asignaciones`)
      .set(auth(token))
      .send({
        empleadoId: persona._id.toString(),
        categoriaId: categoria._id.toString(),
        fechaAsignacion: '2026-09-15'
      })

    // 201: la asignación se hizo. El aviso no es un error.
    expect(res.status).toBe(201)
    expect(res.body.data.asignacion.activo).toBe(true)
    expect(res.body.data.avisos).toHaveLength(1)
    expect(res.body.data.avisos[0]).toContain(H67)
    expect(res.body.data.avisos[0]).toContain(R13)
    // Y sale en `message`, para que se vea aunque el front no lea `avisos`.
    expect(res.body.message).toBe(res.body.data.avisos[0])
    expect(await Assignment.countDocuments({ proyectoId: proyecto._id })).toBe(1)
  })

  it('no avisa si coincide, aunque esté capturado con otro formato', async () => {
    const { token, proyecto, categoria, crearAsignable } = await escenarioDeRegistros()
    const persona = await crearAsignable('r13 77767 10 5')

    const res = await request(app)
      .post(`${RUTA}/${proyecto._id}/asignaciones`)
      .set(auth(token))
      .send({
        empleadoId: persona._id.toString(),
        categoriaId: categoria._id.toString(),
        fechaAsignacion: '2026-09-15'
      })

    expect(res.status).toBe(201)
    expect(res.body.data.avisos).toEqual([])
    expect(res.body.message).toMatch(/Personal asignado al proyecto/i)
  })

  it('distingue "no coincide" de "no se pudo comprobar"', async () => {
    const { token, proyecto, categoria, crearAsignable } = await escenarioDeRegistros()
    const persona = await crearAsignable(null)

    const res = await request(app)
      .post(`${RUTA}/${proyecto._id}/asignaciones`)
      .set(auth(token))
      .send({
        empleadoId: persona._id.toString(),
        categoriaId: categoria._id.toString(),
        fechaAsignacion: '2026-09-15'
      })

    expect(res.status).toBe(201)
    expect(res.body.data.avisos[0]).toMatch(
      /no tiene registro patronal en su adscripción/i
    )
  })

  it('el listado del proyecto deja la coincidencia a la vista, en tres estados', async () => {
    const { token, proyecto, categoria, crearAsignable } = await escenarioDeRegistros()
    const coincide = await crearAsignable(R13)
    const distinto = await crearAsignable(H67)
    const sinDato = await crearAsignable(null)
    for (const persona of [coincide, distinto, sinDato]) {
      await asignar(proyecto, persona, categoria._id, { fechaAsignacion: '2026-09-15' })
    }

    const res = await request(app)
      .get(`${RUTA}/${proyecto._id}/asignaciones`)
      .set(auth(token))

    expect(res.status).toBe(200)
    const porEmpleado = new Map(res.body.data.asignaciones.map((a) => [a.empleadoId, a]))
    expect(porEmpleado.get(coincide._id.toString())).toMatchObject({
      registroPatronalEmpleado: R13,
      registroPatronalCoincide: true
    })
    expect(porEmpleado.get(distinto._id.toString())).toMatchObject({
      registroPatronalEmpleado: H67,
      registroPatronalCoincide: false
    })
    // Sin dato es `null`, no `false`: no se pudo comparar.
    expect(porEmpleado.get(sinDato._id.toString())).toMatchObject({
      registroPatronalEmpleado: null,
      registroPatronalCoincide: null
    })
  })
})

describe('El vínculo manda sobre el texto (Fase 7, D-72)', () => {
  beforeAll(() => Assignment.init())

  /**
   * Una adscripción vinculada al registro del proyecto pero cuyo TEXTO dice otro
   * —el archivo de nómina traía un número viejo y luego se corrigió el vínculo—.
   * Gana el vínculo: el número sale del catálogo de la empresa.
   */
  it('no avisa si el vínculo coincide, aunque el texto diga otro registro', async () => {
    const { token, empresa, proyecto, categoria, registro, crearAsignable } =
      await escenarioDeRegistros()
    const persona = await crearAsignable(H67) // el texto, desactualizado
    await Affiliation.updateOne(
      { empresaId: empresa._id, empleadoId: persona._id },
      { $set: { registroPatronalId: registro._id } } // el vínculo, correcto
    )

    const res = await request(app)
      .post(`${RUTA}/${proyecto._id}/asignaciones`)
      .set(auth(token))
      .send({
        empleadoId: persona._id.toString(),
        categoriaId: categoria._id.toString(),
        fechaAsignacion: '2026-09-15'
      })

    expect(res.status).toBe(201)
    expect(res.body.data.avisos).toEqual([])
  })

  it('avisa si el vínculo apunta a otro registro, aunque el texto coincida', async () => {
    const { token, empresa, proyecto, categoria, crearAsignable } =
      await escenarioDeRegistros()
    const otro = await crearRegistroPatronal(empresa, H67)
    const persona = await crearAsignable(R13) // el texto coincide con el proyecto
    await Affiliation.updateOne(
      { empresaId: empresa._id, empleadoId: persona._id },
      { $set: { registroPatronalId: otro._id } } // pero el vínculo dice otro
    )

    const res = await request(app)
      .post(`${RUTA}/${proyecto._id}/asignaciones`)
      .set(auth(token))
      .send({
        empleadoId: persona._id.toString(),
        categoriaId: categoria._id.toString(),
        fechaAsignacion: '2026-09-15'
      })

    expect(res.status).toBe(201)
    expect(res.body.data.avisos[0]).toContain(H67)
  })

  it('el detalle distingue vinculado de texto crudo', async () => {
    const { token, empresa, proyecto, categoria, registro, crearAsignable } =
      await escenarioDeRegistros()
    const vinculada = await crearAsignable(R13)
    await Affiliation.updateOne(
      { empresaId: empresa._id, empleadoId: vinculada._id },
      { $set: { registroPatronalId: registro._id } }
    )
    const suelta = await crearAsignable(R13)

    const conVinculo = await asignar(proyecto, vinculada, categoria._id)
    const sinVinculo = await asignar(proyecto, suelta, categoria._id)

    const a = await request(app)
      .get(`/api/v1/asignaciones/${conVinculo._id}`)
      .set(auth(token))
    const b = await request(app)
      .get(`/api/v1/asignaciones/${sinVinculo._id}`)
      .set(auth(token))

    expect(a.body.data.trazabilidad.registroPatronalEmpleadoId).toBe(
      registro._id.toString()
    )
    // Sin vínculo: el número es el texto crudo de la nómina, sin validar.
    expect(b.body.data.trazabilidad.registroPatronalEmpleadoId).toBeNull()
    expect(b.body.data.trazabilidad.registroPatronalEmpleado).toBe(R13)
    // Los dos coinciden con el proyecto; el vínculo no cambia el veredicto.
    expect(a.body.data.trazabilidad.registroPatronalCoincide).toBe(true)
    expect(b.body.data.trazabilidad.registroPatronalCoincide).toBe(true)
  })
})

describe('GET /api/v1/asignaciones/:id — la cadena resuelta (Fase 6)', () => {
  beforeAll(() => Assignment.init())

  it('devuelve empleado → empresa → registro patronal → proyecto → registro de obra', async () => {
    const { token, empresa, proyecto, cliente, categoria, registroObra, crearAsignable } =
      await escenarioDeRegistros()
    const persona = await crearAsignable(H67)
    const asignacion = await asignar(proyecto, persona, categoria._id, {
      fechaAsignacion: '2026-09-15'
    })

    const res = await request(app)
      .get(`/api/v1/asignaciones/${asignacion._id}`)
      .set(auth(token))

    expect(res.status).toBe(200)
    expect(res.body.data.asignacion).toMatchObject({
      _id: asignacion._id.toString(),
      empleadoNombre: persona.nombre,
      categoriaNombre: 'Albañil'
    })
    expect(res.body.data.trazabilidad).toMatchObject({
      empleado: { _id: persona._id.toString(), nombre: persona.nombre },
      empresa: { _id: empresa._id.toString(), nombre: empresa.nombre },
      // El de SU adscripción, texto libre; el del proyecto va resuelto.
      registroPatronalEmpleado: H67,
      proyecto: { _id: proyecto._id.toString(), nombre: proyecto.nombre },
      registroPatronal: { numero: R13, descripcion: null, activo: true },
      cliente: { _id: cliente._id.toString(), nombre: cliente.nombre },
      registroPatronalCoincide: false
    })
    expect(res.body.data.trazabilidad.registroObra._id).toBe(registroObra.toString())
    expect(res.body.data.trazabilidad.adscripcionActiva).toBe(true)
    expect(res.body.data.avisos).toHaveLength(1)
  })

  it('404 si la asignación es de un proyecto fuera de alcance', async () => {
    const { proyecto, categoria, crearAsignable } = await escenarioDeRegistros()
    const persona = await crearAsignable(R13)
    const asignacion = await asignar(proyecto, persona, categoria._id)
    // Otro RH, de otra empresa: el proyecto no existe para él.
    const ajeno = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })

    const res = await request(app)
      .get(`/api/v1/asignaciones/${asignacion._id}`)
      .set(auth(ajeno.token))

    expect(res.status).toBe(404)
    expect(res.body.message).toMatch(/no existe/i)
  })

  it('rh_consulta lo lee: mirar quién está en la obra no es moverlo', async () => {
    const { empresa, proyecto, categoria, crearAsignable } = await escenarioDeRegistros()
    const persona = await crearAsignable(R13)
    const asignacion = await asignar(proyecto, persona, categoria._id)
    const consulta = await crearEmpleadoConSesion({ nivelAcceso: 'rh_consulta', empresa })

    const res = await request(app)
      .get(`/api/v1/asignaciones/${asignacion._id}`)
      .set(auth(consulta.token))

    expect(res.status).toBe(200)
    expect(res.body.data.trazabilidad.registroPatronalCoincide).toBe(true)
  })

  it('401 sin sesión, 400 con un id inválido y 404 si no existe', async () => {
    const { token, proyecto, categoria, crearAsignable } = await escenarioDeRegistros()
    const persona = await crearAsignable(R13)
    const asignacion = await asignar(proyecto, persona, categoria._id)

    const sinSesion = await request(app).get(`/api/v1/asignaciones/${asignacion._id}`)
    const invalido = await request(app)
      .get('/api/v1/asignaciones/no-es-un-id')
      .set(auth(token))
    const inexistente = await request(app)
      .get(`/api/v1/asignaciones/${new mongoose.Types.ObjectId()}`)
      .set(auth(token))

    expect(sinSesion.status).toBe(401)
    expect(invalido.status).toBe(400)
    expect(inexistente.status).toBe(404)
  })
})
