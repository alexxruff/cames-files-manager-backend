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
  const { proyecto } = await crearProyecto(sesion.empresa)
  return { ...sesion, proyecto }
}

/** Un contrato largo —dos años— para que siempre pida renovaciones. */
const crearContrato = (e) =>
  request(app)
    .post(`${PROYECTOS}/${e.proyecto._id}/contratos`)
    .set(auth(e.token))
    .send({
      nombre: 'Cimentación',
      fechaInicio: addMonths(HOY, -1),
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

/** Contrato con SIROC registrado hace `mesesAtras` meses. */
async function conSiroc(e, mesesAtras) {
  const contrato = (await crearContrato(e)).body.data.contrato
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
      const contrato = (await crearContrato(e)).body.data.contrato

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
      const contrato = (await crearContrato(e)).body.data.contrato

      // Registrado de forma que la ventana venza pasado mañana.
      await registrarSiroc(e, contrato._id, addMonths(addDays(HOY, 2), -2))

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
    it('un contrato que se pasó de su fecha de fin sin finalizarse también la exige', async () => {
      const e = await escenario()

      const contrato = (
        await request(app)
          .post(`${PROYECTOS}/${e.proyecto._id}/contratos`)
          .set(auth(e.token))
          .send({
            nombre: 'Cimentación',
            // Terminó hace un mes en el papel, pero sigue en curso.
            fechaInicio: addMonths(HOY, -3),
            fechaFin: addMonths(HOY, -1)
          })
      ).body.data.contrato

      const res = await registrarSiroc(e, contrato._id, addMonths(HOY, -3))

      expect(res.status).toBe(200)
      const seguimiento = res.body.data.contrato.seguimientoSiroc
      expect(seguimiento.estado).toBe('vencida')
      expect(seguimiento.requiereActualizacion).toBe(true)
      // Sus fechas no preveían ninguna, pero debe una: se pasó de ellas.
      expect(seguimiento.actualizacionesRequeridas).toBe(0)
      expect(seguimiento.actualizacionesPendientes).toBe(1)
      expect(seguimiento.mensaje).toMatch(/requiere actualización desde el/)
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
        { fecha: HOY, nota: 'Acuse 4471' }
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
        { fecha: HOY, nota: null }
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
