const request = require('supertest')
const app = require('../../src/app')
const Contract = require('../../src/api/v1/contracts/contractModel')
const Project = require('../../src/api/v1/projects/projectModel')
const {
  crearEmpresa,
  crearEmpleadoConSesion,
  crearProyecto,
  crearRegistroPatronal,
  crearRegistroObra,
  crearCliente,
  agregarACartera,
  auth
} = require('../helpers/factories')

const PROYECTOS = '/api/v1/proyectos'
const CONTRATOS = '/api/v1/contratos'

/**
 * Contratos y SIROC (D-70).
 *
 * Contrato y fase son la misma entidad (G1). El SIROC va embebido y es único en
 * todo el sistema (G4). Y los candados de G3 viven en el proyecto: lo que se
 * puede cambiar en él depende de si ya cuelgan contratos.
 */
async function escenario(datos = {}) {
  const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin', ...datos })
  const { proyecto, cliente, registroPatronal, registroObra } = await crearProyecto(
    sesion.empresa
  )
  return { ...sesion, proyecto, cliente, registroPatronal, registroObra }
}

const cuerpo = (extra = {}) => ({
  nombre: 'Cimentación',
  fechaInicio: '2026-09-01',
  fechaFin: '2026-12-31',
  ...extra
})

const crear = (e, extra = {}) =>
  request(app)
    .post(`${PROYECTOS}/${e.proyecto._id}/contratos`)
    .set(auth(e.token))
    .send(cuerpo(extra))

const SIROC = { numero: 'SIR-2026-0001', fechaRegistro: '2026-09-05' }

