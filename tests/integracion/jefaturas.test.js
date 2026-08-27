const request = require('supertest')
const app = require('../../src/app')
const Affiliation = require('../../src/api/v1/affiliations/affiliationModel')
const Area = require('../../src/api/v1/areas/areaModel')
const {
  crearEmpresa,
  crearEmpleado,
  crearEmpleadoConSesion,
  adscribir,
  auth
} = require('../helpers/factories')

/**
 * Jefaturas de área (D-60).
 *
 * Trabajar en un área y dirigirla son cosas distintas. Hasta D-60 el alcance de
 * un `jefe_area` salía de las áreas de su propia adscripción, así que ponerlo en
 * Contabilidad porque ahí trabaja le daba de paso visión sobre todo
 * Contabilidad. Ahora se asigna explícitamente.
 */
describe('trabajar en un área ya no es dirigirla', () => {
  it('un jefe adscrito a un área que NO dirige no ve a nadie', async () => {
    const empresa = await crearEmpresa()
    // Trabaja en contabilidad, pero no dirige nada.
    const { token } = await crearEmpleadoConSesion({
      nivelAcceso: 'jefe_area',
      empresa,
      areas: ['contabilidad'],
      dirigeAreas: []
    })
    const companero = await crearEmpleado({ nombre: 'Companero De Contabilidad' })
    await adscribir(empresa, companero, { areas: ['contabilidad'] })

    const res = await request(app).get('/api/v1/empleados').set(auth(token))

    expect(res.status).toBe(200)
    expect(res.body.data.empleados.map((e) => e.empleado.nombre)).not.toContain(
      'Companero De Contabilidad'
    )
  })

  it('y en cuanto se le asigna la jefatura, la ve', async () => {
    const empresa = await crearEmpresa()
    const sesion = await crearEmpleadoConSesion({
      nivelAcceso: 'jefe_area',
      empresa,
      areas: ['contabilidad'],
      dirigeAreas: []
    })
    const companero = await crearEmpleado({ nombre: 'Companero De Contabilidad' })
    await adscribir(empresa, companero, { areas: ['contabilidad'] })

    const admin = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin', empresa })
    const asignar = await request(app)
      .patch(`/api/v1/adscripciones/${sesion.adscripcion._id}/jefaturas`)
      .set(auth(admin.token))
      .send({ dirigeAreas: ['contabilidad'] })

    expect(asignar.status).toBe(200)
    expect(asignar.body.data.adscripcion.dirigeAreas).toEqual(['contabilidad'])

    const res = await request(app).get('/api/v1/empleados').set(auth(sesion.token))
    expect(res.body.data.empleados.map((e) => e.empleado.nombre)).toContain(
      'Companero De Contabilidad'
    )
  })

  it('se puede dirigir un área en la que NO se trabaja', async () => {
    const empresa = await crearEmpresa()
    // Trabaja en dirección y dirige contabilidad: el caso del director.
    const { token } = await crearEmpleadoConSesion({
      nivelAcceso: 'jefe_area',
      empresa,
      areas: ['direccion'],
      dirigeAreas: ['contabilidad']
    })
    const contable = await crearEmpleado({ nombre: 'Persona De Contabilidad' })
    await adscribir(empresa, contable, { areas: ['contabilidad'] })
    const otro = await crearEmpleado({ nombre: 'Persona De Tesoreria' })
    await adscribir(empresa, otro, { areas: ['tesoreria'] })

    const res = await request(app).get('/api/v1/empleados').set(auth(token))

    const nombres = res.body.data.empleados.map((e) => e.empleado.nombre)
    expect(nombres).toContain('Persona De Contabilidad')
    expect(nombres).not.toContain('Persona De Tesoreria')
  })

  it('la jefatura es POR EMPRESA: dirigir en una no da alcance en la otra', async () => {
    const urbanizadora = await crearEmpresa({ nombre: 'Urbanizadora' })
    const maquinaria = await crearEmpresa({ nombre: 'Maquinaria' })
    const sesion = await crearEmpleadoConSesion({
      nivelAcceso: 'jefe_area',
      empresa: urbanizadora,
      areas: ['contabilidad'],
      dirigeAreas: ['contabilidad']
    })
    // La misma persona, adscrita también a la otra empresa, pero sin dirigir ahí.
    await adscribir(maquinaria, sesion.empleado, { areas: ['contabilidad'] })

    const aca = await crearEmpleado({ nombre: 'Contable De Urbanizadora' })
    await adscribir(urbanizadora, aca, { areas: ['contabilidad'] })
    const alla = await crearEmpleado({ nombre: 'Contable De Maquinaria' })
    await adscribir(maquinaria, alla, { areas: ['contabilidad'] })

    const res = await request(app).get('/api/v1/empleados').set(auth(sesion.token))

    const nombres = res.body.data.empleados.map((e) => e.empleado.nombre)
    expect(nombres).toContain('Contable De Urbanizadora')
    expect(nombres).not.toContain('Contable De Maquinaria')
  })
})

