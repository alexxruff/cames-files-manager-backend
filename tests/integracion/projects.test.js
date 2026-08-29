const request = require('supertest')
const mongoose = require('mongoose')
const app = require('../../src/app')
const Project = require('../../src/api/v1/projects/projectModel')
const Assignment = require('../../src/api/v1/assignments/assignmentModel')
const Company = require('../../src/api/v1/companies/companyModel')
const Client = require('../../src/api/v1/clients/clientModel')
const { normalize } = require('../../src/utils/text')
const {
  crearEmpresa,
  crearCliente,
  crearCategoria,
  crearEmpleado,
  crearEmpleadoConSesion,
  adscribir,
  agregarACartera,
  crearProyecto,
  crearRegistroPatronal,
  crearRegistroObra,
  asignar,
  auth
} = require('../helpers/factories')

const RUTA = '/api/v1/proyectos'

/** Sesión que puede gestionar proyectos, con cliente en cartera y categoría. */
async function escenario(datos = {}) {
  const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin', ...datos })
  const cliente = await crearCliente({ nombre: `Cliente de ${sesion.empresa.nombre}` })
  await agregarACartera(sesion.empresa, cliente)
  const categoria = await crearCategoria(undefined, 'mano_de_obra')
  // Obligatorios en todo proyecto nuevo desde D-69.
  const registroPatronal = await crearRegistroPatronal(sesion.empresa)
  const registroObra = await crearRegistroObra(cliente)
  return { ...sesion, cliente, categoria, registroPatronal, registroObra }
}

const cuerpo = ({
  empresa,
  cliente,
  categoria,
  registroPatronal,
  registroObra,
  ...extra
}) => ({
  empresaId: empresa._id.toString(),
  clienteId: cliente._id.toString(),
  nombre: 'Torre Andares — Etapa 2',
  fechaInicio: '2026-09-01',
  fechaFinEstimada: '2027-06-30',
  categorias: [categoria._id.toString()],
  registroPatronalId: registroPatronal?._id?.toString(),
  registroObraId: registroObra?._id?.toString(),
  ...extra
})