describe('Contratos de un proyecto', () => {
  describe('alta y listado', () => {
    it('se crea con el número que asigna el SERVIDOR, no el cliente', async () => {
      const e = await escenario()

      const primero = await crear(e)
      expect(primero.status).toBe(201)
      expect(primero.body.data.contrato).toMatchObject({
        proyectoId: e.proyecto._id.toString(),
        numero: 1,
        nombre: 'Cimentación',
        fase: null,
        fechaInicio: '2026-09-01',
        fechaFin: '2026-12-31',
        siroc: null,
        estado: 'en_curso',
        activo: true
      })

      // Aunque manden uno, el servidor pone el siguiente de la secuencia.
      const segundo = await crear(e, { nombre: 'Estructura', numero: 99 })
      expect(segundo.status).toBe(201)
      expect(segundo.body.data.contrato.numero).toBe(2)
    })

    it('el nombre es opcional: un proyecto de un contrato no tiene fases', async () => {
      const e = await escenario()

      const res = await crear(e, { nombre: undefined })

      expect(res.status).toBe(201)
      expect(res.body.data.contrato.nombre).toBeNull()
    })

    it('el nombre vacío se guarda como null, nunca como cadena vacía', async () => {
      const e = await escenario()

      const res = await crear(e, { nombre: '' })

      expect(res.status).toBe(201)
      expect(res.body.data.contrato.nombre).toBeNull()
    })

    it('los lista por número y esconde los dados de baja salvo que se pidan', async () => {
      const e = await escenario()
      await crear(e, { nombre: 'Uno' })
      const dos = await crear(e, { nombre: 'Dos' })

      await request(app)
        .patch(`${CONTRATOS}/${dos.body.data.contrato._id}/estado`)
        .set(auth(e.token))
        .send({ activo: false })

      const visibles = await request(app)
        .get(`${PROYECTOS}/${e.proyecto._id}/contratos`)
        .set(auth(e.token))
      expect(visibles.status).toBe(200)
      expect(visibles.body.data.contratos).toHaveLength(1)
      expect(visibles.body.data.contratos[0].nombre).toBe('Uno')

      const todos = await request(app)
        .get(`${PROYECTOS}/${e.proyecto._id}/contratos?incluirInactivos=true`)
        .set(auth(e.token))
      expect(todos.body.data.contratos.map((c) => c.numero)).toEqual([1, 2])
    })

    it('400 si la fecha de fin es anterior a la de inicio', async () => {
      const e = await escenario()

      const res = await crear(e, { fechaInicio: '2026-12-01', fechaFin: '2026-09-01' })

      expect(res.status).toBe(400)
      expect(res.body.errors[0].msg).toMatch(/anterior a la de inicio/i)
    })

    /*
     * D-85: las fechas del contrato caen dentro de las del proyecto —del inicio
     * al fin real o, si no lo tiene, al estimado—. El de las fábricas va del 1
     * sep 2026 al 1 mar 2027.
     */
    describe('las fechas caen dentro de las del proyecto (D-85)', () => {
      it('400 si empieza antes que el proyecto, y dice desde cuándo sí', async () => {
        const e = await escenario()

        const res = await crear(e, { fechaInicio: '2026-08-31', fechaFin: '2026-12-31' })

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(
          'La fecha de inicio del contrato no puede ser anterior al inicio del proyecto (2026-09-01)'
        )
      })

      it('400 si termina después que el proyecto, y dice hasta cuándo sí', async () => {
        const e = await escenario()

        const res = await crear(e, { fechaFin: '2027-03-02' })

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(
          'La fecha de fin del contrato no puede ser posterior al fin del proyecto (2027-03-01)'
        )
      })

      it('los bordes cuentan como dentro', async () => {
        const e = await escenario()

        const res = await crear(e, { fechaInicio: '2026-09-01', fechaFin: '2027-03-01' })

        expect(res.status).toBe(201)
      })

      it('con fecha de fin real, manda ésa y no la estimada', async () => {
        const e = await escenario()
        await Project.updateOne({ _id: e.proyecto._id }, { fechaFinReal: '2026-11-30' })

        const res = await crear(e, { fechaFin: '2026-12-01' })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/fin del proyecto \(2026-11-30\)/)
      })

      it('al editar se revisa sólo la fecha que viene: lo ya capturado no se toca', async () => {
        const e = await escenario()
        const contrato = (await crear(e)).body.data.contrato
        // Un contrato viejo que quedó fuera de rango por la base.
        await Contract.updateOne({ _id: contrato._id }, { fechaInicio: '2026-01-01' })

        const soloFin = await request(app)
          .patch(`${CONTRATOS}/${contrato._id}`)
          .set(auth(e.token))
          .send({ fechaFin: '2027-01-31' })
        expect(soloFin.status).toBe(200)

        const finFuera = await request(app)
          .patch(`${CONTRATOS}/${contrato._id}`)
          .set(auth(e.token))
          .send({ fechaFin: '2027-04-01' })
        expect(finFuera.status).toBe(400)
      })
    })

    it('400 en un proyecto finalizado', async () => {
      const e = await escenario()
      await request(app)
        .post(`${PROYECTOS}/${e.proyecto._id}/finalizar`)
        .set(auth(e.token))
        .send({ fechaFinReal: '2026-10-01' })

      const res = await crear(e)

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/proyecto finalizado/i)
    })
  })

  describe('la fase, el alias del contrato (D-75)', () => {
    it('se manda en el alta, junto al nombre y sin pisarlo', async () => {
      const e = await escenario()

      const res = await crear(e, { nombre: 'Contrato 001-A', fase: 'Fase 1' })

      expect(res.status).toBe(201)
      expect(res.body.data.contrato).toMatchObject({
        nombre: 'Contrato 001-A',
        fase: 'Fase 1'
      })
    })

    it('es opcional y sale en null, nunca vacía ni ausente', async () => {
      const e = await escenario()

      const sinFase = await crear(e)
      expect(sinFase.body.data.contrato.fase).toBeNull()

      const vacia = await crear(e, { fase: '   ' })
      expect(vacia.status).toBe(201)
      expect(vacia.body.data.contrato.fase).toBeNull()
    })

    it('se edita, y se vacía con cadena vacía o con null', async () => {
      const e = await escenario()
      const id = (await crear(e, { fase: 'Fase 1' })).body.data.contrato._id

      const editada = await request(app)
        .patch(`${CONTRATOS}/${id}`)
        .set(auth(e.token))
        .send({ fase: 'Fase 2' })
      expect(editada.status).toBe(200)
      expect(editada.body.data.contrato.fase).toBe('Fase 2')

      const vaciada = await request(app)
        .patch(`${CONTRATOS}/${id}`)
        .set(auth(e.token))
        .send({ fase: '' })
      expect(vaciada.status).toBe(200)
      expect(vaciada.body.data.contrato.fase).toBeNull()

      const conNull = await request(app)
        .patch(`${CONTRATOS}/${id}`)
        .set(auth(e.token))
        .send({ fase: null })
      expect(conNull.status).toBe(200)
      expect(conNull.body.data.contrato.fase).toBeNull()
    })

    it('editar sólo la fase no toca el nombre ni las fechas', async () => {
      const e = await escenario()
      const id = (await crear(e, { nombre: 'Contrato 001-A' })).body.data.contrato._id

      const res = await request(app)
        .patch(`${CONTRATOS}/${id}`)
        .set(auth(e.token))
        .send({ fase: 'Fase 1' })

      expect(res.body.data.contrato).toMatchObject({
        nombre: 'Contrato 001-A',
        fase: 'Fase 1',
        fechaInicio: '2026-09-01',
        fechaFin: '2026-12-31'
      })
    })

    it('viene en el listado de contratos del proyecto', async () => {
      const e = await escenario()
      await crear(e, { nombre: 'Uno', fase: 'Fase 1' })
      await crear(e, { nombre: 'Dos' })

      const res = await request(app)
        .get(`${PROYECTOS}/${e.proyecto._id}/contratos`)
        .set(auth(e.token))

      expect(res.status).toBe(200)
      expect(res.body.data.contratos.map((c) => c.fase)).toEqual(['Fase 1', null])
    })

    it('400 si pasa de 120 caracteres', async () => {
      const e = await escenario()

      const res = await crear(e, { fase: 'F'.repeat(121) })

      expect(res.status).toBe(400)
      expect(res.body.errors[0].msg).toBe('La fase no puede exceder 120 caracteres')
    })
  })

  describe('sesión y alcance', () => {
    it('401 sin sesión', async () => {
      const e = await escenario()

      const res = await request(app).get(`${PROYECTOS}/${e.proyecto._id}/contratos`)

      expect(res.status).toBe(401)
    })

    it('403 si no gestiona proyectos, aunque sí pueda leerlos', async () => {
      const e = await escenario()
      const consulta = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_consulta',
        empresa: e.empresa
      })

      const lectura = await request(app)
        .get(`${PROYECTOS}/${e.proyecto._id}/contratos`)
        .set(auth(consulta.token))
      expect(lectura.status).toBe(200)

      const alta = await request(app)
        .post(`${PROYECTOS}/${e.proyecto._id}/contratos`)
        .set(auth(consulta.token))
        .send(cuerpo())
      expect(alta.status).toBe(403)
    })

    it('404 —no 403— con un contrato de otra empresa', async () => {
      const e = await escenario()
      const contrato = (await crear(e)).body.data.contrato

      // Alguien de otra empresa, sin alcance global.
      const otraEmpresa = await crearEmpresa({ nombre: 'Ajena SA' })
      const ajeno = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_admin',
        empresa: otraEmpresa
      })

      const res = await request(app)
        .patch(`${CONTRATOS}/${contrato._id}`)
        .set(auth(ajeno.token))
        .send({ nombre: 'Otro' })

      expect(res.status).toBe(404)
      expect(res.body.message).toMatch(/no existe/i)
    })
  })

  describe('edición', () => {
    it('cambia nombre y fechas', async () => {
      const e = await escenario()
      const contrato = (await crear(e)).body.data.contrato

      const res = await request(app)
        .patch(`${CONTRATOS}/${contrato._id}`)
        .set(auth(e.token))
        .send({ nombre: 'Cimentación y estructura', fechaFin: '2027-01-31' })

      expect(res.status).toBe(200)
      expect(res.body.data.contrato.nombre).toBe('Cimentación y estructura')
      expect(res.body.data.contrato.fechaFin).toBe('2027-01-31')
    })

    it('rechaza por aquí el SIROC, el estado y el número, y dice por dónde van', async () => {
      const e = await escenario()
      const contrato = (await crear(e)).body.data.contrato

      const res = await request(app)
        .patch(`${CONTRATOS}/${contrato._id}`)
        .set(auth(e.token))
        .send({ siroc: SIROC, numero: 5 })

      expect(res.status).toBe(400)
      expect(res.body.errors[0].msg).toMatch(/PUT \/contratos\/:id\/siroc/)
      expect(res.body.errors[0].msg).toMatch(/lo asigna el servidor/)
    })
  })

  describe('SIROC', () => {
    it('se registra, se corrige y queda en el contrato', async () => {
      const e = await escenario()
      const contrato = (await crear(e)).body.data.contrato

      const alta = await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .send(SIROC)

      expect(alta.status).toBe(200)
      expect(alta.body.data.contrato.siroc).toEqual({
        numero: 'SIR-2026-0001',
        fechaRegistro: '2026-09-05',
        // Nace sin renovaciones: se agregan cada dos meses (D-76).
        actualizaciones: [],
        // Y sin papel: el aviso escaneado es opcional (D-80).
        archivo: null
      })

      // Corregirlo con su MISMO número no choca consigo mismo.
      const correccion = await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .send({ ...SIROC, fechaRegistro: '2026-09-08' })
      expect(correccion.status).toBe(200)
      expect(correccion.body.data.contrato.siroc.fechaRegistro).toBe('2026-09-08')
    })

    /*
     * Del aviso se capturan dos datos y ya: número y fecha de registro (D-76). La
     * vigencia se deriva —dos meses—, y mientras el front quita el campo de su
     * formulario, mandarla no rompe: se ignora.
     */
    it('no tiene fecha final: `vigenciaHasta` no se guarda ni se devuelve', async () => {
      const e = await escenario()
      const contrato = (await crear(e)).body.data.contrato

      const res = await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .send({ ...SIROC, vigenciaHasta: '2027-09-10' })

      expect(res.status).toBe(200)
      expect(res.body.data.contrato.siroc).not.toHaveProperty('vigenciaHasta')
      // Lo que sí sale es la vigencia derivada, a los dos meses del registro.
      expect(res.body.data.contrato.seguimientoSiroc.vigenciaPeriodoHasta).toBe(
        '2026-11-05'
      )
    })

    it('es ÚNICO en todo el sistema: 409 diciendo dónde está el otro (G4)', async () => {
      const e = await escenario()
      const primero = (await crear(e)).body.data.contrato
      await request(app)
        .put(`${CONTRATOS}/${primero._id}/siroc`)
        .set(auth(e.token))
        .send(SIROC)

      // Otro proyecto de la misma empresa: el choque cruza proyectos.
      const otro = await crearProyecto(e.empresa, { nombre: 'Otra Obra' })
      const suContrato = (
        await request(app)
          .post(`${PROYECTOS}/${otro.proyecto._id}/contratos`)
          .set(auth(e.token))
          .send(cuerpo())
      ).body.data.contrato

      const res = await request(app)
        .put(`${CONTRATOS}/${suContrato._id}/siroc`)
        .set(auth(e.token))
        .send(SIROC)

      expect(res.status).toBe(409)
      expect(res.body.code).toBe('SIROC_DUPLICADO')
      expect(res.body.message).toContain('SIR-2026-0001')
      // Y con dónde está, que es lo que necesita quien captura.
      expect(res.body.data).toMatchObject({
        contratoId: primero._id,
        contratoNumero: 1,
        proyectoId: e.proyecto._id.toString()
      })
    })

    it('se quita, y sólo si lo tenía', async () => {
      const e = await escenario()
      const contrato = (await crear(e)).body.data.contrato

      const sinTenerlo = await request(app)
        .delete(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
      expect(sinTenerlo.status).toBe(400)

      await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .send(SIROC)

      const res = await request(app)
        .delete(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
      expect(res.status).toBe(200)
      expect(res.body.data.contrato.siroc).toBeNull()

      // Y el número queda libre para el contrato correcto.
      const otroContrato = (await crear(e, { nombre: 'El bueno' })).body.data.contrato
      const reuso = await request(app)
        .put(`${CONTRATOS}/${otroContrato._id}/siroc`)
        .set(auth(e.token))
        .send(SIROC)
      expect(reuso.status).toBe(200)
    })

    /*
     * D-85: el aviso se presenta al arrancar, así que `fechaRegistro` cae entre
     * el inicio del contrato y siete días después.
     */
    describe('la fecha de registro va pegada al inicio del contrato (D-85)', () => {
      const registrar = (e, contratoId, fechaRegistro) =>
        request(app)
          .put(`${CONTRATOS}/${contratoId}/siroc`)
          .set(auth(e.token))
          .send({ ...SIROC, fechaRegistro })

      it('acepta el día del inicio y el séptimo después', async () => {
        const e = await escenario()
        const contrato = (await crear(e)).body.data.contrato

        expect((await registrar(e, contrato._id, '2026-09-01')).status).toBe(200)
        expect((await registrar(e, contrato._id, '2026-09-08')).status).toBe(200)
      })

      it('400 antes del inicio o pasados los siete días, y dice el rango', async () => {
        const e = await escenario()
        const contrato = (await crear(e)).body.data.contrato

        const antes = await registrar(e, contrato._id, '2026-08-31')
        const despues = await registrar(e, contrato._id, '2026-09-09')

        expect(antes.status).toBe(400)
        expect(despues.status).toBe(400)
        expect(despues.body.message).toBe(
          'La fecha de registro del SIROC debe estar entre el 2026-09-01 y el 2026-09-08: el aviso se presenta al arrancar el contrato'
        )
      })

      it('corregir sólo el número de un SIROC viejo reenvía su fecha y pasa', async () => {
        const e = await escenario()
        const contrato = (await crear(e)).body.data.contrato
        await Contract.updateOne(
          { _id: contrato._id },
          {
            siroc: {
              numero: 'SIR-VIEJO',
              fechaRegistro: '2026-10-20',
              actualizaciones: []
            }
          }
        )

        const res = await request(app)
          .put(`${CONTRATOS}/${contrato._id}/siroc`)
          .set(auth(e.token))
          .send({ numero: 'SIR-VIEJO-B', fechaRegistro: '2026-10-20' })

        expect(res.status).toBe(200)
        expect(res.body.data.contrato.siroc.numero).toBe('SIR-VIEJO-B')
      })
    })

    it('400 si la fecha de registro no es una fecha de calendario', async () => {
      const e = await escenario()
      const contrato = (await crear(e)).body.data.contrato

      const res = await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .send({ ...SIROC, fechaRegistro: '10/09/2026' })

      expect(res.status).toBe(400)
      expect(res.body.errors[0].msg).toMatch(/AAAA-MM-DD/)
    })
  })

  describe('finalizar, reabrir y baja son cosas distintas', () => {
    it('finalizar y reabrir mueven `estado`, no `activo`', async () => {
      const e = await escenario()
      const contrato = (await crear(e)).body.data.contrato

      const fin = await request(app)
        .post(`${CONTRATOS}/${contrato._id}/finalizar`)
        .set(auth(e.token))
      expect(fin.status).toBe(200)
      expect(fin.body.data.contrato).toMatchObject({ estado: 'finalizado', activo: true })

      const otraVez = await request(app)
        .post(`${CONTRATOS}/${contrato._id}/finalizar`)
        .set(auth(e.token))
      expect(otraVez.status).toBe(400)

      const reabrir = await request(app)
        .post(`${CONTRATOS}/${contrato._id}/reabrir`)
        .set(auth(e.token))
      expect(reabrir.body.data.contrato.estado).toBe('en_curso')
    })

    it('la baja mueve `activo`, no `estado`', async () => {
      const e = await escenario()
      const contrato = (await crear(e)).body.data.contrato

      const res = await request(app)
        .patch(`${CONTRATOS}/${contrato._id}/estado`)
        .set(auth(e.token))
        .send({ activo: false })

      expect(res.status).toBe(200)
      expect(res.body.data.contrato).toMatchObject({ activo: false, estado: 'en_curso' })
    })

    it('no se reabre un contrato de un proyecto finalizado', async () => {
      const e = await escenario()
      const contrato = (await crear(e)).body.data.contrato
      await request(app).post(`${CONTRATOS}/${contrato._id}/finalizar`).set(auth(e.token))
      await request(app)
        .post(`${PROYECTOS}/${e.proyecto._id}/finalizar`)
        .set(auth(e.token))
        .send({ fechaFinReal: '2026-10-01' })

      const res = await request(app)
        .post(`${CONTRATOS}/${contrato._id}/reabrir`)
        .set(auth(e.token))

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/proyecto está finalizado/i)
    })
  })
})

