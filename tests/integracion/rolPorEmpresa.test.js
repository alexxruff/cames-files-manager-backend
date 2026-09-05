const request = require('supertest')
const app = require('../../src/app')
const Role = require('../../src/api/v1/roles/roleModel')
const Employee = require('../../src/api/v1/employees/employeeModel')
const Affiliation = require('../../src/api/v1/affiliations/affiliationModel')
const {
  crearEmpleadoConSesion,
  crearEmpresa,
  adscribir,
  auth
} = require('../helpers/factories')

/**
 * Un rol distinto en cada empresa (D-94).
 *
 * Esta es la prueba que valida las tres tareas de la cadena a la vez: los
 * permisos partidos por sección (D-92), los roles como dato (D-93) y el rol por
 * empresa. Lo que se comprueba aquí no se podía comprobar antes, porque hasta la
 * #45 no existía un usuario que no trajera todas las casillas.
 *
 * El caso central: **la misma persona, el mismo recurso, dos empresas** — 200 en
 * una y 404 en la otra. No 403: dentro de la empresa donde no tiene el permiso,
 * esos datos quedan fuera de su alcance, y fuera de alcance responde como si no
 * existiera (regla #7 del contrato).
 */
const ROLES = '/api/v1/roles'
const EMPRESAS = '/api/v1/empresas'
const ADSCRIPCIONES = '/api/v1/adscripciones'

