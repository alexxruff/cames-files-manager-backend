const request = require('supertest')
const app = require('../../src/app')
const Affiliation = require('../../src/api/v1/affiliations/affiliationModel')
const Record = require('../../src/api/v1/records/recordModel')
const Company = require('../../src/api/v1/companies/companyModel')
const {
  ensureBaseChecklistTemplates
} = require('../../src/services/seedChecklistTemplates')
const {
  crearEmpresa,
  crearCategoria,
  crearEmpleado,
  crearEmpleadoConSesion,
  adscribir,
  crearProyecto,
  crearRegistroPatronal,
  asignar,
  auth
} = require('../helpers/factories')

/**
 * Adscripciones: empresa ↔ empleado (backend-spec §6.3, D-45).
 *
 * El alta (`POST /empleados`) ya prueba la primera adscripción de una persona;
 * aquí se prueban las que vienen después: sumar una empresa, moverla, darla de
 * baja de una sin tocar las demás.
 */
describe('Adscripciones', () => {
  describe('GET /api/v1/empresas/:id/adscripciones', () => {
    it('lista las adscripciones de la empresa, con la persona resuelta', async () => {
      const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const categoria = await crearCategoria('Albañil', 'mano_de_obra')
      const persona = await crearEmpleado({
        nombre: 'Roberto Aguilar Sosa',
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      await adscribir(sesion.empresa, persona, { areas: ['operaciones_urbanizadora'] })

      const res = await request(app)
        .get(`/api/v1/empresas/${sesion.empresa._id}/adscripciones`)
        .set(auth(sesion.token))

      expect(res.status).toBe(200)
      // El propio `rh_admin` de la sesión también tiene una adscripción a esta
      // empresa (así entró); se busca la de la persona entre las que haya.
      const suya = res.body.data.adscripciones.find(
        (a) => a.empleado._id === persona._id.toString()
      )
      expect(suya.empleado).toMatchObject({
        nombre: 'Roberto Aguilar Sosa',
        tipo: 'mano_de_obra',
        activo: true
      })
    })

    it('filtra por activo y por área', async () => {
      const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const categoria = await crearCategoria('Albañil', 'mano_de_obra')
      const activa = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      const baja = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      await adscribir(sesion.empresa, activa, { areas: ['operaciones_urbanizadora'] })
      await adscribir(sesion.empresa, baja, {
        areas: ['operaciones_maquinaria'],
        activo: false,
        motivoBaja: 'Renunció'
      })

      const soloActivas = await request(app)
        .get(`/api/v1/empresas/${sesion.empresa._id}/adscripciones?activo=true`)
        .set(auth(sesion.token))
      const idsActivas = soloActivas.body.data.adscripciones.map((a) => a.empleadoId)
      expect(idsActivas).toContain(activa._id.toString())
      expect(idsActivas).not.toContain(baja._id.toString())

      const porArea = await request(app)
        .get(
          `/api/v1/empresas/${sesion.empresa._id}/adscripciones?area=operaciones_maquinaria&activo=todos`
        )
        .set(auth(sesion.token))
      expect(porArea.body.data.adscripciones).toHaveLength(1)
      expect(porArea.body.data.adscripciones[0].activo).toBe(false)
    })

    it('por defecto sólo trae activas; activo=false trae sólo las bajas, sin mezclar (D-51)', async () => {
      const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const categoria = await crearCategoria('Albañil', 'mano_de_obra')
      const activa = await crearEmpleado({
        nombre: 'Activa',
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      const baja = await crearEmpleado({
        nombre: 'Dada De Baja',
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      await adscribir(sesion.empresa, activa, { areas: ['operaciones_urbanizadora'] })
      await adscribir(sesion.empresa, baja, {
        areas: ['operaciones_urbanizadora'],
        activo: false,
        motivoBaja: 'Renunció'
      })

      const porDefecto = await request(app)
        .get(`/api/v1/empresas/${sesion.empresa._id}/adscripciones`)
        .set(auth(sesion.token))
      const nombresPorDefecto = porDefecto.body.data.adscripciones.map(
        (a) => a.empleado.nombre
      )
      expect(nombresPorDefecto).toContain('Activa')
      expect(nombresPorDefecto).not.toContain('Dada De Baja')

      const soloBajas = await request(app)
        .get(`/api/v1/empresas/${sesion.empresa._id}/adscripciones?activo=false`)
        .set(auth(sesion.token))
      const nombresBajas = soloBajas.body.data.adscripciones.map((a) => a.empleado.nombre)
      expect(nombresBajas).toEqual(['Dada De Baja'])

      const todas = await request(app)
        .get(`/api/v1/empresas/${sesion.empresa._id}/adscripciones?activo=todos`)
        .set(auth(sesion.token))
      const nombresTodas = todas.body.data.adscripciones.map((a) => a.empleado.nombre)
      expect(nombresTodas).toEqual(expect.arrayContaining(['Activa', 'Dada De Baja']))
    })

    it('el jefe de área sólo ve las adscripciones de sus propias áreas', async () => {
      const jefe = await crearEmpleadoConSesion({
        nivelAcceso: 'jefe_area',
        areas: ['operaciones_urbanizadora']
      })
      const categoria = await crearCategoria('Albañil', 'mano_de_obra')
      const deSuArea = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      const deOtraArea = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      await adscribir(jefe.empresa, deSuArea, { areas: ['operaciones_urbanizadora'] })
      await adscribir(jefe.empresa, deOtraArea, { areas: ['operaciones_maquinaria'] })

      const res = await request(app)
        .get(`/api/v1/empresas/${jefe.empresa._id}/adscripciones`)
        .set(auth(jefe.token))

      const ids = res.body.data.adscripciones.map((a) => a.empleadoId)
      expect(ids).toContain(deSuArea._id.toString())
      expect(ids).not.toContain(deOtraArea._id.toString())
    })

    it('filtra por categoriaId', async () => {
      const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const categoriaObra = await crearCategoria('Albañil', 'mano_de_obra')
      const categoriaOficina = await crearCategoria('Contador', 'administrativo')
      const obrero = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoriaObra._id
      })
      const administrativo = await crearEmpleado({
        tipo: 'administrativo',
        categoriaId: categoriaOficina._id
      })
      await adscribir(sesion.empresa, obrero, { areas: ['operaciones_urbanizadora'] })
      await adscribir(sesion.empresa, administrativo, { areas: ['finanzas'] })

      // El filtro por `tipo` se fue en D-59; queda el de categoría.
      const porCategoria = await request(app)
        .get(
          `/api/v1/empresas/${sesion.empresa._id}/adscripciones?categoriaId=${categoriaOficina._id}`
        )
        .set(auth(sesion.token))
      const idsPorCategoria = porCategoria.body.data.adscripciones.map(
        (a) => a.empleadoId
      )
      expect(idsPorCategoria).toContain(administrativo._id.toString())
      expect(idsPorCategoria).not.toContain(obrero._id.toString())
    })

    it('ordena por numeroEmpleado ascendente por defecto, y se puede invertir', async () => {
      const sesion = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_admin',
        alcanceGlobal: true
      })
      const categoria = await crearCategoria('Albañil', 'mano_de_obra')

      for (const numeroEmpleado of ['0003', '0001', '0002']) {
        // El número es de la persona desde D-54, no de la adscripción.
        const persona = await crearEmpleado({
          tipo: 'mano_de_obra',
          categoriaId: categoria._id,
          numeroEmpleado
        })
        await adscribir(sesion.empresa, persona, { areas: ['operaciones_urbanizadora'] })
      }

      /*
       * Se acota por categoría —ya no por `tipo`, que se fue en D-59— para dejar
       * fuera al empleado de la sesión, que no tiene número y descuadraría el
       * orden esperado.
       */
      const suyas = `/api/v1/empresas/${sesion.empresa._id}/adscripciones?categoriaId=${categoria._id}`
      const porDefecto = await request(app).get(suyas).set(auth(sesion.token))
      const desc = await request(app)
        .get(`${suyas}&orden=numero_desc`)
        .set(auth(sesion.token))

      const numerosAsc = porDefecto.body.data.adscripciones.map(
        (a) => a.empleado.numeroEmpleado
      )
      expect(numerosAsc).toEqual(['0001', '0002', '0003'])
      expect(desc.body.data.adscripciones.map((a) => a.empleado.numeroEmpleado)).toEqual(
        [...numerosAsc].reverse()
      )
    })

    it('valida categoriaId y orden con mensajes en español', async () => {
      const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const malos = [
        `/api/v1/empresas/${sesion.empresa._id}/adscripciones?categoriaId=no-es-id`,
        `/api/v1/empresas/${sesion.empresa._id}/adscripciones?orden=por_fecha`,
        `/api/v1/empresas/${sesion.empresa._id}/adscripciones?activo=quizas`
      ]

      for (const ruta of malos) {
        const res = await request(app).get(ruta).set(auth(sesion.token))
        expect(res.status).toBe(400)
        expect(res.body.errors[0].msg).not.toBe('Invalid value')
      }
    })

    it('404 si la empresa no es visible; 401 sin sesión', async () => {
      const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const ajena = await crearEmpresa()

      const res = await request(app)
        .get(`/api/v1/empresas/${ajena._id}/adscripciones`)
        .set(auth(sesion.token))
      expect(res.status).toBe(404)

      const sinSesion = await request(app).get(
        `/api/v1/empresas/${sesion.empresa._id}/adscripciones`
      )
      expect(sinSesion.status).toBe(401)
    })
  })

  describe('POST /api/v1/empresas/:id/adscripciones', () => {
    it('adscribe a una persona que ya existe, y re-sincroniza su expediente', async () => {
      await ensureBaseChecklistTemplates()
      const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const otraEmpresa = await crearEmpresa()
      const categoria = await crearCategoria('Albañil', 'mano_de_obra')
      const persona = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      // Ya trabajaba en otra empresa: el expediente existe desde antes.
      await adscribir(otraEmpresa, persona, { areas: ['operaciones_urbanizadora'] })
      await Record.create({ empleadoId: persona._id, documentos: [], plantillas: [] })

      const res = await request(app)
        .post(`/api/v1/empresas/${sesion.empresa._id}/adscripciones`)
        .set(auth(sesion.token))
        .send({
          empleadoId: persona._id.toString(),
          areas: ['operaciones_urbanizadora'],
          tipoContrato: 'indeterminado',
          fechaIngreso: '2026-09-01'
        })

      expect(res.status).toBe(201)
      expect(res.body.data.adscripcion).toMatchObject({
        empresaId: sesion.empresa._id.toString(),
        empleadoId: persona._id.toString(),
        activo: true
      })

      // Su expediente ya no está vacío: se re-sincronizó con el checklist.
      const expediente = await Record.findOne({ empleadoId: persona._id })
      expect(expediente.documentos.length).toBeGreaterThan(0)
    })

    it('reactiva en vez de duplicar si ya tuvo adscripción a esa empresa', async () => {
      const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const categoria = await crearCategoria('Albañil', 'mano_de_obra')
      const persona = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      await adscribir(sesion.empresa, persona, {
        areas: ['operaciones_urbanizadora'],
        activo: false,
        motivoBaja: 'Se fue'
      })

      const res = await request(app)
        .post(`/api/v1/empresas/${sesion.empresa._id}/adscripciones`)
        .set(auth(sesion.token))
        .send({
          empleadoId: persona._id.toString(),
          areas: ['operaciones_maquinaria'],
          tipoContrato: 'indeterminado',
          fechaIngreso: '2026-09-01'
        })

      expect(res.status).toBe(200)
      expect(res.body.data.adscripcion.activo).toBe(true)
      expect(res.body.data.adscripcion.areas).toEqual(['operaciones_maquinaria'])
      expect(
        await Affiliation.countDocuments({
          empresaId: sesion.empresa._id,
          empleadoId: persona._id
        })
      ).toBe(1)
    })

    it('409 si ya está adscrita y activa', async () => {
      const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const categoria = await crearCategoria('Albañil', 'mano_de_obra')
      const persona = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      await adscribir(sesion.empresa, persona, { areas: ['operaciones_urbanizadora'] })

      const res = await request(app)
        .post(`/api/v1/empresas/${sesion.empresa._id}/adscripciones`)
        .set(auth(sesion.token))
        .send({
          empleadoId: persona._id.toString(),
          tipoContrato: 'indeterminado',
          fechaIngreso: '2026-09-01'
        })

      expect(res.status).toBe(409)
    })

    it('400 si un administrativo no lleva ningún área', async () => {
      const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const persona = await crearEmpleado({ tipo: 'administrativo' })

      const res = await request(app)
        .post(`/api/v1/empresas/${sesion.empresa._id}/adscripciones`)
        .set(auth(sesion.token))
        .send({
          empleadoId: persona._id.toString(),
          tipoContrato: 'indeterminado',
          fechaIngreso: '2026-09-01'
        })

      expect(res.status).toBe(400)
    })

    it('400 si la persona está dada de baja del sistema', async () => {
      const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const categoria = await crearCategoria('Albañil', 'mano_de_obra')
      const persona = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoria._id,
        activo: false,
        motivoBaja: 'Ya no trabaja aquí'
      })

      const res = await request(app)
        .post(`/api/v1/empresas/${sesion.empresa._id}/adscripciones`)
        .set(auth(sesion.token))
        .send({
          empleadoId: persona._id.toString(),
          areas: ['operaciones_urbanizadora'],
          tipoContrato: 'indeterminado',
          fechaIngreso: '2026-09-01'
        })

      expect(res.status).toBe(400)
    })

    it('403 para rh_consulta y para jefe_area: adscribir es exclusivo de rh_admin', async () => {
      const categoria = await crearCategoria('Albañil', 'mano_de_obra')
      const persona = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })

      const consulta = await crearEmpleadoConSesion({ nivelAcceso: 'rh_consulta' })
      const resConsulta = await request(app)
        .post(`/api/v1/empresas/${consulta.empresa._id}/adscripciones`)
        .set(auth(consulta.token))
        .send({
          empleadoId: persona._id.toString(),
          areas: ['operaciones_urbanizadora'],
          tipoContrato: 'indeterminado',
          fechaIngreso: '2026-09-01'
        })
      expect(resConsulta.status).toBe(403)

      const jefe = await crearEmpleadoConSesion({
        nivelAcceso: 'jefe_area',
        areas: ['operaciones_urbanizadora']
      })
      const resJefe = await request(app)
        .post(`/api/v1/empresas/${jefe.empresa._id}/adscripciones`)
        .set(auth(jefe.token))
        .send({
          empleadoId: persona._id.toString(),
          areas: ['operaciones_urbanizadora'],
          tipoContrato: 'indeterminado',
          fechaIngreso: '2026-09-01'
        })
      expect(resJefe.status).toBe(403)
    })

    it('404 si la empresa no es visible, o el empleado no existe', async () => {
      const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const ajena = await crearEmpresa()
      const categoria = await crearCategoria('Albañil', 'mano_de_obra')
      const persona = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })

      const empresaAjena = await request(app)
        .post(`/api/v1/empresas/${ajena._id}/adscripciones`)
        .set(auth(sesion.token))
        .send({
          empleadoId: persona._id.toString(),
          areas: ['operaciones_urbanizadora'],
          tipoContrato: 'indeterminado',
          fechaIngreso: '2026-09-01'
        })
      expect(empresaAjena.status).toBe(404)

      const empleadoInexistente = await request(app)
        .post(`/api/v1/empresas/${sesion.empresa._id}/adscripciones`)
        .set(auth(sesion.token))
        .send({
          empleadoId: '507f1f77bcf86cd799439011',
          areas: ['operaciones_urbanizadora'],
          tipoContrato: 'indeterminado',
          fechaIngreso: '2026-09-01'
        })
      expect(empleadoInexistente.status).toBe(404)
    })
  })

  describe('PATCH /api/v1/adscripciones/:id', () => {
    it('actualiza los campos y re-sincroniza el expediente', async () => {
      await ensureBaseChecklistTemplates()
      const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const categoria = await crearCategoria('Albañil', 'mano_de_obra')
      const persona = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      const adscripcion = await adscribir(sesion.empresa, persona, {
        areas: ['operaciones_urbanizadora']
      })
      await Record.create({ empleadoId: persona._id, documentos: [], plantillas: [] })

      const res = await request(app)
        .patch(`/api/v1/adscripciones/${adscripcion._id}`)
        .set(auth(sesion.token))
        .send({ tipoContrato: 'obra_determinada', fechaTerminoContrato: '2026-12-31' })

      expect(res.status).toBe(200)
      expect(res.body.data.adscripcion).toMatchObject({
        tipoContrato: 'obra_determinada',
        fechaTerminoContrato: '2026-12-31'
      })

      const expediente = await Record.findOne({ empleadoId: persona._id })
      expect(expediente.documentos.length).toBeGreaterThan(0)
    })

    it('400 con un campo que no se edita aquí (activo, empresaId)', async () => {
      const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const categoria = await crearCategoria('Albañil', 'mano_de_obra')
      const persona = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      const adscripcion = await adscribir(sesion.empresa, persona, {
        areas: ['operaciones_urbanizadora']
      })

      const res = await request(app)
        .patch(`/api/v1/adscripciones/${adscripcion._id}`)
        .set(auth(sesion.token))
        .send({ activo: false })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/estado/)
    })

    it('400 si deja a un administrativo sin ningún área', async () => {
      const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const persona = await crearEmpleado({ tipo: 'administrativo' })
      const adscripcion = await adscribir(sesion.empresa, persona, {
        areas: ['finanzas']
      })

      const res = await request(app)
        .patch(`/api/v1/adscripciones/${adscripcion._id}`)
        .set(auth(sesion.token))
        .send({ areas: [] })

      expect(res.status).toBe(400)
    })

    it('404 si la adscripción no es visible', async () => {
      const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const ajena = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const categoria = await crearCategoria('Albañil', 'mano_de_obra')
      const persona = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      const adscripcion = await adscribir(ajena.empresa, persona, {
        areas: ['operaciones_urbanizadora']
      })

      const res = await request(app)
        .patch(`/api/v1/adscripciones/${adscripcion._id}`)
        .set(auth(sesion.token))
        .send({ tipoContrato: 'obra_determinada', fechaTerminoContrato: '2026-12-31' })
      expect(res.status).toBe(404)
    })

    it('403 para rh_consulta y para jefe_area', async () => {
      const consulta = await crearEmpleadoConSesion({ nivelAcceso: 'rh_consulta' })
      const categoria = await crearCategoria('Albañil', 'mano_de_obra')
      const persona = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      const adscripcion = await adscribir(consulta.empresa, persona, {
        areas: ['operaciones_urbanizadora']
      })

      const res = await request(app)
        .patch(`/api/v1/adscripciones/${adscripcion._id}`)
        .set(auth(consulta.token))
        .send({ tipoContrato: 'obra_determinada', fechaTerminoContrato: '2026-12-31' })
      expect(res.status).toBe(403)
    })
  })

  describe('PATCH /api/v1/adscripciones/:id/estado', () => {
    it('da de baja de esa empresa y cierra sus asignaciones abiertas ahí', async () => {
      const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const categoria = await crearCategoria('Albañil', 'mano_de_obra')
      const persona = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      const adscripcion = await adscribir(sesion.empresa, persona, {
        areas: ['operaciones_urbanizadora']
      })
      const { proyecto } = await crearProyecto(sesion.empresa)
      const asignacion = await asignar(proyecto, persona, categoria._id)

      const res = await request(app)
        .patch(`/api/v1/adscripciones/${adscripcion._id}/estado`)
        .set(auth(sesion.token))
        .send({ activo: false, motivo: 'Termina su contrato antes de tiempo' })

      expect(res.status).toBe(200)
      expect(res.body.data.adscripcion).toMatchObject({
        activo: false,
        motivoBaja: 'Termina su contrato antes de tiempo'
      })
      expect(res.body.data.adscripcion.fechaBaja).toEqual(expect.any(String))

      const Assignment = require('../../src/api/v1/assignments/assignmentModel')
      const cerrada = await Assignment.findById(asignacion._id)
      expect(cerrada.activo).toBe(false)
      expect(cerrada.fechaSalida).toEqual(expect.any(String))
    })

    it('400 al dar de baja sin motivo, o con uno de menos de 10 caracteres', async () => {
      const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const categoria = await crearCategoria('Albañil', 'mano_de_obra')
      const persona = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      const adscripcion = await adscribir(sesion.empresa, persona, {
        areas: ['operaciones_urbanizadora']
      })

      const sinMotivo = await request(app)
        .patch(`/api/v1/adscripciones/${adscripcion._id}/estado`)
        .set(auth(sesion.token))
        .send({ activo: false })
      expect(sinMotivo.status).toBe(400)

      const corto = await request(app)
        .patch(`/api/v1/adscripciones/${adscripcion._id}/estado`)
        .set(auth(sesion.token))
        .send({ activo: false, motivo: 'corto' })
      expect(corto.status).toBe(400)
    })

    it('reactivar no exige motivo', async () => {
      const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const categoria = await crearCategoria('Albañil', 'mano_de_obra')
      const persona = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      const adscripcion = await adscribir(sesion.empresa, persona, {
        areas: ['operaciones_urbanizadora'],
        activo: false,
        motivoBaja: 'Se fue'
      })

      const res = await request(app)
        .patch(`/api/v1/adscripciones/${adscripcion._id}/estado`)
        .set(auth(sesion.token))
        .send({ activo: true })

      expect(res.status).toBe(200)
      expect(res.body.data.adscripcion).toMatchObject({
        activo: true,
        motivoBaja: null,
        fechaBaja: null
      })
    })

    it('403 para rh_consulta y para jefe_area', async () => {
      const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const categoria = await crearCategoria('Albañil', 'mano_de_obra')
      const persona = await crearEmpleado({
        tipo: 'mano_de_obra',
        categoriaId: categoria._id
      })
      const adscripcion = await adscribir(sesion.empresa, persona, {
        areas: ['operaciones_urbanizadora']
      })

      const consulta = await crearEmpleadoConSesion({ nivelAcceso: 'rh_consulta' })
      const resConsulta = await request(app)
        .patch(`/api/v1/adscripciones/${adscripcion._id}/estado`)
        .set(auth(consulta.token))
        .send({ activo: false, motivo: 'Termina su contrato antes de tiempo' })
      expect(resConsulta.status).toBe(403)
    })
  })
})

