const request = require('supertest')
const mongoose = require('mongoose')
const app = require('../../src/app')
const Record = require('../../src/api/v1/records/recordModel')
const AccessLog = require('../../src/api/v1/accessLogs/accessLogModel')
const ChecklistTemplate = require('../../src/api/v1/checklistTemplates/checklistTemplateModel')
const storage = require('../../src/services/storageService')
const {
  ensureBaseChecklistTemplates
} = require('../../src/services/seedChecklistTemplates')
const {
  crearEmpresa,
  crearCategoria,
  crearEmpleado,
  crearEmpleadoConSesion,
  adscribir,
  auth
} = require('../helpers/factories')

const { DOCUMENT_TYPES } = require('../../src/constants')

/** Un PDF y una imagen mínimos, válidos por sus magic bytes. */
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)])
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32)
])

afterEach(() => storage.limpiarMemoria())

/**
 * Escenario: plantillas base sembradas, una empresa, y una persona de obra
 * adscrita a ella, con su expediente ya creado por el alta.
 */
async function escenario(datos = {}) {
  await ensureBaseChecklistTemplates()
  const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin', ...datos })
  const categoria = await crearCategoria('Albañil', 'mano_de_obra')

  const persona = await crearEmpleado({
    nombre: 'Roberto Aguilar Sosa',
    tipo: 'mano_de_obra',
    categoriaId: categoria._id
  })
  await adscribir(sesion.empresa, persona, {
    areas: datos.areas || ['operaciones_urbanizadora'],
    tipoContrato: 'indeterminado'
  })

  return { ...sesion, categoria, persona }
}

const subir = (token, expedienteId, tipo, buffer, campos = {}) => {
  const peticion = request(app)
    .post(`/api/v1/expedientes/${expedienteId}/documentos/${tipo}`)
    .set(auth(token))
  for (const [clave, valor] of Object.entries(campos)) peticion.field(clave, valor)
  return buffer ? peticion.attach('archivo', buffer, 'documento.pdf') : peticion
}

describe('GET /api/v1/empleados/:id/expediente', () => {
  beforeAll(() => Record.init())

  it('devuelve el expediente con su checklist, avance y el empleado', async () => {
    const { token, persona } = await escenario()

    const res = await request(app)
      .get(`/api/v1/empleados/${persona._id}/expediente`)
      .set(auth(token))

    expect(res.status).toBe(200)
    expect(res.body.data.expediente.empleadoId).toBe(persona._id.toString())
    expect(res.body.data.empleado.empleado.nombre).toBe('Roberto Aguilar Sosa')
    // Toda la plantilla de obra: 12 documentos, todos pendientes.
    expect(res.body.data.expediente.documentos).toHaveLength(DOCUMENT_TYPES.length)
    expect(
      res.body.data.expediente.documentos.every((d) => d.estatus === 'pending')
    ).toBe(true)
    expect(res.body.data.avance).toMatchObject({
      entregados: 0,
      porcentaje: 0,
      estatus: 'incomplete'
    })
  })

  it('el alta del empleado ya creó su expediente, en la misma transacción', async () => {
    const { token, empresa } = await escenario()
    const categoria = await crearCategoria('Peón', 'mano_de_obra')

    const alta = await request(app)
      .post('/api/v1/empleados')
      .set(auth(token))
      .send({
        nombre: 'Nueva Persona',
        tipo: 'mano_de_obra',
        categoriaId: categoria._id.toString(),
        numeroEmpleado: 'NE-1',
        adscripcion: {
          empresaId: empresa._id.toString(),
          areas: ['operaciones_urbanizadora'],
          tipoContrato: 'indeterminado',
          fechaIngreso: '2026-09-01'
        }
      })

    expect(alta.status).toBe(201)
    const nuevoId = alta.body.data.empleado.empleado._id
    expect(await Record.countDocuments({ empleadoId: nuevoId })).toBe(1)
  })

  it('el checklist es la UNIÓN de las plantillas de sus adscripciones', async () => {
    // Una persona en dos empresas: administrativo en una, obra en la otra.
    const { token, empresa, persona } = await escenario({
      areas: ['operaciones_urbanizadora']
    })
    const otra = await crearEmpresa({ nombre: 'Otra del grupo' })
    await adscribir(otra, persona, {
      areas: ['finanzas'],
      tipoContrato: 'indeterminado'
    })
    await request(app).get(`/api/v1/empleados/${persona._id}/expediente`).set(auth(token))
    // Se re-sincroniza para que tome la adscripción nueva.
    const recordService = require('../../src/api/v1/records/recordService')
    await recordService.sincronizar(persona._id)

    const res = await request(app)
      .get(`/api/v1/empleados/${persona._id}/expediente`)
      .set(auth(token))
    const porTipo = Object.fromEntries(
      res.body.data.expediente.documentos.map((d) => [d.tipo, d])
    )

    // La de obra no pide CV; la general sí. Requerido gana.
    expect(porTipo.cv.requerido).toBe(true)
    // Obra pide el examen médico cada 6 meses; la general cada 12. Gana 6.
    expect(porTipo.examen_medico.vigenciaMeses).toBe(6)
    expect(res.body.data.expediente.plantillas.length).toBeGreaterThanOrEqual(1)
    expect(empresa).toBeDefined()
  })

  it('404 si el empleado no es visible para quien pregunta', async () => {
    const { persona } = await escenario()
    const otro = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })

    const res = await request(app)
      .get(`/api/v1/empleados/${persona._id}/expediente`)
      .set(auth(otro.token))
    expect(res.status).toBe(404)
  })
})

