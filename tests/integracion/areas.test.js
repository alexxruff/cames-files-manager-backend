const request = require('supertest')
const app = require('../../src/app')
const Area = require('../../src/api/v1/areas/areaModel')
const {
  crearEmpresa,
  crearEmpleado,
  crearEmpleadoConSesion,
  adscribir,
  auth
} = require('../helpers/factories')

const RUTA = '/api/v1/areas'

/**
 * Catálogo de áreas (D-58).
 *
 * Dejaron de ser un enum del código para poder recibir lo que trae la columna
 * `Departamento` del archivo de nómina —obras como `Axis Zapopan`— sin editar
 * el código ni desplegar.
 */
describe('GET /api/v1/areas', () => {
  it('arranca con las nueve base, activas y marcadas como tales', async () => {
    const { token } = await crearEmpleadoConSesion()

    const res = await request(app).get(RUTA).set(auth(token))

    expect(res.status).toBe(200)
    const claves = res.body.data.areas.map((a) => a.clave)
    expect(claves).toEqual(
      expect.arrayContaining([
        'direccion',
        'recursos_humanos',
        'finanzas',
        'operaciones_maquinaria',
        'operaciones_urbanizadora',
        'costos_y_presupuestos',
        'comercial',
        'tesoreria',
        'contabilidad'
      ])
    )
    expect(res.body.data.areas.every((a) => a.esBase && a.activa)).toBe(true)
    // El nombre mostrable y la clave del contrato son cosas distintas.
    const rh = res.body.data.areas.find((a) => a.clave === 'recursos_humanos')
    expect(rh.nombre).toBe('Recursos Humanos (RH)')
  })

  it('las dadas de baja se piden aparte, no vienen mezcladas', async () => {
    const { token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const temporal = await Area.create({
      clave: 'axis_3',
      nombre: 'Axis 3',
      temporal: true
    })

    await request(app)
      .patch(`${RUTA}/${temporal._id}/estado`)
      .set(auth(token))
      .send({ activa: false })

    const activas = await request(app).get(RUTA).set(auth(token))
    const bajas = await request(app).get(`${RUTA}?activa=false`).set(auth(token))
    const todas = await request(app).get(`${RUTA}?activa=todos`).set(auth(token))

    expect(activas.body.data.areas.map((a) => a.clave)).not.toContain('axis_3')
    expect(bajas.body.data.areas.map((a) => a.clave)).toEqual(['axis_3'])
    expect(todas.body.data.areas.map((a) => a.clave)).toContain('axis_3')
  })

  it('filtra las temporales, que son las que RH tiene que ir cerrando', async () => {
    const { token } = await crearEmpleadoConSesion()
    await Area.create({ clave: 'axis_3', nombre: 'Axis 3', temporal: true })

    const res = await request(app).get(`${RUTA}?temporal=true`).set(auth(token))

    expect(res.body.data.areas.map((a) => a.clave)).toEqual(['axis_3'])
  })
})

describe('POST /api/v1/areas', () => {
  it('el administrador de plataforma da de alta un área, con su clave derivada', async () => {
    const { token } = await crearEmpleadoConSesion({ alcanceGlobal: true })

    const res = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send({ nombre: 'Jurídico y Cumplimiento' })

    expect(res.status).toBe(201)
    expect(res.body.data.area).toMatchObject({
      clave: 'juridico_y_cumplimiento',
      nombre: 'Jurídico y Cumplimiento',
      esBase: false,
      temporal: false,
      activa: true
    })
  })

  it('es idempotente por nombre: la segunda vez devuelve la que hay', async () => {
    const { token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const primera = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send({ nombre: 'Jurídico' })

    const segunda = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send({ nombre: '  jurídico  ' })

    expect(segunda.status).toBe(200)
    expect(segunda.body.data.area._id).toBe(primera.body.data.area._id)
    expect(await Area.countDocuments({ nombreNormalizado: 'juridico' })).toBe(1)
  })

  it('403 sin alcance global: el catálogo afecta a todo el grupo', async () => {
    const { token } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })

    const res = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send({ nombre: 'Jurídico' })

    expect(res.status).toBe(403)
  })
})

