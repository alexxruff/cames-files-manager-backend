const request = require('supertest')
const app = require('../../src/app')
const Contract = require('../../src/api/v1/contracts/contractModel')
const Assignment = require('../../src/api/v1/assignments/assignmentModel')
const {
  ensureBaseChecklistTemplates
} = require('../../src/services/seedChecklistTemplates')
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
 * El SIROC de la obra, en el expediente de quien trabaja en ella (#11).
 *
 * **Nada de esto se guarda**: la cadena `empleado → asignación → proyecto →
 * contrato → siroc` se resuelve al leer, así que el mismo expediente responde
 * distinto cuando alguien refrenda el aviso o cierra una fase — y `obras` sale
 * de las asignaciones ACTIVAS, no del histórico.
 */
const EXPEDIENTES = '/api/v1/expedientes'
const EMPLEADOS = '/api/v1/empleados'

/** Una fase del proyecto, con su SIROC ya registrado. */
async function crearContrato(proyecto, datos = {}) {
  return Contract.create({
    proyectoId: proyecto._id,
    numero: datos.numero ?? 1,
    nombre: datos.nombre || 'Cimentación',
    fase: datos.fase ?? null,
    fechaInicio: datos.fechaInicio || '2026-01-01',
    fechaFin: datos.fechaFin || '2026-12-31',
    estado: datos.estado || 'en_curso',
    activo: datos.activo ?? true,
    siroc:
      datos.siroc === null
        ? null
        : {
            numero: datos.siroc?.numero || 'SIR-2026-0001',
            fechaRegistro: datos.siroc?.fechaRegistro || '2026-01-01',
            actualizaciones: datos.siroc?.actualizaciones || []
          }
  })
}

async function escenario(datos = {}) {
  await ensureBaseChecklistTemplates()
  const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin', ...datos })
  const categoria = await crearCategoria('Albañil', 'mano_de_obra')
  const { proyecto } = await crearProyecto(sesion.empresa, {
    nombre: 'Torre Poniente',
    fechaInicio: '2026-01-01'
  })

  const persona = await crearEmpleado({
    nombre: 'Roberto Aguilar Sosa',
    tipo: 'mano_de_obra',
    categoriaId: categoria._id
  })
  await adscribir(sesion.empresa, persona, { areas: ['operaciones_urbanizadora'] })

  const expediente = async (token = sesion.token) =>
    request(app).get(`${EMPLEADOS}/${persona._id}/expediente`).set(auth(token))

  return { ...sesion, categoria, proyecto, persona, expediente }
}

describe('El SIROC de su obra, en el expediente', () => {
  beforeAll(() => Assignment.init())

  it('quien no está en ninguna obra responde `obras: []`, no la llave ausente', async () => {
    const { expediente } = await escenario()

    const res = await expediente()

    expect(res.status).toBe(200)
    expect(res.body.data.obras).toEqual([])
  })

  it('trae el SIROC de la obra, con su seguimiento ya calculado', async () => {
    const e = await escenario()
    const contrato = await crearContrato(e.proyecto, {
      siroc: { numero: 'SIR-2026-0777', fechaRegistro: '2026-01-01' }
    })
    await asignar(e.proyecto, e.persona, e.categoria._id)

    const res = await e.expediente()

    expect(res.status).toBe(200)
    expect(res.body.data.obras).toHaveLength(1)

    const obra = res.body.data.obras[0]
    expect(obra.proyecto).toEqual({
      _id: e.proyecto._id.toString(),
      nombre: 'Torre Poniente'
    })
    expect(obra.contrato).toMatchObject({
      _id: contrato._id.toString(),
      numero: 1,
      nombre: 'Cimentación',
      estado: 'en_curso'
    })
    expect(obra.siroc.numero).toBe('SIR-2026-0777')
    // El mismo bloque que ya viaja con el contrato: el front pinta un semáforo.
    expect(obra.seguimientoSiroc).toMatchObject({
      periodoMeses: 2,
      estado: expect.any(String),
      mensaje: expect.any(String)
    })
  })

  it('`GET /expedientes/:id` responde lo mismo que la ruta del empleado', async () => {
    const e = await escenario()
    await crearContrato(e.proyecto)
    await asignar(e.proyecto, e.persona, e.categoria._id)

    const porEmpleado = await e.expediente()
    const porId = await request(app)
      .get(`${EXPEDIENTES}/${porEmpleado.body.data.expediente._id}`)
      .set(auth(e.token))

    expect(porId.status).toBe(200)
    expect(porId.body.data.obras).toEqual(porEmpleado.body.data.obras)
  })

  it('una obra sin contratos con SIROC no aparece', async () => {
    const e = await escenario()
    await crearContrato(e.proyecto, { siroc: null })
    await asignar(e.proyecto, e.persona, e.categoria._id)

    const res = await e.expediente()

    expect(res.body.data.obras).toEqual([])
  })

  it('la asignación cerrada no cuenta: ya no trabaja ahí', async () => {
    const e = await escenario()
    await crearContrato(e.proyecto)
    await asignar(e.proyecto, e.persona, e.categoria._id, {
      activo: false,
      fechaSalida: '2026-10-01'
    })

    const res = await e.expediente()

    expect(res.body.data.obras).toEqual([])
  })

  describe('cuál de las fases', () => {
    it('la que cubre hoy, no la que ya pasó', async () => {
      const e = await escenario()
      await crearContrato(e.proyecto, {
        numero: 1,
        nombre: 'Preliminares',
        fechaInicio: '2020-01-01',
        fechaFin: '2020-06-01',
        estado: 'finalizado',
        siroc: { numero: 'SIR-VIEJO', fechaRegistro: '2020-01-01' }
      })
      await crearContrato(e.proyecto, {
        numero: 2,
        nombre: 'Estructura',
        fechaInicio: '2020-07-01',
        fechaFin: '2099-01-01',
        siroc: { numero: 'SIR-HOY', fechaRegistro: '2026-01-01' }
      })
      await asignar(e.proyecto, e.persona, e.categoria._id)

      const res = await e.expediente()

      expect(res.body.data.obras).toHaveLength(1)
      expect(res.body.data.obras[0].siroc.numero).toBe('SIR-HOY')
      expect(res.body.data.obras[0].vigente).toBe(true)
    })

    it('si ninguna cubre hoy, la última que estuvo activa, con `vigente: false`', async () => {
      const e = await escenario()
      await crearContrato(e.proyecto, {
        numero: 1,
        fechaInicio: '2020-01-01',
        fechaFin: '2020-06-01',
        estado: 'finalizado',
        siroc: { numero: 'SIR-PRIMERO', fechaRegistro: '2020-01-01' }
      })
      await crearContrato(e.proyecto, {
        numero: 2,
        fechaInicio: '2020-07-01',
        fechaFin: '2021-01-01',
        estado: 'finalizado',
        siroc: { numero: 'SIR-ULTIMO', fechaRegistro: '2020-07-01' }
      })
      await asignar(e.proyecto, e.persona, e.categoria._id)

      const res = await e.expediente()

      expect(res.body.data.obras[0].siroc.numero).toBe('SIR-ULTIMO')
      expect(res.body.data.obras[0].vigente).toBe(false)
    })
  })

  /*
   * D-84: el expediente es el otro sitio que avisaba de «SIROC vencido» por una
   * obra que ya terminó y nadie cerró. Como el bloque se deriva al leer, se
   * apagó con la misma regla, pero se fija aquí: era una alarma equivocada en la
   * ficha de una persona.
   */
  describe('una obra terminada y sin cerrar (D-84)', () => {
    it('con el aviso cubriéndola hasta el fin, ya no dice que su SIROC venció', async () => {
      const e = await escenario()
      await crearContrato(e.proyecto, {
        fechaInicio: '2020-01-01',
        fechaFin: '2020-02-15',
        // Nadie la finalizó: la obra se acabó y los papeles se quedaron abiertos.
        estado: 'en_curso',
        siroc: { numero: 'SIR-ABIERTO', fechaRegistro: '2020-01-01' }
      })
      await asignar(e.proyecto, e.persona, e.categoria._id)

      const res = await e.expediente()

      const obra = res.body.data.obras[0]
      expect(obra.vigente).toBe(false)
      expect(obra.seguimientoSiroc).toMatchObject({
        estado: 'no_requiere',
        requiereActualizacion: false,
        actualizacionesPendientes: 0
      })
      expect(obra.seguimientoSiroc.mensaje).toBe(
        'El contrato terminó el 2020-02-15: su SIROC ya no requiere actualizaciones.'
      )
    })

    it('lo que debía antes de terminar lo sigue debiendo, y la cuenta se corta en su fecha de fin', async () => {
      const e = await escenario()
      await crearContrato(e.proyecto, {
        fechaInicio: '2020-01-01',
        fechaFin: '2021-01-01',
        estado: 'en_curso',
        siroc: { numero: 'SIR-CON-DEUDA', fechaRegistro: '2020-01-01' }
      })
      await asignar(e.proyecto, e.persona, e.categoria._id)

      const res = await e.expediente()

      // Un año con el aviso del día 1 y ningún refrendo: cinco, y ni uno más
      // aunque hayan pasado años desde entonces.
      expect(res.body.data.obras[0].seguimientoSiroc).toMatchObject({
        estado: 'vencida',
        actualizacionesRequeridas: 5,
        actualizacionesPendientes: 5
      })
    })
  })

  it('la obra de una empresa que no ve NO aparece, y el expediente sigue respondiendo', async () => {
    const e = await escenario()
    await crearContrato(e.proyecto)
    await asignar(e.proyecto, e.persona, e.categoria._id)

    // Otra empresa, con su obra y su gente: la misma persona, adscrita también allá.
    const otra = await crearEmpresa({ nombre: 'Constructora Ajena' })
    const { proyecto: ajeno } = await crearProyecto(otra, {
      nombre: 'Obra Ajena'
    })
    await crearContrato(ajeno, { siroc: { numero: 'SIR-AJENO' } })
    await adscribir(otra, e.persona, { areas: ['operaciones_urbanizadora'] })
    await asignar(ajeno, e.persona, e.categoria._id)

    // Quien pregunta sólo tiene adscripción en la primera empresa.
    const res = await e.expediente()

    expect(res.status).toBe(200)
    const numeros = res.body.data.obras.map((o) => o.siroc.numero)
    expect(numeros).toContain('SIR-2026-0001')
    expect(numeros).not.toContain('SIR-AJENO')
  })

  it('exige sesión', async () => {
    const e = await escenario()

    const res = await request(app).get(`${EMPLEADOS}/${e.persona._id}/expediente`)

    expect(res.status).toBe(401)
  })
})
