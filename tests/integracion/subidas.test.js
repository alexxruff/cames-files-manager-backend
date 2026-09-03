const request = require('supertest')
const mongoose = require('mongoose')
const app = require('../../src/app')
const storage = require('../../src/services/storageService')
const Upload = require('../../src/api/v1/uploads/uploadModel')
const Contract = require('../../src/api/v1/contracts/contractModel')
const {
  ensureBaseChecklistTemplates
} = require('../../src/services/seedChecklistTemplates')
const {
  crearEmpleadoConSesion,
  crearEmpleado,
  crearCliente,
  agregarACartera,
  crearProyecto,
  adscribir,
  auth
} = require('../helpers/factories')

/**
 * Subida directa al almacenamiento (D-83).
 *
 * El archivo deja de pasar por el servidor: se pide un permiso, el navegador
 * sube a R2 con una URL firmada, y la ruta de siempre registra el adjunto con
 * `subidaId` en vez de `multipart`.
 *
 * Lo que estas pruebas vigilan es que **quitar el archivo del camino no quite
 * ninguna comprobación**: capacidad, alcance, tipo real por contenido, tamaño y
 * que un permiso sirva una sola vez y sólo para lo suyo.
 *
 * El almacenamiento corre con el driver de memoria, así que `subirComoNavegador`
 * hace lo que haría el `PUT` del navegador: dejar los bytes en la clave que dice
 * la URL firmada.
 */
const SUBIDAS = '/api/v1/subidas'
const CONTRATOS = '/api/v1/contratos'
const PROYECTOS = '/api/v1/proyectos'
const CLIENTES = '/api/v1/clientes'
const EXPEDIENTES = '/api/v1/expedientes'

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)])
/** Un HEIC: firma real, y fuera de los tipos aceptados a propósito (D-78). */
const HEIC = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypheic'),
  Buffer.alloc(32, 0)
])

/**
 * La clave a la que apunta la URL firmada del driver de memoria.
 *
 * A mano y no con `new URL`: el esquema `memoria://` no tiene host, así que el
 * parser se comería el primer tramo de la clave —que con `R2_PREFIX` es la
 * carpeta— y la subida acabaría en otro sitio.
 */