describe('POST /api/v1/expedientes/:id/documentos/:tipo — subir', () => {
  const abrirExpediente = async (token, personaId) => {
    const res = await request(app)
      .get(`/api/v1/empleados/${personaId}/expediente`)
      .set(auth(token))
    return res.body.data.expediente._id
  }

  it('sube el archivo, crea la versión 1 y deja el documento en revisión', async () => {
    const { token, persona, empleado } = await escenario()
    const expedienteId = await abrirExpediente(token, persona._id)

    const res = await subir(token, expedienteId, 'ine', PDF)

    expect(res.status).toBe(201)
    const doc = res.body.data.expediente.documentos.find((d) => d.tipo === 'ine')
    expect(doc.estatus).toBe('in_review')
    expect(doc.versiones).toHaveLength(1)
    expect(doc.versiones[0]).toMatchObject({ version: 1, estatus: 'in_review' })
    expect(doc.archivo).toMatchObject({
      nombre: 'documento.pdf',
      mime: 'application/pdf',
      tamanoBytes: PDF.length,
      // El NOMBRE de quien subió, para el histórico.
      subidoPor: empleado.nombre
    })
    // La ubicación real del archivo NUNCA se expone.
    expect(JSON.stringify(res.body)).not.toContain('claveAlmacenamiento')
    expect(JSON.stringify(res.body)).not.toContain('expedientes/')
  })

  it('el archivo queda guardado en el almacenamiento', async () => {
    const { token, persona } = await escenario()
    const expedienteId = await abrirExpediente(token, persona._id)
    await subir(token, expedienteId, 'ine', PDF)

    const expediente = await Record.findById(expedienteId).select(
      '+documentos.archivo.claveAlmacenamiento'
    )
    const clave = expediente.documento('ine').archivo.claveAlmacenamiento

    // La convención del spec: nunca lleva el nombre original del archivo.
    expect(clave).toMatch(
      new RegExp(`^expedientes/${persona._id}/ine/v1-[0-9a-f-]+\\.pdf$`)
    )
    expect(clave).not.toContain('documento.pdf')
    expect(storage.contenidoEnMemoria(clave).buffer.equals(PDF)).toBe(true)
  })

  it('el avance sube cuando el documento se entrega', async () => {
    const { token, persona } = await escenario()
    const expedienteId = await abrirExpediente(token, persona._id)

    const res = await subir(token, expedienteId, 'ine', PDF)
    // Subido no es entregado: queda en revisión hasta que RH lo valide.
    expect(res.body.data.avance.entregados).toBe(0)
    expect(res.body.data.avance.enRevision).toBe(1)
  })

  describe('reemplazo y versiones', () => {
    it('la versión 2 marca la anterior como reemplazada y va al inicio', async () => {
      const { token, persona } = await escenario()
      const expedienteId = await abrirExpediente(token, persona._id)

      await subir(token, expedienteId, 'ine', PDF)
      const res = await subir(token, expedienteId, 'ine', PNG)

      const doc = res.body.data.expediente.documentos.find((d) => d.tipo === 'ine')
      expect(doc.versiones.map((v) => v.version)).toEqual([2, 1])
      expect(doc.versiones[0].reemplazadaEn).toBeNull()
      expect(doc.versiones[1].reemplazadaEn).toEqual(expect.any(String))
      // El archivo vigente es el nuevo.
      expect(doc.archivo.mime).toBe('image/png')
    })

    it('subir de nuevo limpia el rechazo anterior', async () => {
      const { token, persona } = await escenario()
      const expedienteId = await abrirExpediente(token, persona._id)
      await subir(token, expedienteId, 'ine', PDF)

      // Se simula el rechazo (validar/rechazar llegan en el paso siguiente).
      await Record.updateOne(
        { _id: expedienteId, 'documentos.tipo': 'ine' },
        {
          $set: {
            'documentos.$.estatus': 'rejected',
            'documentos.$.motivoRechazo': 'La imagen está borrosa',
            'documentos.$.revisadoPor': 'Marisol',
            'documentos.$.revisadoEn': new Date()
          }
        }
      )

      const res = await subir(token, expedienteId, 'ine', PDF)
      const doc = res.body.data.expediente.documentos.find((d) => d.tipo === 'ine')

      expect(doc.estatus).toBe('in_review')
      expect(doc.motivoRechazo).toBeNull()
      expect(doc.revisadoPor).toBeNull()
      expect(doc.revisadoEn).toBeNull()
    })
  })

  describe('validación del archivo', () => {
    it('415 si el contenido no es PDF ni imagen, aunque el nombre diga otra cosa', async () => {
      const { token, persona } = await escenario()
      const expedienteId = await abrirExpediente(token, persona._id)

      const res = await request(app)
        .post(`/api/v1/expedientes/${expedienteId}/documentos/ine`)
        .set(auth(token))
        // Un ejecutable disfrazado de PDF.
        .attach('archivo', Buffer.from([0x4d, 0x5a, 0x90, 0x00]), 'documento.pdf')

      expect(res.status).toBe(415)
      expect(res.body.message).toMatch(/PDF/)
    })

    it('415 con una foto de iPhone, y lo explica', async () => {
      const { token, persona } = await escenario()
      const expedienteId = await abrirExpediente(token, persona._id)
      const heic = Buffer.concat([
        Buffer.alloc(4),
        Buffer.from('ftypheic'),
        Buffer.alloc(16)
      ])

      const res = await request(app)
        .post(`/api/v1/expedientes/${expedienteId}/documentos/ine`)
        .set(auth(token))
        .attach('archivo', heic, 'foto.heic')

      expect(res.status).toBe(415)
      expect(res.body.message).toMatch(/HEIC/)
      expect(res.body.message).toMatch(/JPG o PDF/)
    })

    it('400 si no se adjunta archivo', async () => {
      const { token, persona } = await escenario()
      const expedienteId = await abrirExpediente(token, persona._id)

      const res = await subir(token, expedienteId, 'ine', null)
      expect(res.status).toBe(400)
      expect(res.body.errors[0].path).toBe('archivo')
    })

    it('400 con un tipo de documento inventado', async () => {
      const { token, persona } = await escenario()
      const expedienteId = await abrirExpediente(token, persona._id)

      const res = await subir(token, expedienteId, 'pasaporte_galactico', PDF)
      expect(res.status).toBe(400)
    })

    it('nada se guarda si el archivo se rechaza', async () => {
      const { token, persona } = await escenario()
      const expedienteId = await abrirExpediente(token, persona._id)

      await request(app)
        .post(`/api/v1/expedientes/${expedienteId}/documentos/ine`)
        .set(auth(token))
        .attach('archivo', Buffer.from('sólo texto'), 'documento.pdf')

      const expediente = await Record.findById(expedienteId)
      expect(expediente.documento('ine').versiones).toHaveLength(0)
      expect(expediente.documento('ine').estatus).toBe('pending')
    })
  })

  describe('vigencias', () => {
    it('acepta la vigencia que le manden', async () => {
      const { token, persona } = await escenario()
      const expedienteId = await abrirExpediente(token, persona._id)

      const res = await subir(token, expedienteId, 'examen_medico', PDF, {
        vigenciaHasta: '2027-03-31'
      })

      expect(res.status).toBe(201)
      const doc = res.body.data.expediente.documentos.find(
        (d) => d.tipo === 'examen_medico'
      )
      expect(doc.vigenciaHasta).toBe('2027-03-31')
      expect(doc.versiones[0].vigenciaHasta).toBe('2027-03-31')
    })

    it('si no la mandan, la deriva de los meses de la plantilla', async () => {
      const { token, persona } = await escenario()
      const expedienteId = await abrirExpediente(token, persona._id)

      const res = await subir(token, expedienteId, 'examen_medico', PDF)
      const doc = res.body.data.expediente.documentos.find(
        (d) => d.tipo === 'examen_medico'
      )

      // La plantilla de obra pide 6 meses.
      expect(doc.vigenciaHasta).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(doc.vigenciaMeses).toBe(6)
    })

    it('el contrato de un indeterminado no lleva vigencia', async () => {
      const { token, persona } = await escenario()
      const expedienteId = await abrirExpediente(token, persona._id)

      const res = await subir(token, expedienteId, 'contrato', PDF)
      const doc = res.body.data.expediente.documentos.find((d) => d.tipo === 'contrato')
      expect(doc.vigenciaHasta).toBeNull()
    })

    it('el contrato temporal hereda la fecha de término más próxima', async () => {
      const { token, empresa } = await escenario()
      const categoria = await crearCategoria('Temporal', 'mano_de_obra')
      const temporal = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      await adscribir(empresa, temporal, {
        areas: ['operaciones_urbanizadora'],
        tipoContrato: 'obra_determinada',
        fechaIngreso: '2026-09-01',
        fechaTerminoContrato: '2027-03-31'
      })
      const otra = await crearEmpresa()
      await adscribir(otra, temporal, {
        areas: ['operaciones_urbanizadora'],
        tipoContrato: 'determinado',
        fechaIngreso: '2026-09-01',
        fechaTerminoContrato: '2026-12-31'
      })

      const expedienteId = await abrirExpediente(token, temporal._id)
      const res = await subir(token, expedienteId, 'contrato', PDF)
      const doc = res.body.data.expediente.documentos.find((d) => d.tipo === 'contrato')

      // La más próxima: es la condición más estricta.
      expect(doc.vigenciaHasta).toBe('2026-12-31')
    })

    it('400 si mandan vigencia en un documento que no caduca', async () => {
      const { token, persona } = await escenario()
      const expedienteId = await abrirExpediente(token, persona._id)

      const res = await subir(token, expedienteId, 'ine', PDF, {
        vigenciaHasta: '2027-03-31'
      })
      expect(res.status).toBe(400)
      expect(res.body.errors[0].path).toBe('vigenciaHasta')
    })

    it('400 con una fecha mal formada', async () => {
      const { token, persona } = await escenario()
      const expedienteId = await abrirExpediente(token, persona._id)

      const res = await subir(token, expedienteId, 'examen_medico', PDF, {
        vigenciaHasta: '31/03/2027'
      })
      expect(res.status).toBe(400)
    })
  })

  describe('permisos y estado', () => {
    it('rh_consulta puede subir; el jefe de área no', async () => {
      const { empresa, persona } = await escenario()

      const consulta = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_consulta',
        empresa
      })
      const expedienteId = await abrirExpediente(consulta.token, persona._id)
      expect((await subir(consulta.token, expedienteId, 'ine', PDF)).status).toBe(201)

      const jefe = await crearEmpleadoConSesion({
        nivelAcceso: 'jefe_area',
        empresa,
        areas: ['operaciones_urbanizadora']
      })
      expect((await subir(jefe.token, expedienteId, 'curp', PDF)).status).toBe(403)
    })

    it('el expediente de alguien dado de baja es de sólo lectura', async () => {
      const { token, persona } = await escenario()
      const expedienteId = await abrirExpediente(token, persona._id)

      await request(app)
        .patch(`/api/v1/empleados/${persona._id}/estado`)
        .set(auth(token))
        .send({ activo: false, motivo: 'Renuncia voluntaria' })

      const res = await subir(token, expedienteId, 'ine', PDF)
      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/sólo lectura/i)
    })

    it('404 si el expediente es de otra empresa; 401 sin sesión', async () => {
      const { token, persona } = await escenario()
      const expedienteId = await abrirExpediente(token, persona._id)

      const otro = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      expect((await subir(otro.token, expedienteId, 'ine', PDF)).status).toBe(404)

      const sinSesion = await request(app)
        .post(`/api/v1/expedientes/${expedienteId}/documentos/ine`)
        .attach('archivo', PDF, 'documento.pdf')
      expect(sinSesion.status).toBe(401)
    })
  })
})

