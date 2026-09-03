const request = require('supertest')
const app = require('../../src/app')
const Machine = require('../../src/api/v1/machines/machineModel')
const IncidentType = require('../../src/api/v1/incidentTypes/incidentTypeModel')
const MachineIncident = require('../../src/api/v1/machineIncidents/machineIncidentModel')
const { today, addDays } = require('../../src/utils/dates')
const {
  crearEmpresa,
  crearCategoria,
  crearEmpleado,
  crearEmpleadoConSesion,
  adscribir,
  crearProyecto,
  asignar,
  auth
} = require('../helpers/factories')

/**
 * Las incidencias de una máquina (D-88).
 *
 * Lo que vigilan estas pruebas es que **el trabajador y la obra de ese momento
 * no se teclean**: salen de la historia de asignaciones cruzada con la fecha en
 * que sucedió. Una incidencia capturada hoy sobre algo que pasó hace un mes
 * tiene que decir quién la tenía HACE UN MES, no quién la trae ahora.
 */
const EMPRESAS = '/api/v1/empresas'
const MAQUINAS = '/api/v1/maquinas'
const INCIDENCIAS = '/api/v1/incidencias'
const TIPOS = '/api/v1/tipos-incidencia'

const INICIO_OBRA = '2026-08-01'
const CON_JUAN = '2026-08-01'
const CON_PEDRO = '2026-08-10'

async function escenario() {
  const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
  const categoria = await crearCategoria(undefined, 'mano_de_obra')
  const { proyecto } = await crearProyecto(sesion.empresa, {
    nombre: 'Obra Norte',
    fechaInicio: INICIO_OBRA
  })

  const crearOperadorEnObra = async (nombre) => {
    const persona = await crearEmpleado({
      nombre,
      tipo: 'mano_de_obra',
      categoriaId: categoria._id
    })
    await adscribir(sesion.empresa, persona, { areas: ['operaciones_urbanizadora'] })
    await asignar(proyecto, persona, categoria._id, { fechaAsignacion: INICIO_OBRA })
    return persona
  }

  const maquina = await crearMaquina(sesion)
  const tipo = await crearTipo(sesion, 'Falla hidráulica')

  return { ...sesion, categoria, proyecto, crearOperadorEnObra, maquina, tipo }
}

async function crearMaquina(e, datos = {}) {
  const res = await request(app)
    .post(`${EMPRESAS}/${e.empresa._id}/maquinas`)
    .set(auth(e.token))
    .send({ identificador: 'ECO-12', modelo: 'CAT 320D', ...datos })
  expect(res.status).toBe(201)
  return res.body.data.maquina
}

async function crearTipo(e, nombre) {
  const res = await request(app).post(TIPOS).set(auth(e.token)).send({ nombre })
  expect([200, 201]).toContain(res.status)
  return res.body.data.tipo
}

const asignarMaquina = (e, maquinaId, cuerpo) =>
  request(app).post(`${MAQUINAS}/${maquinaId}/asignacion`).set(auth(e.token)).send(cuerpo)

const levantar = (e, maquinaId, cuerpo) =>
  request(app)
    .post(`${MAQUINAS}/${maquinaId}/incidencias`)
    .set(auth(e.token))
    .send(cuerpo)

const listar = (e, maquinaId, query = '') =>
  request(app).get(`${MAQUINAS}/${maquinaId}/incidencias${query}`).set(auth(e.token))

const resolver = (e, incidenciaId, cuerpo = {}) =>
  request(app)
    .post(`${INCIDENCIAS}/${incidenciaId}/resolucion`)
    .set(auth(e.token))
    .send(cuerpo)

