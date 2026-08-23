const request = require('supertest')
const mongoose = require('mongoose')
const app = require('../../src/app')
const Employee = require('../../src/api/v1/employees/employeeModel')
const Affiliation = require('../../src/api/v1/affiliations/affiliationModel')
const {
  crearCategoria,
  crearEmpresa,
  crearEmpleado,
  crearEmpleadoConSesion,
  adscribir,
  auth
} = require('../helpers/factories')

const RUTA = '/api/v1/empleados'

/** Alta de personal: persona + adscripción en una transacción. */
const cuerpo = ({ empresaId, categoriaId, ...extra }) => ({
  nombre: 'Roberto Aguilar Sosa',
  tipo: 'mano_de_obra',
  categoriaId,
  adscripcion: {
    empresaId,
    areas: ['obra'],
    tipoContrato: 'obra_determinada',
    fechaIngreso: '2026-09-01',
    fechaTerminoContrato: '2027-03-01'
  },
  ...extra
})

/** Sesión + su empresa + una categoría del tipo pedido. */
async function escenario(datos = {}, tipoCategoria = 'mano_de_obra') {
  const sesion = await crearEmpleadoConSesion(datos)
  const categoria = await crearCategoria(undefined, tipoCategoria)
  return { ...sesion, categoria }
}