describe('POST /api/v1/expedientes/:id/documentos/:tipo/revisar', () => {
  const preparar = async (datos = {}) => {
    const contexto = await escenario(datos)
    const abierto = await request(app)
      .get(`/api/v1/empleados/${contexto.persona._id}/expediente`)
      .set(auth(contexto.token))
    const expedienteId = abierto.body.data.expediente._id
    await subir(contexto.token, expedienteId, 'ine', PDF)
    return { ...contexto, expedienteId }
  }

  const revisar = (token, expedienteId, tipo, cuerpo) =>
    request(app)
      .post(`/api/v1/expedientes/${expedienteId}/documentos/${tipo}/revisar`)
      .set(auth(token))
      .send(cuerpo)

  it('aprobado: true valida — documento y versión quedan validated', async () => {
    const { token, expedienteId, empleado } = await preparar()

    const res = await revisar(token, expedienteId, 'ine', { aprobado: true })

    expect(res.status).toBe(200)
    const doc = res.body.data.expediente.documentos.find((d) => d.tipo === 'ine')
    expect(doc.estatus).toBe('validated')
    expect(doc.motivoRechazo).toBeNull()
    expect(doc.revisadoPor).toBe(empleado.nombre)
    expect(doc.revisadoEn).toEqual(expect.any(String))
    expect(doc.versiones[0]).toMatchObject({ version: 1, estatus: 'validated' })

    // Y el avance ya cuenta el documento como entregado.
    expect(res.body.data.avance.entregados).toBeGreaterThan(0)
    expect(res.body.data.avance.enRevision).toBe(0)
  })

  it('aprobado: false con motivo rechaza — documento y versión quedan rejected', async () => {
    const { token, expedienteId, empleado } = await preparar()

    const res = await revisar(token, expedienteId, 'ine', {
      aprobado: false,
      motivo: 'La foto del INE está ilegible'
    })

    expect(res.status).toBe(200)
    const doc = res.body.data.expediente.documentos.find((d) => d.tipo === 'ine')
    expect(doc.estatus).toBe('rejected')
    expect(doc.motivoRechazo).toBe('La foto del INE está ilegible')
    expect(doc.revisadoPor).toBe(empleado.nombre)
    expect(doc.versiones[0]).toMatchObject({
      version: 1,
      estatus: 'rejected',
      motivoRechazo: 'La foto del INE está ilegible'
    })
    expect(res.body.data.avance.rechazados).toBe(1)
  })

  it('400 si rechaza sin motivo, o con uno de menos de 10 caracteres', async () => {
    const { token, expedienteId } = await preparar()

    const sinMotivo = await revisar(token, expedienteId, 'ine', { aprobado: false })
    expect(sinMotivo.status).toBe(400)

    const corto = await revisar(token, expedienteId, 'ine', {
      aprobado: false,
      motivo: 'corto'
    })
    expect(corto.status).toBe(400)
  })

  it('400 si `aprobado` no viene o no es booleano', async () => {
    const { token, expedienteId } = await preparar()
    expect((await revisar(token, expedienteId, 'ine', {})).status).toBe(400)
    expect((await revisar(token, expedienteId, 'ine', { aprobado: 'sí' })).status).toBe(
      400
    )
  })

  it('400 si el documento no está en revisión (pendiente o ya revisado)', async () => {
    const { token, expedienteId } = await preparar()

    const pendiente = await revisar(token, expedienteId, 'curp', { aprobado: true })
    expect(pendiente.status).toBe(400)

    await revisar(token, expedienteId, 'ine', { aprobado: true })
    const yaRevisado = await revisar(token, expedienteId, 'ine', { aprobado: true })
    expect(yaRevisado.status).toBe(400)
  })

  it('subir de nuevo tras un rechazo permite volver a revisar', async () => {
    const { token, expedienteId } = await preparar()
    await revisar(token, expedienteId, 'ine', {
      aprobado: false,
      motivo: 'La foto del INE está ilegible'
    })

    await subir(token, expedienteId, 'ine', PDF)
    const res = await revisar(token, expedienteId, 'ine', { aprobado: true })

    expect(res.status).toBe(200)
    const doc = res.body.data.expediente.documentos.find((d) => d.tipo === 'ine')
    expect(doc.estatus).toBe('validated')
    expect(doc.motivoRechazo).toBeNull()
  })

  it('403 sólo para jefe_area: no sube ni revisa (D-44)', async () => {
    const { expedienteId } = await preparar()

    const jefe = await crearEmpleadoConSesion({ nivelAcceso: 'jefe_area' })
    expect(
      (await revisar(jefe.token, expedienteId, 'ine', { aprobado: true })).status
    ).toBe(403)
  })

  it('rh_consulta también revisa, y un rh_admin con alcanceGlobal también (D-44)', async () => {
    const { empresa, expedienteId } = await preparar()

    const consulta = await crearEmpleadoConSesion({
      nivelAcceso: 'rh_consulta',
      empresa
    })
    expect(
      (await revisar(consulta.token, expedienteId, 'ine', { aprobado: true })).status
    ).toBe(200)

    // Levanta la aprobación anterior para poder probar el segundo caso.
    await subir(consulta.token, expedienteId, 'ine', PDF)

    const admin = await crearEmpleadoConSesion({
      nivelAcceso: 'rh_admin',
      alcanceGlobal: true,
      empresa
    })
    expect(
      (await revisar(admin.token, expedienteId, 'ine', { aprobado: true })).status
    ).toBe(200)
  })

  it('404 si el expediente no existe, o el empleado no es visible; 401 sin sesión', async () => {
    const { token, expedienteId } = await preparar()

    const inexistente = await revisar(
      token,
      new mongoose.Types.ObjectId().toString(),
      'ine',
      { aprobado: true }
    )
    expect(inexistente.status).toBe(404)

    const otro = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    expect(
      (await revisar(otro.token, expedienteId, 'ine', { aprobado: true })).status
    ).toBe(404)

    const sinSesion = await request(app)
      .post(`/api/v1/expedientes/${expedienteId}/documentos/ine/revisar`)
      .send({ aprobado: true })
    expect(sinSesion.status).toBe(401)
  })
})