describe('el renglón del listado dice qué dirige', () => {
  it('GET /empleados trae dirigeAreas en cada adscripción', async () => {
    const empresa = await crearEmpresa()
    const admin = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin', empresa })
    const persona = await crearEmpleado({ nombre: 'Quien Dirige' })
    await adscribir(empresa, persona, {
      areas: ['direccion'],
      dirigeAreas: ['contabilidad']
    })

    const res = await request(app)
      .get('/api/v1/empleados?busqueda=Quien Dirige')
      .set(auth(admin.token))

    const renglon = res.body.data.empleados.find(
      (e) => e.empleado.nombre === 'Quien Dirige'
    )
    expect(renglon.adscripciones[0]).toMatchObject({
      areas: ['direccion'],
      dirigeAreas: ['contabilidad']
    })
  })
})

describe('PATCH /api/v1/adscripciones/:id/jefaturas', () => {
  const escenario = async () => {
    const empresa = await crearEmpresa()
    const admin = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin', empresa })
    const persona = await crearEmpleado({ nombre: 'Quien Dirige' })
    const adscripcion = await adscribir(empresa, persona, { areas: ['contabilidad'] })
    return { empresa, admin, persona, adscripcion }
  }

  it('manda la lista completa: mandar [] le quita la jefatura', async () => {
    const { admin, adscripcion } = await escenario()
    await request(app)
      .patch(`/api/v1/adscripciones/${adscripcion._id}/jefaturas`)
      .set(auth(admin.token))
      .send({ dirigeAreas: ['contabilidad', 'tesoreria'] })

    const res = await request(app)
      .patch(`/api/v1/adscripciones/${adscripcion._id}/jefaturas`)
      .set(auth(admin.token))
      .send({ dirigeAreas: [] })

    expect(res.status).toBe(200)
    expect((await Affiliation.findById(adscripcion._id)).dirigeAreas).toEqual([])
  })

  it('quita los repetidos: dirigir dos veces la misma área no es dirigirla más', async () => {
    const { admin, adscripcion } = await escenario()

    const res = await request(app)
      .patch(`/api/v1/adscripciones/${adscripcion._id}/jefaturas`)
      .set(auth(admin.token))
      .send({ dirigeAreas: ['contabilidad', 'contabilidad'] })

    expect(res.body.data.adscripcion.dirigeAreas).toEqual(['contabilidad'])
  })

  it('400 con un área que no existe o está dada de baja', async () => {
    const { admin, adscripcion } = await escenario()
    await Area.create({
      clave: 'axis_3',
      nombre: 'Axis 3',
      temporal: true,
      activa: false
    })

    const inventada = await request(app)
      .patch(`/api/v1/adscripciones/${adscripcion._id}/jefaturas`)
      .set(auth(admin.token))
      .send({ dirigeAreas: ['no_existe'] })
    expect(inventada.status).toBe(400)

    const deBaja = await request(app)
      .patch(`/api/v1/adscripciones/${adscripcion._id}/jefaturas`)
      .set(auth(admin.token))
      .send({ dirigeAreas: ['axis_3'] })
    expect(deBaja.status).toBe(400)
    expect(deBaja.body.message).toContain('Axis 3')
  })

  it('403 para quien no reparte visibilidad; 404 fuera de alcance', async () => {
    const { empresa, adscripcion } = await escenario()

    for (const nivelAcceso of ['rh_consulta', 'jefe_area']) {
      const { token } = await crearEmpleadoConSesion({ nivelAcceso, empresa })
      const res = await request(app)
        .patch(`/api/v1/adscripciones/${adscripcion._id}/jefaturas`)
        .set(auth(token))
        .send({ dirigeAreas: ['contabilidad'] })
      expect(res.status).toBe(403)
    }

    // Un rh_admin de OTRA empresa no la alcanza: 404, no 403.
    const ajeno = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const fuera = await request(app)
      .patch(`/api/v1/adscripciones/${adscripcion._id}/jefaturas`)
      .set(auth(ajeno.token))
      .send({ dirigeAreas: ['contabilidad'] })
    expect(fuera.status).toBe(404)
  })
})

