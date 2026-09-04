const request = require('supertest')
const app = require('../../src/app')
const storage = require('../../src/services/storageService')
const Contract = require('../../src/api/v1/contracts/contractModel')
const {
  crearEmpleadoConSesion,
  crearEmpresa,
  crearProyecto,
  auth
} = require('../helpers/factories')

/**
 * El monto, la historia de modificaciones y eliminar un contrato (D-90).
 *
 * Las tres cosas llegaron juntas porque se estorban: editar un contrato se
 * confundía con modificarlo —que es un hecho nuevo y debe quedar—, y corregir un
 * dedazo no tenía más salida que editar. Ahora son tres caminos distintos, y lo
 * que estas pruebas vigilan es que no se pisen:
 *
 * - **Modificar** repacta fechas y monto, y el contrato queda con los nuevos.
 * - **Deshacer** devuelve los de antes, exactamente.
 * - **Eliminar** borra el contrato entero y libera los dos números.
 * - **Dar de baja** sigue siendo lo de siempre y no borra nada.
 */
const CONTRATOS = '/api/v1/contratos'
const PROYECTOS = '/api/v1/proyectos'

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)])
const OTRO_PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(128, 0x21)])

async function escenario(datos = {}) {
  const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin', ...datos })
  const { proyecto } = await crearProyecto(sesion.empresa, {
    // Ancho: los contratos de estas pruebas caben dentro (D-85).
    fechaInicio: '2026-01-01',
    fechaFinEstimada: '2027-12-31'
  })
  return { ...sesion, proyecto }
}

const crear = (e, extra = {}) =>
  request(app)
    .post(`${PROYECTOS}/${e.proyecto._id}/contratos`)
    .set(auth(e.token))
    .send({
      nombre: 'Cimentación',
      fechaInicio: '2026-01-01',
      fechaFin: '2026-03-31',
      monto: 1500000,
      ...extra
    })

const contratoDe = async (e, extra = {}) => (await crear(e, extra)).body.data.contrato

const modificar = (e, contratoId, extra = {}) =>
  request(app)
    .post(`${CONTRATOS}/${contratoId}/modificaciones`)
    .set(auth(e.token))
    .send({
      fechaInicio: '2026-01-01',
      fechaFin: '2026-12-31',
      monto: 2100000.5,
      motivo: 'El cliente aplazó la obra y se anexaron requerimientos',
      fechaAcuerdo: '2026-03-20',
      ...extra
    })

describe('El monto del contrato (D-90)', () => {
  it('es obligatorio al dar de alta', async () => {
    const e = await escenario()

    const res = await crear(e, { monto: undefined })

    expect(res.status).toBe(400)
    expect(res.body.errors[0].msg).toBe('El monto del contrato es requerido')
  })

  it('se guarda con centavos y sale en la ficha y en el listado', async () => {
    const e = await escenario()

    const alta = await crear(e, { monto: 1234567.89 })
    expect(alta.status).toBe(201)
    expect(alta.body.data.contrato.monto).toBe(1234567.89)

    const listado = await request(app)
      .get(`${PROYECTOS}/${e.proyecto._id}/contratos`)
      .set(auth(e.token))
    expect(listado.body.data.contratos[0].monto).toBe(1234567.89)
  })

  it('cero es una cifra válida, y NO es lo mismo que no tenerlo', async () => {
    const e = await escenario()
    const enCero = await contratoDe(e, { monto: 0 })
    expect(enCero.monto).toBe(0)

    // Un contrato de los de antes de D-90: nadie le capturó monto.
    const viejo = await contratoDe(e)
    await Contract.updateOne({ _id: viejo._id }, { $unset: { monto: '' } })

    const res = await request(app)
      .get(`${PROYECTOS}/${e.proyecto._id}/contratos`)
      .set(auth(e.token))

    const montos = res.body.data.contratos.map((c) => c.monto)
    expect(montos).toEqual([0, null])
  })

  it('400 si es negativo o no es un número', async () => {
    const e = await escenario()

    const negativo = await crear(e, { monto: -1 })
    expect(negativo.status).toBe(400)
    expect(negativo.body.errors[0].msg).toMatch(/no puede ser negativo/)

    const texto = await crear(e, { monto: 'mucho' })
    expect(texto.status).toBe(400)
    expect(texto.body.errors[0].msg).toMatch(/número en pesos/)
  })

  it('un contrato viejo sin monto sigue pudiendo registrar su SIROC', async () => {
    const e = await escenario()
    const contrato = await contratoDe(e)
    await Contract.updateOne({ _id: contrato._id }, { $unset: { monto: '' } })

    const res = await request(app)
      .put(`${CONTRATOS}/${contrato._id}/siroc`)
      .set(auth(e.token))
      .send({ numero: 'SIR-VIEJO-01', fechaRegistro: '2026-01-05' })

    expect(res.status).toBe(200)
    expect(res.body.data.contrato.monto).toBeNull()
  })
})