describe('GET /api/v1/expedientes/:id/documentos/:tipo/versiones/:v/url', () => {
  const preparar = async (datos = {}) => {
    const contexto = await escenario(datos)
    const abierto = await request(app)
      .get(`/api/v1/empleados/${contexto.persona._id}/expediente`)
      .set(auth(contexto.token))
    const expedienteId = abierto.body.data.expediente._id
    await subir(contexto.token, expedienteId, 'ine', PDF)
    await subir(contexto.token, expedienteId, 'cv', PDF)
    return { ...contexto, expedienteId }
  }

  it('emite la URL firmada y registra en la bitácora', async () => {
    const { token, expedienteId, empleado, persona } = await preparar()

    const res = await request(app)
      .get(`/api/v1/expedientes/${expedienteId}/documentos/ine/versiones/1/url`)
      .set(auth(token))

    expect(res.status).toBe(200)
    expect(res.body.data.url).toEqual(expect.any(String))
    expect(res.body.data.archivo).toMatchObject({
      nombre: 'documento.pdf',
      mime: 'application/pdf'
    })

    // Requisito legal: queda rastro de quién abrió qué.
    const bitacora = await AccessLog.find({})
    expect(bitacora).toHaveLength(1)
    expect(bitacora[0]).toMatchObject({
      accion: 'ver_documento',
      usuarioNombre: empleado.nombre,
      tipoDocumento: 'ine',
      version: 1,
      sujetoNombre: persona.nombre
    })
  })

  // El renglón de la tabla de empleados trae el avance sin pedir el expediente.
  it('llena avanceExpediente y expedienteId en el renglón de empleados', async () => {
    const { token, expedienteId, persona } = await preparar()

    const lista = await request(app)
      .get(`/api/v1/empleados?buscar=${encodeURIComponent(persona.nombre)}`)
      .set(auth(token))

    const renglon = lista.body.data.empleados.find(
      (r) => r.empleado._id === persona._id.toString()
    )
    expect(renglon.expedienteId).toBe(expedienteId)
    expect(renglon.avanceExpediente).toEqual(expect.any(Number))

    // Y el porcentaje es el mismo que devuelve el expediente completo.
    const detalle = await request(app)
      .get(`/api/v1/expedientes/${expedienteId}`)
      .set(auth(token))
    expect(renglon.avanceExpediente).toBe(detalle.body.data.avance.porcentaje)

    // El renglón NO puede traer los archivos: en una agregación `select: false`
    // no aplica y la clave del bucket se filtraría (D-27).
    expect(JSON.stringify(renglon)).not.toContain('claveAlmacenamiento')
    expect(JSON.stringify(renglon)).not.toContain('expedientes/')
  })

  // El front pinta la ficha de la persona con la respuesta de la subida, así que
  // `data.empleado` tiene que ser el MISMO renglón en las tres rutas. Antes la
  // subida devolvía sólo la persona, sin categoría ni adscripciones.
  it('devuelve el mismo renglón de empleado al consultar y al subir', async () => {
    const { token, expedienteId, persona } = await preparar()

    const lectura = await request(app)
      .get(`/api/v1/empleados/${persona._id}/expediente`)
      .set(auth(token))
    const subida = await subir(token, expedienteId, 'curp', PDF)

    expect(subida.status).toBe(201)
    expect(Object.keys(subida.body.data.empleado).sort()).toEqual(
      Object.keys(lectura.body.data.empleado).sort()
    )
    expect(subida.body.data.empleado.empleado.nombre).toBe(persona.nombre)
    expect(Array.isArray(subida.body.data.empleado.adscripciones)).toBe(true)
  })

  // Regresión (D-41): `claveAlmacenamiento` es `select: false`. Si se lee el
  // expediente sin pedirla y se vuelve a guardar, Mongoose reescribe el arreglo
  // de versiones y la deja vacía: el archivo anterior queda inalcanzable para
  // siempre. Pasaba al reemplazar un documento, así que hay que subir dos veces
  // antes de pedir la URL de la primera versión.
  it('sigue sirviendo la versión anterior después de reemplazar el documento', async () => {
    const { token, expedienteId } = await preparar()

    await subir(token, expedienteId, 'ine', PDF)

    const res = await request(app)
      .get(`/api/v1/expedientes/${expedienteId}/documentos/ine/versiones/1/url`)
      .set(auth(token))

    expect(res.status).toBe(200)
    expect(res.body.data.url).toEqual(expect.any(String))

    // Y en la base las dos claves siguen ahí, distintas entre sí.
    const crudo = await Record.collection.findOne({
      _id: new mongoose.Types.ObjectId(expedienteId)
    })
    const claves = crudo.documentos
      .find((d) => d.tipo === 'ine')
      .versiones.map((v) => v.archivo.claveAlmacenamiento)
    expect(claves).toHaveLength(2)
    expect(claves.every((clave) => typeof clave === 'string' && clave.length > 0)).toBe(
      true
    )
    expect(new Set(claves).size).toBe(2)
  })

  it('distingue ver de descargar en la bitácora', async () => {
    const { token, expedienteId } = await preparar()

    await request(app)
      .get(
        `/api/v1/expedientes/${expedienteId}/documentos/ine/versiones/1/url?descargar=true`
      )
      .set(auth(token))

    const registro = await AccessLog.findOne({})
    expect(registro.accion).toBe('descargar_documento')
  })

  it('el jefe de área NO puede abrir un documento sensible, pero sí uno que no lo es', async () => {
    const { empresa, expedienteId } = await preparar()
    const jefe = await crearEmpleadoConSesion({
      nivelAcceso: 'jefe_area',
      empresa,
      areas: ['operaciones_urbanizadora']
    })

    // La INE es sensible; el CV no.
    const sensible = await request(app)
      .get(`/api/v1/expedientes/${expedienteId}/documentos/ine/versiones/1/url`)
      .set(auth(jefe.token))
    const noSensible = await request(app)
      .get(`/api/v1/expedientes/${expedienteId}/documentos/cv/versiones/1/url`)
      .set(auth(jefe.token))

    expect(sensible.status).toBe(403)
    expect(sensible.body.message).toMatch(/datos personales sensibles/i)
    expect(noSensible.status).toBe(200)
  })

  it('404 en una versión que no existe, o en un expediente ajeno', async () => {
    const { token, expedienteId } = await preparar()

    const sinVersion = await request(app)
      .get(`/api/v1/expedientes/${expedienteId}/documentos/ine/versiones/9/url`)
      .set(auth(token))
    expect(sinVersion.status).toBe(404)

    const otro = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const ajeno = await request(app)
      .get(`/api/v1/expedientes/${expedienteId}/documentos/ine/versiones/1/url`)
      .set(auth(otro.token))
    expect(ajeno.status).toBe(404)
  })

  it('404 con un expediente inexistente', async () => {
    const { token } = await escenario()
    const res = await request(app)
      .get(
        `/api/v1/expedientes/${new mongoose.Types.ObjectId()}/documentos/ine/versiones/1/url`
      )
      .set(auth(token))
    expect(res.status).toBe(404)
  })
})

