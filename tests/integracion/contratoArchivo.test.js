const request = require('supertest')
const app = require('../../src/app')
const storage = require('../../src/services/storageService')
const Contract = require('../../src/api/v1/contracts/contractModel')
const Assignment = require('../../src/api/v1/assignments/assignmentModel')
const {
  ensureBaseChecklistTemplates
} = require('../../src/services/seedChecklistTemplates')
const {
  crearEmpleadoConSesion,
  crearEmpleado,
  crearCategoria,
  crearProyecto,
  adscribir,
  asignar,
  auth
} = require('../helpers/factories')

/**
 * El contrato escaneado (D-81).
 *
 * A diferencia del SIROC —dos papeles, uno del aviso y uno por refrendo—, aquí
 * hay **uno solo** y se reemplaza: es la copia del documento que respalda al
 * registro, no un expediente que se versiona. Lo que estas pruebas vigilan es
 * eso y el momento en que se adjunta: las fechas se capturan el día que se
 * firma y el escaneo llega después, así que el `PATCH` de sólo archivo es el
 * camino normal, no un caso raro.
 *
 * El almacenamiento corre con el driver de memoria, así que
 * `contenidoEnMemoria` dice lo que de verdad quedó guardado y lo que se borró.
 */
const CONTRATOS = '/api/v1/contratos'
const PROYECTOS = '/api/v1/proyectos'
const EMPLEADOS = '/api/v1/empleados'

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)])
const OTRO_PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(128, 0x21)])
/** Un HEIC: firma real, y fuera de los tipos aceptados a propósito (D-78). */
const HEIC = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypheic'),
  Buffer.alloc(32, 0)
])

async function escenario(datos = {}) {
  const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin', ...datos })
  const { proyecto, categoria } = await crearProyecto(sesion.empresa, {
    // Ancho: los contratos de estas pruebas caben dentro (D-85).
    fechaInicio: '2026-01-01',
    fechaFinEstimada: '2027-12-31'
  })
  return { ...sesion, proyecto, categoria }
}

/** Contrato ya capturado, sin papel: el estado del que se parte casi siempre. */
async function contratoDe(e, datos = {}) {
  const res = await request(app)
    .post(`${PROYECTOS}/${e.proyecto._id}/contratos`)
    .set(auth(e.token))
    .send({
      nombre: 'Cimentación',
      fechaInicio: '2026-01-01',
      fechaFin: '2027-12-31',
      ...datos
    })
  return res.body.data.contrato
}

/** La clave con la que quedó guardado el papel, leyéndola de la base. */
async function claveDelContrato(contratoId) {
  const doc = await Contract.findById(contratoId)
  return doc.archivo?.claveAlmacenamiento ?? null
}

