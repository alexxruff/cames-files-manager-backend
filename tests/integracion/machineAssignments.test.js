const request = require('supertest')
const app = require('../../src/app')
const MachineAssignment = require('../../src/api/v1/machineAssignments/machineAssignmentModel')
const Machine = require('../../src/api/v1/machines/machineModel')
const { today } = require('../../src/utils/dates')
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
 * La máquina asignada a un trabajador, y su historia (D-87).
 *
 * Lo que vigilan estas pruebas es la regla del negocio, no la mecánica: **la
 * obra sale de la asignación del trabajador** y no se captura; una máquina está
 * con una sola persona a la vez; y cuando el trabajador se va —de la obra o del
 * sistema— la máquina **pierde a la persona, no la obra**.
 *
 * Las fechas son explícitas siempre que un día cuente: el día de hoy cambia y
 * una prueba que dependa de él falla sola en cuanto pasa el tiempo.
 */
const EMPRESAS = '/api/v1/empresas'
const MAQUINAS = '/api/v1/maquinas'
const PROYECTOS = '/api/v1/proyectos'
const EMPLEADOS = '/api/v1/empleados'
const ASIGNACIONES = '/api/v1/asignaciones'

const INICIO_OBRA = '2026-08-01'
const ENTRADA = '2026-08-05'

async function escenario(datos = {}) {
  const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin', ...datos })
  // Nombre generado: el catálogo de categorías es compartido y dos escenarios
  // en la misma prueba chocarían contra su índice único.
  const categoria = await crearCategoria(undefined, 'mano_de_obra')
  const { proyecto } = await crearProyecto(sesion.empresa, {
    nombre: 'Obra Norte',
    fechaInicio: INICIO_OBRA
  })

  /** Alguien adscrito a la empresa. Sin obra todavía. */
  const crearOperador = async (extra = {}) => {
    const persona = await crearEmpleado({
      tipo: 'mano_de_obra',
      categoriaId: categoria._id,
      ...extra
    })
    await adscribir(sesion.empresa, persona, { areas: ['operaciones_urbanizadora'] })
    return persona
  }

  /** Adscrito Y asignado a una obra: listo para recibir máquinas. */
  const crearOperadorEnObra = async (obra = proyecto, extra = {}) => {
    const persona = await crearOperador(extra)
    const asignacion = await asignar(obra, persona, categoria._id, {
      fechaAsignacion: ENTRADA
    })
    return { persona, asignacion }
  }

  return { ...sesion, categoria, proyecto, crearOperador, crearOperadorEnObra }
}

async function crearMaquina(e, datos = {}) {
  const res = await request(app)
    .post(`${EMPRESAS}/${e.empresa._id}/maquinas`)
    .set(auth(e.token))
    .send({ identificador: 'ECO-12', modelo: 'CAT 320D', ...datos })
  expect(res.status).toBe(201)
  return res.body.data.maquina
}

const asignarMaquina = (e, maquinaId, cuerpo) =>
  request(app).post(`${MAQUINAS}/${maquinaId}/asignacion`).set(auth(e.token)).send(cuerpo)

const devolverMaquina = (e, maquinaId, cuerpo = {}) =>
  request(app).post(`${MAQUINAS}/${maquinaId}/devolucion`).set(auth(e.token)).send(cuerpo)

const historialDe = (e, maquinaId) =>
  request(app).get(`${MAQUINAS}/${maquinaId}/historial`).set(auth(e.token))