describe('POST /api/v1/proyectos', () => {
  beforeAll(() => Project.init())

  it('crea el proyecto con su cliente y categorías', async () => {
    const { token, empresa, cliente, categoria, registroPatronal, registroObra } =
      await escenario()

    const res = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send(cuerpo({ empresa, cliente, categoria, registroPatronal, registroObra }))

    expect(res.status).toBe(201)
    expect(res.body.data.proyecto).toMatchObject({
      nombre: 'Torre Andares — Etapa 2',
      empresaId: empresa._id.toString(),
      clienteId: cliente._id.toString(),
      empresaNombre: empresa.nombre,
      clienteNombre: cliente.nombre,
      estado: 'en_curso',
      fechaFinReal: null,
      aplazamientos: []
    })
    expect(res.body.data.proyecto.categorias).toEqual([categoria._id.toString()])
    // Derivado, nunca almacenado.
    expect(typeof res.body.data.proyecto.diasParaCierre).toBe('number')
  })

  it('EXIGE que el cliente esté en la cartera activa de la empresa', async () => {
    const { token, empresa, categoria, registroPatronal } = await escenario()
    const fuera = await crearCliente({ nombre: 'Cliente sin cartera' })
    const registroObra = await crearRegistroObra(fuera)

    const res = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send(
        cuerpo({ empresa, cliente: fuera, categoria, registroPatronal, registroObra })
      )

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/no está en la cartera activa/i)
    expect(res.body.errors[0].path).toBe('clienteId')
  })

  it('tampoco vale un cliente que fue sacado de la cartera', async () => {
    const { token, empresa, categoria } = await escenario()
    const sacado = await crearCliente()
    await agregarACartera(empresa, sacado, { activo: false })

    const res = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send(cuerpo({ empresa, cliente: sacado, categoria }))

    expect(res.status).toBe(400)
  })

  it('exige al menos una categoría, y que exista y esté activa', async () => {
    const { token, empresa, cliente, categoria, registroPatronal, registroObra } =
      await escenario()
    const desactivada = await crearCategoria('Desactivada', 'mano_de_obra')
    desactivada.activo = false
    await desactivada.save()

    const sinCategorias = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send(
        cuerpo({
          empresa,
          cliente,
          categoria,
          registroPatronal,
          registroObra,
          categorias: []
        })
      )
    const inactiva = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send(
        cuerpo({
          empresa,
          cliente,
          categoria,
          registroPatronal,
          registroObra,
          categorias: [desactivada._id.toString()]
        })
      )

    expect(sinCategorias.status).toBe(400)
    expect(inactiva.status).toBe(400)
    expect(inactiva.body.errors[0].path).toBe('categorias')
  })

  it('la fecha de fin estimada debe ser posterior al inicio', async () => {
    const { token, empresa, cliente, categoria, registroPatronal, registroObra } =
      await escenario()

    const res = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send(
        cuerpo({
          empresa,
          cliente,
          categoria,
          registroPatronal,
          registroObra,
          fechaInicio: '2026-09-01',
          fechaFinEstimada: '2026-08-01'
        })
      )

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/posterior a la de inicio/i)
  })

  it('el nombre es único DENTRO de la empresa, pero se repite entre empresas', async () => {
    const uno = await escenario()
    await request(app).post(RUTA).set(auth(uno.token)).send(cuerpo(uno))

    const repetido = await request(app)
      .post(RUTA)
      .set(auth(uno.token))
      .send(cuerpo({ ...uno, nombre: 'torre andares — etapa 2' }))
    expect(repetido.status).toBe(409)
    expect(repetido.body.code).toBe('PROYECTO_DUPLICADO')

    // Otra empresa del grupo sí puede tener su propia "Torre Andares".
    const dos = await escenario()
    const otraEmpresa = await request(app)
      .post(RUTA)
      .set(auth(dos.token))
      .send(cuerpo(dos))
    expect(otraEmpresa.status).toBe(201)
  })

  it('404 si la empresa no es suya', async () => {
    const e = await escenario()
    const ajena = await crearEmpresa()

    const res = await request(app)
      .post(RUTA)
      .set(auth(e.token))
      .send(cuerpo({ ...e, empresa: ajena }))

    expect(res.status).toBe(404)
  })

  it('el jefe de área puede crear proyectos; rh_consulta no', async () => {
    const jefe = await escenario({
      nivelAcceso: 'jefe_area',
      areas: ['operaciones_urbanizadora']
    })
    const conJefe = await request(app).post(RUTA).set(auth(jefe.token)).send(cuerpo(jefe))
    expect(conJefe.status).toBe(201)

    const consulta = await escenario({ nivelAcceso: 'rh_consulta' })
    const conConsulta = await request(app)
      .post(RUTA)
      .set(auth(consulta.token))
      .send(
        cuerpo({
          ...consulta
        })
      )
    expect(conConsulta.status).toBe(403)
  })

  it('400 con mensajes por campo', async () => {
    const { token, empresa, cliente, categoria, registroPatronal, registroObra } =
      await escenario()
    const casos = [
      [{ nombre: 'ab' }, 'nombre'],
      [{ fechaInicio: '01/09/2026' }, 'fechaInicio'],
      [{ clienteId: 'no-es-id' }, 'clienteId'],
      [{ categorias: 'no-es-lista' }, 'categorias']
    ]

    for (const [extra, campo] of casos) {
      const res = await request(app)
        .post(RUTA)
        .set(auth(token))
        .send(
          cuerpo({
            empresa,
            cliente,
            categoria,
            registroPatronal,
            registroObra,
            ...extra
          })
        )
      expect(res.status).toBe(400)
      expect(res.body.errors.some((e) => e.path === campo)).toBe(true)
    }
  })
})