describe('El archivo del contrato', () => {
  beforeAll(() => Assignment.init())

  describe('al dar de alta el contrato', () => {
    it('se sube con el contrato y sale firmado en la respuesta', async () => {
      const e = await escenario()

      const res = await request(app)
        .post(`${PROYECTOS}/${e.proyecto._id}/contratos`)
        .set(auth(e.token))
        .field('nombre', 'Cimentación')
        .field('fechaInicio', '2026-01-01')
        .field('fechaFin', '2027-12-31')
        .attach('archivo', PDF, 'contrato firmado (2).pdf')

      expect(res.status).toBe(201)
      expect(res.body.data.contrato).toMatchObject({
        nombre: 'Cimentación',
        archivo: {
          nombre: 'contrato firmado (2).pdf',
          mime: 'application/pdf',
          tamanoBytes: PDF.length,
          previsualizable: true,
          // El nombre de descarga es el del DATO, no el del archivo (D-78).
          nombreDescarga: 'Cimentación.pdf'
        }
      })
      expect(res.body.data.contrato.archivo.url).toEqual(expect.any(String))
      // La clave de almacenamiento no sale nunca.
      expect(res.body.data.contrato.archivo.claveAlmacenamiento).toBeUndefined()

      const clave = await claveDelContrato(res.body.data.contrato._id)
      expect(clave).toContain(`contratos/${res.body.data.contrato._id}/contrato-`)
      expect(storage.contenidoEnMemoria(clave)).not.toBeNull()
    })

    it('es opcional: el alta en JSON de siempre sigue funcionando', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)

      expect(contrato.archivo).toBeNull()
      expect(await claveDelContrato(contrato._id)).toBeNull()
    })

    it('sin nombre ni fase, el papel baja con el ordinal del contrato', async () => {
      const e = await escenario()

      const res = await request(app)
        .post(`${PROYECTOS}/${e.proyecto._id}/contratos`)
        .set(auth(e.token))
        .field('fechaInicio', '2026-01-01')
        .field('fechaFin', '2027-12-31')
        .attach('archivo', PDF, 'escaneo.pdf')

      expect(res.status).toBe(201)
      expect(res.body.data.contrato.archivo.nombreDescarga).toBe('Contrato 1.pdf')
    })

    /*
     * Lo que pidió el cliente en la #17: un contrato de obra escaneado pasa de
     * 20 MB, y con el tope anterior de 10 el front lo rebotaba antes de salir.
     */
    it('acepta un contrato de 21 MB, que con el tope anterior rebotaba', async () => {
      const e = await escenario()
      const grande = Buffer.concat([
        Buffer.from('%PDF-1.7\n'),
        Buffer.alloc(21 * 1024 * 1024, 0x20)
      ])

      const res = await request(app)
        .post(`${PROYECTOS}/${e.proyecto._id}/contratos`)
        .set(auth(e.token))
        .field('fechaInicio', '2026-01-01')
        .field('fechaFin', '2027-12-31')
        .attach('archivo', grande, 'contrato-grande.pdf')

      expect(res.status).toBe(201)
      expect(res.body.data.contrato.archivo.tamanoBytes).toBe(grande.length)
    })

    it('un tipo que no se acepta responde 415 y no deja nada guardado', async () => {
      const e = await escenario()

      const res = await request(app)
        .post(`${PROYECTOS}/${e.proyecto._id}/contratos`)
        .set(auth(e.token))
        .field('fechaInicio', '2026-01-01')
        .field('fechaFin', '2027-12-31')
        .attach('archivo', HEIC, 'contrato.heic')

      expect(res.status).toBe(415)
      expect(await Contract.countDocuments({ proyectoId: e.proyecto._id })).toBe(0)
    })
  })

  describe('adjuntarlo después, que es el caso normal', () => {
    it('un PATCH con sólo el archivo lo guarda sin tocar ningún otro campo', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e, { fase: 'Fase 1' })

      const res = await request(app)
        .patch(`${CONTRATOS}/${contrato._id}`)
        .set(auth(e.token))
        .attach('archivo', PDF, 'contrato.pdf')

      expect(res.status).toBe(200)
      expect(res.body.message).toBe('Contrato actualizado con su archivo')
      expect(res.body.data.contrato).toMatchObject({
        nombre: 'Cimentación',
        fase: 'Fase 1',
        fechaInicio: '2026-01-01',
        fechaFin: '2027-12-31',
        archivo: { nombre: 'contrato.pdf', previsualizable: true }
      })
    })

    it('se puede mandar junto con los campos, en la misma petición', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)

      const res = await request(app)
        .patch(`${CONTRATOS}/${contrato._id}`)
        .set(auth(e.token))
        .field('fase', 'Fase 2')
        .attach('archivo', PDF, 'contrato.pdf')

      expect(res.status).toBe(200)
      expect(res.body.data.contrato.fase).toBe('Fase 2')
      expect(res.body.data.contrato.archivo).not.toBeNull()
    })

    it('un PATCH vacío de verdad —sin campos y sin archivo— sigue siendo 400', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)

      const res = await request(app)
        .patch(`${CONTRATOS}/${contrato._id}`)
        .set(auth(e.token))
        .send({})

      expect(res.status).toBe(400)
      expect(res.body.errors[0].msg).toBe('No hay nada que actualizar')
    })
  })

  describe('reemplazarlo', () => {
    it('el nuevo queda y el anterior se borra de verdad', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)

      await request(app)
        .patch(`${CONTRATOS}/${contrato._id}`)
        .set(auth(e.token))
        .attach('archivo', PDF, 'primero.pdf')
      const primera = await claveDelContrato(contrato._id)

      const res = await request(app)
        .patch(`${CONTRATOS}/${contrato._id}`)
        .set(auth(e.token))
        .attach('archivo', OTRO_PDF, 'segundo.pdf')

      expect(res.status).toBe(200)
      expect(res.body.data.contrato.archivo).toMatchObject({
        nombre: 'segundo.pdf',
        tamanoBytes: OTRO_PDF.length
      })

      const segunda = await claveDelContrato(contrato._id)
      expect(segunda).not.toBe(primera)
      expect(storage.contenidoEnMemoria(segunda)).not.toBeNull()
      expect(storage.contenidoEnMemoria(primera)).toBeNull()
    })

    it('editar los campos SIN archivo no tira el papel que ya estaba', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)

      await request(app)
        .patch(`${CONTRATOS}/${contrato._id}`)
        .set(auth(e.token))
        .attach('archivo', PDF, 'contrato.pdf')
      const clave = await claveDelContrato(contrato._id)

      const res = await request(app)
        .patch(`${CONTRATOS}/${contrato._id}`)
        .set(auth(e.token))
        .send({ fase: 'Fase 3' })

      expect(res.status).toBe(200)
      expect(res.body.data.contrato.fase).toBe('Fase 3')
      expect(res.body.data.contrato.archivo.nombre).toBe('contrato.pdf')
      expect(await claveDelContrato(contrato._id)).toBe(clave)
      expect(storage.contenidoEnMemoria(clave)).not.toBeNull()
    })
  })

  describe('abrirlo', () => {
    it('devuelve un enlace fresco, y 404 si el contrato no tiene papel', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)

      const sinArchivo = await request(app)
        .get(`${CONTRATOS}/${contrato._id}/archivo`)
        .set(auth(e.token))
      expect(sinArchivo.status).toBe(404)
      expect(sinArchivo.body.message).toBe('Ese contrato no tiene archivo')

      await request(app)
        .patch(`${CONTRATOS}/${contrato._id}`)
        .set(auth(e.token))
        .attach('archivo', PDF, 'contrato.pdf')

      const res = await request(app)
        .get(`${CONTRATOS}/${contrato._id}/archivo`)
        .set(auth(e.token))

      expect(res.status).toBe(200)
      expect(res.body.data.archivo).toMatchObject({
        nombre: 'contrato.pdf',
        nombreDescarga: 'Cimentación.pdf',
        previsualizable: true
      })
      expect(res.body.data.archivo.url).toEqual(expect.any(String))
    })

    it('leerlo sólo pide sesión y alcance; subirlo, gestionar proyectos', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)
      await request(app)
        .patch(`${CONTRATOS}/${contrato._id}`)
        .set(auth(e.token))
        .attach('archivo', PDF, 'contrato.pdf')

      const lector = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_consulta',
        empresa: e.empresa
      })
      const leido = await request(app)
        .get(`${CONTRATOS}/${contrato._id}/archivo`)
        .set(auth(lector.token))
      expect(leido.status).toBe(200)

      const prohibido = await request(app)
        .patch(`${CONTRATOS}/${contrato._id}`)
        .set(auth(lector.token))
        .attach('archivo', PDF, 'contrato.pdf')
      expect(prohibido.status).toBe(403)

      const ajeno = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const invisible = await request(app)
        .get(`${CONTRATOS}/${contrato._id}/archivo`)
        .set(auth(ajeno.token))
      expect(invisible.status).toBe(404)
      expect(invisible.body.message).toBe('El contrato no existe')

      const sinSesion = await request(app).get(`${CONTRATOS}/${contrato._id}/archivo`)
      expect(sinSesion.status).toBe(401)
    })
  })

  describe('dónde más sale el enlace', () => {
    it('en el listado de contratos del proyecto', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)
      await request(app)
        .patch(`${CONTRATOS}/${contrato._id}`)
        .set(auth(e.token))
        .attach('archivo', PDF, 'contrato.pdf')

      const res = await request(app)
        .get(`${PROYECTOS}/${e.proyecto._id}/contratos`)
        .set(auth(e.token))

      expect(res.status).toBe(200)
      expect(res.body.data.contratos[0].archivo).toMatchObject({
        nombre: 'contrato.pdf',
        url: expect.any(String)
      })
    })

    it('en las obras del expediente de quien trabaja en ellas (D-77)', async () => {
      await ensureBaseChecklistTemplates()
      const e = await escenario()
      const contrato = await contratoDe(e)

      await request(app)
        .patch(`${CONTRATOS}/${contrato._id}`)
        .set(auth(e.token))
        .attach('archivo', PDF, 'contrato.pdf')
      await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .send({ numero: 'SIR-CTR-0001', fechaRegistro: '2026-01-05' })

      const categoria = await crearCategoria('Albañil', 'mano_de_obra')
      const persona = await crearEmpleado({
        nombre: 'Roberto Aguilar Sosa',
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      await adscribir(e.empresa, persona, { areas: ['operaciones_urbanizadora'] })
      await asignar(e.proyecto, persona, categoria._id)

      const res = await request(app)
        .get(`${EMPLEADOS}/${persona._id}/expediente`)
        .set(auth(e.token))

      expect(res.status).toBe(200)
      expect(res.body.data.obras[0].contrato.archivo).toMatchObject({
        nombre: 'contrato.pdf',
        nombreDescarga: 'Cimentación.pdf',
        url: expect.any(String)
      })
    })

    it('un contrato sin papel dice `archivo: null`, no omite la llave', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)

      expect(contrato).toHaveProperty('archivo', null)

      const listado = await request(app)
        .get(`${PROYECTOS}/${e.proyecto._id}/contratos`)
        .set(auth(e.token))
      expect(listado.body.data.contratos[0]).toHaveProperty('archivo', null)
    })
  })
})