describe('La máquina se asigna a un trabajador y va a su obra', () => {
  beforeAll(() => MachineAssignment.init())

  describe('la obra sale del trabajador, no del cuerpo', () => {
    it('con una sola obra no hace falta decir cuál', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)
      const { persona, asignacion } = await e.crearOperadorEnObra()

      const res = await asignarMaquina(e, maquina._id, {
        empleadoId: persona._id.toString(),
        fechaAsignacion: '2026-08-10'
      })

      expect(res.status).toBe(201)
      expect(res.body.data.maquina.asignacion).toMatchObject({
        empleadoId: persona._id.toString(),
        empleadoNombre: persona.nombre,
        proyectoId: e.proyecto._id.toString(),
        proyectoNombre: 'Obra Norte',
        // La trazabilidad: de qué asignación tomó la obra.
        asignacionId: asignacion._id.toString(),
        fechaAsignacion: '2026-08-10',
        fechaDevolucion: null,
        vigente: true
      })
      expect(res.body.data.liberada).toBeNull()
    })

    it('con varias obras pide en cuál va, y dice cuáles son', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)
      const { persona } = await e.crearOperadorEnObra()

      const { proyecto: otra } = await crearProyecto(e.empresa, {
        nombre: 'Obra Sur',
        fechaInicio: INICIO_OBRA
      })
      await asignar(otra, persona, e.categoria._id, { fechaAsignacion: ENTRADA })

      const res = await asignarMaquina(e, maquina._id, {
        empleadoId: persona._id.toString()
      })

      expect(res.status).toBe(400)
      expect(res.body.code).toBe('OBRA_REQUERIDA')
      expect(res.body.errors[0].path).toBe('proyectoId')
      expect(res.body.data.obras).toHaveLength(2)
      expect(res.body.data.obras.map((o) => o.proyectoNombre).sort()).toEqual([
        'Obra Norte',
        'Obra Sur'
      ])
    })

    it('elegida la obra, la máquina se va a ésa', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)
      const { persona } = await e.crearOperadorEnObra()

      const { proyecto: otra } = await crearProyecto(e.empresa, {
        nombre: 'Obra Sur',
        fechaInicio: INICIO_OBRA
      })
      await asignar(otra, persona, e.categoria._id, { fechaAsignacion: ENTRADA })

      const res = await asignarMaquina(e, maquina._id, {
        empleadoId: persona._id.toString(),
        proyectoId: otra._id.toString()
      })

      expect(res.status).toBe(201)
      expect(res.body.data.maquina.asignacion.proyectoNombre).toBe('Obra Sur')
    })

    it('NO puede quedar en una obra donde el trabajador no está', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)
      const { persona } = await e.crearOperadorEnObra()

      // Una obra de la empresa, pero él no está asignado ahí.
      const { proyecto: ajena } = await crearProyecto(e.empresa, {
        nombre: 'Obra Ajena',
        fechaInicio: INICIO_OBRA
      })

      const res = await asignarMaquina(e, maquina._id, {
        empleadoId: persona._id.toString(),
        proyectoId: ajena._id.toString()
      })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/no está asignado a esa obra/i)
      expect(res.body.errors[0].path).toBe('proyectoId')
    })

    it('sin obra no hay dónde poner la máquina', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)
      const suelto = await e.crearOperador()

      const res = await asignarMaquina(e, maquina._id, {
        empleadoId: suelto._id.toString()
      })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/no está asignado a ninguna obra/i)
      expect(res.body.errors[0].path).toBe('empleadoId')
    })

    it('la máquina de una empresa no se va a la obra de otra', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)

      // La misma persona, adscrita y en obra, pero en OTRA empresa.
      const otraEmpresa = await crearEmpresa()
      const persona = await e.crearOperador()
      await adscribir(otraEmpresa, persona, { areas: ['operaciones_urbanizadora'] })
      const { proyecto: obraAjena } = await crearProyecto(otraEmpresa, {
        fechaInicio: INICIO_OBRA
      })
      await asignar(obraAjena, persona, e.categoria._id, { fechaAsignacion: ENTRADA })

      const res = await asignarMaquina(e, maquina._id, {
        empleadoId: persona._id.toString()
      })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/ninguna obra de esta empresa/i)
    })

    it('no se entrega antes de que el trabajador entrara a la obra', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)
      const { persona } = await e.crearOperadorEnObra()

      const res = await asignarMaquina(e, maquina._id, {
        empleadoId: persona._id.toString(),
        fechaAsignacion: '2026-08-01'
      })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(new RegExp(`entró a esa obra el ${ENTRADA}`))
      expect(res.body.errors[0].path).toBe('fechaAsignacion')
    })
  })

  describe('una máquina con una sola persona a la vez', () => {
    it('asignarla a otra la libera de la anterior, y queda registrado', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)
      const primero = await e.crearOperadorEnObra()
      const segundo = await e.crearOperadorEnObra()

      await asignarMaquina(e, maquina._id, {
        empleadoId: primero.persona._id.toString(),
        fechaAsignacion: '2026-08-10'
      })

      const res = await asignarMaquina(e, maquina._id, {
        empleadoId: segundo.persona._id.toString(),
        fechaAsignacion: '2026-08-20'
      })

      expect(res.status).toBe(201)
      expect(res.body.data.maquina.asignacion.empleadoNombre).toBe(segundo.persona.nombre)
      expect(res.body.data.liberada).toMatchObject({
        empleadoNombre: primero.persona.nombre,
        fechaDevolucion: '2026-08-20',
        motivoCierre: 'reasignacion',
        vigente: false,
        // Del 10 al 20, contando los dos extremos.
        dias: 11
      })
      expect(res.body.data.avisos[0]).toContain(primero.persona.nombre)

      // Y en la base queda un solo tramo vigente.
      const vigentes = await MachineAssignment.countDocuments({
        maquinaId: maquina._id,
        activo: true
      })
      expect(vigentes).toBe(1)
    })

    it('una persona sí puede traer varias máquinas', async () => {
      const e = await escenario()
      const una = await crearMaquina(e, { identificador: 'ECO-1' })
      const otra = await crearMaquina(e, { identificador: 'ECO-2' })
      const { persona } = await e.crearOperadorEnObra()

      for (const maquina of [una, otra]) {
        const res = await asignarMaquina(e, maquina._id, {
          empleadoId: persona._id.toString(),
          fechaAsignacion: '2026-08-10'
        })
        expect(res.status).toBe(201)
      }

      const res = await request(app)
        .get(`${EMPLEADOS}/${persona._id}/maquinas`)
        .set(auth(e.token))

      expect(res.status).toBe(200)
      expect(res.body.data.total).toBe(2)
      expect(res.body.data.maquinas.map((m) => m.identificador)).toEqual([
        'ECO-1',
        'ECO-2'
      ])
    })

    it('volver a asignarle la misma máquina a la misma persona es un 409', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)
      const { persona } = await e.crearOperadorEnObra()

      await asignarMaquina(e, maquina._id, { empleadoId: persona._id.toString() })
      const res = await asignarMaquina(e, maquina._id, {
        empleadoId: persona._id.toString()
      })

      expect(res.status).toBe(409)
      expect(res.body.code).toBe('MAQUINA_YA_ASIGNADA')
    })
  })

  describe('la devolución y la baja', () => {
    it('devolver la deja sin asignar y disponible', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)
      const { persona } = await e.crearOperadorEnObra()

      await asignarMaquina(e, maquina._id, {
        empleadoId: persona._id.toString(),
        fechaAsignacion: '2026-08-10'
      })

      const res = await devolverMaquina(e, maquina._id, { fechaDevolucion: '2026-08-19' })

      expect(res.status).toBe(200)
      expect(res.body.data.maquina.asignacion).toBeNull()
      expect(res.body.data.devuelta).toMatchObject({
        motivoCierre: 'devolucion',
        fechaDevolucion: '2026-08-19',
        vigente: false,
        dias: 10
      })

      // Y la ficha lo confirma: en el patio.
      const ficha = await request(app)
        .get(`${MAQUINAS}/${maquina._id}`)
        .set(auth(e.token))
      expect(ficha.body.data.maquina.asignacion).toBeNull()
    })

    it('una máquina que no está asignada no se puede devolver', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)

      const res = await devolverMaquina(e, maquina._id)

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/no está asignada/i)
    })

    it('una máquina de baja no se puede asignar', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)
      const { persona } = await e.crearOperadorEnObra()

      await request(app)
        .patch(`${MAQUINAS}/${maquina._id}/estado`)
        .set(auth(e.token))
        .send({ activo: false })

      const res = await asignarMaquina(e, maquina._id, {
        empleadoId: persona._id.toString()
      })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/dada de baja/i)
    })

    it('dar de baja una máquina asignada la saca de la obra, y lo registra', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)
      const { persona } = await e.crearOperadorEnObra()

      await asignarMaquina(e, maquina._id, {
        empleadoId: persona._id.toString(),
        fechaAsignacion: '2026-08-10'
      })

      const res = await request(app)
        .patch(`${MAQUINAS}/${maquina._id}/estado`)
        .set(auth(e.token))
        .send({ activo: false })

      expect(res.status).toBe(200)
      expect(res.body.data.maquina.asignacion).toBeNull()
      expect(res.body.data.liberada).toMatchObject({
        empleadoNombre: persona.nombre,
        motivoCierre: 'baja_de_maquina'
      })

      // Fuera de servicio: no queda ni en la obra ni con nadie.
      const vigentes = await MachineAssignment.countDocuments({
        maquinaId: maquina._id,
        activo: true
      })
      expect(vigentes).toBe(0)
    })

    it('no se devuelve antes de haber salido a la obra', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)
      const { persona } = await e.crearOperadorEnObra()

      await asignarMaquina(e, maquina._id, {
        empleadoId: persona._id.toString(),
        fechaAsignacion: '2026-08-10'
      })

      const res = await devolverMaquina(e, maquina._id, { fechaDevolucion: '2026-08-09' })

      expect(res.status).toBe(400)
      expect(res.body.errors[0].path).toBe('fechaDevolucion')
    })
  })

  describe('cuando el trabajador se va, la máquina pierde a la persona, no la obra', () => {
    it('al salir de la obra la máquina se queda ahí, sin trabajador', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)
      const { persona, asignacion } = await e.crearOperadorEnObra()

      await asignarMaquina(e, maquina._id, {
        empleadoId: persona._id.toString(),
        fechaAsignacion: '2026-08-10'
      })

      const salida = await request(app)
        .patch(`${ASIGNACIONES}/${asignacion._id}/salida`)
        .set(auth(e.token))
        .send({ fechaSalida: '2026-08-25' })

      expect(salida.status).toBe(200)
      expect(salida.body.data.maquinasLiberadas).toHaveLength(1)
      expect(salida.body.data.maquinasLiberadas[0]).toMatchObject({
        identificador: 'ECO-12',
        proyectoNombre: 'Obra Norte',
        motivo: 'salida_de_obra'
      })
      expect(salida.body.message).toMatch(/sin trabajador/i)

      // Sigue en su obra, sin operador.
      const ficha = await request(app)
        .get(`${MAQUINAS}/${maquina._id}`)
        .set(auth(e.token))
      expect(ficha.body.data.maquina.asignacion).toMatchObject({
        empleadoId: null,
        empleadoNombre: null,
        proyectoNombre: 'Obra Norte',
        fechaAsignacion: '2026-08-25',
        vigente: true
      })
    })

    it('la baja del trabajador hace lo mismo: la máquina se queda en la obra', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)
      const { persona } = await e.crearOperadorEnObra()

      await asignarMaquina(e, maquina._id, {
        empleadoId: persona._id.toString(),
        fechaAsignacion: '2026-08-10'
      })

      const baja = await request(app)
        .patch(`${EMPLEADOS}/${persona._id}/estado`)
        .set(auth(e.token))
        .send({ activo: false, motivo: 'Renuncia voluntaria', fecha: '2026-08-30' })

      expect(baja.status).toBe(200)
      expect(baja.body.data.maquinasLiberadas).toHaveLength(1)
      expect(baja.body.data.maquinasLiberadas[0].motivo).toBe('baja_de_trabajador')
      expect(baja.body.message).toMatch(/sin trabajador/i)

      const ficha = await request(app)
        .get(`${MAQUINAS}/${maquina._id}`)
        .set(auth(e.token))
      expect(ficha.body.data.maquina.asignacion).toMatchObject({
        empleadoId: null,
        proyectoNombre: 'Obra Norte',
        fechaAsignacion: '2026-08-30'
      })
    })

    it('la máquina sin trabajador se puede reasignar en la misma obra', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)
      const primero = await e.crearOperadorEnObra()
      const segundo = await e.crearOperadorEnObra()

      await asignarMaquina(e, maquina._id, {
        empleadoId: primero.persona._id.toString(),
        fechaAsignacion: '2026-08-10'
      })
      await request(app)
        .patch(`${ASIGNACIONES}/${primero.asignacion._id}/salida`)
        .set(auth(e.token))
        .send({ fechaSalida: '2026-08-25' })

      const res = await asignarMaquina(e, maquina._id, {
        empleadoId: segundo.persona._id.toString(),
        fechaAsignacion: '2026-08-26'
      })

      expect(res.status).toBe(201)
      expect(res.body.data.maquina.asignacion.empleadoNombre).toBe(segundo.persona.nombre)
      // El aviso dice la verdad: no se le quitó a nadie, estaba sin trabajador.
      expect(res.body.data.avisos[0]).toMatch(/sin trabajador/i)
    })
  })

  describe('la historia de la máquina', () => {
    it('trae cada tramo con su obra, sus fechas y sus días, y el acumulado', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)
      const primero = await e.crearOperadorEnObra()
      const segundo = await e.crearOperadorEnObra()

      await asignarMaquina(e, maquina._id, {
        empleadoId: primero.persona._id.toString(),
        fechaAsignacion: '2026-08-06'
      })
      await asignarMaquina(e, maquina._id, {
        empleadoId: segundo.persona._id.toString(),
        fechaAsignacion: '2026-08-11'
      })
      await devolverMaquina(e, maquina._id, { fechaDevolucion: '2026-08-20' })
      await asignarMaquina(e, maquina._id, {
        empleadoId: primero.persona._id.toString(),
        fechaAsignacion: '2026-08-21'
      })

      const res = await historialDe(e, maquina._id)

      expect(res.status).toBe(200)
      expect(res.body.data.total).toBe(3)
      expect(res.body.data.maquina).toMatchObject({
        identificador: 'ECO-12',
        modelo: 'CAT 320D'
      })

      // El vigente primero: viene ordenado de lo más reciente a lo más viejo.
      const [vigente, devuelto, reasignado] = res.body.data.tramos
      expect(vigente).toMatchObject({
        empleadoNombre: primero.persona.nombre,
        fechaAsignacion: '2026-08-21',
        fechaDevolucion: null,
        vigente: true
      })
      expect(devuelto).toMatchObject({
        empleadoNombre: segundo.persona.nombre,
        fechaAsignacion: '2026-08-11',
        fechaDevolucion: '2026-08-20',
        motivoCierre: 'devolucion',
        dias: 10
      })
      expect(reasignado).toMatchObject({
        empleadoNombre: primero.persona.nombre,
        fechaAsignacion: '2026-08-06',
        fechaDevolucion: '2026-08-11',
        motivoCierre: 'reasignacion',
        // Del 6 al 11: el día del cambio de manos lo cuentan los dos.
        dias: 6
      })

      // El tramo vigente cuenta hasta hoy, sin que nadie lo cierre.
      const diasVigentes = vigente.dias
      expect(diasVigentes).toBeGreaterThan(0)

      expect(res.body.data.actual._id).toBe(vigente._id)
      expect(res.body.data.porTrabajador[0]).toMatchObject({
        empleadoId: primero.persona._id.toString(),
        tramos: 2,
        dias: 6 + diasVigentes
      })
      expect(res.body.data.porTrabajador[1]).toMatchObject({
        empleadoId: segundo.persona._id.toString(),
        tramos: 1,
        dias: 10
      })
    })

    it('el tramo vigente cuenta hasta hoy', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)
      const { persona } = await e.crearOperadorEnObra()

      await asignarMaquina(e, maquina._id, {
        empleadoId: persona._id.toString(),
        fechaAsignacion: today()
      })

      const res = await historialDe(e, maquina._id)
      expect(res.body.data.actual.dias).toBe(1)
    })

    it('una máquina que nunca salió tiene historia vacía', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)

      const res = await historialDe(e, maquina._id)

      expect(res.status).toBe(200)
      expect(res.body.data).toMatchObject({ total: 0, tramos: [], porTrabajador: [] })
      expect(res.body.data.actual).toBeNull()
    })
  })

  describe('desde la obra y desde el trabajador', () => {
    it('la obra dice qué máquinas hay y con quién', async () => {
      const e = await escenario()
      const diez = await crearMaquina(e, { identificador: 'ECO-10' })
      const dos = await crearMaquina(e, { identificador: 'ECO-2' })
      const sinSalir = await crearMaquina(e, { identificador: 'ECO-99' })
      const { persona } = await e.crearOperadorEnObra()

      for (const maquina of [diez, dos]) {
        await asignarMaquina(e, maquina._id, {
          empleadoId: persona._id.toString(),
          fechaAsignacion: '2026-08-10'
        })
      }

      const res = await request(app)
        .get(`${PROYECTOS}/${e.proyecto._id}/maquinas`)
        .set(auth(e.token))

      expect(res.status).toBe(200)
      expect(res.body.data.total).toBe(2)
      // Orden natural: ECO-2 antes que ECO-10.
      expect(res.body.data.maquinas.map((m) => m.identificador)).toEqual([
        'ECO-2',
        'ECO-10'
      ])
      expect(res.body.data.maquinas[0].asignacion.empleadoNombre).toBe(persona.nombre)
      // La que nunca salió no está en ninguna obra.
      expect(res.body.data.maquinas.map((m) => m._id)).not.toContain(sinSalir._id)
    })

    it('el catálogo de la empresa dice quién tiene cada máquina', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)
      const libre = await crearMaquina(e, { identificador: 'ECO-99' })
      const { persona } = await e.crearOperadorEnObra()

      await asignarMaquina(e, maquina._id, {
        empleadoId: persona._id.toString(),
        fechaAsignacion: '2026-08-10'
      })

      const res = await request(app)
        .get(`${EMPRESAS}/${e.empresa._id}/maquinas`)
        .set(auth(e.token))

      const porId = Object.fromEntries(res.body.data.maquinas.map((m) => [m._id, m]))
      expect(porId[maquina._id].asignacion).toMatchObject({
        empleadoNombre: persona.nombre,
        proyectoNombre: 'Obra Norte'
      })
      // Disponible: en el patio.
      expect(porId[libre._id].asignacion).toBeNull()
    })
  })

  describe('permisos y alcance', () => {
    it('sin sesión, 401', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)

      const res = await request(app)
        .post(`${MAQUINAS}/${maquina._id}/asignacion`)
        .send({})
      expect(res.status).toBe(401)
    })

    it('rh_consulta puede ver la historia pero no asignar', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)
      const { persona } = await e.crearOperadorEnObra()

      const consulta = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_consulta',
        empresa: e.empresa,
        areas: ['operaciones_urbanizadora']
      })

      const lectura = await historialDe(consulta, maquina._id)
      expect(lectura.status).toBe(200)

      const escritura = await asignarMaquina(consulta, maquina._id, {
        empleadoId: persona._id.toString()
      })
      expect(escritura.status).toBe(403)
    })

    it('una máquina de otra empresa no existe: 404, no 403', async () => {
      const e = await escenario()
      const ajena = await escenario()
      const maquina = await crearMaquina(ajena)
      const { persona } = await e.crearOperadorEnObra()

      const asignacion = await asignarMaquina(e, maquina._id, {
        empleadoId: persona._id.toString()
      })
      expect(asignacion.status).toBe(404)
      expect(asignacion.body.message).toMatch(/La máquina no existe/)

      const historial = await historialDe(e, maquina._id)
      expect(historial.status).toBe(404)

      const devolucion = await devolverMaquina(e, maquina._id)
      expect(devolucion.status).toBe(404)
    })

    it('la obra de otra empresa tampoco existe', async () => {
      const e = await escenario()
      const ajena = await escenario()

      const res = await request(app)
        .get(`${PROYECTOS}/${ajena.proyecto._id}/maquinas`)
        .set(auth(e.token))

      expect(res.status).toBe(404)
      expect(res.body.message).toMatch(/El proyecto no existe/)
    })

    it('las máquinas de alguien de otra empresa tampoco', async () => {
      const e = await escenario()
      const ajena = await escenario()
      const { persona } = await ajena.crearOperadorEnObra()

      const res = await request(app)
        .get(`${EMPLEADOS}/${persona._id}/maquinas`)
        .set(auth(e.token))

      expect(res.status).toBe(404)
      expect(res.body.message).toMatch(/El empleado no existe/)
    })

    it('un id mal formado es 400, no 500', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)

      const res = await asignarMaquina(e, maquina._id, { empleadoId: 'no-es-un-id' })
      expect(res.status).toBe(400)
      expect(res.body.errors[0].path).toBe('empleadoId')
    })

    it('sin empleado no hay asignación', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)

      const res = await asignarMaquina(e, maquina._id, {})
      expect(res.status).toBe(400)
      expect(res.body.errors[0].msg).toMatch(/empleado es requerido/i)
    })
  })

  describe('nada de esto vive en la máquina', () => {
    it('la colección de máquinas no guarda ni empleado ni proyecto', async () => {
      const e = await escenario()
      const maquina = await crearMaquina(e)
      const { persona } = await e.crearOperadorEnObra()

      await asignarMaquina(e, maquina._id, { empleadoId: persona._id.toString() })

      /*
       * Regla #6: nada derivado en la base. Dónde está la máquina se resuelve al
       * leer, cruzando su tramo vigente; si alguien "simplifica" esto metiendo
       * los ids en la máquina, habrá dos verdades y una se quedará vieja.
       */
      const doc = await Machine.findById(maquina._id).lean()
      expect(doc.empleadoId).toBeUndefined()
      expect(doc.proyectoId).toBeUndefined()
      expect(doc.asignacion).toBeUndefined()
    })
  })
})