describe('PATCH /api/v1/areas/:id — renombrar', () => {
  it('cambia el nombre y NO la clave: las adscripciones la guardan', async () => {
    const { token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const area = await Area.findOne({ clave: 'costos_y_presupuestos' })

    const res = await request(app)
      .patch(`${RUTA}/${area._id}`)
      .set(auth(token))
      .send({ nombre: 'Costos' })

    expect(res.status).toBe(200)
    expect(res.body.data.area).toMatchObject({
      clave: 'costos_y_presupuestos',
      nombre: 'Costos'
    })
  })

  it('409 si el nombre ya es de otra', async () => {
    const { token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const area = await Area.findOne({ clave: 'tesoreria' })

    const res = await request(app)
      .patch(`${RUTA}/${area._id}`)
      .set(auth(token))
      .send({ nombre: 'Contabilidad' })

    expect(res.status).toBe(409)
  })
})

describe('PATCH /api/v1/areas/:id/estado — dar de baja y reactivar', () => {
  const temporal = () =>
    Area.create({ clave: 'axis_3', nombre: 'Axis 3', temporal: true })

  it('da de baja sin borrar, y se puede reactivar', async () => {
    const { token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const area = await temporal()

    const baja = await request(app)
      .patch(`${RUTA}/${area._id}/estado`)
      .set(auth(token))
      .send({ activa: false })

    expect(baja.status).toBe(200)
    expect(baja.body.data.area.activa).toBe(false)
    // No se borró: sigue ahí para reactivarla.
    expect(await Area.countDocuments({ clave: 'axis_3' })).toBe(1)

    const alta = await request(app)
      .patch(`${RUTA}/${area._id}/estado`)
      .set(auth(token))
      .send({ activa: true })

    expect(alta.body.data.area.activa).toBe(true)
  })

  it('400 si alguien todavía la tiene asignada, diciendo cuántos', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const area = await temporal()
    const persona = await crearEmpleado({ nombre: 'En Axis Tres' })
    await adscribir(empresa, persona, { areas: ['axis_3'] })

    const res = await request(app)
      .patch(`${RUTA}/${area._id}/estado`)
      .set(auth(token))
      .send({ activa: false })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('1 persona la tiene')
    expect((await Area.findById(area._id)).activa).toBe(true)
  })

  it('400 con un área base: no se dan de baja', async () => {
    const { token } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const base = await Area.findOne({ clave: 'tesoreria' })

    const res = await request(app)
      .patch(`${RUTA}/${base._id}/estado`)
      .set(auth(token))
      .send({ activa: false })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('base')
  })

  describe('quién puede dar de baja qué', () => {
    it('rh_admin y rh_consulta cierran las TEMPORALES, sin alcance global', async () => {
      for (const nivelAcceso of ['rh_admin', 'rh_consulta']) {
        const { token } = await crearEmpleadoConSesion({ nivelAcceso })
        const area = await Area.create({
          clave: `obra_${nivelAcceso}`,
          nombre: `Obra ${nivelAcceso}`,
          temporal: true
        })

        const res = await request(app)
          .patch(`${RUTA}/${area._id}/estado`)
          .set(auth(token))
          .send({ activa: false })

        expect(res.status).toBe(200)
        expect(res.body.data.area.activa).toBe(false)
      }
    })

    it('pero NO las del catálogo: eso es del administrador de plataforma', async () => {
      const { token } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const delCatalogo = await Area.create({
        clave: 'juridico',
        nombre: 'Jurídico',
        temporal: false
      })

      const res = await request(app)
        .patch(`${RUTA}/${delCatalogo._id}/estado`)
        .set(auth(token))
        .send({ activa: false })

      expect(res.status).toBe(403)
      expect(res.body.message).toContain('administrador de plataforma')
    })

    it('un jefe de área no cierra ninguna', async () => {
      const { token } = await crearEmpleadoConSesion({
        nivelAcceso: 'jefe_area',
        areas: ['operaciones_urbanizadora']
      })
      const area = await Area.create({
        clave: 'axis_3',
        nombre: 'Axis 3',
        temporal: true
      })

      const res = await request(app)
        .patch(`${RUTA}/${area._id}/estado`)
        .set(auth(token))
        .send({ activa: false })

      expect(res.status).toBe(403)
    })
  })
})

describe('las áreas se validan contra el catálogo al guardarlas', () => {
  it('400 al adscribir con un área que no existe', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const persona = await crearEmpleado({ nombre: 'Sin Area Valida' })

    const res = await request(app)
      .post(`/api/v1/empresas/${empresa._id}/adscripciones`)
      .set(auth(token))
      .send({
        empleadoId: persona._id.toString(),
        areas: ['area_inventada'],
        tipoContrato: 'indeterminado',
        fechaIngreso: '2026-01-15'
      })

    expect(res.status).toBe(400)
    expect(res.body.errors[0].path).toBe('areas')
  })

  it('400 con un área dada de baja, diciendo cuál', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({
      nivelAcceso: 'rh_admin',
      alcanceGlobal: true
    })
    const area = await Area.create({
      clave: 'axis_3',
      nombre: 'Axis 3',
      temporal: true,
      activa: false
    })
    expect(area.activa).toBe(false)

    const persona = await crearEmpleado({ nombre: 'A Un Area Cerrada' })
    const res = await request(app)
      .post(`/api/v1/empresas/${empresa._id}/adscripciones`)
      .set(auth(token))
      .send({
        empleadoId: persona._id.toString(),
        areas: ['axis_3'],
        tipoContrato: 'indeterminado',
        fechaIngreso: '2026-01-15'
      })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('Axis 3')
  })

  it('pero el FILTRO sí admite un área dada de baja: es a quien hay que reasignar', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({ alcanceGlobal: true })
    const persona = await crearEmpleado({ nombre: 'En Area Cerrada' })
    await adscribir(empresa, persona, { areas: ['axis_3'] })
    await Area.create({
      clave: 'axis_3',
      nombre: 'Axis 3',
      temporal: true,
      activa: false
    })

    const res = await request(app).get('/api/v1/empleados?area=axis_3').set(auth(token))

    expect(res.status).toBe(200)
    expect(res.body.data.empleados.map((e) => e.empleado.nombre)).toContain(
      'En Area Cerrada'
    )
  })

  it('400 si el área del filtro no existe', async () => {
    const { token } = await crearEmpleadoConSesion()

    const res = await request(app)
      .get('/api/v1/empleados?area=no_existe')
      .set(auth(token))

    expect(res.status).toBe(400)
    expect(res.body.errors[0].path).toBe('area')
  })
})

describe('las áreas heredadas del modelo anterior', () => {
  it('se siembran sólo si tienen gente, para no romper a nadie', async () => {
    const { ensureBaseAreas } = require('../../src/services/seedAreas')
    const empresa = await crearEmpresa()
    const persona = await crearEmpleado({ nombre: 'Con Area Vieja' })
    // Se escribe directo: el área ya no existe en el catálogo, así que la ruta
    // normal la rechazaría — es justo el dato que dejó el modelo anterior.
    const Affiliation = require('../../src/api/v1/affiliations/affiliationModel')
    await Affiliation.create({
      empresaId: empresa._id,
      empleadoId: persona._id,
      areas: ['obra'],
      tipoContrato: 'indeterminado',
      fechaIngreso: '2026-01-15'
    })

    await ensureBaseAreas()

    const obra = await Area.findOne({ clave: 'obra' })
    expect(obra).not.toBeNull()
    expect(obra.esBase).toBe(false)
    // Activa: si entrara de baja, su jefe de área dejaría de ver a su gente.
    expect(obra.activa).toBe(true)
    // Y las que nadie tiene no se siembran.
    expect(await Area.findOne({ clave: 'compras' })).toBeNull()
  })
})