const claveDe = (url) => url.replace(/^memoria:\/\//, '').split('?')[0]

/**
 * Lo que hace el navegador entre pedir el permiso y confirmarlo: poner los bytes
 * donde dice la URL. Con R2 sería un `PUT`; aquí, el driver de memoria.
 */
async function subirComoNavegador(url, buffer, contentType = 'application/pdf') {
  await storage.subir({ buffer, clave: claveDe(url), contentType })
}

async function pedirPermiso(token, cuerpo) {
  return request(app).post(SUBIDAS).set(auth(token)).send(cuerpo)
}

async function escenario(datos = {}) {
  const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin', ...datos })
  const { proyecto, cliente } = await crearProyecto(sesion.empresa, {
    // Ancho: los contratos de estas pruebas caben dentro (D-85).
    fechaInicio: '2026-01-01',
    fechaFinEstimada: '2027-12-31'
  })
  return { ...sesion, proyecto, cliente }
}

async function contratoDe(e) {
  const res = await request(app)
    .post(`${PROYECTOS}/${e.proyecto._id}/contratos`)
    .set(auth(e.token))
    .send({ nombre: 'Cimentación', fechaInicio: '2026-01-01', fechaFin: '2027-12-31' })
  return res.body.data.contrato
}

describe('POST /api/v1/subidas — el permiso', () => {
  it('lo emite con URL, método y encabezados, y deja la subida pendiente', async () => {
    const e = await escenario()
    const contrato = await contratoDe(e)

    const res = await pedirPermiso(e.token, {
      destino: 'contrato',
      referencia: { contratoId: contrato._id },
      nombre: 'contrato-firmado.pdf',
      mime: 'application/pdf',
      tamanoBytes: PDF.length
    })

    expect(res.status).toBe(201)
    expect(res.body.data.subida).toMatchObject({
      metodo: 'PUT',
      encabezados: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(PDF.length)
      }
    })
    expect(typeof res.body.data.subida.url).toBe('string')
    expect(new Date(res.body.data.subida.expiraEn).getTime()).toBeGreaterThan(Date.now())

    const guardada = await Upload.findById(res.body.data.subida._id)
    expect(guardada.estado).toBe('pendiente')
    expect(guardada.destino).toBe('contrato')
    // Lo declarado se guarda, pero no se cree: se comprueba al confirmar.
    expect(guardada.tamanoBytes).toBe(PDF.length)
  })

  it('404 si el recurso es de otra empresa: pedir el permiso no revela nada', async () => {
    const e = await escenario()
    const ajena = await escenario()
    const contratoAjeno = await contratoDe(ajena)

    const res = await pedirPermiso(e.token, {
      destino: 'contrato',
      referencia: { contratoId: contratoAjeno._id },
      nombre: 'contrato.pdf',
      tamanoBytes: PDF.length
    })

    expect(res.status).toBe(404)
    expect(await Upload.countDocuments({})).toBe(0)
  })

  it('403 sin la capacidad del destino, y 401 sin sesión', async () => {
    const e = await escenario()
    const contrato = await contratoDe(e)
    const consulta = await crearEmpleadoConSesion({
      nivelAcceso: 'rh_consulta',
      empresa: e.empresa
    })

    const sinPermiso = await pedirPermiso(consulta.token, {
      destino: 'contrato',
      referencia: { contratoId: contrato._id },
      nombre: 'contrato.pdf',
      tamanoBytes: PDF.length
    })
    const sinSesion = await request(app)
      .post(SUBIDAS)
      .send({ destino: 'contrato', nombre: 'x.pdf', tamanoBytes: 10 })

    expect(sinPermiso.status).toBe(403)
    expect(sinSesion.status).toBe(401)
    expect(await Upload.countDocuments({})).toBe(0)
  })

  it('400 con destino inválido, sin nombre o sin tamaño; 413 si pasa del tope', async () => {
    const e = await escenario()
    const contrato = await contratoDe(e)
    const base = {
      destino: 'contrato',
      referencia: { contratoId: contrato._id },
      nombre: 'contrato.pdf',
      tamanoBytes: PDF.length
    }

    const destinoMalo = await pedirPermiso(e.token, { ...base, destino: 'inventado' })
    const sinNombre = await pedirPermiso(e.token, { ...base, nombre: '' })
    const sinTamano = await pedirPermiso(e.token, { ...base, tamanoBytes: 0 })
    const gigante = await pedirPermiso(e.token, {
      ...base,
      tamanoBytes: 400 * 1024 * 1024
    })

    expect(destinoMalo.status).toBe(400)
    expect(sinNombre.status).toBe(400)
    expect(sinTamano.status).toBe(400)
    expect(gigante.status).toBe(413)
    expect(gigante.body.message).toMatch(/30 MB/)
  })

  it('exige los ids que su destino necesita', async () => {
    const e = await escenario()

    const res = await pedirPermiso(e.token, {
      destino: 'siroc-aviso',
      nombre: 'aviso.pdf',
      tamanoBytes: PDF.length
    })

    expect(res.status).toBe(400)
    expect(res.body.errors[0].path).toBe('contratoId')
  })
})