/**
 * G3: qué deja de poderse cambiar en el proyecto en cuanto hay contratos. Los
 * candados están en `PATCH /proyectos/:id`, pero el que los dispara es el
 * contrato, así que se prueban aquí.
 */
describe('Candados del proyecto una vez que hay contratos (G3)', () => {
  it('el registro patronal es libre SIN contratos y queda fijo con ellos', async () => {
    const e = await escenario()
    const otroRegistro = await crearRegistroPatronal(e.empresa, 'RP-SEGUNDO')

    const libre = await request(app)
      .patch(`${PROYECTOS}/${e.proyecto._id}`)
      .set(auth(e.token))
      .send({ registroPatronalId: otroRegistro._id.toString() })
    expect(libre.status).toBe(200)

    await crear(e)

    const tercero = await crearRegistroPatronal(e.empresa, 'RP-TERCERO')
    const bloqueado = await request(app)
      .patch(`${PROYECTOS}/${e.proyecto._id}`)
      .set(auth(e.token))
      .send({ registroPatronalId: tercero._id.toString() })

    expect(bloqueado.status).toBe(400)
    expect(bloqueado.body.errors[0].path).toBe('registroPatronalId')
    expect(bloqueado.body.message).toMatch(/ya tiene 1 contrato/)
  })

  it('reenviar el MISMO registro no cuenta como cambio', async () => {
    const e = await escenario()
    await crear(e)

    // El formulario del front manda el proyecto entero: esto tiene que pasar.
    const res = await request(app)
      .patch(`${PROYECTOS}/${e.proyecto._id}`)
      .set(auth(e.token))
      .send({
        nombre: 'Nombre Corregido',
        registroPatronalId: e.registroPatronal._id.toString(),
        registroObraId: e.registroObra._id.toString()
      })

    expect(res.status).toBe(200)
    expect(res.body.data.proyecto.nombre).toBe('Nombre Corregido')
  })

  it('el registro de obra aguanta hasta que UN contrato tiene SIROC', async () => {
    const e = await escenario()
    const contrato = (await crear(e)).body.data.contrato
    const otraObra = await crearRegistroObra(e.cliente, 'OB-SEGUNDA')

    // Con contrato pero sin SIROC todavía se corrige.
    const antes = await request(app)
      .patch(`${PROYECTOS}/${e.proyecto._id}`)
      .set(auth(e.token))
      .send({ registroObraId: otraObra._id.toString() })
    expect(antes.status).toBe(200)

    await request(app)
      .put(`${CONTRATOS}/${contrato._id}/siroc`)
      .set(auth(e.token))
      .send(SIROC)

    const tercera = await crearRegistroObra(e.cliente, 'OB-TERCERA')
    const despues = await request(app)
      .patch(`${PROYECTOS}/${e.proyecto._id}`)
      .set(auth(e.token))
      .send({ registroObraId: tercera._id.toString() })

    expect(despues.status).toBe(400)
    expect(despues.body.errors[0].path).toBe('registroObraId')
    expect(despues.body.message).toMatch(/SIROC/)
  })

  it('el cliente queda fijo en cuanto hay un contrato', async () => {
    const e = await escenario()
    const nuevoCliente = await crearCliente({ nombre: 'Cliente Distinto' })
    await agregarACartera(e.empresa, nuevoCliente)
    const suObra = await crearRegistroObra(nuevoCliente)

    await crear(e)

    const res = await request(app)
      .patch(`${PROYECTOS}/${e.proyecto._id}`)
      .set(auth(e.token))
      .send({
        clienteId: nuevoCliente._id.toString(),
        registroObraId: suObra._id.toString()
      })

    expect(res.status).toBe(400)
    expect(res.body.errors[0].path).toBe('clienteId')
  })

  it('un contrato DADO DE BAJA deja de trabar el proyecto', async () => {
    const e = await escenario()
    const contrato = (await crear(e)).body.data.contrato
    await request(app)
      .patch(`${CONTRATOS}/${contrato._id}/estado`)
      .set(auth(e.token))
      .send({ activo: false })

    const otroRegistro = await crearRegistroPatronal(e.empresa, 'RP-OTRO')
    const res = await request(app)
      .patch(`${PROYECTOS}/${e.proyecto._id}`)
      .set(auth(e.token))
      .send({ registroPatronalId: otroRegistro._id.toString() })

    expect(res.status).toBe(200)
    // Y su número no se reusa: el índice único cuenta también a los de baja.
    const nuevo = await crear(e, { nombre: 'El que sí' })
    expect(nuevo.body.data.contrato.numero).toBe(2)
    expect(await Contract.countDocuments({ proyectoId: e.proyecto._id })).toBe(2)
  })
})
