const request = require('supertest')
const app = require('../../src/app')
const { today, addMonths, addDays } = require('../../src/utils/dates')
const {
  crearEmpresa,
  crearEmpleadoConSesion,
  crearProyecto,
  auth
} = require('../helpers/factories')

const PROYECTOS = '/api/v1/proyectos'
const CONTRATOS = '/api/v1/contratos'

/**
 * Actualización del SIROC cada dos meses (D-76).
 *
 * Lo que se guarda es el hecho —qué día se refrendó el aviso—; el resto del
 * bloque `seguimientoSiroc` se deriva al leer, así que estas pruebas fijan las
 * fechas RELATIVAS a hoy en vez de congelar el reloj: es como se va a consultar.
 */
const HOY = today()

async function escenario() {
  const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
  // Un proyecto ancho: las fechas de los contratos van relativas a hoy y tienen
  // que caber dentro de las suyas (D-85).
  const { proyecto } = await crearProyecto(sesion.empresa, {
    fechaInicio: addMonths(HOY, -36),
    fechaFinEstimada: addMonths(HOY, 36)
  })
  return { ...sesion, proyecto }
}

/**
 * Un contrato largo —dos años— para que siempre pida renovaciones. Arranca el
 * día que se le va a registrar el SIROC: el aviso va pegado al inicio (D-85).
 */
const crearContrato = (e, fechaInicio = addMonths(HOY, -1)) =>
  request(app)
    .post(`${PROYECTOS}/${e.proyecto._id}/contratos`)
    .set(auth(e.token))
    .send({
      nombre: 'Cimentación',
      fechaInicio,
      fechaFin: addMonths(HOY, 23)
    })

const registrarSiroc = (e, contratoId, fechaRegistro, numero = 'SIR-2026-9001') =>
  request(app)
    .put(`${CONTRATOS}/${contratoId}/siroc`)
    .set(auth(e.token))
    .send({ numero, fechaRegistro })

const actualizar = (e, contratoId, cuerpo = {}) =>
  request(app)
    .post(`${CONTRATOS}/${contratoId}/siroc/actualizaciones`)
    .set(auth(e.token))
    .send(cuerpo)

/** Un contrato con las fechas que haga falta, sin SIROC todavía. */
const conFechas = async (e, fechaInicio, fechaFin) =>
  (
    await request(app)
      .post(`${PROYECTOS}/${e.proyecto._id}/contratos`)
      .set(auth(e.token))
      .send({ nombre: 'Cimentación', fechaInicio, fechaFin })
  ).body.data.contrato

/** Contrato con SIROC registrado hace `mesesAtras` meses. */
async function conSiroc(e, mesesAtras) {
  const contrato = (await crearContrato(e, addMonths(HOY, -mesesAtras))).body.data
    .contrato
  const res = await registrarSiroc(e, contrato._id, addMonths(HOY, -mesesAtras))
  return res.body.data.contrato
}