describe('GET /api/v1/proyectos', () => {
  it('sólo muestra los de las empresas visibles', async () => {
    const { token, empresa } = await crearEmpleadoConSesion()
    await crearProyecto(empresa, { nombre: 'Propio' })

    const ajena = await crearEmpresa()
    await crearProyecto(ajena, { nombre: 'Ajeno' })

    const res = await request(app).get(RUTA).set(auth(token))

    expect(res.body.data.proyectos.map((p) => p.nombre)).toEqual(['Propio'])
    expect(res.body.data.total).toBe(1)
  })

  it('el admin de plataforma ve los de todas', async () => {
    const { token } = await crearEmpleadoConSesion({
      alcanceGlobal: true,
      sinAdscripcion: true
    })
    await crearProyecto(await crearEmpresa(), { nombre: 'Uno' })
    await crearProyecto(await crearEmpresa(), { nombre: 'Dos' })

    const res = await request(app).get(RUTA).set(auth(token))
    expect(res.body.data.total).toBe(2)
  })

  it('filtra por estado, cliente y empresa, y busca por nombre', async () => {
    const { token, empresa } = await crearEmpleadoConSesion()
    const { cliente } = await crearProyecto(empresa, { nombre: 'Torre Andares' })
    await crearProyecto(empresa, { nombre: 'Plaza Central', estado: 'finalizado' })

    const enCurso = await request(app).get(`${RUTA}?estado=en_curso`).set(auth(token))
    const porCliente = await request(app)
      .get(`${RUTA}?clienteId=${cliente._id}`)
      .set(auth(token))
    const porNombre = await request(app).get(`${RUTA}?busqueda=plaza`).set(auth(token))

    expect(enCurso.body.data.proyectos.map((p) => p.nombre)).toEqual(['Torre Andares'])
    expect(porCliente.body.data.proyectos.map((p) => p.nombre)).toEqual(['Torre Andares'])
    expect(porNombre.body.data.proyectos.map((p) => p.nombre)).toEqual(['Plaza Central'])
  })

  it('empresaId de otra empresa responde 404', async () => {
    const { token } = await crearEmpleadoConSesion()
    const ajena = await crearEmpresa()

    const res = await request(app).get(`${RUTA}?empresaId=${ajena._id}`).set(auth(token))
    expect(res.status).toBe(404)
  })

  it('pagina y trae total, pagina y porPagina', async () => {
    const { token, empresa } = await crearEmpleadoConSesion()
    for (const nombre of ['A', 'B', 'C']) await crearProyecto(empresa, { nombre })

    const res = await request(app).get(`${RUTA}?porPagina=2`).set(auth(token))
    expect(res.body.data).toMatchObject({ total: 3, pagina: 1, porPagina: 2 })
    expect(res.body.data.proyectos).toHaveLength(2)
  })

  it('el detalle de un proyecto ajeno responde 404', async () => {
    const { token } = await crearEmpleadoConSesion()
    const ajena = await crearEmpresa()
    const { proyecto } = await crearProyecto(ajena)

    expect(
      (await request(app).get(`${RUTA}/${proyecto._id}`).set(auth(token))).status
    ).toBe(404)
  })
})

describe('PATCH /api/v1/proyectos/:id', () => {
  it('actualiza nombre, cliente, fecha de inicio y categorías', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const { proyecto } = await crearProyecto(empresa)
    const otroCliente = await crearCliente({ nombre: 'Otro Cliente' })
    await agregarACartera(empresa, otroCliente)
    // Cambiar de cliente exige su registro de obra en la misma petición (D-69).
    const otroRegistroObra = await crearRegistroObra(otroCliente)
    const otraCategoria = await crearCategoria('Otra', 'mano_de_obra')

    const res = await request(app)
      .patch(`${RUTA}/${proyecto._id}`)
      .set(auth(token))
      .send({
        nombre: 'Torre Andares — Etapa 3',
        clienteId: otroCliente._id.toString(),
        registroObraId: otroRegistroObra._id.toString(),
        categorias: [otraCategoria._id.toString()]
      })

    expect(res.status).toBe(200)
    expect(res.body.data.proyecto).toMatchObject({
      nombre: 'Torre Andares — Etapa 3',
      clienteId: otroCliente._id.toString(),
      clienteNombre: 'Otro Cliente'
    })
  })

  it('RECHAZA cambiar la fecha de cierre y dice que use /aplazar', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const { proyecto } = await crearProyecto(empresa)

    const res = await request(app)
      .patch(`${RUTA}/${proyecto._id}`)
      .set(auth(token))
      .send({ fechaFinEstimada: '2027-12-31' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/aplazar/)
    expect(res.body.message).toMatch(/exige motivo/)
  })

  it('rechaza estado, fechaFinReal, empresaId y el historial', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const { proyecto } = await crearProyecto(empresa)

    for (const campo of ['estado', 'fechaFinReal', 'empresaId', 'aplazamientos']) {
      const res = await request(app)
        .patch(`${RUTA}/${proyecto._id}`)
        .set(auth(token))
        .send({ [campo]: 'lo que sea' })
      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(campo)
    }
  })

  it('el cliente nuevo también tiene que estar en la cartera', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const { proyecto } = await crearProyecto(empresa)
    const fuera = await crearCliente({ nombre: 'Sin cartera' })

    const res = await request(app)
      .patch(`${RUTA}/${proyecto._id}`)
      .set(auth(token))
      .send({ clienteId: fuera._id.toString() })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/cartera activa/i)
  })

  it('no deja quitar una categoría que alguien asignado está usando', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const { proyecto, categoria } = await crearProyecto(empresa)
    const persona = await crearEmpleado({
      tipo: 'mano_de_obra',
      categoriaId: categoria._id
    })
    await adscribir(empresa, persona, { areas: ['operaciones_urbanizadora'] })
    await asignar(proyecto, persona, categoria._id)

    const otra = await crearCategoria('Otra', 'mano_de_obra')
    const res = await request(app)
      .patch(`${RUTA}/${proyecto._id}`)
      .set(auth(token))
      .send({ categorias: [otra._id.toString()] })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/1 persona asignada la tiene/i)
    expect(await Assignment.countDocuments({ activo: true })).toBe(1)
  })
})