describe('Incidencias de la máquina', () => {
  beforeAll(async () => {
    await Machine.init()
    await IncidentType.init()
    await MachineIncident.init()
  })

  describe('levantar una', () => {
    it('la registra con su tipo y dice quién tenía la máquina ese día', async () => {
      const e = await escenario()
      const juan = await e.crearOperadorEnObra('Juan Pérez')
      await asignarMaquina(e, e.maquina._id, {
        empleadoId: juan._id.toString(),
        fechaAsignacion: CON_JUAN
      })

      const res = await levantar(e, e.maquina._id, {
        tipoId: e.tipo._id,
        descripcion: 'Botó aceite por la manguera del cilindro',
        fechaIncidencia: '2026-08-05'
      })

      expect(res.status).toBe(201)
      expect(res.body.data.incidencia).toMatchObject({
        descripcion: 'Botó aceite por la manguera del cilindro',
        fechaIncidencia: '2026-08-05',
        fechaResolucion: null,
        notaResolucion: null,
        abierta: true,
        tipo: { _id: e.tipo._id, nombre: 'Falla hidráulica', activo: true }
      })
      expect(res.body.data.incidencia.contexto).toMatchObject({
        sinAsignar: false,
        empleadoId: juan._id.toString(),
        empleadoNombre: 'Juan Pérez',
        proyectoId: e.proyecto._id.toString(),
        proyectoNombre: 'Obra Norte',
        texto: 'Juan Pérez · Obra Norte'
      })
    })

    it('la fecha manda: una de días atrás señala a quien la tenía ENTONCES', async () => {
      const e = await escenario()
      const juan = await e.crearOperadorEnObra('Juan Pérez')
      const pedro = await e.crearOperadorEnObra('Pedro Ruiz')

      await asignarMaquina(e, e.maquina._id, {
        empleadoId: juan._id.toString(),
        fechaAsignacion: CON_JUAN
      })
      await asignarMaquina(e, e.maquina._id, {
        empleadoId: pedro._id.toString(),
        fechaAsignacion: CON_PEDRO
      })

      // Hoy la trae Pedro, pero esto pasó cuando la traía Juan.
      const vieja = await levantar(e, e.maquina._id, {
        tipoId: e.tipo._id,
        descripcion: 'Se le rompió el vidrio',
        fechaIncidencia: '2026-08-04'
      })
      const reciente = await levantar(e, e.maquina._id, {
        tipoId: e.tipo._id,
        descripcion: 'No enciende',
        fechaIncidencia: '2026-08-20'
      })

      expect(vieja.body.data.incidencia.contexto.empleadoNombre).toBe('Juan Pérez')
      expect(reciente.body.data.incidencia.contexto.empleadoNombre).toBe('Pedro Ruiz')
    })

    it('si la máquina estaba en el patio, lo dice', async () => {
      const e = await escenario()

      const res = await levantar(e, e.maquina._id, {
        tipoId: e.tipo._id,
        descripcion: 'Apareció rayada en el patio',
        fechaIncidencia: '2026-08-05'
      })

      expect(res.body.data.incidencia.contexto).toMatchObject({
        sinAsignar: true,
        empleadoId: null,
        proyectoId: null,
        texto: 'Sin asignar: la máquina estaba en el patio'
      })
    })

    it('sin fecha, es de hoy', async () => {
      const e = await escenario()

      const res = await levantar(e, e.maquina._id, {
        tipoId: e.tipo._id,
        descripcion: 'Fuga de aceite'
      })

      expect(res.body.data.incidencia.fechaIncidencia).toBe(today())
      expect(res.body.data.incidencia.dias).toBe(1)
    })

    it('una fecha del futuro se rechaza con 400', async () => {
      const e = await escenario()

      const res = await levantar(e, e.maquina._id, {
        tipoId: e.tipo._id,
        descripcion: 'Fuga de aceite',
        fechaIncidencia: addDays(today(), 1)
      })

      expect(res.status).toBe(400)
      expect(res.body.errors[0]).toMatchObject({ path: 'fechaIncidencia' })
      expect(res.body.message).toBe('La fecha no puede ser del futuro')
    })

    it('un tipo dado de baja no se ofrece para incidencias nuevas', async () => {
      const e = await escenario()
      await request(app)
        .patch(`${TIPOS}/${e.tipo._id}/estado`)
        .set(auth(e.token))
        .send({ activo: false })

      const res = await levantar(e, e.maquina._id, {
        tipoId: e.tipo._id,
        descripcion: 'Fuga de aceite'
      })

      expect(res.status).toBe(400)
      expect(res.body.errors[0].path).toBe('tipoId')
      expect(res.body.message).toMatch(/está dado de baja/)
    })

    it('pero las viejas lo conservan', async () => {
      const e = await escenario()
      const levantada = await levantar(e, e.maquina._id, {
        tipoId: e.tipo._id,
        descripcion: 'Fuga de aceite',
        fechaIncidencia: '2026-08-05'
      })

      await request(app)
        .patch(`${TIPOS}/${e.tipo._id}/estado`)
        .set(auth(e.token))
        .send({ activo: false })

      const res = await listar(e, e.maquina._id)
      const [incidencia] = res.body.data.incidencias

      expect(incidencia._id).toBe(levantada.body.data.incidencia._id)
      expect(incidencia.tipo).toMatchObject({
        nombre: 'Falla hidráulica',
        // Con `activo: false`, para que la pantalla lo pueda señalar.
        activo: false
      })
    })

    it('renombrar el tipo corrige el nombre en las incidencias viejas', async () => {
      const e = await escenario()
      await levantar(e, e.maquina._id, {
        tipoId: e.tipo._id,
        descripcion: 'Fuga de aceite',
        fechaIncidencia: '2026-08-05'
      })

      await request(app)
        .patch(`${TIPOS}/${e.tipo._id}`)
        .set(auth(e.token))
        .send({ nombre: 'Falla hidráulica (mangueras)' })

      const res = await listar(e, e.maquina._id)
      expect(res.body.data.incidencias[0].tipo.nombre).toBe(
        'Falla hidráulica (mangueras)'
      )
    })

    it('sin descripción, 400 en español', async () => {
      const e = await escenario()

      const res = await levantar(e, e.maquina._id, { tipoId: e.tipo._id })

      expect(res.status).toBe(400)
      expect(res.body.errors[0].msg).toBe('La descripción de la incidencia es requerida')
    })

    it('se puede levantar sobre una máquina dada de baja: suele ser el motivo', async () => {
      const e = await escenario()
      await request(app)
        .patch(`${MAQUINAS}/${e.maquina._id}/estado`)
        .set(auth(e.token))
        .send({ activo: false })

      const res = await levantar(e, e.maquina._id, {
        tipoId: e.tipo._id,
        descripcion: 'Se fundió el motor: por eso se dio de baja',
        fechaIncidencia: '2026-08-05'
      })

      expect(res.status).toBe(201)
    })
  })

  describe('resolver', () => {
    it('la cierra con su fecha y su nota', async () => {
      const e = await escenario()
      const { body } = await levantar(e, e.maquina._id, {
        tipoId: e.tipo._id,
        descripcion: 'Fuga de aceite',
        fechaIncidencia: '2026-08-05'
      })

      const res = await resolver(e, body.data.incidencia._id, {
        fechaResolucion: '2026-08-07',
        notaResolucion: 'Se cambió la manguera'
      })

      expect(res.status).toBe(200)
      expect(res.body.data.incidencia).toMatchObject({
        abierta: false,
        fechaResolucion: '2026-08-07',
        notaResolucion: 'Se cambió la manguera',
        // Días naturales e inclusivos, como los tramos: del 5 al 7 son 3.
        dias: 3
      })
    })

    it('la nota es opcional y sin fecha se cierra hoy', async () => {
      const e = await escenario()
      const { body } = await levantar(e, e.maquina._id, {
        tipoId: e.tipo._id,
        descripcion: 'Fuga de aceite',
        fechaIncidencia: '2026-08-05'
      })

      const res = await resolver(e, body.data.incidencia._id)

      expect(res.status).toBe(200)
      expect(res.body.data.incidencia).toMatchObject({
        abierta: false,
        fechaResolucion: today(),
        notaResolucion: null
      })
    })

    it('no se resuelve antes de que pasara', async () => {
      const e = await escenario()
      const { body } = await levantar(e, e.maquina._id, {
        tipoId: e.tipo._id,
        descripcion: 'Fuga de aceite',
        fechaIncidencia: '2026-08-05'
      })

      const res = await resolver(e, body.data.incidencia._id, {
        fechaResolucion: '2026-08-01'
      })

      expect(res.status).toBe(400)
      expect(res.body.errors[0].path).toBe('fechaResolucion')
      expect(res.body.message).toMatch(/sucedió el 2026-08-05/)
    })

    it('una ya resuelta no se vuelve a resolver: 409 con la fecha que tiene', async () => {
      const e = await escenario()
      const { body } = await levantar(e, e.maquina._id, {
        tipoId: e.tipo._id,
        descripcion: 'Fuga de aceite',
        fechaIncidencia: '2026-08-05'
      })
      await resolver(e, body.data.incidencia._id, { fechaResolucion: '2026-08-07' })

      const res = await resolver(e, body.data.incidencia._id)

      expect(res.status).toBe(409)
      expect(res.body.code).toBe('INCIDENCIA_YA_RESUELTA')
      expect(res.body.message).toMatch(/ya se resolvió el 2026-08-07/)
    })

    it('404 si la incidencia no existe', async () => {
      const e = await escenario()

      const res = await resolver(e, '64b7f1a2c3d4e5f6a7b8c9d0')

      expect(res.status).toBe(404)
      expect(res.body.message).toBe('La incidencia no existe')
    })
  })

  describe('listado', () => {
    it('van por fecha, de la más reciente a la más vieja, con los contadores', async () => {
      const e = await escenario()
      for (const fecha of ['2026-08-05', '2026-08-20', '2026-08-12']) {
        await levantar(e, e.maquina._id, {
          tipoId: e.tipo._id,
          descripcion: `Lo del ${fecha}`,
          fechaIncidencia: fecha
        })
      }
      const { body } = await listar(e, e.maquina._id)
      await resolver(e, body.data.incidencias[0]._id, { fechaResolucion: '2026-08-21' })

      const res = await listar(e, e.maquina._id)

      expect(res.status).toBe(200)
      expect(res.body.data.incidencias.map((i) => i.fechaIncidencia)).toEqual([
        '2026-08-20',
        '2026-08-12',
        '2026-08-05'
      ])
      expect(res.body.data).toMatchObject({
        estado: 'todas',
        total: 3,
        abiertas: 2,
        resueltas: 1
      })
      expect(res.body.data.maquina).toMatchObject({
        _id: e.maquina._id,
        identificador: 'ECO-12',
        modelo: 'CAT 320D'
      })
    })

    it('se pueden pedir sólo las abiertas, y los contadores siguen completos', async () => {
      const e = await escenario()
      const abierta = await levantar(e, e.maquina._id, {
        tipoId: e.tipo._id,
        descripcion: 'Sigue abierta',
        fechaIncidencia: '2026-08-05'
      })
      const cerrada = await levantar(e, e.maquina._id, {
        tipoId: e.tipo._id,
        descripcion: 'Ya se atendió',
        fechaIncidencia: '2026-08-06'
      })
      await resolver(e, cerrada.body.data.incidencia._id, {
        fechaResolucion: '2026-08-07'
      })

      const soloAbiertas = await listar(e, e.maquina._id, '?estado=abiertas')
      const soloResueltas = await listar(e, e.maquina._id, '?estado=resueltas')

      expect(soloAbiertas.body.data.incidencias.map((i) => i._id)).toEqual([
        abierta.body.data.incidencia._id
      ])
      expect(soloAbiertas.body.data).toMatchObject({
        total: 1,
        abiertas: 1,
        resueltas: 1
      })
      expect(soloResueltas.body.data.incidencias.map((i) => i._id)).toEqual([
        cerrada.body.data.incidencia._id
      ])
    })

    it('un estado que no existe se rechaza con 400', async () => {
      const e = await escenario()

      const res = await listar(e, e.maquina._id, '?estado=pendientes')

      expect(res.status).toBe(400)
      expect(res.body.errors[0].msg).toBe('estado debe ser abiertas, resueltas o todas')
    })
  })

  describe('permisos y alcance', () => {
    it('quien no gestiona proyectos consulta pero no levanta ni resuelve', async () => {
      const e = await escenario()
      const { body } = await levantar(e, e.maquina._id, {
        tipoId: e.tipo._id,
        descripcion: 'Fuga de aceite',
        fechaIncidencia: '2026-08-05'
      })
      const consulta = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_consulta',
        empresa: e.empresa
      })

      expect((await listar(consulta, e.maquina._id)).status).toBe(200)
      expect(
        (
          await levantar(consulta, e.maquina._id, {
            tipoId: e.tipo._id,
            descripcion: 'Otra cosa'
          })
        ).status
      ).toBe(403)
      expect((await resolver(consulta, body.data.incidencia._id)).status).toBe(403)
    })

    it('fuera de alcance, 404 y no 403', async () => {
      const e = await escenario()
      const { body } = await levantar(e, e.maquina._id, {
        tipoId: e.tipo._id,
        descripcion: 'Fuga de aceite',
        fechaIncidencia: '2026-08-05'
      })

      // Alguien de OTRA empresa: para él, esa máquina no existe.
      const otra = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_admin',
        empresa: await crearEmpresa()
      })

      expect((await listar(otra, e.maquina._id)).status).toBe(404)
      expect(
        (
          await levantar(otra, e.maquina._id, {
            tipoId: e.tipo._id,
            descripcion: 'Otra cosa'
          })
        ).status
      ).toBe(404)

      const resolucion = await resolver(otra, body.data.incidencia._id)
      expect(resolucion.status).toBe(404)
      expect(resolucion.body.message).toBe('La incidencia no existe')
    })

    it('sin sesión, 401', async () => {
      const e = await escenario()

      expect(
        (await request(app).get(`${MAQUINAS}/${e.maquina._id}/incidencias`)).status
      ).toBe(401)
      expect(
        (await request(app).post(`${MAQUINAS}/${e.maquina._id}/incidencias`).send({}))
          .status
      ).toBe(401)
    })
  })
})