describe('Confirmar la subida en la ruta del recurso', () => {
  it('adjunta el contrato escaneado y marca el permiso como usado', async () => {
    const e = await escenario()
    const contrato = await contratoDe(e)

    const permiso = await pedirPermiso(e.token, {
      destino: 'contrato',
      referencia: { contratoId: contrato._id },
      nombre: 'contrato-firmado.pdf',
      mime: 'application/pdf',
      tamanoBytes: PDF.length
    })
    await subirComoNavegador(permiso.body.data.subida.url, PDF)

    const res = await request(app)
      .patch(`${CONTRATOS}/${contrato._id}`)
      .set(auth(e.token))
      .send({ subidaId: permiso.body.data.subida._id })

    expect(res.status).toBe(200)
    expect(res.body.data.contrato.archivo).toMatchObject({
      nombre: 'contrato-firmado.pdf',
      mime: 'application/pdf',
      tamanoBytes: PDF.length,
      previsualizable: true
    })
    expect(res.body.message).toMatch(/con su archivo/i)

    // El archivo ya no está en `pendientes/`: se movió a su carpeta definitiva.
    const guardado = await Contract.findById(contrato._id)
    expect(guardado.archivo.claveAlmacenamiento).toMatch(/contratos\//)
    expect(
      storage.contenidoEnMemoria(guardado.archivo.claveAlmacenamiento)
    ).not.toBeNull()

    const subida = await Upload.findById(permiso.body.data.subida._id)
    expect(subida.estado).toBe('usada')
    expect(storage.contenidoEnMemoria(subida.claveTemporal)).toBeNull()
  })

  it('el mismo permiso no sirve dos veces', async () => {
    const e = await escenario()
    const contrato = await contratoDe(e)

    const permiso = await pedirPermiso(e.token, {
      destino: 'contrato',
      referencia: { contratoId: contrato._id },
      nombre: 'contrato.pdf',
      tamanoBytes: PDF.length
    })
    await subirComoNavegador(permiso.body.data.subida.url, PDF)

    const primera = await request(app)
      .patch(`${CONTRATOS}/${contrato._id}`)
      .set(auth(e.token))
      .send({ subidaId: permiso.body.data.subida._id })
    const segunda = await request(app)
      .patch(`${CONTRATOS}/${contrato._id}`)
      .set(auth(e.token))
      .send({ subidaId: permiso.body.data.subida._id })

    expect(primera.status).toBe(200)
    expect(segunda.status).toBe(400)
    expect(segunda.body.message).toMatch(/ya se usó/i)
  })

  it('un permiso de otro contrato no sirve para éste', async () => {
    const e = await escenario()
    const uno = await contratoDe(e)
    const otro = await request(app)
      .post(`${PROYECTOS}/${e.proyecto._id}/contratos`)
      .set(auth(e.token))
      .send({ nombre: 'Otra fase', fechaInicio: '2026-02-01', fechaFin: '2027-12-31' })

    const permiso = await pedirPermiso(e.token, {
      destino: 'contrato',
      referencia: { contratoId: uno._id },
      nombre: 'contrato.pdf',
      tamanoBytes: PDF.length
    })
    await subirComoNavegador(permiso.body.data.subida.url, PDF)

    const res = await request(app)
      .patch(`${CONTRATOS}/${otro.body.data.contrato._id}`)
      .set(auth(e.token))
      .send({ subidaId: permiso.body.data.subida._id })

    expect(res.status).toBe(400)
    expect(res.body.errors[0].path).toBe('subidaId')
  })

  it('un permiso de otro destino tampoco', async () => {
    const e = await escenario()
    const contrato = await contratoDe(e)

    const permiso = await pedirPermiso(e.token, {
      destino: 'siroc-aviso',
      referencia: { contratoId: contrato._id },
      nombre: 'aviso.pdf',
      tamanoBytes: PDF.length
    })
    await subirComoNavegador(permiso.body.data.subida.url, PDF)

    const res = await request(app)
      .patch(`${CONTRATOS}/${contrato._id}`)
      .set(auth(e.token))
      .send({ subidaId: permiso.body.data.subida._id })

    expect(res.status).toBe(400)
  })

  it('415 y borra el objeto si lo que se subió no es de un tipo aceptado', async () => {
    const e = await escenario()
    const contrato = await contratoDe(e)

    const permiso = await pedirPermiso(e.token, {
      destino: 'contrato',
      // El navegador puede decir lo que quiera: manda un HEIC diciendo que es PDF.
      referencia: { contratoId: contrato._id },
      nombre: 'contrato.pdf',
      mime: 'application/pdf',
      tamanoBytes: HEIC.length
    })
    await subirComoNavegador(permiso.body.data.subida.url, HEIC)

    const res = await request(app)
      .patch(`${CONTRATOS}/${contrato._id}`)
      .set(auth(e.token))
      .send({ subidaId: permiso.body.data.subida._id })

    expect(res.status).toBe(415)
    const guardado = await Contract.findById(contrato._id)
    expect(guardado.archivo).toBeNull()
    // No se queda ocupando sitio ni deja el permiso vivo.
    expect(storage.contenidoEnMemoria(claveDe(permiso.body.data.subida.url))).toBeNull()
    expect(await Upload.findById(permiso.body.data.subida._id)).toBeNull()
  })

  it('400 si el archivo nunca llegó al almacenamiento', async () => {
    const e = await escenario()
    const contrato = await contratoDe(e)

    const permiso = await pedirPermiso(e.token, {
      destino: 'contrato',
      referencia: { contratoId: contrato._id },
      nombre: 'contrato.pdf',
      tamanoBytes: PDF.length
    })

    const res = await request(app)
      .patch(`${CONTRATOS}/${contrato._id}`)
      .set(auth(e.token))
      .send({ subidaId: permiso.body.data.subida._id })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/no llegó al almacenamiento/i)
  })

  it('400 si lo subido no pesa lo que se anunció', async () => {
    const e = await escenario()
    const contrato = await contratoDe(e)

    const permiso = await pedirPermiso(e.token, {
      destino: 'contrato',
      referencia: { contratoId: contrato._id },
      nombre: 'contrato.pdf',
      tamanoBytes: PDF.length
    })
    // Otro PDF, más grande que el anunciado.
    await subirComoNavegador(
      permiso.body.data.subida.url,
      Buffer.concat([PDF, Buffer.alloc(2048, 0x20)])
    )

    const res = await request(app)
      .patch(`${CONTRATOS}/${contrato._id}`)
      .set(auth(e.token))
      .send({ subidaId: permiso.body.data.subida._id })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/no es el que se anunció/i)
  })

  it('400 con un permiso caducado', async () => {
    const e = await escenario()
    const contrato = await contratoDe(e)

    const permiso = await pedirPermiso(e.token, {
      destino: 'contrato',
      referencia: { contratoId: contrato._id },
      nombre: 'contrato.pdf',
      tamanoBytes: PDF.length
    })
    await subirComoNavegador(permiso.body.data.subida.url, PDF)
    await Upload.updateOne(
      { _id: permiso.body.data.subida._id },
      { expiraEn: new Date(Date.now() - 1000) }
    )

    const res = await request(app)
      .patch(`${CONTRATOS}/${contrato._id}`)
      .set(auth(e.token))
      .send({ subidaId: permiso.body.data.subida._id })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/caducó/i)
  })

  it('400 con un `subidaId` inventado', async () => {
    const e = await escenario()
    const contrato = await contratoDe(e)

    const res = await request(app)
      .patch(`${CONTRATOS}/${contrato._id}`)
      .set(auth(e.token))
      .send({ subidaId: new mongoose.Types.ObjectId().toString() })

    expect(res.status).toBe(400)
    expect(res.body.errors[0].path).toBe('subidaId')
  })
})

