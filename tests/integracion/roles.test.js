const request = require('supertest')
const app = require('../../src/app')
const Role = require('../../src/api/v1/roles/roleModel')
const Employee = require('../../src/api/v1/employees/employeeModel')
const { ensureSystemRoles } = require('../../src/services/seedRoles')
const { PERMISSION_KEYS, PERMISSION_MATRIX, can } = require('../../src/utils/permissions')
const {
  crearEmpleadoConSesion,
  crearEmpresa,
  adscribir,
  auth,
  PASSWORD_VALIDA
} = require('../helpers/factories')

/**
 * Roles armados desde la plataforma (D-93).
 *
 * Lo que vigilan estas pruebas, en orden de importancia:
 *
 * 1. Que los tres roles sembrados den **exactamente** lo que daban los tres
 *    niveles de acceso. Es la parte que no puede fallar: si difieren, el día del
 *    despliegue alguien gana o pierde permisos sin que nadie lo pidiera.
 * 2. Que un rol nuevo de verdad **acote** las rutas. Hasta ahora el reparto de
 *    la #44 sólo se podía probar contra sí mismo, porque los tres niveles traían
 *    todas las casillas; el «contador» de aquí abajo es el primer usuario que no
 *    las trae, y es la prueba de fuego de que aquello quedó bien partido.
 * 3. Que un rol incoherente no se guarde, y que uno en uso no se borre.
 */
const ROLES = '/api/v1/roles'
const EMPRESAS = '/api/v1/empresas'
const MAQUINAS = '/api/v1/maquinas'
const LOGIN = '/api/v1/auth/login'

