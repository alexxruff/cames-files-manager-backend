const request = require('supertest')
const app = require('../../src/app')
const Record = require('../../src/api/v1/records/recordModel')
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
const { today, addDays, nextAnniversary } = require('../../src/utils/dates')

/**
 * `GET /alertas` — la bandeja de pendientes (spec §6.6, D-47).
 *
 * Lo que estas pruebas cuidan, y por qué:
 *
 * 1. **Que la alerta desaparezca cuando se resuelve la causa**, recorriendo el
 *    flujo HTTP de verdad: subir el documento y validarlo, y volver a pedir la
 *    bandeja. Es lo que se pidió, y como las alertas se derivan (no se guardan),
 *    lo que se comprueba es que no haya quedado nada que apagar.
 * 2. **Que el alcance se respete**: nadie ve alertas de gente que no puede ver.
 *    Es la superficie nueva más peligrosa de este módulo.
 * 3. **Que un cumpleaños no tape un documento vencido.**
 */

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)])

afterEach(() => storage.limpiarMemoria())

/** Una fecha de nacimiento cuyo cumpleaños cae en `dias` días desde hoy. */
const naceParaCumplirEn = (dias, anio = 1990) => {
  const objetivo = addDays(today(), dias)
  return `${anio}${objetivo.slice(4)}`
}

/**
 * Empresa + sesión `rh_admin` + una persona de obra adscrita, con su expediente
 * ya creado. El expediente nace lleno de `pending`, así que la persona genera
 * alertas de `documento_faltante` desde el primer momento.
 */
let escenarios = 0

async function escenario(datos = {}) {
  await ensureBaseChecklistTemplates()
  escenarios += 1
  const sesion = await crearEmpleadoConSesion({
    nivelAcceso: datos.nivelAcceso || 'rh_admin',
    areas: datos.areasDelUsuario
  })
  // Nombre único: el índice de categorías es global y varias pruebas montan dos
  // escenarios para comprobar el aislamiento entre empresas.
  const categoria = await crearCategoria(`Albañil ${escenarios}`, 'mano_de_obra')

  const persona = await crearEmpleado({
    nombre: 'Roberto Aguilar Sosa',
    tipo: 'mano_de_obra',
    categoriaId: categoria._id,
    fechaNacimiento: datos.fechaNacimiento ?? null
  })
  await adscribir(sesion.empresa, persona, {
    areas: datos.areas || ['obra'],
    tipoContrato: 'indeterminado'
  })

  // El expediente nace al consultarlo la primera vez.
  const res = await request(app)
    .get(`/api/v1/empleados/${persona._id}/expediente`)
    .set(auth(sesion.token))

  return { ...sesion, categoria, persona, expedienteId: res.body.data.expediente._id }
}

const listar = (token, query = '') =>
  request(app).get(`/api/v1/alertas${query}`).set(auth(token))

const deEmpleado = (res, empleadoId) =>
  res.body.data.alertas.filter((a) => a.empleadoId === empleadoId.toString())