describe('Las modificaciones del contrato (D-90)', () => {
  describe('registrar una', () => {
    it('pisa fechas y monto, y deja el original en la historia', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)

      const res = await modificar(e, contrato._id)

      expect(res.status).toBe(201)
      expect(res.body.message).toBe('Modificación del contrato registrada')
      expect(res.body.data.contrato).toMatchObject({
        fechaInicio: '2026-01-01',
        fechaFin: '2026-12-31',
        monto: 2100000.5
      })
      expect(res.body.data.contrato.historia.modificado).toBe(true)
      expect(res.body.data.contrato.historia.entradas).toEqual([
        {
          tipo: 'original',
          indice: null,
          fechaAcuerdo: null,
          motivo: null,
          fechaInicio: '2026-01-01',
          fechaFin: '2026-03-31',
          monto: 1500000,
          archivo: null,
          vigente: false
        },
        {
          tipo: 'modificacion',
          indice: 0,
          fechaAcuerdo: '2026-03-20',
          motivo: 'El cliente aplazó la obra y se anexaron requerimientos',
          fechaInicio: '2026-01-01',
          fechaFin: '2026-12-31',
          monto: 2100000.5,
          archivo: null,
          vigente: true
        }
      ])
    })

    it('sin modificaciones responde que no hay historia, sin arreglos vacíos que interpretar', async () => {
      const e = await escenario()

      const contrato = await contratoDe(e)

      expect(contrato.historia).toEqual({ modificado: false, entradas: [] })
    })

    it('la segunda modificación deja tres entradas y sólo la última vigente', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)
      await modificar(e, contrato._id)

      const res = await modificar(e, contrato._id, {
        fechaFin: '2027-06-30',
        monto: 2500000,
        fechaAcuerdo: '2026-08-10',
        motivo: 'Segunda ampliación'
      })

      expect(res.status).toBe(201)
      const entradas = res.body.data.contrato.historia.entradas
      expect(entradas.map((x) => x.monto)).toEqual([1500000, 2100000.5, 2500000])
      expect(entradas.map((x) => x.vigente)).toEqual([false, false, true])
      expect(res.body.data.contrato.fechaFin).toBe('2027-06-30')
    })

    it('el motivo y la fecha del acuerdo son opcionales, y sin fecha se asume hoy', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)

      const res = await modificar(e, contrato._id, {
        motivo: undefined,
        fechaAcuerdo: undefined
      })

      expect(res.status).toBe(201)
      const ultima = res.body.data.contrato.historia.entradas[1]
      expect(ultima.motivo).toBeNull()
      expect(ultima.fechaAcuerdo).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('400 con fecha de acuerdo futura', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)

      const res = await modificar(e, contrato._id, { fechaAcuerdo: '2099-01-01' })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/no puede ser futura/)
    })

    it('400 sin monto, y 400 si la fecha de fin queda antes que la de inicio', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)

      const sinMonto = await modificar(e, contrato._id, { monto: undefined })
      expect(sinMonto.status).toBe(400)
      expect(sinMonto.body.errors[0].msg).toBe('El monto de la modificación es requerido')

      const alReves = await modificar(e, contrato._id, {
        fechaInicio: '2026-06-01',
        fechaFin: '2026-02-01'
      })
      expect(alReves.status).toBe(400)
      expect(alReves.body.message).toMatch(/anterior a la de inicio/)
    })

    it('rechaza los campos que no se modifican, y dice qué hacer con ellos', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)

      const res = await modificar(e, contrato._id, { nombre: 'Otro nombre' })

      expect(res.status).toBe(400)
      expect(res.body.errors[0].msg).toMatch(/elimina el contrato y captúralo de nuevo/)
    })

    it('400 en un contrato finalizado o dado de baja, diciendo cómo destrabarlo', async () => {
      const e = await escenario()
      const finalizado = await contratoDe(e)
      await request(app)
        .post(`${CONTRATOS}/${finalizado._id}/finalizar`)
        .set(auth(e.token))

      const cerrado = await modificar(e, finalizado._id)
      expect(cerrado.status).toBe(400)
      expect(cerrado.body.message).toMatch(/reábrelo/i)

      const debaja = await contratoDe(e)
      await request(app)
        .patch(`${CONTRATOS}/${debaja._id}/estado`)
        .set(auth(e.token))
        .send({ activo: false })

      const res = await modificar(e, debaja._id)
      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/reactívalo/i)
    })

    it('403 si no gestiona proyectos, 404 si el contrato es de otra empresa', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)

      const consulta = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_consulta',
        empresa: e.empresa
      })
      const prohibido = await modificar(consulta, contrato._id)
      expect(prohibido.status).toBe(403)

      const ajeno = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_admin',
        empresa: await crearEmpresa({ nombre: 'Ajena SA' })
      })
      const invisible = await modificar(ajeno, contrato._id)
      expect(invisible.status).toBe(404)
      expect(invisible.body.message).toBe('El contrato no existe')

      const sinSesion = await request(app)
        .post(`${CONTRATOS}/${contrato._id}/modificaciones`)
        .send({ fechaInicio: '2026-01-01', fechaFin: '2026-12-31', monto: 1 })
      expect(sinSesion.status).toBe(401)
    })
  })

  describe('desde la modificación vale lo nuevo, para todo', () => {
    it('el techo del SIROC se mueve con la fecha de fin (D-84)', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)
      await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .send({ numero: 'SIR-TECHO-01', fechaRegistro: '2026-01-05' })

      // El contrato termina el 31 de marzo: un reporte de abril no entra.
      const antes = await request(app)
        .post(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones`)
        .set(auth(e.token))
        .send({ fecha: '2026-04-15' })
      expect(antes.status).toBe(400)
      expect(antes.body.message).toMatch(/terminó el 2026-03-31/)

      await modificar(e, contrato._id)

      const despues = await request(app)
        .post(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones`)
        .set(auth(e.token))
        .send({ fecha: '2026-04-15' })
      expect(despues.status).toBe(201)
    })
  })

  describe('los dos papeles', () => {
    it('el convenio se adjunta después y convive con el del contrato original', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)
      await request(app)
        .put(`${CONTRATOS}/${contrato._id}/archivo`)
        .set(auth(e.token))
        .attach('archivo', PDF, 'contrato.pdf')

      const conConvenio = await request(app)
        .post(`${CONTRATOS}/${contrato._id}/modificaciones`)
        .set(auth(e.token))
        .field('fechaInicio', '2026-01-01')
        .field('fechaFin', '2026-12-31')
        .field('monto', '2100000')
        .field('fechaAcuerdo', '2026-03-20')
        .attach('archivo', OTRO_PDF, 'convenio modificatorio.pdf')

      expect(conConvenio.status).toBe(201)
      const entradas = conConvenio.body.data.contrato.historia.entradas
      expect(entradas[0].archivo).toMatchObject({
        nombre: 'contrato.pdf',
        nombreDescarga: 'Cimentación.pdf',
        url: expect.any(String)
      })
      expect(entradas[1].archivo).toMatchObject({
        nombre: 'convenio modificatorio.pdf',
        nombreDescarga: 'Cimentación-modificacion-2026-03-20.pdf',
        url: expect.any(String)
      })

      // Y se abre con un enlace fresco, como el resto de los papeles.
      const enlace = await request(app)
        .get(`${CONTRATOS}/${contrato._id}/modificaciones/0/archivo`)
        .set(auth(e.token))
      expect(enlace.status).toBe(200)
      expect(enlace.body.data.archivo.url).toEqual(expect.any(String))
    })

    it('es opcional al capturar y se sube luego, sin tocar nada más', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)
      await modificar(e, contrato._id)

      const sinPapel = await request(app)
        .get(`${CONTRATOS}/${contrato._id}/modificaciones/0/archivo`)
        .set(auth(e.token))
      expect(sinPapel.status).toBe(404)
      expect(sinPapel.body.message).toBe('Esa modificación no tiene convenio adjunto')

      const res = await request(app)
        .put(`${CONTRATOS}/${contrato._id}/modificaciones/0/archivo`)
        .set(auth(e.token))
        .attach('archivo', PDF, 'convenio.pdf')

      expect(res.status).toBe(200)
      expect(res.body.message).toBe('Convenio modificatorio guardado')
      const entrada = res.body.data.contrato.historia.entradas[1]
      expect(entrada.archivo.nombre).toBe('convenio.pdf')
      expect(entrada.monto).toBe(2100000.5)
      expect(entrada.fechaAcuerdo).toBe('2026-03-20')
    })

    it('404 con una modificación que no existe', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)

      const res = await request(app)
        .get(`${CONTRATOS}/${contrato._id}/modificaciones/3/archivo`)
        .set(auth(e.token))

      expect(res.status).toBe(404)
      expect(res.body.message).toBe('Esa modificación no existe')
    })

    it('leer el convenio sólo pide sesión y alcance; subirlo, gestionar proyectos', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)
      await modificar(e, contrato._id)
      await request(app)
        .put(`${CONTRATOS}/${contrato._id}/modificaciones/0/archivo`)
        .set(auth(e.token))
        .attach('archivo', PDF, 'convenio.pdf')

      const lector = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_consulta',
        empresa: e.empresa
      })

      const leido = await request(app)
        .get(`${CONTRATOS}/${contrato._id}/modificaciones/0/archivo`)
        .set(auth(lector.token))
      expect(leido.status).toBe(200)

      const prohibido = await request(app)
        .put(`${CONTRATOS}/${contrato._id}/modificaciones/0/archivo`)
        .set(auth(lector.token))
        .attach('archivo', PDF, 'convenio.pdf')
      expect(prohibido.status).toBe(403)
    })
  })

  describe('deshacer la última', () => {
    it('devuelve el contrato a los valores anteriores y lo deja sin historia', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)
      await modificar(e, contrato._id)

      const res = await request(app)
        .delete(`${CONTRATOS}/${contrato._id}/modificaciones/ultima`)
        .set(auth(e.token))

      expect(res.status).toBe(200)
      expect(res.body.data.contrato).toMatchObject({
        fechaInicio: '2026-01-01',
        fechaFin: '2026-03-31',
        monto: 1500000,
        historia: { modificado: false, entradas: [] }
      })
    })

    it('con dos, vuelve a la primera y la historia se queda con ella', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)
      await modificar(e, contrato._id)
      await modificar(e, contrato._id, { fechaFin: '2027-06-30', monto: 2500000 })

      const res = await request(app)
        .delete(`${CONTRATOS}/${contrato._id}/modificaciones/ultima`)
        .set(auth(e.token))

      expect(res.body.data.contrato).toMatchObject({
        fechaFin: '2026-12-31',
        monto: 2100000.5
      })
      expect(res.body.data.contrato.historia.entradas).toHaveLength(2)
    })

    it('se lleva el convenio de esa modificación, y sólo ése', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)
      await request(app)
        .put(`${CONTRATOS}/${contrato._id}/archivo`)
        .set(auth(e.token))
        .attach('archivo', PDF, 'contrato.pdf')
      await request(app)
        .post(`${CONTRATOS}/${contrato._id}/modificaciones`)
        .set(auth(e.token))
        .field('fechaInicio', '2026-01-01')
        .field('fechaFin', '2026-12-31')
        .field('monto', '2100000')
        .attach('archivo', OTRO_PDF, 'convenio.pdf')

      const guardado = await Contract.findById(contrato._id)
      const delContrato = guardado.archivo.claveAlmacenamiento
      const delConvenio = guardado.modificaciones[0].archivo.claveAlmacenamiento

      await request(app)
        .delete(`${CONTRATOS}/${contrato._id}/modificaciones/ultima`)
        .set(auth(e.token))

      expect(storage.contenidoEnMemoria(delConvenio)).toBeNull()
      expect(storage.contenidoEnMemoria(delContrato)).not.toBeNull()
    })

    it('400 si no hay ninguna', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)

      const res = await request(app)
        .delete(`${CONTRATOS}/${contrato._id}/modificaciones/ultima`)
        .set(auth(e.token))

      expect(res.status).toBe(400)
      expect(res.body.message).toBe('Ese contrato no tiene modificaciones registradas')
    })
  })
})

