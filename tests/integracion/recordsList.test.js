const request = require('supertest')
const app = require('../../src/app')
const Record = require('../../src/api/v1/records/recordModel')
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

/**
 * `GET /expedientes` — listado paginado (backend-spec §6.5, D-45).
 *
 * `estatus` es derivado (D-10): no se filtra en Mongo, se resuelve el avance de
 * todos los que cumplen los demás filtros y se filtra/pagina en memoria (ver el
 * comentario en `recordService.list`). Estas pruebas cubren justo eso: que el
 * resultado sea correcto, no cómo se calculó.
 */
describe('GET /api/v1/expedientes', () => {
  const listar = (token, query = '') =>
    request(app).get(`/api/v1/expedientes${query}`).set(auth(token))

  it('lista los expedientes de las empresas visibles, con avance y empleado', async () => {
    await ensureBaseChecklistTemplates()
    const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const categoria = await crearCategoria('Albañil', 'mano_de_obra')
    const persona = await crearEmpleado({
      nombre: 'Roberto Aguilar Sosa',
      tipo: 'mano_de_obra',
      categoriaId: categoria._id
    })
    await adscribir(sesion.empresa, persona, { areas: ['operaciones_urbanizadora'] })
    // El expediente nace al consultarlo la primera vez; aquí se fuerza para
    // que ya exista cuando se pida el listado.
    await request(app)
      .get(`/api/v1/empleados/${persona._id}/expediente`)
      .set(auth(sesion.token))

    const res = await listar(sesion.token)

    expect(res.status).toBe(200)
    expect(res.body.data.total).toBe(1)
    expect(res.body.data.pagina).toBe(1)
    expect(res.body.data.porPagina).toBe(25)
    const fila = res.body.data.expedientes[0]
    expect(fila.empleado.empleado.nombre).toBe('Roberto Aguilar Sosa')
    expect(fila.expediente.documentos.length).toBeGreaterThan(0)
    expect(fila.avance).toMatchObject({ estatus: 'incomplete' })
  })

  it('no ve expedientes de una empresa fuera de su alcance', async () => {
    await ensureBaseChecklistTemplates()
    const propia = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const ajena = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const categoria = await crearCategoria('Albañil', 'mano_de_obra')
    const personaAjena = await crearEmpleado({
      tipo: 'mano_de_obra',
      categoriaId: categoria._id
    })
    await adscribir(ajena.empresa, personaAjena, { areas: ['operaciones_urbanizadora'] })
    await request(app)
      .get(`/api/v1/empleados/${personaAjena._id}/expediente`)
      .set(auth(ajena.token))

    const res = await listar(propia.token)
    expect(res.body.data.total).toBe(0)
  })

  it('filtra por empresaId; 404 si la empresa no es visible', async () => {
    await ensureBaseChecklistTemplates()
    const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const otraEmpresa = await crearEmpresa()
    const categoria = await crearCategoria('Albañil', 'mano_de_obra')
    const persona = await crearEmpleado({
      tipo: 'mano_de_obra',
      categoriaId: categoria._id
    })
    await adscribir(sesion.empresa, persona, { areas: ['operaciones_urbanizadora'] })
    await request(app)
      .get(`/api/v1/empleados/${persona._id}/expediente`)
      .set(auth(sesion.token))

    const propia = await listar(sesion.token, `?empresaId=${sesion.empresa._id}`)
    expect(propia.body.data.total).toBe(1)

    const fueraDeAlcance = await listar(sesion.token, `?empresaId=${otraEmpresa._id}`)
    expect(fueraDeAlcance.status).toBe(404)
  })

  it('filtra por estatus: sólo lo validado y vigente cuenta como complete', async () => {
    await ensureBaseChecklistTemplates()
    const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const categoria = await crearCategoria('Albañil', 'mano_de_obra')
    const persona = await crearEmpleado({
      tipo: 'mano_de_obra',
      categoriaId: categoria._id
    })
    await adscribir(sesion.empresa, persona, { areas: ['operaciones_urbanizadora'] })
    await request(app)
      .get(`/api/v1/empleados/${persona._id}/expediente`)
      .set(auth(sesion.token))

    // Todo pendiente: incomplete.
    const incompletos = await listar(sesion.token, '?estatus=incomplete')
    expect(incompletos.body.data.total).toBe(1)
    const completos = await listar(sesion.token, '?estatus=complete')
    expect(completos.body.data.total).toBe(0)

    // Se valida todo lo requerido a mano, sin pasar por el flujo de subida:
    // lo único que importa aquí es el estatus derivado.
    await Record.updateOne(
      { empleadoId: persona._id },
      { $set: { 'documentos.$[d].estatus': 'validated' } },
      { arrayFilters: [{ 'd.requerido': true }] }
    )

    const ahoraCompletos = await listar(sesion.token, '?estatus=complete')
    expect(ahoraCompletos.body.data.total).toBe(1)
    expect(ahoraCompletos.body.data.expedientes[0].empleado.empleado._id).toBe(
      persona._id.toString()
    )
    const yaNoIncompletos = await listar(sesion.token, '?estatus=incomplete')
    expect(yaNoIncompletos.body.data.total).toBe(0)
  })

  it('400 con un estatus que no existe', async () => {
    const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const res = await listar(sesion.token, '?estatus=inventado')
    expect(res.status).toBe(400)
  })

  it('pagina correctamente: total real, y cada página con el tamaño pedido', async () => {
    await ensureBaseChecklistTemplates()
    const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const categoria = await crearCategoria('Albañil', 'mano_de_obra')

    for (let i = 0; i < 3; i++) {
      const persona = await crearEmpleado({
        nombre: `Persona ${i}`,
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      await adscribir(sesion.empresa, persona, { areas: ['operaciones_urbanizadora'] })
      await request(app)
        .get(`/api/v1/empleados/${persona._id}/expediente`)
        .set(auth(sesion.token))
    }

    const primera = await listar(sesion.token, '?porPagina=2&pagina=1')
    expect(primera.body.data.total).toBe(3)
    expect(primera.body.data.expedientes).toHaveLength(2)

    const segunda = await listar(sesion.token, '?porPagina=2&pagina=2')
    expect(segunda.body.data.expedientes).toHaveLength(1)
  })

  it('401 sin sesión', async () => {
    const res = await request(app).get('/api/v1/expedientes')
    expect(res.status).toBe(401)
  })
})