describe('GET /api/v1/alertas', () => {
  describe('alertas de documentación faltante', () => {
    it('lista un faltante por cada documento requerido sin subir', async () => {
      const { token, persona, expedienteId } = await escenario()

      const res = await listar(token)

      expect(res.status).toBe(200)
      const suyas = deEmpleado(res, persona._id)
      expect(suyas.length).toBeGreaterThan(0)
      expect(suyas.every((a) => a.tipo === 'documento_faltante')).toBe(true)
      expect(suyas[0]).toMatchObject({
        origen: 'documento',
        empleadoNombre: 'Roberto Aguilar Sosa',
        expedienteId,
        areas: ['obra']
      })
      expect(suyas[0].categoriaNombre).toMatch(/^Albañil/)
      expect(suyas[0].mensaje).toMatch(/^Falta subir /)
    })

    it('trae la empresa de la persona en empresas[]', async () => {
      const { token, persona, empresa } = await escenario()

      const [alerta] = deEmpleado(await listar(token), persona._id)

      expect(alerta.empresas).toEqual([
        { _id: empresa._id.toString(), nombre: empresa.nombre }
      ])
    })

    /*
     * LA prueba de lo que se pidió: «que se remuevan cuando se resuelven». Se
     * recorre el flujo real —subir y validar— y la alerta ya no está. No hubo que
     * apagar nada porque no hay nada guardado que apagar.
     */
    it('subir y validar el documento lo saca de la bandeja, sin ninguna acción extra', async () => {
      const { token, persona, expedienteId } = await escenario()

      const antes = deEmpleado(await listar(token), persona._id)
      const faltante = antes.find((a) => a.tipoDocumento === 'ine')
      expect(faltante).toBeDefined()

      await request(app)
        .post(`/api/v1/expedientes/${expedienteId}/documentos/ine`)
        .set(auth(token))
        .attach('archivo', PDF, 'ine.pdf')
        .expect(201)

      // En revisión todavía no genera alerta, pero tampoco falta ya.
      const enRevision = deEmpleado(await listar(token), persona._id)
      expect(enRevision.find((a) => a.tipoDocumento === 'ine')).toBeUndefined()

      await request(app)
        .post(`/api/v1/expedientes/${expedienteId}/documentos/ine/revisar`)
        .set(auth(token))
        .send({ aprobado: true })
        .expect(200)

      const despues = deEmpleado(await listar(token), persona._id)
      expect(despues.find((a) => a.tipoDocumento === 'ine')).toBeUndefined()
      expect(despues.length).toBe(antes.length - 1)
    })

    it('rechazar un documento cambia la alerta de faltante a rechazado, con su motivo', async () => {
      const { token, persona, expedienteId } = await escenario()

      await request(app)
        .post(`/api/v1/expedientes/${expedienteId}/documentos/ine`)
        .set(auth(token))
        .attach('archivo', PDF, 'ine.pdf')
        .expect(201)
      await request(app)
        .post(`/api/v1/expedientes/${expedienteId}/documentos/ine/revisar`)
        .set(auth(token))
        .send({ aprobado: false, motivo: 'La credencial está ilegible' })
        .expect(200)

      const [alerta] = deEmpleado(
        await listar(token, '?tipo=documento_rechazado'),
        persona._id
      )
      expect(alerta.tipoDocumento).toBe('ine')
      expect(alerta.motivoRechazo).toBe('La credencial está ilegible')
      expect(alerta.mensaje).toContain('fue rechazado')
    })

    it('un documento vencido sale como vencido, con los días en negativo', async () => {
      const { token, persona, expedienteId } = await escenario()

      // Se fija el estatus a mano: llegar hasta "vencido" por el flujo exigiría
      // esperar meses. Lo que se prueba aquí es la derivación, no el flujo.
      await Record.updateOne(
        { _id: expedienteId, 'documentos.tipo': 'ine' },
        {
          $set: {
            'documentos.$.estatus': 'validated',
            'documentos.$.vigenciaHasta': addDays(today(), -4)
          }
        }
      )

      const [alerta] = deEmpleado(await listar(token, '?tipo=vencido'), persona._id)
      expect(alerta.tipoDocumento).toBe('ine')
      expect(alerta.diasRestantes).toBe(-4)
      expect(alerta.mensaje).toBe('Identificación oficial (INE) venció hace 4 días.')
    })

    it('un documento que vence pronto sale como por vencer', async () => {
      const { token, persona, expedienteId } = await escenario()

      await Record.updateOne(
        { _id: expedienteId, 'documentos.tipo': 'ine' },
        {
          $set: {
            'documentos.$.estatus': 'validated',
            'documentos.$.vigenciaHasta': addDays(today(), 5)
          }
        }
      )

      const [alerta] = deEmpleado(await listar(token, '?tipo=por_vencer'), persona._id)
      expect(alerta.diasRestantes).toBe(5)
      expect(alerta.mensaje).toContain('vence en 5 días')
    })
  })

  describe('alertas de cumpleaños', () => {
    it('avisa el mismo día, con la edad que cumple', async () => {
      const { token, persona } = await escenario({
        fechaNacimiento: naceParaCumplirEn(0, 1990)
      })

      const [alerta] = deEmpleado(await listar(token, '?origen=cumpleanos'), persona._id)

      expect(alerta).toMatchObject({
        origen: 'cumpleanos',
        tipo: 'cumpleanos',
        diasRestantes: 0,
        empleadoNombre: 'Roberto Aguilar Sosa'
      })
      expect(alerta.fecha).toBe(nextAnniversary(persona.fechaNacimiento, today()))
      expect(alerta.mensaje).toContain('Hoy es el cumpleaños de Roberto Aguilar Sosa')
    })

    it('avisa dentro de la ventana por defecto (7 días)', async () => {
      const { token, persona } = await escenario({
        fechaNacimiento: naceParaCumplirEn(5)
      })

      const alertas = deEmpleado(await listar(token, '?origen=cumpleanos'), persona._id)
      expect(alertas).toHaveLength(1)
      expect(alertas[0].diasRestantes).toBe(5)
    })

    it('no avisa fuera de la ventana, pero sí si se ensancha con ?diasCumpleanos', async () => {
      const { token, persona } = await escenario({
        fechaNacimiento: naceParaCumplirEn(20)
      })

      const porDefecto = await listar(token, '?origen=cumpleanos')
      expect(deEmpleado(porDefecto, persona._id)).toEqual([])

      const ensanchada = await listar(token, '?origen=cumpleanos&diasCumpleanos=30')
      expect(deEmpleado(ensanchada, persona._id)).toHaveLength(1)
    })

    /*
     * El equivalente de «se resuelve sola» para un cumpleaños: nadie lo cierra,
     * lo cierra el calendario. Alguien que cumplió ayer no está en la bandeja.
     */
    it('a quien cumplió ayer ya no se le avisa', async () => {
      const { token, persona } = await escenario({
        fechaNacimiento: naceParaCumplirEn(-1)
      })

      const alertas = deEmpleado(await listar(token, '?origen=cumpleanos'), persona._id)
      expect(alertas).toEqual([])
    })

    it('sin fecha de nacimiento no hay alerta de cumpleaños', async () => {
      const { token, persona } = await escenario({ fechaNacimiento: null })

      const alertas = deEmpleado(await listar(token, '?origen=cumpleanos'), persona._id)
      expect(alertas).toEqual([])
    })

    it('un cumpleaños no tapa un documento vencido', async () => {
      const { token, persona, expedienteId } = await escenario({
        fechaNacimiento: naceParaCumplirEn(0)
      })
      await Record.updateOne(
        { _id: expedienteId, 'documentos.tipo': 'ine' },
        {
          $set: {
            'documentos.$.estatus': 'validated',
            'documentos.$.vigenciaHasta': addDays(today(), -2)
          }
        }
      )

      const suyas = deEmpleado(await listar(token), persona._id)
      expect(suyas[0].tipo).toBe('vencido')
      expect(suyas[suyas.length - 1].tipo).toBe('cumpleanos')
    })
  })

  describe('quién no genera alertas', () => {
    it('alguien dado de baja del sistema no genera ninguna', async () => {
      const { token, persona } = await escenario({
        fechaNacimiento: naceParaCumplirEn(0)
      })

      expect(deEmpleado(await listar(token), persona._id).length).toBeGreaterThan(0)

      await request(app)
        .patch(`/api/v1/empleados/${persona._id}/estado`)
        .set(auth(token))
        .send({ activo: false, motivo: 'Renunció por motivos personales' })
        .expect(200)

      expect(deEmpleado(await listar(token), persona._id)).toEqual([])
    })

    it('alguien dado de baja de la empresa deja de generarlas', async () => {
      const { token, persona, adscripcion, empresa } = await escenario({
        fechaNacimiento: naceParaCumplirEn(0)
      })
      const suya = await request(app)
        .get(`/api/v1/empresas/${empresa._id}/adscripciones`)
        .set(auth(token))
      const suyaId = suya.body.data.adscripciones.find(
        (a) => a.empleadoId === persona._id.toString()
      )._id

      await request(app)
        .patch(`/api/v1/adscripciones/${suyaId}/estado`)
        .set(auth(token))
        .send({ activo: false, motivo: 'Terminó la obra en la que estaba' })
        .expect(200)

      expect(deEmpleado(await listar(token), persona._id)).toEqual([])
      expect(adscripcion).toBeDefined()
    })
  })

  describe('alcance', () => {
    it('no ve alertas de una empresa que no es suya', async () => {
      const propia = await escenario()
      const ajena = await escenario()

      const res = await listar(propia.token)

      expect(deEmpleado(res, propia.persona._id).length).toBeGreaterThan(0)
      expect(deEmpleado(res, ajena.persona._id)).toEqual([])
    })

    it('404 al pedir una empresa fuera de su alcance, no 403', async () => {
      const { token } = await escenario()
      const ajena = await crearEmpresa({ nombre: 'Empresa ajena' })

      const res = await listar(token, `?empresaId=${ajena._id}`)

      expect(res.status).toBe(404)
      expect(res.body.message).toBe('La empresa no existe')
    })

    it('el jefe de área sólo ve alertas de su área', async () => {
      await ensureBaseChecklistTemplates()
      const empresa = await crearEmpresa({ nombre: 'Maquinaria Cames' })
      const jefe = await crearEmpleadoConSesion({
        nivelAcceso: 'jefe_area',
        empresa,
        areas: ['obra']
      })
      const categoria = await crearCategoria('Albañil', 'mano_de_obra')

      const suyo = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      const ajeno = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      await adscribir(empresa, suyo, { areas: ['obra'] })
      await adscribir(empresa, ajeno, { areas: ['mantenimiento'] })
      for (const persona of [suyo, ajeno]) {
        await request(app)
          .get(`/api/v1/empleados/${persona._id}/expediente`)
          .set(auth(jefe.token))
      }

      const res = await listar(jefe.token)

      expect(res.status).toBe(200)
      expect(deEmpleado(res, suyo._id).length).toBeGreaterThan(0)
      expect(deEmpleado(res, ajeno._id)).toEqual([])
    })

    it('acota a una de sus empresas con ?empresaId', async () => {
      await ensureBaseChecklistTemplates()
      const unaEmpresa = await crearEmpresa({ nombre: 'Cames Maquinaria' })
      const otraEmpresa = await crearEmpresa({ nombre: 'Cames Urbanización' })
      const admin = await crearEmpleadoConSesion({ alcanceGlobal: true })
      const categoria = await crearCategoria('Albañil', 'mano_de_obra')

      const aqui = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      const alla = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      await adscribir(unaEmpresa, aqui, { areas: ['obra'] })
      await adscribir(otraEmpresa, alla, { areas: ['obra'] })
      for (const persona of [aqui, alla]) {
        await request(app)
          .get(`/api/v1/empleados/${persona._id}/expediente`)
          .set(auth(admin.token))
      }

      const res = await listar(admin.token, `?empresaId=${unaEmpresa._id}`)

      expect(deEmpleado(res, aqui._id).length).toBeGreaterThan(0)
      expect(deEmpleado(res, alla._id)).toEqual([])
    })
  })

  describe('filtros y resumen', () => {
    it('filtra por empleado', async () => {
      const primera = await escenario()
      const segunda = await escenario({ nivelAcceso: 'rh_admin' })

      const res = await listar(primera.token, `?empleadoId=${primera.persona._id}`)

      expect(
        res.body.data.alertas.every(
          (a) => a.empleadoId === primera.persona._id.toString()
        )
      ).toBe(true)
      expect(deEmpleado(res, segunda.persona._id)).toEqual([])
    })

    it('filtra por origen', async () => {
      const { token } = await escenario({ fechaNacimiento: naceParaCumplirEn(0) })

      const cumples = await listar(token, '?origen=cumpleanos')
      expect(cumples.body.data.alertas.every((a) => a.origen === 'cumpleanos')).toBe(true)
      expect(cumples.body.data.alertas.length).toBeGreaterThan(0)

      const documentos = await listar(token, '?origen=documento')
      expect(documentos.body.data.alertas.every((a) => a.origen === 'documento')).toBe(
        true
      )
    })

    it('filtra por área', async () => {
      const { token, persona } = await escenario({ areas: ['obra'] })

      expect(
        deEmpleado(await listar(token, '?area=obra'), persona._id).length
      ).toBeGreaterThan(0)
      expect(deEmpleado(await listar(token, '?area=contabilidad'), persona._id)).toEqual(
        []
      )
    })

    /*
     * El resumen es el contador de la campanita: tiene que decir cuántos
     * pendientes hay EN TOTAL, no cuántos quedaron después del filtro que la
     * pantalla trae puesto. Si se calculara sobre lo filtrado, el badge cambiaría
     * al cambiar de pestaña.
     */
    it('el resumen cuenta todas las alertas, aunque la lista venga filtrada', async () => {
      const { token } = await escenario({ fechaNacimiento: naceParaCumplirEn(0) })

      const sinFiltro = await listar(token)
      const soloCumples = await listar(token, '?origen=cumpleanos')

      expect(soloCumples.body.data.resumen).toEqual(sinFiltro.body.data.resumen)
      expect(soloCumples.body.data.total).toBeLessThan(sinFiltro.body.data.total)
      expect(soloCumples.body.data.resumen.cumpleanos).toBeGreaterThan(0)
      expect(soloCumples.body.data.resumen.documento_faltante).toBeGreaterThan(0)
    })

    it('el resumen trae todos los tipos, en cero los que no hay', async () => {
      const { token } = await escenario()

      const { resumen } = (await listar(token)).body.data

      expect(Object.keys(resumen).sort()).toEqual(
        [
          'total',
          'vencido',
          'documento_rechazado',
          'por_vencer',
          'documento_faltante',
          'cumpleanos'
        ].sort()
      )
      expect(resumen.vencido).toBe(0)
      expect(resumen.total).toBe(resumen.documento_faltante)
    })

    it('devuelve truncado en falso cuando no se recorta nada', async () => {
      const { token } = await escenario()
      expect((await listar(token)).body.data.truncado).toBe(false)
    })
  })

  describe('permisos y validación', () => {
    it('401 sin sesión', async () => {
      const res = await request(app).get('/api/v1/alertas')
      expect(res.status).toBe(401)
    })

    it('rh_consulta y jefe_area también ven la bandeja: una alerta no dice nada nuevo', async () => {
      for (const nivelAcceso of ['rh_consulta', 'jefe_area']) {
        const { token } = await escenario({ nivelAcceso, areasDelUsuario: ['obra'] })
        expect((await listar(token)).status).toBe(200)
      }
    })

    it('400 con un tipo o un origen que no existen', async () => {
      const { token } = await escenario()

      const tipo = await listar(token, '?tipo=inventado')
      expect(tipo.status).toBe(400)
      expect(tipo.body.errors[0].msg).toContain('tipo debe ser uno de')

      const origen = await listar(token, '?origen=inventado')
      expect(origen.status).toBe(400)
    })

    it('400 con una ventana de cumpleaños imposible', async () => {
      const { token } = await escenario()

      expect((await listar(token, '?diasCumpleanos=-1')).status).toBe(400)
      expect((await listar(token, '?diasCumpleanos=400')).status).toBe(400)
      expect((await listar(token, '?diasCumpleanos=abc')).status).toBe(400)
    })
  })

  it('la ruta ya no figura como pendiente en el inventario', async () => {
    const res = await request(app).get('/api/v1')

    const pendientes = res.body.data.pendientes.map((p) => p.ruta)
    expect(pendientes).not.toContain('/api/v1/alertas')
    expect(res.body.data.implementados.map((r) => r.ruta)).toContain('/api/v1/alertas')
  })
})