describe('Ciclo de vida del proyecto', () => {
  const preparar = async () => {
    const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const { proyecto, categoria } = await crearProyecto(sesion.empresa, {
      fechaInicio: '2026-09-01',
      fechaFinEstimada: '2027-03-01'
    })
    return { ...sesion, proyecto, categoria }
  }

  describe('POST /:id/aplazar', () => {
    it('mueve la fecha y la deja en el historial con quién y por qué', async () => {
      const { token, proyecto, empleado } = await preparar()

      const res = await request(app)
        .post(`${RUTA}/${proyecto._id}/aplazar`)
        .set(auth(token))
        .send({ fechaNueva: '2027-06-30', motivo: 'Lluvias atrasaron la cimentación' })

      expect(res.status).toBe(200)
      expect(res.body.data.proyecto.fechaFinEstimada).toBe('2027-06-30')
      expect(res.body.data.proyecto.aplazamientos).toHaveLength(1)
      expect(res.body.data.proyecto.aplazamientos[0]).toMatchObject({
        fechaAnterior: '2027-03-01',
        fechaNueva: '2027-06-30',
        motivo: 'Lluvias atrasaron la cimentación',
        registradoPor: empleado.nombre
      })
    })

    it('el historial se acumula, del más reciente al más antiguo', async () => {
      const { token, proyecto } = await preparar()
      const aplazar = (fechaNueva) =>
        request(app)
          .post(`${RUTA}/${proyecto._id}/aplazar`)
          .set(auth(token))
          .send({ fechaNueva, motivo: 'Retraso del proveedor de acero' })

      await aplazar('2027-06-30')
      const res = await aplazar('2027-09-30')

      expect(res.body.data.proyecto.aplazamientos.map((a) => a.fechaNueva)).toEqual([
        '2027-09-30',
        '2027-06-30'
      ])
    })

    it('la fecha nueva debe ser posterior a la vigente', async () => {
      const { token, proyecto } = await preparar()

      const res = await request(app)
        .post(`${RUTA}/${proyecto._id}/aplazar`)
        .set(auth(token))
        .send({ fechaNueva: '2026-12-01', motivo: 'Quiero adelantarlo, no atrasarlo' })

      expect(res.status).toBe(400)
      expect(res.body.errors[0].path).toBe('fechaNueva')
    })

    it('el motivo es obligatorio y de al menos 10 caracteres', async () => {
      const { token, proyecto } = await preparar()

      for (const motivo of ['', 'corto']) {
        const res = await request(app)
          .post(`${RUTA}/${proyecto._id}/aplazar`)
          .set(auth(token))
          .send({ fechaNueva: '2027-06-30', motivo })
        expect(res.status).toBe(400)
        expect(res.body.errors[0].path).toBe('motivo')
      }
    })
  })

  describe('POST /:id/finalizar y /reabrir', () => {
    it('finaliza con su fecha real', async () => {
      const { token, proyecto } = await preparar()

      const res = await request(app)
        .post(`${RUTA}/${proyecto._id}/finalizar`)
        .set(auth(token))
        .send({ fechaFinReal: '2027-02-15' })

      expect(res.status).toBe(200)
      expect(res.body.data.proyecto).toMatchObject({
        estado: 'finalizado',
        fechaFinReal: '2027-02-15',
        diasParaCierre: null
      })
    })

    it('cierra las asignaciones abiertas con esa misma fecha', async () => {
      const { token, empresa, proyecto, categoria } = await preparar()
      const persona = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      await adscribir(empresa, persona, { areas: ['operaciones_urbanizadora'] })
      const asignacion = await asignar(proyecto, persona, categoria._id)

      await request(app)
        .post(`${RUTA}/${proyecto._id}/finalizar`)
        .set(auth(token))
        .send({ fechaFinReal: '2027-02-15' })

      const cerrada = await Assignment.findById(asignacion._id)
      expect(cerrada.activo).toBe(false)
      expect(cerrada.fechaSalida).toBe('2027-02-15')
    })

    it('la fecha de cierre no puede ser anterior al inicio', async () => {
      const { token, proyecto } = await preparar()

      const res = await request(app)
        .post(`${RUTA}/${proyecto._id}/finalizar`)
        .set(auth(token))
        .send({ fechaFinReal: '2026-01-01' })

      expect(res.status).toBe(400)
      expect(res.body.errors[0].path).toBe('fechaFinReal')
    })

    it('no se finaliza dos veces, ni se aplaza uno finalizado', async () => {
      const { token, proyecto } = await preparar()
      await request(app)
        .post(`${RUTA}/${proyecto._id}/finalizar`)
        .set(auth(token))
        .send({ fechaFinReal: '2027-02-15' })

      const otraVez = await request(app)
        .post(`${RUTA}/${proyecto._id}/finalizar`)
        .set(auth(token))
        .send({ fechaFinReal: '2027-02-20' })
      const aplazar = await request(app)
        .post(`${RUTA}/${proyecto._id}/aplazar`)
        .set(auth(token))
        .send({ fechaNueva: '2027-12-01', motivo: 'Reabrir por la vía equivocada' })

      expect(otraVez.status).toBe(400)
      expect(aplazar.status).toBe(400)
      expect(aplazar.body.message).toMatch(/Reábrelo primero/i)
    })

    it('reabrir limpia la fecha real y NO devuelve las asignaciones', async () => {
      const { token, empresa, proyecto, categoria } = await preparar()
      const persona = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      await adscribir(empresa, persona, { areas: ['operaciones_urbanizadora'] })
      const asignacion = await asignar(proyecto, persona, categoria._id)

      await request(app)
        .post(`${RUTA}/${proyecto._id}/finalizar`)
        .set(auth(token))
        .send({ fechaFinReal: '2027-02-15' })
      const res = await request(app)
        .post(`${RUTA}/${proyecto._id}/reabrir`)
        .set(auth(token))
        .send({})

      expect(res.status).toBe(200)
      expect(res.body.data.proyecto).toMatchObject({
        estado: 'en_curso',
        fechaFinReal: null
      })
      // Volver a poner a alguien en la obra es una decisión, no un efecto.
      expect((await Assignment.findById(asignacion._id)).activo).toBe(false)
      expect(res.body.message).toMatch(/vuelve a asignar/i)
    })

    it('400 al reabrir uno que no está finalizado', async () => {
      const { token, proyecto } = await preparar()
      const res = await request(app)
        .post(`${RUTA}/${proyecto._id}/reabrir`)
        .set(auth(token))
        .send({})
      expect(res.status).toBe(400)
    })
  })

  describe('POST /:id/categorias/clonar', () => {
    it('suma las del origen sin quitar ni duplicar', async () => {
      const { token, empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const comun = await crearCategoria('Albañil', 'mano_de_obra')
      const soloOrigen = await crearCategoria('Soldador', 'mano_de_obra')
      const soloDestino = await crearCategoria('Plomero', 'mano_de_obra')

      const origen = await crearProyecto(empresa, {
        nombre: 'Origen',
        categorias: [comun._id, soloOrigen._id]
      })
      const destino = await crearProyecto(empresa, {
        nombre: 'Destino',
        categorias: [comun._id, soloDestino._id]
      })

      const res = await request(app)
        .post(`${RUTA}/${destino.proyecto._id}/categorias/clonar`)
        .set(auth(token))
        .send({ origenId: origen.proyecto._id.toString() })

      expect(res.status).toBe(200)
      expect(res.body.data.agregadas).toBe(1)
      expect(res.body.data.proyecto.categorias.sort()).toEqual(
        [
          comun._id.toString(),
          soloDestino._id.toString(),
          soloOrigen._id.toString()
        ].sort()
      )
    })

    it('avisa cuando no había nada nuevo que agregar', async () => {
      const { token, empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const categoria = await crearCategoria('Albañil', 'mano_de_obra')
      const origen = await crearProyecto(empresa, {
        nombre: 'Origen',
        categorias: [categoria._id]
      })
      const destino = await crearProyecto(empresa, {
        nombre: 'Destino',
        categorias: [categoria._id]
      })

      const res = await request(app)
        .post(`${RUTA}/${destino.proyecto._id}/categorias/clonar`)
        .set(auth(token))
        .send({ origenId: origen.proyecto._id.toString() })

      expect(res.body.data.agregadas).toBe(0)
      expect(res.body.message).toMatch(/no tenía categorías nuevas/i)
    })

    it('400 si el origen es el mismo proyecto; 404 si es de otra empresa', async () => {
      const { token, empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const { proyecto } = await crearProyecto(empresa)
      const ajeno = await crearProyecto(await crearEmpresa())

      const mismo = await request(app)
        .post(`${RUTA}/${proyecto._id}/categorias/clonar`)
        .set(auth(token))
        .send({ origenId: proyecto._id.toString() })
      const otraEmpresa = await request(app)
        .post(`${RUTA}/${proyecto._id}/categorias/clonar`)
        .set(auth(token))
        .send({ origenId: ajeno.proyecto._id.toString() })

      expect(mismo.status).toBe(400)
      expect(otraEmpresa.status).toBe(404)
    })
  })

  it('todas las operaciones del ciclo de vida exigen gestionar proyectos', async () => {
    const { empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const { proyecto } = await crearProyecto(empresa)
    const consulta = await crearEmpleadoConSesion({ nivelAcceso: 'rh_consulta', empresa })

    const peticiones = [
      request(app).patch(`${RUTA}/${proyecto._id}`).send({ nombre: 'Otro nombre' }),
      request(app)
        .post(`${RUTA}/${proyecto._id}/aplazar`)
        .send({ fechaNueva: '2027-12-01', motivo: 'Un motivo suficientemente largo' }),
      request(app)
        .post(`${RUTA}/${proyecto._id}/finalizar`)
        .send({ fechaFinReal: '2027-01-01' }),
      request(app).post(`${RUTA}/${proyecto._id}/reabrir`).send({}),
      request(app)
        .post(`${RUTA}/${proyecto._id}/categorias/clonar`)
        .send({ origenId: new mongoose.Types.ObjectId().toString() })
    ]

    for (const peticion of peticiones) {
      const res = await peticion.set(auth(consulta.token))
      expect(res.status).toBe(403)
    }
  })
})

/**
 * El proyecto referencia un registro patronal de su EMPRESA y un registro de
 * obra de su CLIENTE (D-67). Opcionales en esta fase; obligatorios en la
 * siguiente.
 *
 * La regla que no se puede dejar al front: cada uno tiene que pertenecer a su
 * dueño. Son ramas distintas del modelo —el patronal es de la empresa, el de
 * obra es del cliente— y confundirlas es justo lo que estas pruebas impiden.
 */
describe('registro patronal y registro de obra del proyecto (D-67)', () => {
  /** Empresa con un registro patronal, cliente en cartera con uno de obra. */
  const escenario = async () => {
    const sesion = await crearEmpleadoConSesion({
      nivelAcceso: 'rh_admin',
      alcanceGlobal: true
    })
    const cliente = await crearCliente({ nombre: 'Constructora Del Valle' })
    await agregarACartera(sesion.empresa, cliente)
    const categoria = await crearCategoria('Albañil', 'mano_de_obra')

    const empresa = await Company.findById(sesion.empresa._id)
    empresa.registrosPatronales.push({ numero: 'R13-77767-10-5', descripcion: 'Zapopan' })
    await empresa.save()

    const clienteDoc = await Client.findById(cliente._id)
    clienteDoc.registrosObra.push({
      numero: 'OB-2026-0145',
      descripcion: 'Torre Andares'
    })
    await clienteDoc.save()

    return {
      ...sesion,
      cliente,
      categoria,
      registroPatronalId: empresa.registrosPatronales[0]._id.toString(),
      registroObraId: clienteDoc.registrosObra[0]._id.toString()
    }
  }

  const cuerpo = (e, extra = {}) => ({
    empresaId: e.empresa._id.toString(),
    clienteId: e.cliente._id.toString(),
    nombre: 'Torre Andares',
    fechaInicio: '2026-09-01',
    fechaFinEstimada: '2027-06-30',
    categorias: [e.categoria._id.toString()],
    // Obligatorios desde D-69; las pruebas que prueban su ausencia los quitan.
    registroPatronalId: e.registroPatronalId,
    registroObraId: e.registroObraId,
    ...extra
  })

  it('se crean con ambos, y la respuesta los devuelve RESUELTOS', async () => {
    const e = await escenario()

    const res = await request(app).post(RUTA).set(auth(e.token)).send(cuerpo(e))

    expect(res.status).toBe(201)
    const p = res.body.data.proyecto
    expect(p.registroPatronalId).toBe(e.registroPatronalId)
    expect(p.registroObraId).toBe(e.registroObraId)
    // Resueltos: el número es lo que la pantalla muestra.
    expect(p.registroPatronal).toMatchObject({
      numero: 'R13-77767-10-5',
      descripcion: 'Zapopan'
    })
    expect(p.registroObra).toMatchObject({
      numero: 'OB-2026-0145',
      descripcion: 'Torre Andares'
    })
  })

  it('son OBLIGATORIOS: sin ellos el alta falla (D-69)', async () => {
    const e = await escenario()

    const sinPatronal = await request(app)
      .post(RUTA)
      .set(auth(e.token))
      .send(cuerpo(e, { registroPatronalId: undefined }))
    expect(sinPatronal.status).toBe(400)
    expect(sinPatronal.body.errors[0].path).toBe('registroPatronalId')

    const sinObra = await request(app)
      .post(RUTA)
      .set(auth(e.token))
      .send(cuerpo(e, { registroObraId: undefined }))
    expect(sinObra.status).toBe(400)
    expect(sinObra.body.errors[0].path).toBe('registroObraId')
  })

  it('y no se pueden vaciar después con PATCH', async () => {
    const e = await escenario()
    const alta = await request(app).post(RUTA).set(auth(e.token)).send(cuerpo(e))

    const res = await request(app)
      .patch(`${RUTA}/${alta.body.data.proyecto._id}`)
      .set(auth(e.token))
      .send({ registroPatronalId: null })

    expect(res.status).toBe(400)
  })

  it('400 si el registro patronal es de OTRA empresa', async () => {
    const e = await escenario()
    const otra = await crearEmpresa({ nombre: 'Otra Del Grupo' })
    otra.registrosPatronales.push({ numero: 'Z61-14090-10-9' })
    await otra.save()

    const res = await request(app)
      .post(RUTA)
      .set(auth(e.token))
      .send(cuerpo(e, { registroPatronalId: otra.registrosPatronales[0]._id.toString() }))

    expect(res.status).toBe(400)
    expect(res.body.errors[0].path).toBe('registroPatronalId')
  })

  it('400 si el registro de obra es de OTRO cliente', async () => {
    const e = await escenario()
    const otroCliente = await crearCliente({ nombre: 'Otro Cliente' })
    otroCliente.registrosObra.push({ numero: 'OB-9999' })
    await otroCliente.save()

    const res = await request(app)
      .post(RUTA)
      .set(auth(e.token))
      .send(cuerpo(e, { registroObraId: otroCliente.registrosObra[0]._id.toString() }))

    expect(res.status).toBe(400)
    expect(res.body.errors[0].path).toBe('registroObraId')
  })

  it('400 si el registro está dado de baja', async () => {
    const e = await escenario()
    const empresa = await Company.findById(e.empresa._id)
    empresa.registrosPatronales[0].activo = false
    await empresa.save()

    const res = await request(app).post(RUTA).set(auth(e.token)).send(cuerpo(e))

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('dado de baja')
  })

  it('se pueden CAMBIAR por otro de la misma empresa', async () => {
    const e = await escenario()
    const alta = await request(app).post(RUTA).set(auth(e.token)).send(cuerpo(e))

    const empresa = await Company.findById(e.empresa._id)
    empresa.registrosPatronales.push({ numero: 'H67-29973-10-5' })
    await empresa.save()
    const otro = empresa.registrosPatronales[empresa.registrosPatronales.length - 1]

    const res = await request(app)
      .patch(`${RUTA}/${alta.body.data.proyecto._id}`)
      .set(auth(e.token))
      .send({ registroPatronalId: otro._id.toString() })

    expect(res.status).toBe(200)
    expect(res.body.data.proyecto.registroPatronal.numero).toBe('H67-29973-10-5')
  })

  it('cambiar de cliente EXIGE su registro de obra en la misma petición', async () => {
    const e = await escenario()
    const alta = await request(app).post(RUTA).set(auth(e.token)).send(cuerpo(e))
    const proyectoId = alta.body.data.proyecto._id

    const nuevoCliente = await crearCliente({ nombre: 'Cliente Nuevo' })
    await agregarACartera(e.empresa, nuevoCliente)
    const suRegistro = await crearRegistroObra(nuevoCliente)

    // Sin el registro nuevo: 400, porque el que tiene es del cliente anterior.
    const soloCliente = await request(app)
      .patch(`${RUTA}/${proyectoId}`)
      .set(auth(e.token))
      .send({ clienteId: nuevoCliente._id.toString() })
    expect(soloCliente.status).toBe(400)
    expect(soloCliente.body.errors[0].path).toBe('registroObraId')

    // Con los dos juntos, sí.
    const res = await request(app)
      .patch(`${RUTA}/${proyectoId}`)
      .set(auth(e.token))
      .send({
        clienteId: nuevoCliente._id.toString(),
        registroObraId: suRegistro._id.toString()
      })
    expect(res.status).toBe(200)
    expect(res.body.data.proyecto.registroObra._id).toBe(suRegistro._id.toString())
  })

  it('no se da de baja un registro que un proyecto EN CURSO usa', async () => {
    const e = await escenario()
    await request(app).post(RUTA).set(auth(e.token)).send(cuerpo(e))

    const patronal = await request(app)
      .patch(
        `/api/v1/empresas/${e.empresa._id}/registros-patronales/${e.registroPatronalId}/estado`
      )
      .set(auth(e.token))
      .send({ activo: false })
    expect(patronal.status).toBe(400)
    expect(patronal.body.message).toContain('1 proyecto en curso lo usa')

    const obra = await request(app)
      .patch(
        `/api/v1/clientes/${e.cliente._id}/registros-obra/${e.registroObraId}/estado`
      )
      .set(auth(e.token))
      .send({ activo: false })
    expect(obra.status).toBe(400)
  })

  it('pero sí se da de baja si el proyecto ya se finalizó', async () => {
    const e = await escenario()
    const alta = await request(app).post(RUTA).set(auth(e.token)).send(cuerpo(e))

    const fin = await request(app)
      .post(`${RUTA}/${alta.body.data.proyecto._id}/finalizar`)
      .set(auth(e.token))
      .send({ fechaFinReal: '2026-10-01' })
    expect(fin.status).toBe(200)

    const res = await request(app)
      .patch(
        `/api/v1/empresas/${e.empresa._id}/registros-patronales/${e.registroPatronalId}/estado`
      )
      .set(auth(e.token))
      .send({ activo: false })

    expect(res.status).toBe(200)
  })

  /*
   * El front dedujo esta regla solo, a partir de la nota de D-69, y montó su
   * validación encima: obligatorios al crear, no al editar. Si el backend
   * dejara de cumplirla, un proyecto anterior al cambio se volvería inmodificable
   * incluso para corregirle el nombre.
   */
  it('un proyecto HEREDADO sin registros se sigue editando (D-69)', async () => {
    const e = await escenario()

    // Insercion cruda: es la unica forma de reproducir un documento guardado
    // antes del cambio, porque el alta ya no lo permite.
    const heredado = await Project.collection.insertOne({
      empresaId: e.empresa._id,
      clienteId: e.cliente._id,
      registroPatronalId: null,
      registroObraId: null,
      nombre: 'Proyecto Anterior',
      nombreNormalizado: normalize('Proyecto Anterior'),
      fechaInicio: '2025-01-01',
      fechaFinEstimada: '2025-12-31',
      fechaFinReal: null,
      estado: 'en_curso',
      categorias: [e.categoria._id],
      aplazamientos: [],
      createdAt: new Date(),
      updatedAt: new Date()
    })
    const id = heredado.insertedId.toString()

    const res = await request(app)
      .patch(`${RUTA}/${id}`)
      .set(auth(e.token))
      .send({ nombre: 'Proyecto Anterior Corregido' })

    expect(res.status).toBe(200)
    expect(res.body.data.proyecto.nombre).toBe('Proyecto Anterior Corregido')
    // Y siguen vacios: editar el nombre no los inventa.
    expect(res.body.data.proyecto.registroPatronalId).toBeNull()
    expect(res.body.data.proyecto.registroObra).toBeNull()
  })

  it('pero cambiarle el cliente le sigue exigiendo el registro de obra', async () => {
    const e = await escenario()
    const heredado = await Project.collection.insertOne({
      empresaId: e.empresa._id,
      clienteId: e.cliente._id,
      registroPatronalId: null,
      registroObraId: null,
      nombre: 'Otro Anterior',
      nombreNormalizado: normalize('Otro Anterior'),
      fechaInicio: '2025-01-01',
      fechaFinEstimada: '2025-12-31',
      fechaFinReal: null,
      estado: 'en_curso',
      categorias: [e.categoria._id],
      aplazamientos: [],
      createdAt: new Date(),
      updatedAt: new Date()
    })

    const nuevoCliente = await crearCliente({ nombre: 'Cliente Distinto' })
    await agregarACartera(e.empresa, nuevoCliente)

    const res = await request(app)
      .patch(`${RUTA}/${heredado.insertedId}`)
      .set(auth(e.token))
      .send({ clienteId: nuevoCliente._id.toString() })

    expect(res.status).toBe(400)
    expect(res.body.errors[0].path).toBe('registroObraId')
  })
})