/*
 * D-42: el checklist dice qué es OBLIGATORIO. Nada de esto puede impedir subir
 * un documento, porque un expediente que no acepta archivos no sirve para nada.
 */
describe('Las plantillas no bloquean la subida (D-42)', () => {
  it('acepta un tipo que no está en su checklist, como no requerido', async () => {
    const { token, persona } = await escenario({ nivelAcceso: 'rh_admin' })

    // Un checklist mínimo: sólo INE, y a mano, para que el tipo que se sube
    // seguro no esté en él.
    const expediente = await Record.create({
      empleadoId: persona._id,
      documentos: [{ tipo: 'ine', requerido: true, estatus: 'pending', versiones: [] }]
    })

    const res = await subir(token, expediente._id.toString(), 'cv', PDF)

    expect(res.status).toBe(201)
    const cv = res.body.data.expediente.documentos.find((d) => d.tipo === 'cv')
    expect(cv).toMatchObject({ estatus: 'in_review', requerido: false })
    expect(cv.archivo.nombre).toBe('documento.pdf')
    // Y no tocó el renglón que sí era requerido.
    const ine = res.body.data.expediente.documentos.find((d) => d.tipo === 'ine')
    expect(ine).toMatchObject({ requerido: true, estatus: 'pending' })
  })

  it('un expediente que quedó sin checklist se rellena al consultarlo', async () => {
    await ensureBaseChecklistTemplates()
    const { token, persona } = await escenario({ nivelAcceso: 'rh_admin' })

    // El caso real: el expediente existe pero nació vacío porque cuando se creó
    // no se pudo resolver ninguna plantilla.
    await Record.updateOne(
      { empleadoId: persona._id },
      { $set: { documentos: [], plantillas: [] } }
    )

    const res = await request(app)
      .get(`/api/v1/empleados/${persona._id}/expediente`)
      .set(auth(token))

    expect(res.status).toBe(200)
    expect(res.body.data.expediente.documentos.length).toBeGreaterThan(0)
    // Y quedó guardado, no sólo resuelto al vuelo.
    const enBase = await Record.findOne({ empleadoId: persona._id })
    expect(enBase.documentos.length).toBeGreaterThan(0)
  })

  it('una plantilla guardada sin el campo `activo` sigue contando', async () => {
    await ensureBaseChecklistTemplates()
    // Así están las del modelo anterior en las bases que ya existen: sin `activo`.
    await ChecklistTemplate.collection.updateMany({}, { $unset: { activo: '' } })

    const { token, persona } = await escenario({ nivelAcceso: 'rh_admin' })
    await Record.updateOne({ empleadoId: persona._id }, { $set: { documentos: [] } })

    const res = await request(app)
      .get(`/api/v1/empleados/${persona._id}/expediente`)
      .set(auth(token))

    expect(res.body.data.expediente.documentos.length).toBeGreaterThan(0)
  })

  it('el saneo de la semilla les devuelve `activo` a las plantillas base', async () => {
    await ensureBaseChecklistTemplates()
    await ChecklistTemplate.collection.updateMany(
      {},
      { $unset: { activo: '' }, $set: { clienteId: null } }
    )

    await ensureBaseChecklistTemplates()

    const crudas = await ChecklistTemplate.collection.find({}).toArray()
    expect(crudas.length).toBe(4)
    for (const plantilla of crudas) {
      expect(plantilla.activo).toBe(true)
      expect(plantilla.clienteId).toBeUndefined()
    }
  })
})