describe('Actualización del SIROC cada dos meses', () => {
  describe('lo que anuncia el contrato', () => {
    it('predice cuántas actualizaciones pide desde que se capturan las fechas', async () => {
      const e = await escenario()

      const res = await crearContrato(e)

      expect(res.status).toBe(201)
      // 24 meses de contrato: la primera ventana la cubre el SIROC, faltan 11.
      expect(res.body.data.contrato.seguimientoSiroc).toMatchObject({
        periodoMeses: 2,
        actualizacionesRequeridas: 11,
        actualizacionesRegistradas: 0,
        actualizacionesPendientes: 11,
        estado: 'sin_siroc',
        requiereActualizacion: false,
        vigenciaPeriodoHasta: null
      })
    })

    it('un contrato corto no pide ninguna', async () => {
      const e = await escenario()

      const res = await request(app)
        .post(`${PROYECTOS}/${e.proyecto._id}/contratos`)
        .set(auth(e.token))
        .send({ nombre: 'Breve', fechaInicio: HOY, fechaFin: addMonths(HOY, 2) })

      expect(res.body.data.contrato.seguimientoSiroc.actualizacionesRequeridas).toBe(0)
    })

    it('recién registrado queda al día, con la fecha de la próxima', async () => {
      const e = await escenario()
      const contrato = (await crearContrato(e, HOY)).body.data.contrato

      const res = await registrarSiroc(e, contrato._id, HOY)

      expect(res.status).toBe(200)
      expect(res.body.data.contrato.seguimientoSiroc).toMatchObject({
        estado: 'al_dia',
        vigenciaPeriodoHasta: addMonths(HOY, 2),
        diasParaActualizacion: expect.any(Number),
        requiereActualizacion: false
      })
    })

    it('a dos días de cumplir los dos meses, avisa', async () => {
      const e = await escenario()
      // Registrado de forma que la ventana venza pasado mañana.
      const registro = addMonths(addDays(HOY, 2), -2)
      const contrato = (await crearContrato(e, registro)).body.data.contrato
      await registrarSiroc(e, contrato._id, registro)

      const res = await request(app)
        .get(`${PROYECTOS}/${e.proyecto._id}/contratos`)
        .set(auth(e.token))

      const seguimiento = res.body.data.contratos[0].seguimientoSiroc
      expect(seguimiento.estado).toBe('por_vencer')
      expect(seguimiento.diasParaActualizacion).toBe(2)
      expect(seguimiento.requiereActualizacion).toBe(false)
      expect(seguimiento.mensaje).toMatch(/requiere actualización en 2 días/)
    })

    it('pasados los dos meses con el contrato en curso, la exige', async () => {
      const e = await escenario()
      const contrato = await conSiroc(e, 3)

      expect(contrato.seguimientoSiroc).toMatchObject({
        estado: 'vencida',
        requiereActualizacion: true
      })
      expect(contrato.seguimientoSiroc.diasParaActualizacion).toBeLessThan(0)
      expect(contrato.seguimientoSiroc.mensaje).toMatch(/requiere actualización desde el/)
    })

    /*
     * La regresión que devolvió la tarea: un contrato que se pasó de su fecha de
     * fin y nadie finalizó. La obra sigue abierta ante el IMSS, así que su aviso
     * vence igual; antes callaba porque la ventana «ya cubría lo que quedaba del
     * contrato», sin mirar que ese contrato ya había quedado atrás.
     */
    /*
     * D-84: la fecha de fin es el techo. Antes esto exigía un refrendo cada dos
     * meses para siempre, y toda obra terminada que nadie cerró se quedaba en
     * rojo — que es casi cualquier obra, porque nadie corre a cerrar papeles.
     */
    it('un contrato que se pasó de su fecha de fin, con el aviso cubriéndolo, deja de exigirla', async () => {
      const e = await escenario()
      const contrato = await conFechas(e, addMonths(HOY, -3), addMonths(HOY, -1))

      const res = await registrarSiroc(e, contrato._id, addMonths(HOY, -3))

      expect(res.status).toBe(200)
      expect(res.body.data.contrato.seguimientoSiroc).toMatchObject({
        estado: 'no_requiere',
        requiereActualizacion: false,
        actualizacionesPendientes: 0,
        diasParaActualizacion: null
      })
      expect(res.body.data.contrato.seguimientoSiroc.mensaje).toMatch(
        /^El contrato terminó el .+: su SIROC ya no requiere actualizaciones\.$/
      )
    })

    /*
     * La revisión del 3 de septiembre: el techo corta la cuenta, no la borra.
     * Deshacer el último refrendo de un contrato ya pasado de fecha lo hacía
     * desaparecer —«Sin refrendos pendientes · 1/2»— cuando ese refrendo se debía
     * ANTES de que el contrato terminara.
     */
    describe('pero lo que debía antes de terminar lo sigue debiendo', () => {
      /** Seis meses de contrato que terminaron hace uno, con el SIROC del día 1. */
      async function terminadoConSiroc(e) {
        const contrato = await conFechas(e, addMonths(HOY, -7), addMonths(HOY, -1))
        await registrarSiroc(e, contrato._id, addMonths(HOY, -7))
        return contrato
      }

      it('deshacer el último refrendo vuelve a pedirlo, aunque hoy ya pasó la fecha', async () => {
        const e = await escenario()
        const contrato = await terminadoConSiroc(e)
        await actualizar(e, contrato._id, { fecha: addMonths(HOY, -5) })
        await actualizar(e, contrato._id, { fecha: addMonths(HOY, -3) })

        const res = await request(app)
          .delete(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones/ultima`)
          .set(auth(e.token))

        expect(res.status).toBe(200)
        const seguimiento = res.body.data.contrato.seguimientoSiroc
        expect(seguimiento.actualizacionesRegistradas).toBe(1)
        // El aviso cubría hasta hace tres meses; el contrato siguió dos más.
        expect(seguimiento.actualizacionesPendientes).toBe(1)
        expect(seguimiento.estado).toBe('vencida')
        expect(seguimiento.requiereActualizacion).toBe(true)
        expect(seguimiento.mensaje).toMatch(/con el contrato todavía en curso/)
      })

      it('y esa deuda se paga con un refrendo de entonces, no de hoy', async () => {
        const e = await escenario()
        const contrato = await terminadoConSiroc(e)
        await actualizar(e, contrato._id, { fecha: addMonths(HOY, -5) })

        const deHoy = await actualizar(e, contrato._id)
        expect(deHoy.status).toBe(400)

        const deEntonces = await actualizar(e, contrato._id, {
          fecha: addMonths(HOY, -3)
        })

        expect(deEntonces.status).toBe(201)
        expect(deEntonces.body.data.contrato.seguimientoSiroc).toMatchObject({
          estado: 'no_requiere',
          actualizacionesPendientes: 0
        })
      })

      it('no acumula refrendos de después de la fecha de fin: la cuenta se corta ahí', async () => {
        const e = await escenario()
        const contrato = await conFechas(e, addMonths(HOY, -7), addMonths(HOY, -1))

        const res = await registrarSiroc(e, contrato._id, addMonths(HOY, -7))

        // Seis meses con el aviso del día 1: dos refrendos, y ni uno más aunque
        // hoy ya sea un mes después.
        expect(res.body.data.contrato.seguimientoSiroc).toMatchObject({
          actualizacionesRequeridas: 2,
          actualizacionesPendientes: 2,
          estado: 'vencida'
        })
      })
    })

    it('y en su lugar dice que lo que falta es cerrarlo o corregir sus fechas', async () => {
      const e = await escenario()
      const contrato = await conFechas(e, addMonths(HOY, -3), addMonths(HOY, -1))

      expect(contrato.seguimientoContrato).toMatchObject({
        estado: 'terminado_sin_cerrar',
        requiereCierre: true
      })
      expect(contrato.seguimientoContrato.mensaje).toMatch(
        /finalízalo, o corrige su fecha de fin/
      )
    })

    it('uno dentro de sus fechas lo dice sin pedir nada', async () => {
      const e = await escenario()

      const res = await crearContrato(e)

      expect(res.body.data.contrato.seguimientoContrato).toMatchObject({
        estado: 'en_curso',
        requiereCierre: false,
        diasDesdeFin: null
      })
    })

    it('finalizar el contrato apaga la exigencia', async () => {
      const e = await escenario()
      const contrato = await conSiroc(e, 3)

      const res = await request(app)
        .post(`${CONTRATOS}/${contrato._id}/finalizar`)
        .set(auth(e.token))

      expect(res.status).toBe(200)
      expect(res.body.data.contrato.seguimientoSiroc).toMatchObject({
        estado: 'no_requiere',
        requiereActualizacion: false
      })
    })
  })

  describe('registrar la actualización', () => {
    it('conserva el número, corre la ventana y deja el contador', async () => {
      const e = await escenario()
      const contrato = await conSiroc(e, 3)

      const res = await actualizar(e, contrato._id, { nota: 'Acuse 4471' })

      expect(res.status).toBe(201)
      const actualizado = res.body.data.contrato
      // El número es el mismo: se actualiza el aviso, no se saca otro.
      expect(actualizado.siroc.numero).toBe('SIR-2026-9001')
      expect(actualizado.siroc.actualizaciones).toEqual([
        // `archivo: null` porque esta renovación se capturó sin acuse (D-80).
        { fecha: HOY, nota: 'Acuse 4471', archivo: null }
      ])
      expect(actualizado.seguimientoSiroc).toMatchObject({
        estado: 'al_dia',
        requiereActualizacion: false,
        actualizacionesRegistradas: 1,
        ultimaActualizacion: HOY,
        vigenciaPeriodoHasta: addMonths(HOY, 2)
      })
    })

    it('sin fecha se asume hoy, y la nota es opcional', async () => {
      const e = await escenario()
      const contrato = await conSiroc(e, 3)

      const res = await actualizar(e, contrato._id)

      expect(res.status).toBe(201)
      expect(res.body.data.contrato.siroc.actualizaciones).toEqual([
        { fecha: HOY, nota: null, archivo: null }
      ])
    })

    it('se acumulan y el contador crece', async () => {
      const e = await escenario()
      const contrato = await conSiroc(e, 5)

      await actualizar(e, contrato._id, { fecha: addMonths(HOY, -3) })
      const segunda = await actualizar(e, contrato._id, { fecha: addMonths(HOY, -1) })

      expect(segunda.body.data.contrato.seguimientoSiroc.actualizacionesRegistradas).toBe(
        2
      )
      expect(segunda.body.data.contrato.siroc.actualizaciones).toHaveLength(2)
    })

    it('deshace la última cuando se capturó mal', async () => {
      const e = await escenario()
      const contrato = await conSiroc(e, 3)
      await actualizar(e, contrato._id)

      const res = await request(app)
        .delete(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones/ultima`)
        .set(auth(e.token))

      expect(res.status).toBe(200)
      expect(res.body.data.contrato.siroc.actualizaciones).toEqual([])
      // Y el aviso vuelve a salir, que es de lo que se trataba.
      expect(res.body.data.contrato.seguimientoSiroc.estado).toBe('vencida')
    })

    it('corregir el SIROC no borra sus actualizaciones', async () => {
      const e = await escenario()
      const contrato = await conSiroc(e, 3)
      await actualizar(e, contrato._id)

      const res = await registrarSiroc(
        e,
        contrato._id,
        addMonths(HOY, -3),
        'SIR-CORREGIDO'
      )

      expect(res.status).toBe(200)
      expect(res.body.data.contrato.siroc.numero).toBe('SIR-CORREGIDO')
      expect(res.body.data.contrato.siroc.actualizaciones).toHaveLength(1)
    })
  })

  /*
   * Lo que más va a pasar: la obra se alarga o se recorta. Como todo se deriva
   * al leer, editar las fechas tiene que recalcular en el momento y contando los
   * refrendos que ya hay — ni pedirlos de nuevo desde cero, ni reclamar los que
   * ya se presentaron.
   */
  describe('al mover las fechas del contrato', () => {
    /*
     * Una obra de un año, a la mitad, con sus dos refrendos al día: el aviso
     * vigente llega hasta dentro de un mes. Es el contrato sobre el que se mueve
     * la fecha de fin en los tres casos.
     */
    async function enCursoConDosRefrendos(e) {
      const contrato = await conFechas(e, addMonths(HOY, -5), addMonths(HOY, 7))
      await registrarSiroc(e, contrato._id, addMonths(HOY, -5))
      await actualizar(e, contrato._id, { fecha: addMonths(HOY, -3) })
      await actualizar(e, contrato._id, { fecha: addMonths(HOY, -1) })
      return contrato
    }

    const moverFin = (e, contratoId, fechaFin) =>
      request(app)
        .patch(`${CONTRATOS}/${contratoId}`)
        .set(auth(e.token))
        .send({ fechaFin })

    it('aplazarla vuelve a pedir, contando los refrendos que ya están registrados', async () => {
      const e = await escenario()
      const contrato = await enCursoConDosRefrendos(e)

      const res = await moverFin(e, contrato._id, addMonths(HOY, 12))

      expect(res.status).toBe(200)
      const seguimiento = res.body.data.contrato.seguimientoSiroc
      expect(seguimiento.actualizacionesRegistradas).toBe(2)
      // Desde donde va el aviso —dentro de un mes— hasta dentro de doce.
      expect(seguimiento.actualizacionesPendientes).toBe(6)
      expect(res.body.data.contrato.seguimientoContrato.estado).toBe('en_curso')
    })

    it('recortarla deja de pedir lo que los refrendos ya cubren', async () => {
      const e = await escenario()
      const contrato = await enCursoConDosRefrendos(e)

      const res = await moverFin(e, contrato._id, addDays(HOY, 15))

      expect(res.status).toBe(200)
      expect(res.body.data.contrato.seguimientoSiroc).toMatchObject({
        estado: 'no_requiere',
        actualizacionesPendientes: 0,
        actualizacionesRegistradas: 2,
        mensaje: 'El SIROC vigente cubre lo que queda del contrato.'
      })
    })

    it('recortarla por debajo de lo registrado no rompe la cuenta ni borra refrendos', async () => {
      const e = await escenario()
      const contrato = await enCursoConDosRefrendos(e)

      const res = await moverFin(e, contrato._id, addMonths(HOY, -4))

      expect(res.status).toBe(200)
      const seguimiento = res.body.data.contrato.seguimientoSiroc
      // Se presentaron de verdad ante el IMSS: se dicen como lo que son.
      expect(seguimiento.actualizacionesRegistradas).toBe(2)
      expect(seguimiento.actualizacionesRequeridas).toBe(0)
      expect(seguimiento.actualizacionesPendientes).toBe(0)
      expect(res.body.data.contrato.seguimientoContrato.estado).toBe(
        'terminado_sin_cerrar'
      )
    })
  })

  describe('lo que no se acepta', () => {
    it('400 si el contrato no tiene SIROC', async () => {
      const e = await escenario()
      const contrato = (await crearContrato(e)).body.data.contrato

      const res = await actualizar(e, contrato._id)

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/no tiene SIROC registrado/)
    })

    it('400 con fecha futura', async () => {
      const e = await escenario()
      const contrato = await conSiroc(e, 3)

      const res = await actualizar(e, contrato._id, { fecha: addDays(HOY, 1) })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/no puede tener fecha futura/)
    })

    it('400 si va hacia atrás del registro o de la anterior', async () => {
      const e = await escenario()
      const contrato = await conSiroc(e, 3)

      const antesDelRegistro = await actualizar(e, contrato._id, {
        fecha: addMonths(HOY, -6)
      })
      expect(antesDelRegistro.status).toBe(400)
      expect(antesDelRegistro.body.message).toMatch(/anterior al registro/)

      await actualizar(e, contrato._id, { fecha: addMonths(HOY, -1) })
      const antesDeLaUltima = await actualizar(e, contrato._id, {
        fecha: addMonths(HOY, -2)
      })
      expect(antesDeLaUltima.status).toBe(400)
      expect(antesDeLaUltima.body.message).toMatch(/no puede ser anterior/)
    })

    it('400 si el contrato ya está finalizado', async () => {
      const e = await escenario()
      const contrato = await conSiroc(e, 3)
      await request(app).post(`${CONTRATOS}/${contrato._id}/finalizar`).set(auth(e.token))

      const res = await actualizar(e, contrato._id)

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/ya no está en curso/)
    })

    /*
     * El techo, por API (D-84). Taparlo en la pantalla no alcanzaba: el servidor
     * seguía aceptando refrendos que el IMSS nunca pidió, uno cada dos meses y
     * sin límite, y esa serie de acuses es justo lo que se enseña en una
     * revisión.
     */
    it('400 al registrar una actualización pasada la fecha de fin, y dice qué hacer', async () => {
      const e = await escenario()
      const contrato = await conFechas(e, addMonths(HOY, -3), addMonths(HOY, -1))
      await registrarSiroc(e, contrato._id, addMonths(HOY, -3))

      const res = await actualizar(e, contrato._id)

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(
        /ya no requiere actualizaciones: finaliza el contrato, o corrige su fecha de fin/
      )
    })

    it('pero sí acepta capturar tarde un refrendo que cayó dentro del contrato', async () => {
      const e = await escenario()
      const contrato = await conFechas(e, addMonths(HOY, -4), addMonths(HOY, -1))
      await registrarSiroc(e, contrato._id, addMonths(HOY, -4))

      // El trámite fue hace dos meses; el papel se captura hoy.
      const res = await actualizar(e, contrato._id, { fecha: addMonths(HOY, -2) })

      expect(res.status).toBe(201)
      expect(res.body.data.contrato.seguimientoSiroc.actualizacionesRegistradas).toBe(1)
    })

    /*
     * D-85: un refrendo no se fecha antes de un mes y 25 días del movimiento
     * anterior. Registrar el aviso y su actualización el mismo día corría la
     * ventana sin que el IMSS hubiera pedido nada.
     */
    describe('la espera mínima entre movimientos (D-85)', () => {
      it('400 el mismo día del registro, y dice desde qué día sí', async () => {
        const e = await escenario()
        const contrato = await conSiroc(e, 0)

        const res = await actualizar(e, contrato._id)

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(
          `El SIROC se registró el ${HOY}: la siguiente actualización no puede fecharse antes del ${addDays(addMonths(HOY, 1), 25)}`
        )
      })

      it('un mes y 25 días después ya entra; un día antes, no', async () => {
        const e = await escenario()
        const contrato = await conSiroc(e, 3)
        const registro = addMonths(HOY, -3)
        const minima = addDays(addMonths(registro, 1), 25)

        const antes = await actualizar(e, contrato._id, { fecha: addDays(minima, -1) })
        const justo = await actualizar(e, contrato._id, { fecha: minima })

        expect(antes.status).toBe(400)
        expect(justo.status).toBe(201)
      })

      it('y cuenta desde la actualización anterior, no desde el registro', async () => {
        const e = await escenario()
        const contrato = await conSiroc(e, 5)
        await actualizar(e, contrato._id, { fecha: addMonths(HOY, -3) })
        await actualizar(e, contrato._id, { fecha: addMonths(HOY, -1) })

        // Hoy: un mes después de la última, aunque el registro quede lejos.
        const res = await actualizar(e, contrato._id)

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(
          new RegExp(`^El SIROC se actualizó el ${addMonths(HOY, -1)}`)
        )
      })

      it('respeta el fin de mes: del 31 de enero, la mínima es el 25 de marzo', async () => {
        const e = await escenario()
        const contrato = await conFechas(e, '2026-01-31', '2026-12-31')
        await registrarSiroc(e, contrato._id, '2026-01-31')

        const antes = await actualizar(e, contrato._id, { fecha: '2026-03-24' })
        const justo = await actualizar(e, contrato._id, { fecha: '2026-03-25' })

        expect(antes.status).toBe(400)
        expect(antes.body.message).toMatch(/antes del 2026-03-25$/)
        expect(justo.status).toBe(201)
      })
    })

    it('400 si intentan cambiar el número por aquí, y dice por dónde va', async () => {
      const e = await escenario()
      const contrato = await conSiroc(e, 3)

      const res = await actualizar(e, contrato._id, { numero: 'OTRO-9999' })

      expect(res.status).toBe(400)
      expect(res.body.errors[0].msg).toMatch(/conserva el mismo número/)
    })

    it('400 si no hay actualizaciones que deshacer', async () => {
      const e = await escenario()
      const contrato = await conSiroc(e, 3)

      const res = await request(app)
        .delete(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones/ultima`)
        .set(auth(e.token))

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/no tiene actualizaciones registradas/)
    })
  })

  describe('permisos y alcance', () => {
    it('401 sin sesión', async () => {
      const e = await escenario()
      const contrato = await conSiroc(e, 3)

      const res = await request(app).post(
        `${CONTRATOS}/${contrato._id}/siroc/actualizaciones`
      )

      expect(res.status).toBe(401)
    })

    it('403 sin la capacidad de gestionar proyectos', async () => {
      const e = await escenario()
      const contrato = await conSiroc(e, 3)
      const consulta = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_consulta',
        empresa: e.empresa
      })

      const res = await actualizar({ ...e, token: consulta.token }, contrato._id)

      expect(res.status).toBe(403)
    })

    it('404 —no 403— con un contrato de otra empresa', async () => {
      const e = await escenario()
      const contrato = await conSiroc(e, 3)

      const otraEmpresa = await crearEmpresa({ nombre: 'Ajena SA' })
      const ajeno = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_admin',
        empresa: otraEmpresa
      })

      const res = await actualizar({ ...e, token: ajeno.token }, contrato._id)

      expect(res.status).toBe(404)
      expect(res.body.message).toMatch(/no existe/i)
    })
  })
})