describe('POST /api/v1/empleados — el alta', () => {
  it('crea la persona y su adscripción, y devuelve el renglón completo', async () => {
    const { token, empresa, categoria } = await escenario({ nivelAcceso: 'rh_admin' })

    const res = await request(app)
      .post(RUTA)
      .set(auth(token))
      .send(
        cuerpo({
          empresaId: empresa._id.toString(),
          categoriaId: categoria._id.toString()
        })
      )

    expect(res.status).toBe(201)

    const renglon = res.body.data.empleado
    expect(renglon.empleado).toMatchObject({
      nombre: 'Roberto Aguilar Sosa',
      tipo: 'mano_de_obra',
      activo: true,
      acceso: null
    })
    expect(renglon.categoriaNombre).toBe(categoria.nombre)
    expect(renglon.adscripciones).toHaveLength(1)
    expect(renglon.adscripciones[0]).toMatchObject({
      empresaId: empresa._id.toString(),
      empresaNombre: empresa.nombre,
      areas: ['obra'],
      tipoContrato: 'obra_determinada',
      fechaIngreso: '2026-09-01',
      activo: true
    })
    // Forma estable: lo que falta viene vacío, no ausente.
    expect(renglon.asignaciones).toEqual([])
    // El alta crea el expediente en la misma transacción (D-41), así que el
    // renglón ya trae su id y su avance. Aquí sale 100% porque este escenario no
    // siembra plantillas: un checklist sin requeridos está completo.
    expect(renglon.expedienteId).toEqual(expect.any(String))
    expect(renglon.avanceExpediente).toBe(100)
  })

  it('lo escribe todo en una transacción: sin adscripción no queda persona huérfana', async () => {
    const { token, categoria } = await escenario({ nivelAcceso: 'rh_admin' })
    const ajena = await crearEmpresa()

    const res = await request(app)
      .post(RUTA)
      .set(auth(token))
      // Empresa fuera de su alcance: debe fallar sin crear nada.
      .send(
        cuerpo({ empresaId: ajena._id.toString(), categoriaId: categoria._id.toString() })
      )

    expect(res.status).toBe(404)
    expect(await Employee.countDocuments({ nombre: 'Roberto Aguilar Sosa' })).toBe(0)
    expect(await Affiliation.countDocuments({ empresaId: ajena._id })).toBe(0)
  })

  it('la persona queda visible en el listado de quien la creó', async () => {
    const { token, empresa, categoria } = await escenario({ nivelAcceso: 'rh_admin' })
    await request(app)
      .post(RUTA)
      .set(auth(token))
      .send(
        cuerpo({
          empresaId: empresa._id.toString(),
          categoriaId: categoria._id.toString()
        })
      )

    const listado = await request(app).get(RUTA).set(auth(token))
    expect(listado.body.data.empleados.map((e) => e.empleado.nombre)).toContain(
      'Roberto Aguilar Sosa'
    )
  })

  describe('quién puede crear qué', () => {
    it('los tres niveles pueden dar de alta personal de obra', async () => {
      for (const datos of [
        { nivelAcceso: 'rh_admin' },
        { nivelAcceso: 'rh_consulta' },
        { nivelAcceso: 'jefe_area', areas: ['obra'] }
      ]) {
        const { token, empresa, categoria } = await escenario(datos)
        const res = await request(app)
          .post(RUTA)
          .set(auth(token))
          .send(
            cuerpo({
              empresaId: empresa._id.toString(),
              categoriaId: categoria._id.toString(),
              nombre: `Peón de ${datos.nivelAcceso}`
            })
          )

        expect(res.status).toBe(201)
      }
    })

    it('403 si rh_consulta o jefe_area piden tipo administrativo', async () => {
      for (const datos of [
        { nivelAcceso: 'rh_consulta' },
        { nivelAcceso: 'jefe_area', areas: ['obra'] }
      ]) {
        const { token, empresa, categoria } = await escenario(datos, 'administrativo')
        const res = await request(app)
          .post(RUTA)
          .set(auth(token))
          .send(
            cuerpo({
              empresaId: empresa._id.toString(),
              categoriaId: categoria._id.toString(),
              nombre: `Administrativo de ${datos.nivelAcceso}`,
              tipo: 'administrativo'
            })
          )

        expect(res.status).toBe(403)
        expect(res.body.message).toMatch(/administrador de RH/i)
        // Y no lo creó con otro tipo ni ignoró el campo.
        expect(
          await Employee.countDocuments({
            tipo: 'administrativo',
            nombre: /de rh|de jefe/i
          })
        ).toBe(0)
      }
    })

    it('rh_admin sí puede dar de alta administrativos', async () => {
      const { token, empresa, categoria } = await escenario(
        { nivelAcceso: 'rh_admin' },
        'administrativo'
      )
      const res = await request(app)
        .post(RUTA)
        .set(auth(token))
        .send(
          cuerpo({
            empresaId: empresa._id.toString(),
            categoriaId: categoria._id.toString(),
            tipo: 'administrativo',
            adscripcion: {
              empresaId: empresa._id.toString(),
              areas: ['administracion'],
              tipoContrato: 'indeterminado',
              fechaIngreso: '2026-09-01'
            }
          })
        )

      expect(res.status).toBe(201)
      expect(res.body.data.empleado.empleado.tipo).toBe('administrativo')
    })
  })

  describe('la adscripción', () => {
    it('es obligatoria salvo para el administrador de plataforma', async () => {
      const { token, categoria } = await escenario({ nivelAcceso: 'rh_admin' })

      const res = await request(app).post(RUTA).set(auth(token)).send({
        nombre: 'Sin Empresa',
        tipo: 'mano_de_obra',
        categoriaId: categoria._id.toString()
      })

      expect(res.status).toBe(400)
      expect(res.body.errors[0].path).toBe('adscripcion.empresaId')
      expect(res.body.message).toMatch(/nadie podría verla/i)
    })

    it('el administrador de plataforma puede crear sólo el catálogo', async () => {
      const { token } = await crearEmpleadoConSesion({
        alcanceGlobal: true,
        sinAdscripcion: true
      })
      const categoria = await crearCategoria(undefined, 'mano_de_obra')

      const res = await request(app).post(RUTA).set(auth(token)).send({
        nombre: 'Persona Del Catálogo',
        tipo: 'mano_de_obra',
        categoriaId: categoria._id.toString()
      })

      expect(res.status).toBe(201)
      expect(res.body.data.empleado.adscripciones).toEqual([])
    })

    it('un administrativo necesita al menos un área', async () => {
      const { token, empresa, categoria } = await escenario(
        { nivelAcceso: 'rh_admin' },
        'administrativo'
      )

      const res = await request(app)
        .post(RUTA)
        .set(auth(token))
        .send(
          cuerpo({
            empresaId: empresa._id.toString(),
            categoriaId: categoria._id.toString(),
            tipo: 'administrativo',
            adscripcion: {
              empresaId: empresa._id.toString(),
              areas: [],
              tipoContrato: 'indeterminado',
              fechaIngreso: '2026-09-01'
            }
          })
        )

      expect(res.status).toBe(400)
      expect(res.body.errors[0].path).toBe('adscripcion.areas')
    })

    it('un contrato temporal exige fecha de término posterior al ingreso', async () => {
      const { token, empresa, categoria } = await escenario({ nivelAcceso: 'rh_admin' })

      const res = await request(app)
        .post(RUTA)
        .set(auth(token))
        .send(
          cuerpo({
            empresaId: empresa._id.toString(),
            categoriaId: categoria._id.toString(),
            adscripcion: {
              empresaId: empresa._id.toString(),
              areas: ['obra'],
              tipoContrato: 'obra_determinada',
              fechaIngreso: '2026-09-01',
              fechaTerminoContrato: '2026-08-01'
            }
          })
        )

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/posterior/i)
      expect(await Employee.countDocuments({ nombre: 'Roberto Aguilar Sosa' })).toBe(0)
    })
  })

  describe('el jefe de área sólo da de alta en sus áreas', () => {
    it('403 si pide un área que no es suya', async () => {
      const { token, empresa, categoria } = await escenario({
        nivelAcceso: 'jefe_area',
        areas: ['obra']
      })

      const res = await request(app)
        .post(RUTA)
        .set(auth(token))
        .send(
          cuerpo({
            empresaId: empresa._id.toString(),
            categoriaId: categoria._id.toString(),
            adscripcion: {
              empresaId: empresa._id.toString(),
              areas: ['ventas'],
              tipoContrato: 'indeterminado',
              fechaIngreso: '2026-09-01'
            }
          })
        )

      expect(res.status).toBe(403)
      expect(res.body.message).toMatch(/tus áreas: obra/i)
    })

    it('400 si no indica ninguna: crearía a alguien que no podría ver', async () => {
      const { token, empresa, categoria } = await escenario({
        nivelAcceso: 'jefe_area',
        areas: ['obra']
      })

      const res = await request(app)
        .post(RUTA)
        .set(auth(token))
        .send(
          cuerpo({
            empresaId: empresa._id.toString(),
            categoriaId: categoria._id.toString(),
            adscripcion: {
              empresaId: empresa._id.toString(),
              areas: [],
              tipoContrato: 'indeterminado',
              fechaIngreso: '2026-09-01'
            }
          })
        )

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/no podrías ver/i)
    })

    it('y lo que crea en su área sí lo ve después', async () => {
      const { token, empresa, categoria } = await escenario({
        nivelAcceso: 'jefe_area',
        areas: ['obra']
      })

      await request(app)
        .post(RUTA)
        .set(auth(token))
        .send(
          cuerpo({
            empresaId: empresa._id.toString(),
            categoriaId: categoria._id.toString()
          })
        )

      const listado = await request(app).get(RUTA).set(auth(token))
      expect(listado.body.data.empleados.map((e) => e.empleado.nombre)).toContain(
        'Roberto Aguilar Sosa'
      )
    })
  })

  describe('la categoría', () => {
    it('404 si no existe', async () => {
      const { token, empresa } = await escenario({ nivelAcceso: 'rh_admin' })
      const res = await request(app)
        .post(RUTA)
        .set(auth(token))
        .send(
          cuerpo({
            empresaId: empresa._id.toString(),
            categoriaId: new mongoose.Types.ObjectId().toString()
          })
        )

      expect(res.status).toBe(404)
      expect(res.body.message).toMatch(/categoría/i)
    })

    it('400 si su tipo no corresponde al de la persona', async () => {
      const { token, empresa } = await escenario({ nivelAcceso: 'rh_admin' })
      const deOficina = await crearCategoria('Contador', 'administrativo')

      const res = await request(app)
        .post(RUTA)
        .set(auth(token))
        .send(
          cuerpo({
            empresaId: empresa._id.toString(),
            categoriaId: deOficina._id.toString(),
            tipo: 'mano_de_obra'
          })
        )

      expect(res.status).toBe(400)
      expect(res.body.errors[0].path).toBe('categoriaId')
    })
  })

  describe('duplicados', () => {
    it('409 si la CURP ya existe, diciendo de quién es', async () => {
      const { token, empresa, categoria } = await escenario({ nivelAcceso: 'rh_admin' })
      const existente = await crearEmpleado({
        nombre: 'Roberto Aguilar Sosa',
        curp: 'AUSR900101HJCGSB03'
      })

      const res = await request(app)
        .post(RUTA)
        .set(auth(token))
        .send(
          cuerpo({
            empresaId: empresa._id.toString(),
            categoriaId: categoria._id.toString(),
            curp: 'AUSR900101HJCGSB03'
          })
        )

      expect(res.status).toBe(409)
      expect(res.body.code).toBe('CURP_DUPLICADA')
      expect(res.body.data.candidatos[0]._id).toBe(existente._id.toString())
      expect(res.body.data.candidatos[0].yaEstaEnTuEmpresa).toBe(false)
    })

    it('la CURP duplicada no se puede forzar: es la identidad de la persona', async () => {
      const { token, empresa, categoria } = await escenario({ nivelAcceso: 'rh_admin' })
      await crearEmpleado({ curp: 'AUSR900101HJCGSB03' })

      const res = await request(app)
        .post(RUTA)
        .set(auth(token))
        .send(
          cuerpo({
            empresaId: empresa._id.toString(),
            categoriaId: categoria._id.toString(),
            curp: 'AUSR900101HJCGSB03',
            confirmarDuplicado: true
          })
        )

      expect(res.status).toBe(409)
    })

    it('sin CURP, avisa de los candidatos por nombre en vez de crear a ciegas', async () => {
      const { token, empresa, categoria } = await escenario({ nivelAcceso: 'rh_admin' })
      const yaEsta = await crearEmpleado({ nombre: 'Roberto Aguilar Sosa' })
      await adscribir(empresa, yaEsta)

      const res = await request(app)
        .post(RUTA)
        .set(auth(token))
        .send(
          cuerpo({
            empresaId: empresa._id.toString(),
            categoriaId: categoria._id.toString()
          })
        )

      expect(res.status).toBe(409)
      expect(res.body.code).toBe('POSIBLE_DUPLICADO')
      expect(res.body.data.candidatos).toHaveLength(1)
      // Lo que la interfaz necesita para elegir el mensaje.
      expect(res.body.data.candidatos[0].yaEstaEnTuEmpresa).toBe(true)
      expect(await Employee.countDocuments({ nombre: 'Roberto Aguilar Sosa' })).toBe(1)
    })

    it('compara el nombre ignorando acentos y mayúsculas', async () => {
      const { token, empresa, categoria } = await escenario({ nivelAcceso: 'rh_admin' })
      await crearEmpleado({ nombre: 'Rocío Gómez Muñoz' })

      const res = await request(app)
        .post(RUTA)
        .set(auth(token))
        .send(
          cuerpo({
            empresaId: empresa._id.toString(),
            categoriaId: categoria._id.toString(),
            nombre: 'rocio gomez munoz'
          })
        )

      expect(res.status).toBe(409)
    })

    it('confirmarDuplicado crea a la persona cuando de verdad es otra', async () => {
      const { token, empresa, categoria } = await escenario({ nivelAcceso: 'rh_admin' })
      await crearEmpleado({ nombre: 'Roberto Aguilar Sosa' })

      const res = await request(app)
        .post(RUTA)
        .set(auth(token))
        .send(
          cuerpo({
            empresaId: empresa._id.toString(),
            categoriaId: categoria._id.toString(),
            confirmarDuplicado: true
          })
        )

      expect(res.status).toBe(201)
      expect(await Employee.countDocuments({ nombre: 'Roberto Aguilar Sosa' })).toBe(2)
    })

    it('con fecha de nacimiento distinta no lo considera duplicado', async () => {
      const { token, empresa, categoria } = await escenario({ nivelAcceso: 'rh_admin' })
      await crearEmpleado({
        nombre: 'Roberto Aguilar Sosa',
        fechaNacimiento: '1990-01-01'
      })

      const res = await request(app)
        .post(RUTA)
        .set(auth(token))
        .send(
          cuerpo({
            empresaId: empresa._id.toString(),
            categoriaId: categoria._id.toString(),
            fechaNacimiento: '1985-06-15'
          })
        )

      expect(res.status).toBe(201)
    })
  })

  describe('validaciones y sesión', () => {
    it('401 sin sesión', async () => {
      const res = await request(app).post(RUTA).send({ nombre: 'X' })
      expect(res.status).toBe(401)
    })

    it('400 con mensajes en español por campo', async () => {
      const { token, empresa, categoria } = await escenario({ nivelAcceso: 'rh_admin' })
      const enviar = (extra) =>
        request(app)
          .post(RUTA)
          .set(auth(token))
          .send({
            ...cuerpo({
              empresaId: empresa._id.toString(),
              categoriaId: categoria._id.toString()
            }),
            ...extra
          })

      const casos = [
        [{ nombre: 'ab' }, 'nombre'],
        [{ tipo: 'obrero' }, 'tipo'],
        [{ categoriaId: 'no-es-id' }, 'categoriaId'],
        [{ curp: 'NO-ES-CURP' }, 'curp'],
        [{ fechaNacimiento: '01/01/1990' }, 'fechaNacimiento']
      ]

      for (const [extra, campo] of casos) {
        const res = await enviar(extra)
        expect(res.status).toBe(400)
        expect(res.body.errors.some((e) => e.path === campo)).toBe(true)
        expect(res.body.errors[0].msg).not.toBe('Invalid value')
      }
    })
  })
})