describe('Plantillas del checklist', () => {
  it('las base quedaron con empresaId null y activas', async () => {
    await ensureBaseChecklistTemplates()
    const plantillas = await ChecklistTemplate.find({})

    expect(plantillas).toHaveLength(4)
    for (const plantilla of plantillas) {
      expect(plantilla.empresaId).toBeNull()
      expect(plantilla.activo).toBe(true)
      expect(plantilla.toJSON().clienteId).toBeUndefined()
    }
  })
})

/**
 * El expediente devuelve el renglón del empleado, y ese renglón tiene que decir
 * lo mismo que `/empresas/:id/adscripciones` (D-62). Faltaban cuatro campos que
 * el archivo de nómina llena y que no se veían por ningún lado.
 */
describe('el expediente devuelve la adscripción completa (D-62)', () => {
  it('trae departamento, datosPendientes y el rastro de la baja', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const persona = await crearEmpleado({ nombre: 'Con Datos De Nomina' })
    await adscribir(empresa, persona, {
      areas: ['operaciones_urbanizadora'],
      departamento: 'Axis Zapopan',
      datosPendientes: ['fechaTerminoContrato'],
      tipoContrato: 'obra_determinada'
    })

    const res = await request(app)
      .get(`/api/v1/empleados/${persona._id}/expediente`)
      .set(auth(token))

    expect(res.status).toBe(200)
    const suya = res.body.data.empleado.adscripciones[0]
    expect(suya).toMatchObject({
      departamento: 'Axis Zapopan',
      datosPendientes: ['fechaTerminoContrato'],
      motivoBaja: null,
      fechaBaja: null
    })
    // La nómina sigue sin salir: es la decisión pendiente (D-46).
    expect(suya.nomina).toBeUndefined()
  })

  it('trae las condiciones laborales, que NO son datos sensibles (D-63)', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const persona = await crearEmpleado({ nombre: 'Con Condiciones' })
    await adscribir(empresa, persona, {
      areas: ['operaciones_urbanizadora'],
      condiciones: {
        tipoRegimen: '02 Sueldos',
        turno: 'Turno diurno',
        registroPatronal: 'R13-77767-10-5',
        baseCotizacion: 'Fijo',
        teletrabajador: false
      }
    })

    const res = await request(app)
      .get(`/api/v1/empleados/${persona._id}/expediente`)
      .set(auth(token))

    const suya = res.body.data.empleado.adscripciones[0]
    expect(suya.condiciones).toMatchObject({
      tipoRegimen: '02 Sueldos',
      turno: 'Turno diurno',
      registroPatronal: 'R13-77767-10-5',
      baseCotizacion: 'Fijo',
      teletrabajador: false
    })
    // Y ningún importe se coló ahí.
    expect(suya.condiciones.salarioDiario).toBeUndefined()
    expect(suya.condiciones.cuenta).toBeUndefined()
  })
})
