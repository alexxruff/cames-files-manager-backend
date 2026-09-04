const request = require('supertest')
const app = require('../../src/app')
const storage = require('../../src/services/storageService')
const Contract = require('../../src/api/v1/contracts/contractModel')
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
 * El papel del SIROC: el aviso escaneado y el acuse de cada renovación (D-80).
 *
 * Son DOS archivos distintos y a propósito: refrendar el aviso produce un papel
 * nuevo que no sustituye al original, y el historial completo es justo lo que se
 * enseña si el IMSS revisa. Por eso la mayoría de estas pruebas mira que uno no
 * pise al otro.
 *
 * El almacenamiento corre con el driver de memoria, así que `contenidoEnMemoria`
 * sirve para afirmar lo que de verdad quedó guardado y lo que se borró —que es
 * la mitad de lo que hay que probar cuando un archivo se reemplaza—.
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

const crearContrato = (e) =>
  request(app).post(`${PROYECTOS}/${e.proyecto._id}/contratos`).set(auth(e.token)).send({
    nombre: 'Cimentación',
    fechaInicio: '2026-01-01',
    fechaFin: '2027-12-31',
    monto: 1500000
  })

/** Contrato recién creado, sin SIROC. */
async function contratoDe(e) {
  const res = await crearContrato(e)
  return res.body.data.contrato
}

/** La clave con la que quedó guardado el archivo, leyéndola de la base. */
async function claveDelAviso(contratoId) {
  const doc = await Contract.findById(contratoId)
  return doc.siroc?.archivo?.claveAlmacenamiento ?? null
}

async function claveDeActualizacion(contratoId, indice) {
  const doc = await Contract.findById(contratoId)
  return doc.siroc?.actualizaciones?.[indice]?.archivo?.claveAlmacenamiento ?? null
}

let numeroSiroc = 0
const siguienteNumero = () => `SIR-ARCH-${(numeroSiroc += 1).toString().padStart(4, '0')}`

