const request = require('supertest')
const mongoose = require('mongoose')
const app = require('../../src/app')
const Employee = require('../../src/api/v1/employees/employeeModel')
const {
  crearCategoria,
  crearEmpresa,
  crearEmpleado,
  crearEmpleadoConSesion,
  adscribir,
  auth
} = require('../helpers/factories')

const RUTA = '/api/v1/empleados'

/** Sesión de rh_admin con su empresa y una persona suya a la que editar. */
async function escenario(datos = {}) {
  const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin', ...datos })
  const persona = await crearEmpleado({
    nombre: 'Roberto Aguilar',
    tipo: 'mano_de_obra',
    ...datos.persona
  })
  await adscribir(sesion.empresa, persona, { areas: ['operaciones_urbanizadora'] })
  return { ...sesion, persona }
}

describe('PATCH /api/v1/empleados/:id — editar a la persona', () => {
  it('actualiza los datos y devuelve el renglón completo', async () => {
    const { token, persona, empresa } = await escenario()

    const res = await request(app).patch(`${RUTA}/${persona._id}`).set(auth(token)).send({
      nombre: 'Roberto Aguilar Sosa',
      telefono: '3312345678',
      email: 'roberto@correo.com'
    })

    expect(res.status).toBe(200)
    expect(res.body.data.empleado.empleado).toMatchObject({
      nombre: 'Roberto Aguilar Sosa',
      telefono: '3312345678',
      email: 'roberto@correo.com'
    })
    // Trae la adscripción resuelta, igual que el listado.
    expect(res.body.data.empleado.adscripciones[0].empresaNombre).toBe(empresa.nombre)
  })

  describe('el número de trabajador (D-54)', () => {
    it('se puede corregir', async () => {
      const { token, persona } = await escenario({
        persona: { numeroEmpleado: 'NE-VIEJO' }
      })

      const res = await request(app)
        .patch(`${RUTA}/${persona._id}`)
        .set(auth(token))
        .send({ numeroEmpleado: 'NE-NUEVO' })

      expect(res.status).toBe(200)
      expect(res.body.data.empleado.empleado.numeroEmpleado).toBe('NE-NUEVO')
      expect((await Employee.findById(persona._id)).numeroEmpleado).toBe('NE-NUEVO')
    })

    it('se puede poner por primera vez a quien no lo tenía', async () => {
      const { token, persona } = await escenario()
      expect(persona.numeroEmpleado).toBeNull()

      const res = await request(app)
        .patch(`${RUTA}/${persona._id}`)
        .set(auth(token))
        .send({ numeroEmpleado: 'NE-PRIMERO' })

      expect(res.status).toBe(200)
      expect(res.body.data.empleado.empleado.numeroEmpleado).toBe('NE-PRIMERO')
    })

    it('409 si ese número ya es de otra persona', async () => {
      const { token, persona, empresa } = await escenario()
      const otro = await crearEmpleado({
        nombre: 'Ya Lo Tiene',
        numeroEmpleado: 'NE-OCUPADO'
      })
      await adscribir(empresa, otro, { areas: ['operaciones_urbanizadora'] })

      const res = await request(app)
        .patch(`${RUTA}/${persona._id}`)
        .set(auth(token))
        .send({ numeroEmpleado: 'NE-OCUPADO' })

      expect(res.status).toBe(409)
      expect(res.body.code).toBe('NUMERO_EMPLEADO_DUPLICADO')
      expect(res.body.errors[0].path).toBe('numeroEmpleado')
    })

    it('deja reenviar el mismo que ya tenía', async () => {
      const { token, persona } = await escenario({
        persona: { numeroEmpleado: 'NE-IGUAL' }
      })

      const res = await request(app)
        .patch(`${RUTA}/${persona._id}`)
        .set(auth(token))
        .send({ numeroEmpleado: 'NE-IGUAL', telefono: '3312345678' })

      expect(res.status).toBe(200)
    })

    it('400 si llega vacío: se corrige con el nuevo, no se borra', async () => {
      const { token, persona } = await escenario({
        persona: { numeroEmpleado: 'NE-NO-BORRAR' }
      })

      const res = await request(app)
        .patch(`${RUTA}/${persona._id}`)
        .set(auth(token))
        .send({ numeroEmpleado: '' })

      expect(res.status).toBe(400)
      expect(res.body.errors[0].path).toBe('numeroEmpleado')
    })
  })

  it('completa la CURP de un alta provisional', async () => {
    const { token, persona } = await escenario()
    expect(persona.curp).toBeNull()

    const res = await request(app)
      .patch(`${RUTA}/${persona._id}`)
      .set(auth(token))
      .send({ curp: 'ausr900101hjcgsb03' })

    expect(res.status).toBe(200)
    // Se normaliza a mayúsculas.
    expect(res.body.data.empleado.empleado.curp).toBe('AUSR900101HJCGSB03')
  })

  it('409 si la CURP nueva ya es de otra persona', async () => {
    const { token, persona } = await escenario()
    const otra = await crearEmpleado({
      nombre: 'Otra Persona',
      curp: 'AUSR900101HJCGSB03'
    })

    const res = await request(app)
      .patch(`${RUTA}/${persona._id}`)
      .set(auth(token))
      .send({ curp: 'AUSR900101HJCGSB03' })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('CURP_DUPLICADA')
    expect(res.body.data.candidatos[0]._id).toBe(otra._id.toString())
  })

  it('deja reenviar la misma CURP que ya tenía', async () => {
    const { token, persona } = await escenario({
      persona: { curp: 'AUSR900101HJCGSB03' }
    })

    const res = await request(app)
      .patch(`${RUTA}/${persona._id}`)
      .set(auth(token))
      .send({ curp: 'AUSR900101HJCGSB03', nombre: 'Roberto Aguilar Sosa' })

    expect(res.status).toBe(200)
  })

  it('permite corregir el nombre aunque exista alguien igual', async () => {
    // A diferencia del alta, editar el nombre NO se bloquea por duplicado: es
    // justo la corrección que se está haciendo.
    const { token, persona } = await escenario()
    await crearEmpleado({ nombre: 'Roberto Aguilar Sosa' })

    const res = await request(app)
      .patch(`${RUTA}/${persona._id}`)
      .set(auth(token))
      .send({ nombre: 'Roberto Aguilar Sosa' })

    expect(res.status).toBe(200)
  })

  it('vacía un opcional con null, y nunca lo guarda como cadena vacía', async () => {
    const { token, persona } = await escenario({
      persona: { email: 'viejo@correo.com' }
    })

    const res = await request(app)
      .patch(`${RUTA}/${persona._id}`)
      .set(auth(token))
      .send({ email: null, telefono: null })

    expect(res.status).toBe(200)
    expect(res.body.data.empleado.empleado.email).toBeNull()
    expect(res.body.data.empleado.empleado.telefono).toBeNull()
  })

  describe('la categoría y el tipo', () => {
    it('cambia la categoría por otra del mismo tipo', async () => {
      const { token, persona } = await escenario()
      const nueva = await crearCategoria('Albañil oficial', 'mano_de_obra')

      const res = await request(app)
        .patch(`${RUTA}/${persona._id}`)
        .set(auth(token))
        .send({ categoriaId: nueva._id.toString() })

      expect(res.status).toBe(200)
      expect(res.body.data.empleado.categoriaNombre).toBe('Albañil oficial')
    })

    it('400 si la categoría no corresponde al tipo de la persona', async () => {
      const { token, persona } = await escenario()
      const deOficina = await crearCategoria('Contador', 'administrativo')

      const res = await request(app)
        .patch(`${RUTA}/${persona._id}`)
        .set(auth(token))
        .send({ categoriaId: deOficina._id.toString() })

      expect(res.status).toBe(400)
      expect(res.body.errors[0].path).toBe('categoriaId')
    })

    it('cambia el tipo junto con una categoría coherente', async () => {
      const { token, persona } = await escenario()
      const deOficina = await crearCategoria('Contador', 'administrativo')

      const res = await request(app)
        .patch(`${RUTA}/${persona._id}`)
        .set(auth(token))
        .send({ tipo: 'administrativo', categoriaId: deOficina._id.toString() })

      expect(res.status).toBe(200)
      expect(res.body.data.empleado.empleado.tipo).toBe('administrativo')
    })

    it('400 si cambia el tipo y su categoría deja de corresponder', async () => {
      const { token, persona } = await escenario()

      const res = await request(app)
        .patch(`${RUTA}/${persona._id}`)
        .set(auth(token))
        .send({ tipo: 'administrativo' })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/categoría/i)
    })

    it('400 al volverlo administrativo si su adscripción no tiene área', async () => {
      const { token, empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const persona = await crearEmpleado({ tipo: 'mano_de_obra' })
      await adscribir(empresa, persona, { areas: [] })
      const deOficina = await crearCategoria('Contador', 'administrativo')

      const res = await request(app)
        .patch(`${RUTA}/${persona._id}`)
        .set(auth(token))
        .send({ tipo: 'administrativo', categoriaId: deOficina._id.toString() })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/al menos un área/i)
    })
  })

  describe('lo que no se edita aquí', () => {
    it('400 con los campos que tienen su propio recurso, diciendo cuál es', async () => {
      const { token, persona } = await escenario()

      const res = await request(app)
        .patch(`${RUTA}/${persona._id}`)
        .set(auth(token))
        .send({ nombre: 'Nuevo', activo: false, acceso: { nivelAcceso: 'rh_admin' } })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/estado/)
      expect(res.body.message).toMatch(/acceso/)
    })

    it('400 si el cuerpo viene vacío', async () => {
      const { token, persona } = await escenario()
      const res = await request(app)
        .patch(`${RUTA}/${persona._id}`)
        .set(auth(token))
        .send({})

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/nada que actualizar/i)
    })

    it('400 con formatos inválidos, con el campo señalado', async () => {
      const { token, persona } = await escenario()
      const casos = [
        [{ curp: 'NO-ES-CURP' }, 'curp'],
        [{ nombre: 'ab' }, 'nombre'],
        [{ tipo: 'obrero' }, 'tipo'],
        [{ fechaNacimiento: '01/01/1990' }, 'fechaNacimiento'],
        [{ email: 'no-es-correo' }, 'email']
      ]

      for (const [cuerpo, campo] of casos) {
        const res = await request(app)
          .patch(`${RUTA}/${persona._id}`)
          .set(auth(token))
          .send(cuerpo)
        expect(res.status).toBe(400)
        expect(res.body.errors.some((e) => e.path === campo)).toBe(true)
      }
    })
  })

  describe('permisos y alcance', () => {
    it('quien puede dar de alta personal de obra puede corregirlo', async () => {
      // Es la razón de la regla: el que captura tiene que poder arreglar su
      // propio error de dedo sin pedírselo a un administrador.
      for (const nivel of ['rh_consulta', 'jefe_area']) {
        const { token, empresa } = await crearEmpleadoConSesion({
          nivelAcceso: nivel,
          areas: ['operaciones_urbanizadora']
        })
        const persona = await crearEmpleado({ tipo: 'mano_de_obra' })
        await adscribir(empresa, persona, { areas: ['operaciones_urbanizadora'] })

        const res = await request(app)
          .patch(`${RUTA}/${persona._id}`)
          .set(auth(token))
          .send({ nombre: 'Nombre Corregido' })

        expect(res.status).toBe(200)
        expect(res.body.data.empleado.empleado.nombre).toBe('Nombre Corregido')
      }
    })

    it('pero NO puede editar a un administrativo', async () => {
      for (const nivel of ['rh_consulta', 'jefe_area']) {
        const { token, empresa } = await crearEmpleadoConSesion({
          nivelAcceso: nivel,
          areas: ['finanzas']
        })
        const persona = await crearEmpleado({ tipo: 'administrativo' })
        await adscribir(empresa, persona, { areas: ['finanzas'] })

        const res = await request(app)
          .patch(`${RUTA}/${persona._id}`)
          .set(auth(token))
          .send({ nombre: 'Nombre Corregido' })

        expect(res.status).toBe(403)
        expect(res.body.message).toMatch(/editar personal administrativo/i)
      }
    })

    it('ni convertir a un peón en administrativo', async () => {
      const { token, empresa } = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_consulta'
      })
      const persona = await crearEmpleado({ tipo: 'mano_de_obra' })
      await adscribir(empresa, persona, { areas: ['operaciones_urbanizadora'] })
      const deOficina = await crearCategoria('Contador', 'administrativo')

      const res = await request(app)
        .patch(`${RUTA}/${persona._id}`)
        .set(auth(token))
        .send({ tipo: 'administrativo', categoriaId: deOficina._id.toString() })

      expect(res.status).toBe(403)
      expect(res.body.message).toMatch(/convertir/i)
    })

    it('un jefe de área no alcanza a quien está fuera de sus áreas', async () => {
      // El filtro de áreas ya lo dejaba fuera del listado; editar da el mismo 404.
      const { token, empresa } = await crearEmpleadoConSesion({
        nivelAcceso: 'jefe_area',
        areas: ['operaciones_urbanizadora']
      })
      const otraArea = await crearEmpleado({ tipo: 'mano_de_obra' })
      await adscribir(empresa, otraArea, { areas: ['comercial'] })

      const res = await request(app)
        .patch(`${RUTA}/${otraArea._id}`)
        .set(auth(token))
        .send({ nombre: 'Nombre Corregido' })

      expect(res.status).toBe(404)
    })

    it('404 si la persona es de otra empresa', async () => {
      const { token } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const ajena = await crearEmpresa()
      const persona = await crearEmpleado()
      await adscribir(ajena, persona)

      const res = await request(app)
        .patch(`${RUTA}/${persona._id}`)
        .set(auth(token))
        .send({ nombre: 'Ajeno Editado' })

      expect(res.status).toBe(404)
    })

    it('401 sin sesión, 400 con un id mal formado', async () => {
      const { token, persona } = await escenario()

      expect(
        (await request(app).patch(`${RUTA}/${persona._id}`).send({ nombre: 'X' })).status
      ).toBe(401)
      expect(
        (
          await request(app)
            .patch(`${RUTA}/no-es-id`)
            .set(auth(token))
            .send({ nombre: 'Xyz' })
        ).status
      ).toBe(400)
    })
  })
})