describe('GET /api/v1/empresas/:id/jefaturas', () => {
  it('lista TODAS las áreas activas, con y sin jefe', async () => {
    const empresa = await crearEmpresa()
    const admin = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin', empresa })
    const persona = await crearEmpleado({
      nombre: 'Quien Dirige',
      numeroEmpleado: '0042'
    })
    const adscripcion = await adscribir(empresa, persona, {
      areas: ['direccion'],
      dirigeAreas: ['contabilidad']
    })

    const res = await request(app)
      .get(`/api/v1/empresas/${empresa._id}/jefaturas`)
      .set(auth(admin.token))

    expect(res.status).toBe(200)
    const porClave = Object.fromEntries(
      res.body.data.jefaturas.map((j) => [j.area.clave, j])
    )

    expect(porClave.contabilidad.jefes).toEqual([
      {
        adscripcionId: adscripcion._id.toString(),
        empleadoId: persona._id.toString(),
        nombre: 'Quien Dirige',
        numeroEmpleado: '0042'
      }
    ])
    // Las que nadie dirige también salen: es la mitad de para qué sirve.
    expect(porClave.tesoreria.jefes).toEqual([])
    expect(Object.keys(porClave)).toContain('operaciones_urbanizadora')
  })

  it('un área puede tener varios jefes, y un jefe varias áreas', async () => {
    const empresa = await crearEmpresa()
    const admin = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin', empresa })

    const una = await crearEmpleado({ nombre: 'Jefa Una' })
    await adscribir(empresa, una, {
      areas: ['contabilidad'],
      dirigeAreas: ['contabilidad', 'tesoreria']
    })
    const otra = await crearEmpleado({ nombre: 'Jefe Dos' })
    await adscribir(empresa, otra, {
      areas: ['contabilidad'],
      dirigeAreas: ['contabilidad']
    })

    const res = await request(app)
      .get(`/api/v1/empresas/${empresa._id}/jefaturas`)
      .set(auth(admin.token))

    const porClave = Object.fromEntries(
      res.body.data.jefaturas.map((j) => [j.area.clave, j])
    )
    expect(porClave.contabilidad.jefes.map((j) => j.nombre).sort()).toEqual([
      'Jefa Una',
      'Jefe Dos'
    ])
    expect(porClave.tesoreria.jefes.map((j) => j.nombre)).toEqual(['Jefa Una'])
  })

  it('403 para quien no reparte visibilidad', async () => {
    const empresa = await crearEmpresa()
    const { token } = await crearEmpleadoConSesion({
      nivelAcceso: 'rh_consulta',
      empresa
    })

    const res = await request(app)
      .get(`/api/v1/empresas/${empresa._id}/jefaturas`)
      .set(auth(token))

    expect(res.status).toBe(403)
  })
})