describe('El archivo del SIROC', () => {
  describe('el aviso escaneado', () => {
    it('se sube junto con el SIROC y sale firmado en el contrato', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)
      const numero = siguienteNumero()

      const res = await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .field('numero', numero)
        .field('fechaRegistro', '2026-01-05')
        .attach('archivo', PDF, 'escaneo (2) final_v3.pdf')

      expect(res.status).toBe(200)
      expect(res.body.data.contrato.siroc).toMatchObject({
        numero,
        fechaRegistro: '2026-01-05',
        actualizaciones: []
      })

      const archivo = res.body.data.contrato.siroc.archivo
      expect(archivo).toMatchObject({
        nombre: 'escaneo (2) final_v3.pdf',
        mime: 'application/pdf',
        tamanoBytes: PDF.length,
        previsualizable: true,
        // Se descarga con el nombre del DATO, no con el del original (D-78).
        nombreDescarga: `${numero}.pdf`
      })
      expect(archivo.url).toEqual(expect.any(String))
      // La clave de almacenamiento NUNCA sale: con ella se llega al objeto
      // saltándose los permisos.
      expect(archivo.claveAlmacenamiento).toBeUndefined()

      // Y quedó guardado de verdad, bajo la carpeta del contrato.
      const clave = await claveDelAviso(contrato._id)
      expect(clave).toContain(`siroc/${contrato._id}/aviso-`)
      expect(storage.contenidoEnMemoria(clave)).not.toBeNull()
    })

    it('el SIROC se puede capturar sin archivo, y el archivo llegar después', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)
      const numero = siguienteNumero()

      const sinPapel = await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .send({ numero, fechaRegistro: '2026-01-05' })

      expect(sinPapel.status).toBe(200)
      expect(sinPapel.body.data.contrato.siroc.archivo).toBeNull()

      const conPapel = await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .field('numero', numero)
        .field('fechaRegistro', '2026-01-05')
        .attach('archivo', PDF, 'aviso.pdf')

      expect(conPapel.status).toBe(200)
      expect(conPapel.body.data.contrato.siroc.archivo.nombre).toBe('aviso.pdf')
    })

    it('corregir el número no tira el papel que ya estaba', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)
      const numero = siguienteNumero()

      await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .field('numero', numero)
        .field('fechaRegistro', '2026-01-05')
        .attach('archivo', PDF, 'aviso.pdf')

      const clave = await claveDelAviso(contrato._id)

      const correccion = await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .send({ numero, fechaRegistro: '2026-01-08' })

      expect(correccion.status).toBe(200)
      expect(correccion.body.data.contrato.siroc.fechaRegistro).toBe('2026-01-08')
      expect(correccion.body.data.contrato.siroc.archivo).toMatchObject({
        nombre: 'aviso.pdf'
      })
      // El mismo objeto, no uno nuevo: no se volvió a subir nada.
      expect(await claveDelAviso(contrato._id)).toBe(clave)
      expect(storage.contenidoEnMemoria(clave)).not.toBeNull()
    })

    it('mandar otro archivo reemplaza el anterior y lo borra del almacenamiento', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)
      const numero = siguienteNumero()

      await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .field('numero', numero)
        .field('fechaRegistro', '2026-01-05')
        .attach('archivo', PDF, 'viejo.pdf')

      const anterior = await claveDelAviso(contrato._id)

      const res = await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .field('numero', numero)
        .field('fechaRegistro', '2026-01-05')
        .attach('archivo', OTRO_PDF, 'nuevo.pdf')

      expect(res.status).toBe(200)
      expect(res.body.data.contrato.siroc.archivo).toMatchObject({
        nombre: 'nuevo.pdf',
        tamanoBytes: OTRO_PDF.length
      })

      const clave = await claveDelAviso(contrato._id)
      expect(clave).not.toBe(anterior)
      // No se versiona: el anterior se va (D-79).
      expect(storage.contenidoEnMemoria(anterior)).toBeNull()
      expect(storage.contenidoEnMemoria(clave)).not.toBeNull()
    })

    it('rechaza con 415 lo que no es un tipo aceptado', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)

      const res = await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .field('numero', siguienteNumero())
        .field('fechaRegistro', '2026-01-05')
        .attach('archivo', HEIC, 'aviso.heic')

      expect(res.status).toBe(415)
      expect(res.body.message).toMatch(/HEIC|no se acepta|tipo/i)
      // Y no dejó a medias un SIROC sin papel.
      const doc = await Contract.findById(contrato._id)
      expect(doc.siroc).toBeNull()
    })
  })

  describe('el acuse de cada renovación', () => {
    it('se sube con la actualización y es SUYO, no del aviso', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)
      const numero = siguienteNumero()

      await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .field('numero', numero)
        .field('fechaRegistro', '2026-01-05')
        .attach('archivo', PDF, 'aviso.pdf')

      const res = await request(app)
        .post(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones`)
        .set(auth(e.token))
        .field('fecha', '2026-03-05')
        .field('nota', 'Acuse 4471')
        .attach('archivo', OTRO_PDF, 'refrendo.pdf')

      expect(res.status).toBe(201)
      const siroc = res.body.data.contrato.siroc
      expect(siroc.actualizaciones).toHaveLength(1)
      expect(siroc.actualizaciones[0]).toMatchObject({
        fecha: '2026-03-05',
        nota: 'Acuse 4471',
        archivo: {
          nombre: 'refrendo.pdf',
          tamanoBytes: OTRO_PDF.length,
          nombreDescarga: `${numero}-reporte-bimestral-2026-03-05.pdf`
        }
      })
      // El del aviso sigue en su sitio, intacto.
      expect(siroc.archivo).toMatchObject({ nombre: 'aviso.pdf' })

      const clave = await claveDeActualizacion(contrato._id, 0)
      expect(clave).toContain(`siroc/${contrato._id}/actualizacion-`)
      expect(clave).not.toBe(await claveDelAviso(contrato._id))
    })

    it('la renovación sin acuse guarda `archivo: null`', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)

      await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .send({ numero: siguienteNumero(), fechaRegistro: '2026-01-05' })

      const res = await request(app)
        .post(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones`)
        .set(auth(e.token))
        .send({ fecha: '2026-03-05' })

      expect(res.status).toBe(201)
      expect(res.body.data.contrato.siroc.actualizaciones[0]).toEqual({
        fecha: '2026-03-05',
        nota: null,
        monto: null,
        bimestre: null,
        archivo: null
      })
    })

    it('corregir el aviso conserva los acuses de las renovaciones', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)
      const numero = siguienteNumero()

      await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .send({ numero, fechaRegistro: '2026-01-05' })
      await request(app)
        .post(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones`)
        .set(auth(e.token))
        .field('fecha', '2026-03-05')
        .attach('archivo', PDF, 'refrendo.pdf')

      const clave = await claveDeActualizacion(contrato._id, 0)

      const correccion = await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .send({ numero, fechaRegistro: '2026-01-07' })

      expect(correccion.status).toBe(200)
      expect(
        correccion.body.data.contrato.siroc.actualizaciones[0].archivo
      ).toMatchObject({ nombre: 'refrendo.pdf' })
      expect(await claveDeActualizacion(contrato._id, 0)).toBe(clave)
      expect(storage.contenidoEnMemoria(clave)).not.toBeNull()
    })

    it('deshacer la última renovación se lleva su acuse, y sólo el suyo', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)

      await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .field('numero', siguienteNumero())
        .field('fechaRegistro', '2026-01-05')
        .attach('archivo', PDF, 'aviso.pdf')
      await request(app)
        .post(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones`)
        .set(auth(e.token))
        .field('fecha', '2026-03-05')
        .attach('archivo', OTRO_PDF, 'refrendo.pdf')

      const claveAviso = await claveDelAviso(contrato._id)
      const claveAcuse = await claveDeActualizacion(contrato._id, 0)

      const res = await request(app)
        .delete(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones/ultima`)
        .set(auth(e.token))

      expect(res.status).toBe(200)
      expect(res.body.data.contrato.siroc.actualizaciones).toEqual([])
      expect(storage.contenidoEnMemoria(claveAcuse)).toBeNull()
      expect(storage.contenidoEnMemoria(claveAviso)).not.toBeNull()
    })
  })

  describe('quitar el SIROC', () => {
    it('se lleva el aviso y todos sus acuses', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)

      await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .field('numero', siguienteNumero())
        .field('fechaRegistro', '2026-01-05')
        .attach('archivo', PDF, 'aviso.pdf')
      await request(app)
        .post(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones`)
        .set(auth(e.token))
        .field('fecha', '2026-03-05')
        .attach('archivo', OTRO_PDF, 'refrendo.pdf')

      const claves = [
        await claveDelAviso(contrato._id),
        await claveDeActualizacion(contrato._id, 0)
      ]

      const res = await request(app)
        .delete(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))

      expect(res.status).toBe(200)
      expect(res.body.data.contrato.siroc).toBeNull()
      for (const clave of claves) expect(storage.contenidoEnMemoria(clave)).toBeNull()
    })
  })

  describe('pedir un enlace fresco', () => {
    it('devuelve el del aviso, y `descargar=true` fuerza la descarga', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)
      const numero = siguienteNumero()

      await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .field('numero', numero)
        .field('fechaRegistro', '2026-01-05')
        .attach('archivo', PDF, 'aviso.pdf')

      const res = await request(app)
        .get(`${CONTRATOS}/${contrato._id}/siroc/archivo`)
        .set(auth(e.token))

      expect(res.status).toBe(200)
      expect(res.body.data.archivo).toMatchObject({
        nombre: 'aviso.pdf',
        nombreDescarga: `${numero}.pdf`,
        previsualizable: true
      })
      expect(res.body.data.archivo.url).toEqual(expect.any(String))

      const descarga = await request(app)
        .get(`${CONTRATOS}/${contrato._id}/siroc/archivo?descargar=true`)
        .set(auth(e.token))
      expect(descarga.status).toBe(200)
    })

    it('devuelve el acuse de una renovación por su posición', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)
      const numero = siguienteNumero()

      await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .send({ numero, fechaRegistro: '2026-01-05' })
      await request(app)
        .post(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones`)
        .set(auth(e.token))
        .field('fecha', '2026-03-05')
        .attach('archivo', PDF, 'refrendo.pdf')

      const res = await request(app)
        .get(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones/0/archivo`)
        .set(auth(e.token))

      expect(res.status).toBe(200)
      expect(res.body.data.archivo).toMatchObject({
        nombre: 'refrendo.pdf',
        nombreDescarga: `${numero}-reporte-bimestral-2026-03-05.pdf`
      })
    })

    it('404 cuando no hay archivo, cuando no hay SIROC y cuando la posición no existe', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)

      const sinSiroc = await request(app)
        .get(`${CONTRATOS}/${contrato._id}/siroc/archivo`)
        .set(auth(e.token))
      expect(sinSiroc.status).toBe(404)
      expect(sinSiroc.body.message).toBe('Ese contrato no tiene SIROC registrado')

      await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .send({ numero: siguienteNumero(), fechaRegistro: '2026-01-05' })

      const sinArchivo = await request(app)
        .get(`${CONTRATOS}/${contrato._id}/siroc/archivo`)
        .set(auth(e.token))
      expect(sinArchivo.status).toBe(404)
      expect(sinArchivo.body.message).toBe('Ese SIROC no tiene archivo')

      const sinRenovacion = await request(app)
        .get(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones/3/archivo`)
        .set(auth(e.token))
      expect(sinRenovacion.status).toBe(404)
      expect(sinRenovacion.body.message).toBe('Ese reporte bimestral del SIROC no existe')
    })

    it('400 si la posición no es un número', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)

      const res = await request(app)
        .get(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones/ultima/archivo`)
        .set(auth(e.token))

      expect(res.status).toBe(400)
      expect(res.body.errors[0].msg).toBe('El reporte bimestral indicado no es válido')
    })

    it('401 sin sesión', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)

      const res = await request(app).get(`${CONTRATOS}/${contrato._id}/siroc/archivo`)
      expect(res.status).toBe(401)
    })

    it('404 —no 403— si el contrato es de una empresa que no se ve', async () => {
      const dueño = await escenario()
      const contrato = await contratoDe(dueño)
      await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(dueño.token))
        .field('numero', siguienteNumero())
        .field('fechaRegistro', '2026-01-05')
        .attach('archivo', PDF, 'aviso.pdf')

      // Otra empresa, otro mundo: ni siquiera se entera de que existe.
      const ajeno = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })

      const res = await request(app)
        .get(`${CONTRATOS}/${contrato._id}/siroc/archivo`)
        .set(auth(ajeno.token))

      expect(res.status).toBe(404)
      expect(res.body.message).toBe('El contrato no existe')
    })

    it('403 si el nivel de acceso no puede gestionar proyectos', async () => {
      const e = await escenario()
      const contrato = await contratoDe(e)
      const lector = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_consulta',
        empresa: e.empresa
      })

      // Leer el papel sí puede: es lo mismo que ver el contrato.
      const captura = await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(lector.token))
        .field('numero', siguienteNumero())
        .field('fechaRegistro', '2026-01-05')
        .attach('archivo', PDF, 'aviso.pdf')

      expect(captura.status).toBe(403)
    })
  })

  describe('ponerle el acuse a una renovación ya capturada', () => {
    /**
     * Contrato con SIROC y `cuantas` renovaciones capturadas SIN acuse: el caso
     * real, porque el papel sellado llega días después de ir al IMSS.
     */
    async function conRefrendos(e, cuantas) {
      const contrato = await contratoDe(e)
      const numero = siguienteNumero()

      await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .send({ numero, fechaRegistro: '2026-01-05' })

      for (let i = 0; i < cuantas; i++) {
        await request(app)
          .post(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones`)
          .set(auth(e.token))
          .send({ fecha: `2026-0${3 + i * 2}-05`, nota: `Refrendo ${i + 1}` })
      }

      return { contrato, numero }
    }

    it('lo guarda sin mover la fecha, la nota ni el seguimiento', async () => {
      const e = await escenario()
      const { contrato, numero } = await conRefrendos(e, 1)

      const antes = await request(app)
        .get(`${PROYECTOS}/${e.proyecto._id}/contratos`)
        .set(auth(e.token))
      const seguimientoAntes = antes.body.data.contratos[0].seguimientoSiroc

      const res = await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones/0/archivo`)
        .set(auth(e.token))
        .attach('archivo', PDF, 'acuse sellado.pdf')

      expect(res.status).toBe(200)
      const siroc = res.body.data.contrato.siroc
      expect(siroc.actualizaciones).toHaveLength(1)
      expect(siroc.actualizaciones[0]).toMatchObject({
        // Lo demás queda exactamente como estaba: sólo entra el papel.
        fecha: '2026-03-05',
        nota: 'Refrendo 1',
        archivo: {
          nombre: 'acuse sellado.pdf',
          nombreDescarga: `${numero}-reporte-bimestral-2026-03-05.pdf`,
          previsualizable: true
        }
      })
      expect(siroc.actualizaciones[0].archivo.url).toEqual(expect.any(String))

      /*
       * Lo que esta ruta viene a evitar: deshacer y recapturar movía la ventana
       * de dos meses y con ella todos los avisos de vencimiento (D-76).
       */
      expect(res.body.data.contrato.seguimientoSiroc).toEqual(seguimientoAntes)
    })

    it('sirve para una de EN MEDIO, no sólo para la última', async () => {
      const e = await escenario()
      const { contrato } = await conRefrendos(e, 3)

      const res = await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones/1/archivo`)
        .set(auth(e.token))
        .attach('archivo', PDF, 'acuse de en medio.pdf')

      expect(res.status).toBe(200)
      const actualizaciones = res.body.data.contrato.siroc.actualizaciones
      expect(actualizaciones).toHaveLength(3)
      expect(actualizaciones[1].archivo).toMatchObject({
        nombre: 'acuse de en medio.pdf'
      })
      // Y sólo esa: las vecinas siguen sin papel y en su sitio.
      expect(actualizaciones[0]).toMatchObject({ fecha: '2026-03-05', archivo: null })
      expect(actualizaciones[2]).toMatchObject({ fecha: '2026-07-05', archivo: null })
    })

    it('reemplaza el que hubiera y borra el anterior del almacenamiento', async () => {
      const e = await escenario()
      const { contrato } = await conRefrendos(e, 1)
      const ruta = `${CONTRATOS}/${contrato._id}/siroc/actualizaciones/0/archivo`

      await request(app).put(ruta).set(auth(e.token)).attach('archivo', PDF, 'viejo.pdf')
      const anterior = await claveDeActualizacion(contrato._id, 0)

      const res = await request(app)
        .put(ruta)
        .set(auth(e.token))
        .attach('archivo', OTRO_PDF, 'nuevo.pdf')

      expect(res.status).toBe(200)
      expect(res.body.data.contrato.siroc.actualizaciones[0].archivo).toMatchObject({
        nombre: 'nuevo.pdf',
        tamanoBytes: OTRO_PDF.length
      })

      const clave = await claveDeActualizacion(contrato._id, 0)
      expect(clave).not.toBe(anterior)
      expect(storage.contenidoEnMemoria(anterior)).toBeNull()
      expect(storage.contenidoEnMemoria(clave)).not.toBeNull()
    })

    it('se puede aunque el contrato ya esté finalizado: el acuse llega tarde', async () => {
      const e = await escenario()
      const { contrato } = await conRefrendos(e, 1)

      await request(app).post(`${CONTRATOS}/${contrato._id}/finalizar`).set(auth(e.token))

      const res = await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones/0/archivo`)
        .set(auth(e.token))
        .attach('archivo', PDF, 'acuse tardio.pdf')

      expect(res.status).toBe(200)
      expect(res.body.data.contrato.siroc.actualizaciones[0].archivo).toMatchObject({
        nombre: 'acuse tardio.pdf'
      })
    })

    it('400 sin archivo, 404 fuera de rango, 400 sin SIROC y 415 con un tipo ajeno', async () => {
      const e = await escenario()
      const { contrato } = await conRefrendos(e, 1)

      const vacia = await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones/0/archivo`)
        .set(auth(e.token))
      expect(vacia.status).toBe(400)
      // El mensaje nombra los dos caminos desde D-83: el `multipart` y la
      // subida directa, que se confirma con `subidaId`.
      expect(vacia.body.errors[0].msg).toBe(
        'Envía el archivo en el campo "archivo", o su `subidaId`'
      )

      const fuera = await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones/7/archivo`)
        .set(auth(e.token))
        .attach('archivo', PDF, 'acuse.pdf')
      expect(fuera.status).toBe(404)
      expect(fuera.body.message).toBe('Ese reporte bimestral del SIROC no existe')

      const tipo = await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones/0/archivo`)
        .set(auth(e.token))
        .attach('archivo', HEIC, 'acuse.heic')
      expect(tipo.status).toBe(415)
      // Y la actualización se quedó como estaba, sin papel.
      expect(await claveDeActualizacion(contrato._id, 0)).toBeNull()

      const otro = await contratoDe(e)
      const sinSiroc = await request(app)
        .put(`${CONTRATOS}/${otro._id}/siroc/actualizaciones/0/archivo`)
        .set(auth(e.token))
        .attach('archivo', PDF, 'acuse.pdf')
      expect(sinSiroc.status).toBe(400)
      expect(sinSiroc.body.message).toBe('Ese contrato no tiene SIROC registrado')
    })

    it('403 para quien no puede gestionar proyectos, y 404 fuera de alcance', async () => {
      const e = await escenario()
      const { contrato } = await conRefrendos(e, 1)
      const ruta = `${CONTRATOS}/${contrato._id}/siroc/actualizaciones/0/archivo`

      const lector = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_consulta',
        empresa: e.empresa
      })
      const prohibido = await request(app)
        .put(ruta)
        .set(auth(lector.token))
        .attach('archivo', PDF, 'acuse.pdf')
      expect(prohibido.status).toBe(403)

      const ajeno = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const invisible = await request(app)
        .put(ruta)
        .set(auth(ajeno.token))
        .attach('archivo', PDF, 'acuse.pdf')
      expect(invisible.status).toBe(404)
      expect(invisible.body.message).toBe('El contrato no existe')

      const sinSesion = await request(app).put(ruta).attach('archivo', PDF, 'acuse.pdf')
      expect(sinSesion.status).toBe(401)
    })
  })

  describe('en el expediente de quien trabaja en la obra', () => {
    it('la obra trae el SIROC con su archivo firmado', async () => {
      await ensureBaseChecklistTemplates()
      const e = await escenario()
      const contrato = await contratoDe(e)
      const numero = siguienteNumero()

      await request(app)
        .put(`${CONTRATOS}/${contrato._id}/siroc`)
        .set(auth(e.token))
        .field('numero', numero)
        .field('fechaRegistro', '2026-01-05')
        .attach('archivo', PDF, 'aviso.pdf')
      await request(app)
        .post(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones`)
        .set(auth(e.token))
        .field('fecha', '2026-03-05')
        .attach('archivo', OTRO_PDF, 'refrendo.pdf')

      const categoria = await crearCategoria('Albañil SIROC', 'mano_de_obra')
      const persona = await crearEmpleado({
        nombre: 'Ana Ruiz Obra',
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      await adscribir(e.empresa, persona, { areas: ['operaciones_urbanizadora'] })
      await asignar(e.proyecto, persona, categoria._id)

      const res = await request(app)
        .get(`${EMPLEADOS}/${persona._id}/expediente`)
        .set(auth(e.token))

      expect(res.status).toBe(200)
      const obra = res.body.data.obras.find((o) => o.contrato._id === contrato._id)
      expect(obra.siroc).toMatchObject({
        numero,
        archivo: {
          nombre: 'aviso.pdf',
          nombreDescarga: `${numero}.pdf`,
          previsualizable: true
        }
      })
      expect(obra.siroc.archivo.url).toEqual(expect.any(String))
      expect(obra.siroc.actualizaciones[0].archivo).toMatchObject({
        nombre: 'refrendo.pdf',
        nombreDescarga: `${numero}-reporte-bimestral-2026-03-05.pdf`
      })
      // Tampoco aquí sale la clave de almacenamiento.
      expect(obra.siroc.archivo.claveAlmacenamiento).toBeUndefined()
    })
  })
})