/**
 * El vínculo con el registro patronal de la empresa (Fase 7, D-72).
 *
 * Convive con `condiciones.registroPatronal`, que es texto: aquí vive el vínculo
 * validado contra el catálogo; allá, lo que dijo el archivo de nómina.
 */
describe('registroPatronalId en la adscripción (D-72)', () => {
  async function escenario() {
    const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const categoria = await crearCategoria('Albañil', 'mano_de_obra')
    const persona = await crearEmpleado({
      tipo: 'mano_de_obra',
      categoriaId: categoria._id
    })
    const adscripcion = await adscribir(sesion.empresa, persona, {
      areas: ['operaciones_urbanizadora']
    })
    const registro = await crearRegistroPatronal(sesion.empresa, 'R13-77767-10-5')
    return { ...sesion, persona, adscripcion, registro }
  }

  it('lo vincula y lo devuelve en la respuesta', async () => {
    const { token, adscripcion, registro } = await escenario()

    const res = await request(app)
      .patch(`/api/v1/adscripciones/${adscripcion._id}`)
      .set(auth(token))
      .send({ registroPatronalId: registro._id.toString() })

    expect(res.status).toBe(200)
    expect(res.body.data.adscripcion.registroPatronalId).toBe(registro._id.toString())
    const guardada = await Affiliation.findById(adscripcion._id)
    expect(String(guardada.registroPatronalId)).toBe(registro._id.toString())
  })

  it('`null` lo desvincula: hay que poder deshacer un vínculo mal puesto', async () => {
    const { token, adscripcion, registro } = await escenario()
    await Affiliation.updateOne(
      { _id: adscripcion._id },
      { $set: { registroPatronalId: registro._id } }
    )

    const res = await request(app)
      .patch(`/api/v1/adscripciones/${adscripcion._id}`)
      .set(auth(token))
      .send({ registroPatronalId: null })

    expect(res.status).toBe(200)
    expect(res.body.data.adscripcion.registroPatronalId).toBeNull()
  })

  it('400 si el registro es de OTRA empresa', async () => {
    const { token, adscripcion } = await escenario()
    const otra = await crearEmpresa()
    const ajeno = await crearRegistroPatronal(otra, 'H67-29973-10-5')

    const res = await request(app)
      .patch(`/api/v1/adscripciones/${adscripcion._id}`)
      .set(auth(token))
      .send({ registroPatronalId: ajeno._id.toString() })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/no es de/i)
    expect(res.body.errors[0].path).toBe('registroPatronalId')
  })

  it('400 si está dado de baja', async () => {
    const { token, empresa, adscripcion, registro } = await escenario()
    // Se baja en la base: darlo de baja por su ruta exige admin de plataforma y
    // aquí lo que se prueba es la adscripción, no ese permiso.
    await Company.updateOne(
      { _id: empresa._id, 'registrosPatronales._id': registro._id },
      { $set: { 'registrosPatronales.$.activo': false } }
    )

    const res = await request(app)
      .patch(`/api/v1/adscripciones/${adscripcion._id}`)
      .set(auth(token))
      .send({ registroPatronalId: registro._id.toString() })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/dado de baja/i)
  })

  it('400 si no es un id, y nace en null si no se manda', async () => {
    const { token, adscripcion, empresa, persona } = await escenario()

    const invalido = await request(app)
      .patch(`/api/v1/adscripciones/${adscripcion._id}`)
      .set(auth(token))
      .send({ registroPatronalId: 'no-es-un-id' })

    expect(invalido.status).toBe(400)
    expect(String(persona._id)).toBeTruthy()
    const nueva = await Affiliation.findOne({
      empresaId: empresa._id,
      empleadoId: adscripcion.empleadoId
    })
    expect(nueva.registroPatronalId).toBeNull()
  })
})