describe('Roles', () => {
  beforeAll(() => Role.init())

  let plataforma

  beforeEach(async () => {
    // Sólo el administrador de plataforma arma roles.
    plataforma = await crearEmpleadoConSesion({
      nivelAcceso: 'rh_admin',
      alcanceGlobal: true
    })
  })

  const crearRol = (cuerpo, sesion) =>
    request(app)
      .post(ROLES)
      .set(auth((sesion || plataforma).token))
      .send(cuerpo)

  const listar = (sesion) =>
    request(app)
      .get(ROLES)
      .set(auth((sesion || plataforma).token))

  describe('los tres de siempre se siembran y dicen lo mismo que decían', () => {
    it('existen desde el arranque, son de sistema y son del grupo', async () => {
      await ensureSystemRoles()
      const res = await listar()

      expect(res.status).toBe(200)
      const nombres = res.body.data.roles.map((r) => r.nombre)
      expect(nombres).toEqual(
        expect.arrayContaining(['Administrador de RH', 'Consulta de RH', 'Jefe de área'])
      )

      for (const rol of res.body.data.roles) {
        expect(rol.esSistema).toBe(true)
        // `null` = del grupo. Hoy todos lo son (D-93).
        expect(rol.empresaId).toBeNull()
      }
    })

    /*
     * La comprobación que sostiene todo el cambio: rol por rol, casilla por
     * casilla, contra la matriz de la que se derivan. Si esto falla, la semilla
     * dejó de reflejar la matriz y alguien va a ganar o perder permisos.
     */
    it.each(['rh_admin', 'rh_consulta', 'jefe_area'])(
      'el rol de %s da exactamente lo que daba ese nivel',
      async (nivelAcceso) => {
        const { porNivel } = await ensureSystemRoles()
        const rol = porNivel[nivelAcceso]

        const conRol = {
          nivelAcceso: 'rh_consulta', // distinto a propósito: debe mandar el ROL
          alcanceGlobal: false,
          rolId: rol,
          permisosExtra: []
        }
        const porNivelAcceso = { nivelAcceso, alcanceGlobal: false }

        for (const clave of PERMISSION_KEYS) {
          expect({ clave, porRol: can(conRol, clave) }).toEqual({
            clave,
            porRol: can(porNivelAcceso, clave)
          })
        }
      }
    )

    it('el de rh_admin alcanza los permisos que se agreguen después', async () => {
      const { porNivel } = await ensureSystemRoles()
      const rol = porNivel.rh_admin

      // No se marcaron 41 casillas: se marcó «todos», que es lo que hace que un
      // módulo nuevo no nazca invisible para quien administra la plataforma.
      expect(rol.todosLosPermisos).toBe(true)

      const conRol = { nivelAcceso: 'rh_admin', alcanceGlobal: true, rolId: rol }
      expect(can(conRol, 'unaCasillaQueTodaviaNoExiste')).toBe(false)
      expect(can(conRol, 'manageRoles')).toBe(true)
    })

    it('el de jefe de área ve sólo sus áreas, como antes', async () => {
      const { porNivel } = await ensureSystemRoles()
      expect(porNivel.jefe_area.soloSusAreas).toBe(true)
      expect(porNivel.rh_admin.soloSusAreas).toBe(false)
    })
  })

  describe('armar un rol', () => {
    it('crea el rol con sus casillas y lo devuelve con 201', async () => {
      const res = await crearRol({
        nombre: 'Contador',
        descripcion: 'Ve la maquinaria, no levanta incidencias',
        permisos: ['viewMachines', 'viewProjects', 'viewContracts']
      })

      expect(res.status).toBe(201)
      expect(res.body.data.rol).toMatchObject({
        nombre: 'Contador',
        esSistema: false,
        activo: true,
        empresaId: null,
        todosLosPermisos: false
      })
      expect(res.body.data.rol.permisos.sort()).toEqual(
        ['viewContracts', 'viewMachines', 'viewProjects'].sort()
      )
    })

    it('no guarda un rol que marca modificar sin marcar ver, y dice cuál falta', async () => {
      const res = await crearRol({
        nombre: 'Incoherente',
        permisos: ['manageMachines']
      })

      expect(res.status).toBe(400)
      expect(res.body.message).toBe(
        '«Dar de alta y editar máquinas» necesita también «Ver la maquinaria»'
      )
      expect(res.body.data.faltantes).toEqual([
        { clave: 'manageMachines', requiere: 'viewMachines' }
      ])
    })

    it('rechaza una casilla que no existe', async () => {
      const res = await crearRol({ nombre: 'Inventado', permisos: ['verTodoElUniverso'] })

      expect(res.status).toBe(400)
      expect(res.body.errors[0].msg).toBe('Ese permiso no existe: verTodoElUniverso')
    })

    it('no permite dos roles con el mismo nombre, aunque cambie el acento', async () => {
      await crearRol({ nombre: 'Contador', permisos: [] })
      const repetido = await crearRol({ nombre: 'contádor', permisos: [] })

      expect(repetido.status).toBe(409)
      expect(repetido.body.message).toBe('Ya existe un rol con ese nombre')
    })

    it('se puede editar después, y duplicar el nombre sigue sin poder', async () => {
      const creado = await crearRol({ nombre: 'Contador', permisos: ['viewMachines'] })
      const id = creado.body.data.rol._id

      const editado = await request(app)
        .patch(`${ROLES}/${id}`)
        .set(auth(plataforma.token))
        .send({ permisos: ['viewMachines', 'manageMachines'] })

      expect(editado.status).toBe(200)
      expect(editado.body.data.rol.permisos).toContain('manageMachines')
    })
  })

  describe('los roles de sistema', () => {
    it('no se renombran ni se dan de baja, pero sí se les cambian los permisos', async () => {
      const { porNivel } = await ensureSystemRoles()
      const id = porNivel.rh_consulta._id.toString()

      const renombrar = await request(app)
        .patch(`${ROLES}/${id}`)
        .set(auth(plataforma.token))
        .send({ nombre: 'Otro nombre' })
      expect(renombrar.status).toBe(400)

      const baja = await request(app)
        .patch(`${ROLES}/${id}`)
        .set(auth(plataforma.token))
        .send({ activo: false })
      expect(baja.status).toBe(400)

      // Los permisos sí: son el punto de partida, no una jaula.
      const permisos = await request(app)
        .patch(`${ROLES}/${id}`)
        .set(auth(plataforma.token))
        .send({ permisos: ['viewEmployees'] })
      expect(permisos.status).toBe(200)
    })

    it('mandarle su MISMO nombre no es renombrarlo, y el formulario los manda todos', async () => {
      const { porNivel } = await ensureSystemRoles()
      const rol = porNivel.rh_consulta

      // Un formulario que devuelve el objeto entero manda `nombre` sin cambiarlo.
      const res = await request(app)
        .patch(`${ROLES}/${rol._id}`)
        .set(auth(plataforma.token))
        .send({ nombre: rol.nombre, permisos: ['viewEmployees'] })

      expect(res.status).toBe(200)
      expect(res.body.data.rol.nombre).toBe(rol.nombre)
    })

    it('no se eliminan', async () => {
      const { porNivel } = await ensureSystemRoles()
      const res = await request(app)
        .delete(`${ROLES}/${porNivel.jefe_area._id}`)
        .set(auth(plataforma.token))

      expect(res.status).toBe(400)
      expect(res.body.message).toBe('Los roles del sistema no se pueden eliminar')
    })
  })

  describe('eliminar', () => {
    it('un rol sin gente se elimina', async () => {
      const creado = await crearRol({ nombre: 'Efímero', permisos: [] })
      const res = await request(app)
        .delete(`${ROLES}/${creado.body.data.rol._id}`)
        .set(auth(plataforma.token))

      expect(res.status).toBe(204)
      expect(await Role.findById(creado.body.data.rol._id)).toBeNull()
    })

    it('un rol que alguien usa NO se elimina, y dice cuántos son', async () => {
      const creado = await crearRol({ nombre: 'Contador', permisos: ['viewMachines'] })
      const rolId = creado.body.data.rol._id

      const persona = await crearEmpleadoConSesion({ nivelAcceso: 'rh_consulta' })
      await Employee.updateOne(
        { _id: persona.empleado._id },
        { $set: { 'acceso.rolId': rolId } }
      )

      const res = await request(app)
        .delete(`${ROLES}/${rolId}`)
        .set(auth(plataforma.token))

      expect(res.status).toBe(409)
      expect(res.body.message).toBe(
        'Hay 1 persona con este rol. Cámbiale el rol antes de eliminarlo.'
      )
      expect(res.body.data.personas).toBe(1)
    })

    it('el listado dice cuánta gente tiene cada rol, para avisar antes', async () => {
      const creado = await crearRol({ nombre: 'Contador', permisos: [] })
      const persona = await crearEmpleadoConSesion({ nivelAcceso: 'rh_consulta' })
      await Employee.updateOne(
        { _id: persona.empleado._id },
        { $set: { 'acceso.rolId': creado.body.data.rol._id } }
      )

      const res = await listar()
      const contador = res.body.data.roles.find((r) => r.nombre === 'Contador')
      expect(contador.personas).toBe(1)
    })
  })

  describe('quién puede', () => {
    it('administrar accesos NO alcanza para armar roles', async () => {
      // `rh_admin` sin alcance global: tiene `manageAccess`, no `manageRoles`.
      const rh = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })

      const escribir = await crearRol({ nombre: 'Contador', permisos: [] }, rh)
      expect(escribir.status).toBe(403)
      expect(escribir.body.message).toBe('No tienes permiso para realizar esta acción')

      // Pero sí puede LEER la lista: la necesita para elegirle rol a alguien.
      const leer = await listar(rh)
      expect(leer.status).toBe(200)
    })

    it('quien no administra accesos ni siquiera ve la lista', async () => {
      const jefe = await crearEmpleadoConSesion({ nivelAcceso: 'jefe_area' })
      const res = await listar(jefe)
      expect(res.status).toBe(403)
    })

    it('sin sesión, 401', async () => {
      const res = await request(app).get(ROLES)
      expect(res.status).toBe(401)
    })
  })

  /*
   * El perfil que motivó todo esto: ve el listado de maquinaria pero NO levanta
   * incidencias, y no toca las obras. Antes era imposible —una sola casilla
   * autorizaba las dos cosas— y por eso este bloque es, de hecho, la prueba de
   * que la #44 partió bien los permisos.
   */
  describe('el contador: ve maquinaria pero no levanta incidencias', () => {
    async function contador() {
      const rol = await crearRol({
        nombre: 'Contador',
        permisos: [
          'viewEmployees',
          'viewProjects',
          'viewContracts',
          'viewMachines',
          'viewMachineIncidents'
        ]
      })

      const empresa = await crearEmpresa()
      const persona = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_consulta',
        empresa
      })
      await Employee.updateOne(
        { _id: persona.empleado._id },
        { $set: { 'acceso.rolId': rol.body.data.rol._id } }
      )

      const maquina = await request(app)
        .post(`${EMPRESAS}/${empresa._id}/maquinas`)
        .set(auth(plataforma.token))
        .send({ identificador: 'ECO-01', modelo: 'CAT 320' })

      return { sesion: persona, empresa, maquinaId: maquina.body.data.maquina._id }
    }

    it('ve el catálogo y la ficha de una máquina', async () => {
      const { sesion, empresa, maquinaId } = await contador()

      const catalogo = await request(app)
        .get(`${EMPRESAS}/${empresa._id}/maquinas`)
        .set(auth(sesion.token))
      expect(catalogo.status).toBe(200)

      const ficha = await request(app)
        .get(`${MAQUINAS}/${maquinaId}`)
        .set(auth(sesion.token))
      expect(ficha.status).toBe(200)
    })

    it('NO levanta una incidencia, aunque vea la máquina', async () => {
      const { sesion, maquinaId } = await contador()

      const res = await request(app)
        .post(`${MAQUINAS}/${maquinaId}/incidencias`)
        .set(auth(sesion.token))
        .send({ tipoId: '000000000000000000000000', fecha: '2026-09-01' })

      expect(res.status).toBe(403)
      expect(res.body.message).toBe('No tienes permiso para realizar esta acción')
    })

    it('NO da de alta una máquina ni edita la obra', async () => {
      const { sesion, empresa, maquinaId } = await contador()

      const alta = await request(app)
        .post(`${EMPRESAS}/${empresa._id}/maquinas`)
        .set(auth(sesion.token))
        .send({ identificador: 'ECO-02', modelo: 'CAT' })
      expect(alta.status).toBe(403)

      const editar = await request(app)
        .patch(`${MAQUINAS}/${maquinaId}`)
        .set(auth(sesion.token))
        .send({ modelo: 'Otro' })
      expect(editar.status).toBe(403)
    })

    it('SÍ ve las incidencias, que es la otra mitad de la separación', async () => {
      const { sesion, maquinaId } = await contador()

      const res = await request(app)
        .get(`${MAQUINAS}/${maquinaId}/incidencias`)
        .set(auth(sesion.token))
      expect(res.status).toBe(200)
    })

    it('el expediente se le puede negar aunque vea a la persona', async () => {
      const { sesion } = await contador()

      // Su rol trae `viewEmployees` pero NO `viewRecords`.
      const personas = await request(app).get('/api/v1/empleados').set(auth(sesion.token))
      expect(personas.status).toBe(200)

      const expedientes = await request(app)
        .get('/api/v1/expedientes')
        .set(auth(sesion.token))
      expect(expedientes.status).toBe(403)
    })
  })

  describe('cambiar un rol surte efecto sin volver a entrar', () => {
    it('quitarle una casilla al rol cierra la ruta en la siguiente petición', async () => {
      const rol = await crearRol({
        nombre: 'Operaciones',
        permisos: ['viewMachines', 'viewEmployees']
      })
      const rolId = rol.body.data.rol._id

      const empresa = await crearEmpresa()
      const persona = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_consulta',
        empresa
      })
      await Employee.updateOne(
        { _id: persona.empleado._id },
        { $set: { 'acceso.rolId': rolId } }
      )

      const antes = await request(app)
        .get(`${EMPRESAS}/${empresa._id}/maquinas`)
        .set(auth(persona.token))
      expect(antes.status).toBe(200)

      await request(app)
        .patch(`${ROLES}/${rolId}`)
        .set(auth(plataforma.token))
        .send({ permisos: ['viewEmployees'] })

      // MISMO token: el permiso no viaja en él, se resuelve en cada petición.
      const despues = await request(app)
        .get(`${EMPRESAS}/${empresa._id}/maquinas`)
        .set(auth(persona.token))
      expect(despues.status).toBe(403)
    })
  })

  describe('excepciones: sólo agregan', () => {
    it('un permiso extra abre una ruta que el rol no daba', async () => {
      const rol = await crearRol({ nombre: 'Consulta', permisos: ['viewEmployees'] })
      const empresa = await crearEmpresa()
      const persona = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_consulta',
        empresa
      })

      await Employee.updateOne(
        { _id: persona.empleado._id },
        {
          $set: {
            'acceso.rolId': rol.body.data.rol._id,
            'acceso.permisosExtra': ['viewMachines']
          }
        }
      )

      const res = await request(app)
        .get(`${EMPRESAS}/${empresa._id}/maquinas`)
        .set(auth(persona.token))
      expect(res.status).toBe(200)
    })

    it('una casilla que el rol YA daba dice que viene del rol, no de la excepción', async () => {
      const rol = await crearRol({ nombre: 'Consulta', permisos: ['viewEmployees'] })
      const persona = await crearEmpleadoConSesion({ nivelAcceso: 'rh_consulta' })

      await Employee.updateOne(
        { _id: persona.empleado._id },
        {
          $set: {
            'acceso.rolId': rol.body.data.rol._id,
            // La misma que el rol ya da, más una que no.
            'acceso.permisosExtra': ['viewEmployees', 'viewMachines']
          }
        }
      )

      const res = await request(app)
        .get(`/api/v1/empleados/${persona.empleado._id}/acceso`)
        .set(auth(plataforma.token))

      const porClave = Object.fromEntries(
        res.body.data.acceso.permisos.map((p) => [p.clave, p.origen])
      )
      // Quitarle la excepción no se la quitaría: decir «excepción» mentiría.
      expect(porClave.viewEmployees).toBe('rol')
      expect(porClave.viewMachines).toBe('excepcion')
    })

    it('la ficha dice de dónde le viene cada permiso', async () => {
      const rol = await crearRol({ nombre: 'Consulta', permisos: ['viewEmployees'] })
      const persona = await crearEmpleadoConSesion({ nivelAcceso: 'rh_consulta' })

      await Employee.updateOne(
        { _id: persona.empleado._id },
        {
          $set: {
            'acceso.rolId': rol.body.data.rol._id,
            'acceso.permisosExtra': ['viewMachines']
          }
        }
      )

      const res = await request(app)
        .get(`/api/v1/empleados/${persona.empleado._id}/acceso`)
        .set(auth(plataforma.token))

      expect(res.status).toBe(200)
      expect(res.body.data.acceso.rol.nombre).toBe('Consulta')
      expect(res.body.data.acceso.permisos).toEqual(
        expect.arrayContaining([
          { clave: 'viewEmployees', origen: 'rol' },
          { clave: 'viewMachines', origen: 'excepcion' }
        ])
      )
    })

    it('valen también antes de que la persona tenga rol', async () => {
      /*
       * Si sólo contaran con rol, dárselas a alguien que todavía no lo tiene se
       * guardaría y no haría nada: un permiso visible en su ficha que no
       * funciona. Como sólo suman, no hay nada que puedan romper.
       */
      const persona = await crearEmpleadoConSesion({ nivelAcceso: 'jefe_area' })
      await Employee.updateOne(
        { _id: persona.empleado._id },
        { $set: { 'acceso.permisosExtra': ['uploadDocuments'] } }
      )

      const res = await request(app).get('/api/v1/auth/me').set(auth(persona.token))

      expect(res.body.data.user.rol).toBeNull()
      // `jefe_area` no sube documentos; la excepción se lo abre.
      expect(res.body.data.user.permisos).toContain('uploadDocuments')
    })

    it('un permiso que exige administrador de plataforma no se da como excepción', async () => {
      const persona = await crearEmpleadoConSesion({ nivelAcceso: 'rh_consulta' })

      const res = await request(app)
        .patch(`/api/v1/empleados/${persona.empleado._id}/acceso`)
        .set(auth(plataforma.token))
        .send({ permisosExtra: ['manageCompanies'] })

      expect(res.status).toBe(400)
      expect(res.body.message).toContain('administrador de plataforma')
    })
  })

  describe('la sesión dice qué permisos trae', () => {
    it('GET /auth/me devuelve el rol y las casillas resueltas', async () => {
      const rol = await crearRol({
        nombre: 'Consulta',
        permisos: ['viewEmployees', 'viewMachines']
      })
      const persona = await crearEmpleadoConSesion({ nivelAcceso: 'rh_consulta' })
      await Employee.updateOne(
        { _id: persona.empleado._id },
        { $set: { 'acceso.rolId': rol.body.data.rol._id } }
      )

      const res = await request(app).get('/api/v1/auth/me').set(auth(persona.token))

      expect(res.status).toBe(200)
      expect(res.body.data.user.rol).toEqual({
        _id: rol.body.data.rol._id,
        nombre: 'Consulta'
      })
      expect(res.body.data.user.permisos.sort()).toEqual([
        'viewEmployees',
        'viewMachines'
      ])
      // El nivel de acceso sigue viajando mientras el front migra.
      expect(res.body.data.user.nivelAcceso).toBe('rh_consulta')
    })

    it('el login devuelve los mismos permisos que /auth/me', async () => {
      const rol = await crearRol({ nombre: 'Consulta', permisos: ['viewEmployees'] })
      const persona = await crearEmpleadoConSesion({ nivelAcceso: 'rh_consulta' })
      await Employee.updateOne(
        { _id: persona.empleado._id },
        {
          $set: {
            'acceso.rolId': rol.body.data.rol._id,
            'acceso.passwordTemporal': false
          }
        }
      )

      const login = await request(app)
        .post(LOGIN)
        .send({ email: persona.empleado.acceso.email, password: PASSWORD_VALIDA })

      expect(login.status).toBe(200)
      expect(login.body.data.user.permisos).toEqual(['viewEmployees'])
      expect(login.body.data.user.rol.nombre).toBe('Consulta')
    })

    it('quien todavía no tiene rol recibe los de su nivel de acceso', async () => {
      const persona = await crearEmpleadoConSesion({ nivelAcceso: 'jefe_area' })

      const res = await request(app).get('/api/v1/auth/me').set(auth(persona.token))

      expect(res.body.data.user.rol).toBeNull()

      const esperados = Object.entries(PERMISSION_MATRIX.jefe_area)
        .filter(([, valor]) => valor === true || valor === 'own_area')
        .map(([clave]) => clave)
      expect(res.body.data.user.permisos.sort()).toEqual(esperados.sort())
    })
  })

  describe('elegir el rol al dar el acceso', () => {
    it('se le puede dar el rol en el alta del acceso', async () => {
      const rol = await crearRol({ nombre: 'Contador', permisos: ['viewMachines'] })
      const empresa = await crearEmpresa()
      const persona = await crearEmpleadoConSesion({ empresa })
      const otra = await require('../helpers/factories').crearEmpleado({})
      await adscribir(otra, empresa)

      const res = await request(app)
        .post(`/api/v1/empleados/${otra._id}/acceso`)
        .set(auth(plataforma.token))
        .send({
          email: 'contador.nuevo@urbacames.com',
          password: PASSWORD_VALIDA,
          nivelAcceso: 'rh_consulta',
          rolId: rol.body.data.rol._id
        })

      expect(res.status).toBe(201)

      const detalle = await request(app)
        .get(`/api/v1/empleados/${otra._id}/acceso`)
        .set(auth(plataforma.token))
      expect(detalle.body.data.acceso.rol.nombre).toBe('Contador')
      expect(persona).toBeDefined()
    })

    it('un rol que no existe da 404 y no crea el acceso', async () => {
      const empresa = await crearEmpresa()
      const otra = await require('../helpers/factories').crearEmpleado({})
      await adscribir(otra, empresa)

      const res = await request(app)
        .post(`/api/v1/empleados/${otra._id}/acceso`)
        .set(auth(plataforma.token))
        .send({
          email: 'sin.rol@urbacames.com',
          password: PASSWORD_VALIDA,
          nivelAcceso: 'rh_consulta',
          rolId: '000000000000000000000000'
        })

      expect(res.status).toBe(404)
      expect(await Employee.findById(otra._id)).toHaveProperty('acceso', null)
    })

    it('un rol dado de baja no se puede asignar', async () => {
      const rol = await crearRol({ nombre: 'Viejo', permisos: [] })
      await request(app)
        .patch(`${ROLES}/${rol.body.data.rol._id}`)
        .set(auth(plataforma.token))
        .send({ activo: false })

      const persona = await crearEmpleadoConSesion({ nivelAcceso: 'rh_consulta' })
      const res = await request(app)
        .patch(`/api/v1/empleados/${persona.empleado._id}/acceso`)
        .set(auth(plataforma.token))
        .send({ rolId: rol.body.data.rol._id })

      expect(res.status).toBe(400)
      expect(res.body.message).toBe('Ese rol está dado de baja: elige otro')
    })
  })
})