describe('Un rol distinto en cada empresa', () => {
  beforeAll(() => Role.init())

  let plataforma

  beforeEach(async () => {
    plataforma = await crearEmpleadoConSesion({
      nivelAcceso: 'rh_admin',
      alcanceGlobal: true
    })
  })

  const crearRol = (nombre, permisos) =>
    request(app).post(ROLES).set(auth(plataforma.token)).send({ nombre, permisos })

  const crearMaquina = (empresa, identificador) =>
    request(app)
      .post(`${EMPRESAS}/${empresa._id}/maquinas`)
      .set(auth(plataforma.token))
      .send({ identificador, modelo: 'CAT 320' })

  /**
   * Alguien en dos empresas: en la primera maneja maquinaria, en la segunda
   * sólo ve al personal. Es el caso que pidió Urbacames.
   */
  async function enDosEmpresas() {
    const conMaquinaria = await crearRol('Operaciones', [
      'viewEmployees',
      'viewMachines',
      'manageMachines'
    ])
    const soloConsulta = await crearRol('Consulta', ['viewEmployees'])

    const constructora = await crearEmpresa({ nombre: 'Urbanizadora' })
    const maquinaria = await crearEmpresa({ nombre: 'Maquinaria CAMES' })

    const persona = await crearEmpleadoConSesion({
      nivelAcceso: 'rh_consulta',
      empresa: constructora
    })
    await adscribir(maquinaria, persona.empleado)

    // El rol de cada empresa, por la ruta de verdad.
    for (const [empresa, rol] of [
      [constructora, conMaquinaria],
      [maquinaria, soloConsulta]
    ]) {
      const adscripcion = await Affiliation.findOne({
        empleadoId: persona.empleado._id,
        empresaId: empresa._id
      })
      const res = await request(app)
        .patch(`${ADSCRIPCIONES}/${adscripcion._id}/rol`)
        .set(auth(plataforma.token))
        .send({ rolId: rol.body.data.rol._id })
      expect(res.status).toBe(200)
    }

    const maqA = await crearMaquina(constructora, 'ECO-A')
    const maqB = await crearMaquina(maquinaria, 'ECO-B')

    return {
      persona,
      constructora,
      maquinaria,
      maquinaA: maqA.body.data.maquina._id,
      maquinaB: maqB.body.data.maquina._id
    }
  }

  describe('el mismo recurso, dos respuestas', () => {
    it('ve la maquinaria de la empresa donde tiene el permiso', async () => {
      const { persona, constructora } = await enDosEmpresas()

      const res = await request(app)
        .get(`${EMPRESAS}/${constructora._id}/maquinas`)
        .set(auth(persona.token))

      expect(res.status).toBe(200)
    })

    it('en la otra empresa responde 404, como si no existiera', async () => {
      const { persona, maquinaria } = await enDosEmpresas()

      const res = await request(app)
        .get(`${EMPRESAS}/${maquinaria._id}/maquinas`)
        .set(auth(persona.token))

      // 404 y no 403: el permiso lo tiene, pero no ahí. Esos datos quedan fuera
      // de su alcance, y fuera de alcance no se confirma que existan.
      expect(res.status).toBe(404)
    })

    it('la ficha de una máquina concreta obedece la misma regla', async () => {
      const { persona, maquinaA, maquinaB } = await enDosEmpresas()

      const suya = await request(app)
        .get(`/api/v1/maquinas/${maquinaA}`)
        .set(auth(persona.token))
      expect(suya.status).toBe(200)

      const ajena = await request(app)
        .get(`/api/v1/maquinas/${maquinaB}`)
        .set(auth(persona.token))
      expect(ajena.status).toBe(404)
    })

    it('editar una máquina donde sí puede funciona, y donde no, 404', async () => {
      const { persona, maquinaA, maquinaB } = await enDosEmpresas()

      const suya = await request(app)
        .patch(`/api/v1/maquinas/${maquinaA}`)
        .set(auth(persona.token))
        .send({ modelo: 'CAT 330' })
      expect(suya.status).toBe(200)

      const ajena = await request(app)
        .patch(`/api/v1/maquinas/${maquinaB}`)
        .set(auth(persona.token))
        .send({ modelo: 'CAT 330' })
      expect(ajena.status).toBe(404)
    })
  })

  describe('cuando no lo tiene en ninguna empresa', () => {
    it('la ruta lo rechaza con 403', async () => {
      const soloConsulta = await crearRol('Consulta', ['viewEmployees'])
      const empresa = await crearEmpresa()
      const otra = await crearEmpresa()

      const persona = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_consulta',
        empresa
      })
      await adscribir(otra, persona.empleado)

      for (const e of [empresa, otra]) {
        const adscripcion = await Affiliation.findOne({
          empleadoId: persona.empleado._id,
          empresaId: e._id
        })
        await request(app)
          .patch(`${ADSCRIPCIONES}/${adscripcion._id}/rol`)
          .set(auth(plataforma.token))
          .send({ rolId: soloConsulta.body.data.rol._id })
      }

      const res = await request(app)
        .get(`${EMPRESAS}/${empresa._id}/maquinas`)
        .set(auth(persona.token))

      // 403 y no 404: no puede en ninguna parte, así que el problema es el
      // permiso, no el alcance.
      expect(res.status).toBe(403)
      expect(res.body.message).toBe('No tienes permiso para realizar esta acción')
    })
  })

  describe('si la adscripción no dice rol, manda el rol base', () => {
    it('quien no usa esto no nota ningún cambio', async () => {
      const base = await crearRol('Base', ['viewEmployees', 'viewMachines'])
      const empresa = await crearEmpresa()
      const otra = await crearEmpresa()

      const persona = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_consulta',
        empresa
      })
      await adscribir(otra, persona.empleado)
      await Employee.updateOne(
        { _id: persona.empleado._id },
        { $set: { 'acceso.rolId': base.body.data.rol._id } }
      )

      // Ninguna adscripción tiene rol: el base vale en las dos.
      for (const e of [empresa, otra]) {
        const res = await request(app)
          .get(`${EMPRESAS}/${e._id}/maquinas`)
          .set(auth(persona.token))
        expect({ empresa: e.nombre, status: res.status }).toEqual({
          empresa: e.nombre,
          status: 200
        })
      }
    })

    it('y quien no tiene ni rol base se resuelve por su nivel de acceso', async () => {
      const empresa = await crearEmpresa()
      const persona = await crearEmpleadoConSesion({
        nivelAcceso: 'jefe_area',
        empresa
      })

      const res = await request(app)
        .get(`${EMPRESAS}/${empresa._id}/maquinas`)
        .set(auth(persona.token))
      expect(res.status).toBe(200)
    })

    it('quitarle el rol de una empresa la devuelve a su rol base', async () => {
      const { persona, maquinaria } = await enDosEmpresas()
      const adscripcion = await Affiliation.findOne({
        empleadoId: persona.empleado._id,
        empresaId: maquinaria._id
      })

      // Su rol base es null, así que cae a `rh_consulta`, que sí ve maquinaria.
      const res = await request(app)
        .patch(`${ADSCRIPCIONES}/${adscripcion._id}/rol`)
        .set(auth(plataforma.token))
        .send({ rolId: null })
      expect(res.status).toBe(200)
      expect(res.body.data.adscripcion.rolId).toBeNull()

      const maquinas = await request(app)
        .get(`${EMPRESAS}/${maquinaria._id}/maquinas`)
        .set(auth(persona.token))
      expect(maquinas.status).toBe(200)
    })
  })

  describe('los catálogos del grupo no se movieron', () => {
    it('basta tener el permiso en ALGUNA empresa para ver clientes y empleados', async () => {
      const { persona } = await enDosEmpresas()

      // `viewClients` no lo tiene en ninguna: 403.
      const clientes = await request(app).get('/api/v1/clientes').set(auth(persona.token))
      expect(clientes.status).toBe(403)

      // `viewEmployees` lo tiene en las dos: el catálogo es global y responde.
      const empleados = await request(app)
        .get('/api/v1/empleados')
        .set(auth(persona.token))
      expect(empleados.status).toBe(200)
    })

    it('empresas, puestos y áreas siguen exigiendo administrador de plataforma', async () => {
      const conTodo = await crearRol('Todopoderoso', [
        'viewEmployees',
        'viewCompanies',
        'manageCompanies',
        'manageCategories',
        'manageAreas'
      ])
      const empresa = await crearEmpresa()
      const persona = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_consulta',
        empresa
      })
      const adscripcion = await Affiliation.findOne({
        empleadoId: persona.empleado._id,
        empresaId: empresa._id
      })
      await request(app)
        .patch(`${ADSCRIPCIONES}/${adscripcion._id}/rol`)
        .set(auth(plataforma.token))
        .send({ rolId: conTodo.body.data.rol._id })

      // El rol las marca, pero no es administrador de plataforma.
      const res = await request(app)
        .post('/api/v1/categorias')
        .set(auth(persona.token))
        .send({ nombre: 'Puesto nuevo', tipo: 'administrativo' })
      expect(res.status).toBe(403)
    })
  })

  describe('las excepciones de la persona valen en todas sus empresas', () => {
    it('un permiso extra abre la ruta en las dos', async () => {
      const { persona, constructora, maquinaria } = await enDosEmpresas()

      await Employee.updateOne(
        { _id: persona.empleado._id },
        { $set: { 'acceso.permisosExtra': ['viewClients'] } }
      )

      const res = await request(app).get('/api/v1/clientes').set(auth(persona.token))
      expect(res.status).toBe(200)
      expect(constructora).toBeDefined()
      expect(maquinaria).toBeDefined()
    })
  })

  describe('la sesión dice qué trae en cada empresa', () => {
    it('cada empresa viene con su rol y sus permisos', async () => {
      const { persona } = await enDosEmpresas()

      const res = await request(app).get('/api/v1/auth/me').set(auth(persona.token))

      expect(res.status).toBe(200)
      const porNombre = Object.fromEntries(
        res.body.data.user.empresas.map((e) => [e.nombre, e])
      )

      expect(porNombre.Urbanizadora.rol.nombre).toBe('Operaciones')
      expect(porNombre.Urbanizadora.permisos).toContain('manageMachines')

      expect(porNombre['Maquinaria CAMES'].rol.nombre).toBe('Consulta')
      expect(porNombre['Maquinaria CAMES'].permisos).not.toContain('manageMachines')
    })

    it('el `permisos` de arriba es la unión de todas, que es lo que el front lee', async () => {
      const { persona } = await enDosEmpresas()

      const res = await request(app).get('/api/v1/auth/me').set(auth(persona.token))

      // Lo tiene en una sola empresa, pero la unión lo incluye: sirve para
      // decidir si la sección se ofrece siquiera.
      expect(res.body.data.user.permisos).toContain('manageMachines')
      expect(res.body.data.user.permisos).toContain('viewEmployees')
    })
  })

  describe('quién puede repartir el rol de una empresa', () => {
    it('exige administrar accesos, no mover gente entre empresas', async () => {
      const { persona, constructora } = await enDosEmpresas()
      const adscripcion = await Affiliation.findOne({
        empleadoId: persona.empleado._id,
        empresaId: constructora._id
      })

      // Su rol «Operaciones» no trae `manageAccess`.
      const res = await request(app)
        .patch(`${ADSCRIPCIONES}/${adscripcion._id}/rol`)
        .set(auth(persona.token))
        .send({ rolId: null })

      expect(res.status).toBe(403)
    })

    it('un rol que no existe da 404 y no cambia nada', async () => {
      const { persona, constructora } = await enDosEmpresas()
      const adscripcion = await Affiliation.findOne({
        empleadoId: persona.empleado._id,
        empresaId: constructora._id
      })

      const res = await request(app)
        .patch(`${ADSCRIPCIONES}/${adscripcion._id}/rol`)
        .set(auth(plataforma.token))
        .send({ rolId: '000000000000000000000000' })

      expect(res.status).toBe(404)
      const sinCambios = await Affiliation.findById(adscripcion._id)
      expect(sinCambios.rolId.toString()).toBe(adscripcion.rolId.toString())
    })
  })
})