describe('Eliminar un contrato (D-90)', () => {
  /** Un contrato con todo encima: papel, SIROC con acuse, reporte y modificación. */
  async function contratoCompleto(e) {
    const contrato = await contratoDe(e)
    await request(app)
      .put(`${CONTRATOS}/${contrato._id}/archivo`)
      .set(auth(e.token))
      .attach('archivo', PDF, 'contrato.pdf')
    await request(app)
      .put(`${CONTRATOS}/${contrato._id}/siroc`)
      .set(auth(e.token))
      .field('numero', 'SIR-BORRAR-01')
      .field('fechaRegistro', '2026-01-05')
      .attach('archivo', PDF, 'aviso.pdf')
    await request(app)
      .post(`${CONTRATOS}/${contrato._id}/modificaciones`)
      .set(auth(e.token))
      .field('fechaInicio', '2026-01-01')
      .field('fechaFin', '2026-12-31')
      .field('monto', '2100000')
      .attach('archivo', OTRO_PDF, 'convenio.pdf')
    await request(app)
      .post(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones`)
      .set(auth(e.token))
      .field('fecha', '2026-03-05')
      .attach('archivo', PDF, 'acuse.pdf')

    const doc = await Contract.findById(contrato._id)
    return {
      contrato,
      claves: [
        doc.archivo.claveAlmacenamiento,
        doc.siroc.archivo.claveAlmacenamiento,
        doc.siroc.actualizaciones[0].archivo.claveAlmacenamiento,
        doc.modificaciones[0].archivo.claveAlmacenamiento
      ]
    }
  }

  it('borra el contrato con todo lo suyo, y dice qué se llevó', async () => {
    const e = await escenario()
    const { contrato, claves } = await contratoCompleto(e)

    const res = await request(app)
      .delete(`${CONTRATOS}/${contrato._id}`)
      .set(auth(e.token))

    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Contrato eliminado')
    expect(res.body.data.eliminado).toEqual({
      _id: contrato._id,
      numero: 1,
      nombre: 'Cimentación',
      fase: null,
      sirocNumero: 'SIR-BORRAR-01',
      reportesBimestrales: 1,
      modificaciones: 1,
      archivos: 4
    })

    expect(await Contract.findById(contrato._id)).toBeNull()
    for (const clave of claves) expect(storage.contenidoEnMemoria(clave)).toBeNull()
  })

  it('libera el número de SIROC, que es único en todo el sistema', async () => {
    const e = await escenario()
    const { contrato } = await contratoCompleto(e)
    const otro = await contratoDe(e, { nombre: 'Estructura' })

    const chocaba = await request(app)
      .put(`${CONTRATOS}/${otro._id}/siroc`)
      .set(auth(e.token))
      .send({ numero: 'SIR-BORRAR-01', fechaRegistro: '2026-01-05' })
    expect(chocaba.status).toBe(409)

    await request(app).delete(`${CONTRATOS}/${contrato._id}`).set(auth(e.token))

    const res = await request(app)
      .put(`${CONTRATOS}/${otro._id}/siroc`)
      .set(auth(e.token))
      .send({ numero: 'SIR-BORRAR-01', fechaRegistro: '2026-01-05' })
    expect(res.status).toBe(200)
    expect(res.body.data.contrato.siroc.numero).toBe('SIR-BORRAR-01')
  })

  it('libera el número del contrato, y el siguiente alta lo reusa', async () => {
    const e = await escenario()
    const uno = await contratoDe(e)
    const dos = await contratoDe(e, { nombre: 'Estructura' })
    expect(dos.numero).toBe(2)

    await request(app).delete(`${CONTRATOS}/${dos._id}`).set(auth(e.token))

    const nuevo = await contratoDe(e, { nombre: 'Estructura, otra vez' })
    expect(nuevo.numero).toBe(2)

    // Y el que sigue en pie conserva el suyo.
    const listado = await request(app)
      .get(`${PROYECTOS}/${e.proyecto._id}/contratos`)
      .set(auth(e.token))
    expect(listado.body.data.contratos.map((c) => c._id)).toContain(uno._id)
  })

  it('un contrato dado de baja SIGUE ocupando su número: la baja no borra', async () => {
    const e = await escenario()
    await contratoDe(e)
    const dos = await contratoDe(e, { nombre: 'Estructura' })

    await request(app)
      .patch(`${CONTRATOS}/${dos._id}/estado`)
      .set(auth(e.token))
      .send({ activo: false })

    const nuevo = await contratoDe(e, { nombre: 'Tercero' })
    expect(nuevo.numero).toBe(3)
    expect(await Contract.findById(dos._id)).not.toBeNull()
  })

  it('lo puede quien gestiona proyectos y nadie más; fuera de alcance, 404', async () => {
    const e = await escenario()
    const contrato = await contratoDe(e)

    const consulta = await crearEmpleadoConSesion({
      nivelAcceso: 'rh_consulta',
      empresa: e.empresa
    })
    const prohibido = await request(app)
      .delete(`${CONTRATOS}/${contrato._id}`)
      .set(auth(consulta.token))
    expect(prohibido.status).toBe(403)

    const ajeno = await crearEmpleadoConSesion({
      nivelAcceso: 'rh_admin',
      empresa: await crearEmpresa({ nombre: 'Ajena SA' })
    })
    const invisible = await request(app)
      .delete(`${CONTRATOS}/${contrato._id}`)
      .set(auth(ajeno.token))
    expect(invisible.status).toBe(404)

    const sinSesion = await request(app).delete(`${CONTRATOS}/${contrato._id}`)
    expect(sinSesion.status).toBe(401)

    // Y después de los tres intentos, el contrato sigue ahí.
    expect(await Contract.findById(contrato._id)).not.toBeNull()
  })
})