describe('Los cinco destinos llegan a su sitio', () => {
  it('el aviso del SIROC y el acuse de un refrendo', async () => {
    const e = await escenario()
    const contrato = await contratoDe(e)

    const permisoAviso = await pedirPermiso(e.token, {
      destino: 'siroc-aviso',
      referencia: { contratoId: contrato._id },
      nombre: 'aviso.pdf',
      tamanoBytes: PDF.length
    })
    await subirComoNavegador(permisoAviso.body.data.subida.url, PDF)

    const siroc = await request(app)
      .put(`${CONTRATOS}/${contrato._id}/siroc`)
      .set(auth(e.token))
      .send({
        numero: 'SIR-2026-1',
        fechaRegistro: '2026-01-05',
        subidaId: permisoAviso.body.data.subida._id
      })

    expect(siroc.status).toBe(200)
    expect(siroc.body.data.contrato.siroc.archivo).toMatchObject({
      nombre: 'aviso.pdf',
      tamanoBytes: PDF.length
    })

    const permisoAcuse = await pedirPermiso(e.token, {
      destino: 'siroc-actualizacion',
      referencia: { contratoId: contrato._id },
      nombre: 'acuse.pdf',
      tamanoBytes: PDF.length
    })
    await subirComoNavegador(permisoAcuse.body.data.subida.url, PDF)

    const refrendo = await request(app)
      .post(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones`)
      .set(auth(e.token))
      .send({ fecha: '2026-03-05', subidaId: permisoAcuse.body.data.subida._id })

    expect(refrendo.status).toBe(201)
    expect(refrendo.body.data.contrato.siroc.actualizaciones[0].archivo.nombre).toBe(
      'acuse.pdf'
    )
  })

  it('el acuse de un refrendo ya capturado, por su propia ruta', async () => {
    const e = await escenario()
    const contrato = await contratoDe(e)

    await request(app)
      .put(`${CONTRATOS}/${contrato._id}/siroc`)
      .set(auth(e.token))
      .send({ numero: 'SIR-2026-2', fechaRegistro: '2026-01-05' })
    await request(app)
      .post(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones`)
      .set(auth(e.token))
      .send({ fecha: '2026-03-05' })

    const permiso = await pedirPermiso(e.token, {
      destino: 'siroc-actualizacion',
      referencia: { contratoId: contrato._id },
      nombre: 'acuse-tardio.pdf',
      tamanoBytes: PDF.length
    })
    await subirComoNavegador(permiso.body.data.subida.url, PDF)

    const res = await request(app)
      .put(`${CONTRATOS}/${contrato._id}/siroc/actualizaciones/0/archivo`)
      .set(auth(e.token))
      .send({ subidaId: permiso.body.data.subida._id })

    expect(res.status).toBe(200)
    expect(res.body.data.contrato.siroc.actualizaciones[0].archivo.nombre).toBe(
      'acuse-tardio.pdf'
    )
  })

  it('el contrato escaneado en el ALTA, que cuelga del proyecto', async () => {
    const e = await escenario()

    const permiso = await pedirPermiso(e.token, {
      destino: 'contrato',
      // Todavía no hay contrato: el dueño del permiso es el proyecto.
      referencia: { proyectoId: e.proyecto._id.toString() },
      nombre: 'contrato-nuevo.pdf',
      tamanoBytes: PDF.length
    })
    await subirComoNavegador(permiso.body.data.subida.url, PDF)

    const res = await request(app)
      .post(`${PROYECTOS}/${e.proyecto._id}/contratos`)
      .set(auth(e.token))
      .send({
        nombre: 'Con papel desde el principio',
        fechaInicio: '2026-01-01',
        fechaFin: '2027-12-31',
        subidaId: permiso.body.data.subida._id
      })

    expect(res.status).toBe(201)
    expect(res.body.data.contrato.archivo).toMatchObject({
      nombre: 'contrato-nuevo.pdf',
      tamanoBytes: PDF.length
    })
  })

  it('el registro de obra, al crearlo y al reemplazarlo', async () => {
    const e = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const cliente = await crearCliente({ nombre: 'Cliente con obra' })
    await agregarACartera(e.empresa, cliente)

    const permiso = await pedirPermiso(e.token, {
      destino: 'registro-obra',
      referencia: { clienteId: cliente._id.toString() },
      nombre: 'registro.pdf',
      tamanoBytes: PDF.length
    })
    await subirComoNavegador(permiso.body.data.subida.url, PDF)

    const res = await request(app)
      .post(`${CLIENTES}/${cliente._id}/registros-obra`)
      .set(auth(e.token))
      .send({ numero: 'OB-2026-1', subidaId: permiso.body.data.subida._id })

    expect(res.status).toBe(201)
    expect(res.body.data.registro.archivo).toMatchObject({
      nombre: 'registro.pdf',
      tamanoBytes: PDF.length
    })
    expect(res.body.data.registro.archivo.claveAlmacenamiento).toBeUndefined()

    // Y reemplazarlo por su propia ruta, con otro permiso.
    const otro = await pedirPermiso(e.token, {
      destino: 'registro-obra',
      referencia: { clienteId: cliente._id.toString() },
      nombre: 'registro-corregido.pdf',
      tamanoBytes: PDF.length
    })
    await subirComoNavegador(otro.body.data.subida.url, PDF)

    const reemplazo = await request(app)
      .patch(`${CLIENTES}/${cliente._id}/registros-obra/${res.body.data.registro._id}`)
      .set(auth(e.token))
      .send({ subidaId: otro.body.data.subida._id })

    expect(reemplazo.status).toBe(200)
    expect(reemplazo.body.data.registro.archivo.nombre).toBe('registro-corregido.pdf')
    expect(reemplazo.body.message).toMatch(/archivo del registro de obra/i)
  })

  it('un documento del expediente, con su versión y su vigencia', async () => {
    await ensureBaseChecklistTemplates()
    const e = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const persona = await crearEmpleado({ tipo: 'mano_de_obra' })
    await adscribir(e.empresa, persona, { areas: ['operaciones_urbanizadora'] })

    const expediente = await request(app)
      .get(`/api/v1/empleados/${persona._id}/expediente`)
      .set(auth(e.token))
    const expedienteId = expediente.body.data.expediente._id

    const permiso = await pedirPermiso(e.token, {
      destino: 'expediente',
      referencia: { expedienteId, tipoDocumento: 'ine' },
      nombre: 'ine.pdf',
      tamanoBytes: PDF.length
    })
    await subirComoNavegador(permiso.body.data.subida.url, PDF)

    const res = await request(app)
      .post(`${EXPEDIENTES}/${expedienteId}/documentos/ine`)
      .set(auth(e.token))
      .send({ subidaId: permiso.body.data.subida._id })

    expect(res.status).toBe(201)
    const documento = res.body.data.expediente.documentos.find((d) => d.tipo === 'ine')
    expect(documento.estatus).toBe('in_review')
    expect(documento.archivo).toMatchObject({
      nombre: 'ine.pdf',
      tamanoBytes: PDF.length
    })
  })
})