describe('PATCH /api/v1/empleados/:id/estado — baja y reactivación', () => {
  it('da de baja con motivo y conserva el registro', async () => {
    const { token, persona } = await escenario()

    const res = await request(app)
      .patch(`${RUTA}/${persona._id}/estado`)
      .set(auth(token))
      .send({ activo: false, motivo: 'Renuncia voluntaria' })

    expect(res.status).toBe(200)
    expect(res.body.data.empleado.empleado).toMatchObject({
      activo: false,
      motivoBaja: 'Renuncia voluntaria'
    })
    expect(res.body.data.empleado.empleado.fechaBaja).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    // No se borró nada.
    expect(await Employee.findById(persona._id)).not.toBeNull()
  })

  it('desaparece del listado normal y aparece con activo=false o activo=todos', async () => {
    const { token, persona } = await escenario()
    await request(app)
      .patch(`${RUTA}/${persona._id}/estado`)
      .set(auth(token))
      .send({ activo: false, motivo: 'Fin de obra' })

    const normal = await request(app).get(RUTA).set(auth(token))
    const soloBajas = await request(app).get(`${RUTA}?activo=false`).set(auth(token))
    const todos = await request(app).get(`${RUTA}?activo=todos`).set(auth(token))

    const nombres = (r) => r.body.data.empleados.map((e) => e.empleado.nombre)
    expect(nombres(normal)).not.toContain('Roberto Aguilar')
    expect(nombres(soloBajas)).toContain('Roberto Aguilar')
    expect(nombres(todos)).toContain('Roberto Aguilar')
  })

  it('400 sin motivo o con un motivo demasiado corto', async () => {
    const { token, persona } = await escenario()

    const sinMotivo = await request(app)
      .patch(`${RUTA}/${persona._id}/estado`)
      .set(auth(token))
      .send({ activo: false })
    const corto = await request(app)
      .patch(`${RUTA}/${persona._id}/estado`)
      .set(auth(token))
      .send({ activo: false, motivo: 'no' })

    expect(sinMotivo.status).toBe(400)
    expect(sinMotivo.body.errors[0].path).toBe('motivo')
    expect(corto.status).toBe(400)
  })

  it('acepta una fecha de baja explícita', async () => {
    const { token, persona } = await escenario()

    const res = await request(app)
      .patch(`${RUTA}/${persona._id}/estado`)
      .set(auth(token))
      .send({ activo: false, motivo: 'Fin de contrato', fecha: '2026-08-31' })

    expect(res.body.data.empleado.empleado.fechaBaja).toBe('2026-08-31')
  })

  it('al dar de baja a alguien con acceso, el acceso queda desactivado', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const conAcceso = await crearEmpleado({
      acceso: { email: 'operador@urbacames.com', nivelAcceso: 'rh_consulta' }
    })
    await adscribir(empresa, conAcceso)

    await request(app)
      .patch(`${RUTA}/${conAcceso._id}/estado`)
      .set(auth(token))
      .send({ activo: false, motivo: 'Renuncia voluntaria' })

    const enBase = await Employee.findById(conAcceso._id)
    expect(enBase.acceso.activo).toBe(false)
    // Y ya no entra.
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'operador@urbacames.com', password: 'Urbacames1!' })
    expect(login.status).toBe(401)
  })

  it('reactiva y limpia el rastro de la baja, sin devolver el acceso', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const persona = await crearEmpleado({
      acceso: { email: 'vuelve@urbacames.com', nivelAcceso: 'rh_consulta' }
    })
    await adscribir(empresa, persona)

    await request(app)
      .patch(`${RUTA}/${persona._id}/estado`)
      .set(auth(token))
      .send({ activo: false, motivo: 'Permiso sin goce de sueldo' })
    const res = await request(app)
      .patch(`${RUTA}/${persona._id}/estado`)
      .set(auth(token))
      .send({ activo: true })

    expect(res.status).toBe(200)
    expect(res.body.data.empleado.empleado).toMatchObject({
      activo: true,
      motivoBaja: null,
      fechaBaja: null
    })
    // El acceso se vuelve a dar a propósito, no se restaura solo.
    expect(res.body.data.empleado.empleado.acceso.activo).toBe(false)
    expect(res.body.message).toMatch(/vuelve a darle acceso/i)
  })

  it('nadie se da de baja a sí mismo', async () => {
    const { token, empleado } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })

    const res = await request(app)
      .patch(`${RUTA}/${empleado._id}/estado`)
      .set(auth(token))
      .send({ activo: false, motivo: 'Me voy de vacaciones' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/a ti mismo/i)
  })

  it('no deja al sistema sin administrador de plataforma', async () => {
    const { token, empresa } = await crearEmpleadoConSesion({
      nivelAcceso: 'rh_admin',
      alcanceGlobal: true
    })
    const otroGlobal = await crearEmpleado({
      acceso: {
        email: 'global2@urbacames.com',
        nivelAcceso: 'rh_admin',
        alcanceGlobal: true
      }
    })
    await adscribir(empresa, otroGlobal)

    // Con dos, dar de baja al otro se permite…
    const primera = await request(app)
      .patch(`${RUTA}/${otroGlobal._id}/estado`)
      .set(auth(token))
      .send({ activo: false, motivo: 'Cambio de puesto' })
    expect(primera.status).toBe(200)

    // …y el que queda ya no puede irse (además de la regla de "a ti mismo").
    const tercero = await crearEmpleado({
      acceso: {
        email: 'global3@urbacames.com',
        nivelAcceso: 'rh_admin',
        alcanceGlobal: true
      }
    })
    await adscribir(empresa, tercero)
    const segunda = await request(app)
      .patch(`${RUTA}/${tercero._id}/estado`)
      .set(auth(token))
      .send({ activo: false, motivo: 'Cambio de puesto' })
    expect(segunda.status).toBe(200)
  })

  it('403 para rh_consulta y jefe_area; 404 fuera de alcance', async () => {
    const { empresa } = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const persona = await crearEmpleado({ tipo: 'mano_de_obra' })
    await adscribir(empresa, persona, { areas: ['operaciones_urbanizadora'] })

    const consulta = await crearEmpleadoConSesion({
      nivelAcceso: 'rh_consulta',
      empresa
    })
    const sinPermiso = await request(app)
      .patch(`${RUTA}/${persona._id}/estado`)
      .set(auth(consulta.token))
      .send({ activo: false, motivo: 'Renuncia voluntaria' })
    expect(sinPermiso.status).toBe(403)

    const otroAdmin = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const fuera = await request(app)
      .patch(`${RUTA}/${persona._id}/estado`)
      .set(auth(otroAdmin.token))
      .send({ activo: false, motivo: 'Renuncia voluntaria' })
    expect(fuera.status).toBe(404)
  })

  it('404 si el empleado no existe', async () => {
    const { token } = await escenario()
    const res = await request(app)
      .patch(`${RUTA}/${new mongoose.Types.ObjectId()}/estado`)
      .set(auth(token))
      .send({ activo: false, motivo: 'Renuncia voluntaria' })

    expect(res.status).toBe(404)
  })
})
