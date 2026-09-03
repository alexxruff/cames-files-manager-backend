const request = require('supertest')
const app = require('../../src/app')
const storage = require('../../src/services/storageService')
const Machine = require('../../src/api/v1/machines/machineModel')
const Upload = require('../../src/api/v1/uploads/uploadModel')
const {
  crearEmpleadoConSesion,
  crearEmpresa,
  adscribir,
  auth
} = require('../helpers/factories')

/**
 * El catálogo de maquinaria por empresa (D-86).
 *
 * Lo que vigilan estas pruebas: que el catálogo sea de la empresa —fuera de
 * alcance no existe—, que el identificador no se repita dentro de ella, que la
 * imagen entre por los dos caminos de siempre y sea de verdad una imagen, y que
 * la baja esconda sin borrar.
 *
 * El almacenamiento corre con el driver de memoria: `contenidoEnMemoria` dice
 * lo que quedó guardado y lo que se borró.
 */
const EMPRESAS = '/api/v1/empresas'
const MAQUINAS = '/api/v1/maquinas'
const SUBIDAS = '/api/v1/subidas'

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 0)
])
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0)])
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)])

const claveDe = (url) => url.replace(/^memoria:\/\//, '').split('?')[0]

async function escenario(datos = {}) {
  return crearEmpleadoConSesion({ nivelAcceso: 'rh_admin', ...datos })
}

async function maquinaDe(e, datos = {}) {
  const res = await request(app)
    .post(`${EMPRESAS}/${e.empresa._id}/maquinas`)
    .set(auth(e.token))
    .send({ identificador: 'ECO-12', modelo: 'CAT 320D', ...datos })
  expect(res.status).toBe(201)
  return res.body.data.maquina
}

async function claveDeLaImagen(maquinaId) {
  const doc = await Machine.findById(maquinaId)
  return doc.imagen?.claveAlmacenamiento ?? null
}

describe('El catálogo de maquinaria', () => {
  describe('el alta', () => {
    it('crea la máquina con identificador y modelo, sin imagen', async () => {
      const e = await escenario()
      const maquina = await maquinaDe(e)

      expect(maquina).toMatchObject({
        empresaId: String(e.empresa._id),
        identificador: 'ECO-12',
        modelo: 'CAT 320D',
        imagen: null,
        activo: true
      })
      expect(maquina._id).toEqual(expect.any(String))
      expect(maquina.id).toBeUndefined()
    })

    it('acepta la foto en el mismo multipart y sale firmada', async () => {
      const e = await escenario()

      const res = await request(app)
        .post(`${EMPRESAS}/${e.empresa._id}/maquinas`)
        .set(auth(e.token))
        .field('identificador', 'ECO-12')
        .field('modelo', 'CAT 320D')
        .attach('archivo', PNG, 'foto patio (1).png')

      expect(res.status).toBe(201)
      expect(res.body.data.maquina.imagen).toMatchObject({
        nombre: 'foto patio (1).png',
        mime: 'image/png',
        tamanoBytes: PNG.length,
        previsualizable: true,
        // Baja con el nombre del DATO, no del archivo (D-78).
        nombreDescarga: 'ECO-12.png'
      })
      expect(res.body.data.maquina.imagen.url).toEqual(expect.any(String))
      expect(res.body.data.maquina.imagen.claveAlmacenamiento).toBeUndefined()

      const clave = await claveDeLaImagen(res.body.data.maquina._id)
      expect(clave).toContain(`maquinas/${res.body.data.maquina._id}/imagen-`)
      expect(storage.contenidoEnMemoria(clave)).not.toBeNull()
    })

    it('409 MAQUINA_DUPLICADA si el identificador ya existe en la empresa, sin importar acentos ni mayúsculas', async () => {
      const e = await escenario()
      const primera = await maquinaDe(e, { identificador: 'Eco 12' })

      const res = await request(app)
        .post(`${EMPRESAS}/${e.empresa._id}/maquinas`)
        .set(auth(e.token))
        .send({ identificador: 'ECO 12', modelo: 'Otra' })

      expect(res.status).toBe(409)
      expect(res.body.code).toBe('MAQUINA_DUPLICADA')
      expect(res.body.errors[0]).toMatchObject({ path: 'identificador' })
      expect(res.body.data.maquina._id).toBe(primera._id)
    })

    it('el mismo identificador en OTRA empresa sí se puede', async () => {
      const a = await escenario()
      const b = await escenario()
      await maquinaDe(a)
      const otra = await maquinaDe(b)
      expect(otra.identificador).toBe('ECO-12')
    })

    it('400 sin identificador o sin modelo', async () => {
      const e = await escenario()

      const res = await request(app)
        .post(`${EMPRESAS}/${e.empresa._id}/maquinas`)
        .set(auth(e.token))
        .send({ modelo: 'CAT' })

      expect(res.status).toBe(400)
      expect(res.body.errors[0].msg).toMatch(/identificador/i)
    })

    it('415 si la "imagen" es un PDF, y no deja nada guardado', async () => {
      const e = await escenario()

      const res = await request(app)
        .post(`${EMPRESAS}/${e.empresa._id}/maquinas`)
        .set(auth(e.token))
        .field('identificador', 'ECO-12')
        .field('modelo', 'CAT 320D')
        .attach('archivo', PDF, 'ficha.pdf')

      expect(res.status).toBe(415)
      expect(res.body.message).toMatch(/JPG, PNG o WEBP/)
      expect(await Machine.countDocuments()).toBe(0)
    })

    it('403 para quien no gestiona proyectos; 401 sin sesión', async () => {
      const e = await escenario({ nivelAcceso: 'rh_consulta' })

      const res = await request(app)
        .post(`${EMPRESAS}/${e.empresa._id}/maquinas`)
        .set(auth(e.token))
        .send({ identificador: 'ECO-12', modelo: 'CAT' })
      expect(res.status).toBe(403)

      const sinSesion = await request(app)
        .post(`${EMPRESAS}/${e.empresa._id}/maquinas`)
        .send({ identificador: 'ECO-12', modelo: 'CAT' })
      expect(sinSesion.status).toBe(401)
    })

    it('el jefe de área sí da de alta: gestiona proyectos', async () => {
      const e = await escenario({ nivelAcceso: 'jefe_area', areas: ['Obra'] })
      const maquina = await maquinaDe(e)
      expect(maquina.identificador).toBe('ECO-12')
    })

    it('404 si la empresa no es visible: no existe para quien pide', async () => {
      const e = await escenario()
      const ajena = await crearEmpresa()

      const res = await request(app)
        .post(`${EMPRESAS}/${ajena._id}/maquinas`)
        .set(auth(e.token))
        .send({ identificador: 'ECO-12', modelo: 'CAT' })

      expect(res.status).toBe(404)
      expect(await Machine.countDocuments()).toBe(0)
    })
  })

  describe('el listado', () => {
    it('trae las máquinas de la empresa, ordenadas por identificador, y esconde las de baja', async () => {
      const e = await escenario()
      const b = await maquinaDe(e, { identificador: 'ECO-2' })
      await maquinaDe(e, { identificador: 'ECO-10' })
      await maquinaDe(e, { identificador: 'ECO-1' })
      await request(app)
        .patch(`${MAQUINAS}/${b._id}/estado`)
        .set(auth(e.token))
        .send({ activo: false })

      const res = await request(app)
        .get(`${EMPRESAS}/${e.empresa._id}/maquinas`)
        .set(auth(e.token))

      expect(res.status).toBe(200)
      expect(res.body.data.total).toBe(2)
      // Orden natural: ECO-2 antes que ECO-10.
      expect(res.body.data.maquinas.map((m) => m.identificador)).toEqual([
        'ECO-1',
        'ECO-10'
      ])

      const todas = await request(app)
        .get(`${EMPRESAS}/${e.empresa._id}/maquinas?incluirInactivas=true`)
        .set(auth(e.token))
      expect(todas.body.data.maquinas.map((m) => m.identificador)).toEqual([
        'ECO-1',
        'ECO-2',
        'ECO-10'
      ])
    })

    it('busca por identificador o por modelo', async () => {
      const e = await escenario()
      await maquinaDe(e, { identificador: 'ECO-1', modelo: 'Retroexcavadora JCB' })
      await maquinaDe(e, { identificador: 'ECO-2', modelo: 'Camión Kenworth' })

      const res = await request(app)
        .get(`${EMPRESAS}/${e.empresa._id}/maquinas?busqueda=camion`)
        .set(auth(e.token))

      expect(res.body.data.maquinas.map((m) => m.identificador)).toEqual(['ECO-2'])
    })

    it('no mezcla catálogos: cada empresa ve sólo el suyo', async () => {
      const a = await escenario()
      const b = await escenario()
      await maquinaDe(a, { identificador: 'DE-A' })
      await maquinaDe(b, { identificador: 'DE-B' })

      const res = await request(app)
        .get(`${EMPRESAS}/${a.empresa._id}/maquinas`)
        .set(auth(a.token))
      expect(res.body.data.maquinas.map((m) => m.identificador)).toEqual(['DE-A'])

      // La empresa ajena: 404, no 403 ni lista vacía.
      const ajena = await request(app)
        .get(`${EMPRESAS}/${b.empresa._id}/maquinas`)
        .set(auth(a.token))
      expect(ajena.status).toBe(404)
    })

    it('el administrador de plataforma ve el catálogo de cualquier empresa', async () => {
      const admin = await escenario({ alcanceGlobal: true })
      const otra = await escenario()
      await maquinaDe(otra)

      const res = await request(app)
        .get(`${EMPRESAS}/${otra.empresa._id}/maquinas`)
        .set(auth(admin.token))
      expect(res.status).toBe(200)
      expect(res.body.data.total).toBe(1)
    })

    it('quien tiene adscripción en dos empresas ve las dos', async () => {
      const otra = await crearEmpresa()
      const e = await escenario()
      await adscribir(otra, e.empleado)
      // La sesión se calcula al entrar: vuelve a iniciar para tener las dos.
      const sesion = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: e.empleado.acceso.email, password: 'Urbacames1!' })
      const token = sesion.body.data.token

      await maquinaDe({ ...e, token }, { identificador: 'X-1' })
      const res = await request(app)
        .post(`${EMPRESAS}/${otra._id}/maquinas`)
        .set(auth(token))
        .send({ identificador: 'X-1', modelo: 'M' })
      expect(res.status).toBe(201)
    })
  })

  describe('la ficha y la edición', () => {
    it('GET /maquinas/:id la devuelve; 404 fuera de alcance; 400 con id inválido', async () => {
      const e = await escenario()
      const ajeno = await escenario()
      const maquina = await maquinaDe(e)

      const res = await request(app).get(`${MAQUINAS}/${maquina._id}`).set(auth(e.token))
      expect(res.status).toBe(200)
      expect(res.body.data.maquina._id).toBe(maquina._id)

      const fuera = await request(app)
        .get(`${MAQUINAS}/${maquina._id}`)
        .set(auth(ajeno.token))
      expect(fuera.status).toBe(404)

      const invalido = await request(app).get(`${MAQUINAS}/no-es-id`).set(auth(e.token))
      expect(invalido.status).toBe(400)
    })

    it('edita identificador y modelo sin tocar la imagen', async () => {
      const e = await escenario()
      const alta = await request(app)
        .post(`${EMPRESAS}/${e.empresa._id}/maquinas`)
        .set(auth(e.token))
        .field('identificador', 'ECO-12')
        .field('modelo', 'CAT 320D')
        .attach('archivo', PNG, 'foto.png')
      const maquina = alta.body.data.maquina
      const clave = await claveDeLaImagen(maquina._id)

      const res = await request(app)
        .patch(`${MAQUINAS}/${maquina._id}`)
        .set(auth(e.token))
        .send({ identificador: 'ECO-13', modelo: 'CAT 320E' })

      expect(res.status).toBe(200)
      expect(res.body.message).toBe('Máquina actualizada')
      expect(res.body.data.maquina).toMatchObject({
        identificador: 'ECO-13',
        modelo: 'CAT 320E',
        imagen: { nombre: 'foto.png', nombreDescarga: 'ECO-13.png' }
      })
      expect(await claveDeLaImagen(maquina._id)).toBe(clave)
    })

    it('409 si el identificador nuevo es el de otra máquina de la empresa', async () => {
      const e = await escenario()
      await maquinaDe(e, { identificador: 'ECO-1' })
      const segunda = await maquinaDe(e, { identificador: 'ECO-2' })

      const res = await request(app)
        .patch(`${MAQUINAS}/${segunda._id}`)
        .set(auth(e.token))
        .send({ identificador: 'eco-1' })

      expect(res.status).toBe(409)
      expect(res.body.code).toBe('MAQUINA_DUPLICADA')

      // Y conservar el propio no choca consigo misma.
      const mismo = await request(app)
        .patch(`${MAQUINAS}/${segunda._id}`)
        .set(auth(e.token))
        .send({ identificador: 'ECO-2', modelo: 'Nuevo' })
      expect(mismo.status).toBe(200)
    })

    it('400 con cuerpo vacío o con campos que no van aquí', async () => {
      const e = await escenario()
      const maquina = await maquinaDe(e)

      const vacio = await request(app)
        .patch(`${MAQUINAS}/${maquina._id}`)
        .set(auth(e.token))
        .send({})
      expect(vacio.status).toBe(400)
      expect(vacio.body.errors[0].msg).toMatch(/nada que actualizar/i)

      const activo = await request(app)
        .patch(`${MAQUINAS}/${maquina._id}`)
        .set(auth(e.token))
        .send({ activo: false })
      expect(activo.status).toBe(400)
      expect(activo.body.errors[0].msg).toMatch(/\/maquinas\/:id\/estado/)
    })

    it('la foto se pone después con un multipart de sólo archivo, y reemplazarla borra la anterior', async () => {
      const e = await escenario()
      const maquina = await maquinaDe(e)

      const primera = await request(app)
        .patch(`${MAQUINAS}/${maquina._id}`)
        .set(auth(e.token))
        .attach('archivo', PNG, 'foto.png')
      expect(primera.status).toBe(200)
      expect(primera.body.message).toBe('Máquina actualizada con su imagen')
      const claveVieja = await claveDeLaImagen(maquina._id)
      expect(storage.contenidoEnMemoria(claveVieja)).not.toBeNull()

      const segunda = await request(app)
        .patch(`${MAQUINAS}/${maquina._id}`)
        .set(auth(e.token))
        .attach('archivo', JPG, 'foto2.jpg')
      expect(segunda.status).toBe(200)
      expect(segunda.body.data.maquina.imagen).toMatchObject({
        mime: 'image/jpeg',
        nombreDescarga: 'ECO-12.jpg'
      })

      const claveNueva = await claveDeLaImagen(maquina._id)
      expect(claveNueva).not.toBe(claveVieja)
      expect(storage.contenidoEnMemoria(claveVieja)).toBeNull()
      expect(storage.contenidoEnMemoria(claveNueva)).not.toBeNull()
    })

    it('415 al reemplazar la foto con un PDF, y la anterior se queda', async () => {
      const e = await escenario()
      const maquina = await maquinaDe(e)
      await request(app)
        .patch(`${MAQUINAS}/${maquina._id}`)
        .set(auth(e.token))
        .attach('archivo', PNG, 'foto.png')
      const clave = await claveDeLaImagen(maquina._id)

      const res = await request(app)
        .patch(`${MAQUINAS}/${maquina._id}`)
        .set(auth(e.token))
        .attach('archivo', PDF, 'ficha.pdf')

      expect(res.status).toBe(415)
      expect(await claveDeLaImagen(maquina._id)).toBe(clave)
      expect(storage.contenidoEnMemoria(clave)).not.toBeNull()
    })

    it('403 al editar sin la capacidad; 404 al editar la de otra empresa', async () => {
      const e = await escenario()
      const consulta = await escenario({ nivelAcceso: 'rh_consulta', empresa: e.empresa })
      const ajeno = await escenario()
      const maquina = await maquinaDe(e)

      const sinPermiso = await request(app)
        .patch(`${MAQUINAS}/${maquina._id}`)
        .set(auth(consulta.token))
        .send({ modelo: 'X' })
      expect(sinPermiso.status).toBe(403)

      const fuera = await request(app)
        .patch(`${MAQUINAS}/${maquina._id}`)
        .set(auth(ajeno.token))
        .send({ modelo: 'X' })
      expect(fuera.status).toBe(404)
    })
  })

  describe('la baja y la reactivación', () => {
    it('da de baja, no borra, y vuelve a activar; repetir el estado es 400', async () => {
      const e = await escenario()
      const maquina = await maquinaDe(e)

      const baja = await request(app)
        .patch(`${MAQUINAS}/${maquina._id}/estado`)
        .set(auth(e.token))
        .send({ activo: false })
      expect(baja.status).toBe(200)
      expect(baja.body.message).toBe('Máquina dada de baja')
      expect(baja.body.data.maquina.activo).toBe(false)
      expect(await Machine.countDocuments()).toBe(1)

      // De baja sigue teniendo ficha: el catálogo la esconde, no la pierde.
      const ficha = await request(app)
        .get(`${MAQUINAS}/${maquina._id}`)
        .set(auth(e.token))
      expect(ficha.status).toBe(200)
      expect(ficha.body.data.maquina.activo).toBe(false)

      const repetida = await request(app)
        .patch(`${MAQUINAS}/${maquina._id}/estado`)
        .set(auth(e.token))
        .send({ activo: false })
      expect(repetida.status).toBe(400)

      const alta = await request(app)
        .patch(`${MAQUINAS}/${maquina._id}/estado`)
        .set(auth(e.token))
        .send({ activo: true })
      expect(alta.status).toBe(200)
      expect(alta.body.message).toBe('Máquina reactivada')
    })

    it('400 si activo no es booleano; 403 sin capacidad; 404 fuera de alcance', async () => {
      const e = await escenario()
      const consulta = await escenario({ nivelAcceso: 'rh_consulta', empresa: e.empresa })
      const ajeno = await escenario()
      const maquina = await maquinaDe(e)

      const malo = await request(app)
        .patch(`${MAQUINAS}/${maquina._id}/estado`)
        .set(auth(e.token))
        .send({ activo: 'no' })
      expect(malo.status).toBe(400)

      const sinPermiso = await request(app)
        .patch(`${MAQUINAS}/${maquina._id}/estado`)
        .set(auth(consulta.token))
        .send({ activo: false })
      expect(sinPermiso.status).toBe(403)

      const fuera = await request(app)
        .patch(`${MAQUINAS}/${maquina._id}/estado`)
        .set(auth(ajeno.token))
        .send({ activo: false })
      expect(fuera.status).toBe(404)
    })
  })

  describe('el enlace a la imagen', () => {
    it('GET /maquinas/:id/imagen da un enlace fresco; sin imagen es 404', async () => {
      const e = await escenario()
      const maquina = await maquinaDe(e)

      const sin = await request(app)
        .get(`${MAQUINAS}/${maquina._id}/imagen`)
        .set(auth(e.token))
      expect(sin.status).toBe(404)
      expect(sin.body.message).toMatch(/no tiene imagen/)

      await request(app)
        .patch(`${MAQUINAS}/${maquina._id}`)
        .set(auth(e.token))
        .attach('archivo', PNG, 'foto.png')

      const res = await request(app)
        .get(`${MAQUINAS}/${maquina._id}/imagen`)
        .set(auth(e.token))
      expect(res.status).toBe(200)
      expect(res.body.data.imagen).toMatchObject({
        nombre: 'foto.png',
        mime: 'image/png',
        nombreDescarga: 'ECO-12.png',
        previsualizable: true
      })
      expect(res.body.data.imagen.url).toEqual(expect.any(String))
    })

    it('la ve quien sólo consulta; no la ve quien es de otra empresa', async () => {
      const e = await escenario()
      const consulta = await escenario({ nivelAcceso: 'rh_consulta', empresa: e.empresa })
      const ajeno = await escenario()
      const maquina = await maquinaDe(e)
      await request(app)
        .patch(`${MAQUINAS}/${maquina._id}`)
        .set(auth(e.token))
        .attach('archivo', PNG, 'foto.png')

      const ok = await request(app)
        .get(`${MAQUINAS}/${maquina._id}/imagen`)
        .set(auth(consulta.token))
      expect(ok.status).toBe(200)

      const fuera = await request(app)
        .get(`${MAQUINAS}/${maquina._id}/imagen`)
        .set(auth(ajeno.token))
      expect(fuera.status).toBe(404)
    })
  })

  describe('la subida directa (D-83)', () => {
    async function pedirPermiso(token, cuerpo) {
      return request(app)
        .post(SUBIDAS)
        .set(auth(token))
        .send({ destino: 'maquina', nombre: 'foto.png', mime: 'image/png', ...cuerpo })
    }

    it('la foto entra en el alta con el permiso pedido para la empresa', async () => {
      const e = await escenario()

      const permiso = await pedirPermiso(e.token, {
        referencia: { empresaId: String(e.empresa._id) },
        tamanoBytes: PNG.length
      })
      expect(permiso.status).toBe(201)
      await storage.subir({
        buffer: PNG,
        clave: claveDe(permiso.body.data.subida.url),
        contentType: 'image/png'
      })

      const res = await request(app)
        .post(`${EMPRESAS}/${e.empresa._id}/maquinas`)
        .set(auth(e.token))
        .send({
          identificador: 'ECO-12',
          modelo: 'CAT',
          subidaId: permiso.body.data.subida._id
        })

      expect(res.status).toBe(201)
      expect(res.body.data.maquina.imagen).toMatchObject({
        nombre: 'foto.png',
        mime: 'image/png'
      })
      expect(await claveDeLaImagen(res.body.data.maquina._id)).toMatch(/maquinas\//)

      const subida = await Upload.findById(permiso.body.data.subida._id)
      expect(subida.estado).toBe('usada')
    })

    it('y se reemplaza con el permiso pedido para la máquina', async () => {
      const e = await escenario()
      const maquina = await maquinaDe(e)

      const permiso = await pedirPermiso(e.token, {
        referencia: { maquinaId: maquina._id },
        tamanoBytes: JPG.length,
        nombre: 'foto.jpg',
        mime: 'image/jpeg'
      })
      expect(permiso.status).toBe(201)
      await storage.subir({
        buffer: JPG,
        clave: claveDe(permiso.body.data.subida.url),
        contentType: 'image/jpeg'
      })

      const res = await request(app)
        .patch(`${MAQUINAS}/${maquina._id}`)
        .set(auth(e.token))
        .send({ subidaId: permiso.body.data.subida._id })

      expect(res.status).toBe(200)
      expect(res.body.data.maquina.imagen.mime).toBe('image/jpeg')
    })

    it('un permiso de la empresa no sirve para reemplazar la foto de una máquina', async () => {
      const e = await escenario()
      const maquina = await maquinaDe(e)
      const permiso = await pedirPermiso(e.token, {
        referencia: { empresaId: String(e.empresa._id) },
        tamanoBytes: PNG.length
      })
      await storage.subir({
        buffer: PNG,
        clave: claveDe(permiso.body.data.subida.url),
        contentType: 'image/png'
      })

      const res = await request(app)
        .patch(`${MAQUINAS}/${maquina._id}`)
        .set(auth(e.token))
        .send({ subidaId: permiso.body.data.subida._id })

      expect(res.status).toBe(400)
      expect(res.body.errors[0].path).toBe('subidaId')
    })

    it('415 si lo subido es un PDF: se borra el objeto y el permiso', async () => {
      const e = await escenario()
      const maquina = await maquinaDe(e)
      const permiso = await pedirPermiso(e.token, {
        referencia: { maquinaId: maquina._id },
        tamanoBytes: PDF.length,
        nombre: 'ficha.pdf',
        mime: 'application/pdf'
      })
      const claveTemporal = claveDe(permiso.body.data.subida.url)
      await storage.subir({
        buffer: PDF,
        clave: claveTemporal,
        contentType: 'application/pdf'
      })

      const res = await request(app)
        .patch(`${MAQUINAS}/${maquina._id}`)
        .set(auth(e.token))
        .send({ subidaId: permiso.body.data.subida._id })

      expect(res.status).toBe(415)
      expect(storage.contenidoEnMemoria(claveTemporal)).toBeNull()
      expect(await Upload.findById(permiso.body.data.subida._id)).toBeNull()
    })

    it('exige empresa o máquina; 404 si son de otra empresa; 403 sin capacidad', async () => {
      const e = await escenario()
      const ajeno = await escenario()
      const consulta = await escenario({ nivelAcceso: 'rh_consulta', empresa: e.empresa })
      const maquina = await maquinaDe(e)

      const sinRef = await pedirPermiso(e.token, { tamanoBytes: PNG.length })
      expect(sinRef.status).toBe(400)

      const empresaAjena = await pedirPermiso(ajeno.token, {
        referencia: { empresaId: String(e.empresa._id) },
        tamanoBytes: PNG.length
      })
      expect(empresaAjena.status).toBe(404)

      const maquinaAjena = await pedirPermiso(ajeno.token, {
        referencia: { maquinaId: maquina._id },
        tamanoBytes: PNG.length
      })
      expect(maquinaAjena.status).toBe(404)

      const sinCapacidad = await pedirPermiso(consulta.token, {
        referencia: { maquinaId: maquina._id },
        tamanoBytes: PNG.length
      })
      expect(sinCapacidad.status).toBe(403)
    })
  })
})
