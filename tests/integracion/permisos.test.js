const request = require('supertest')
const app = require('../../src/app')
const {
  PERMISSIONS,
  PERMISSION_SECTIONS,
  PERMISSION_MATRIX,
  can
} = require('../../src/utils/permissions')
const { crearEmpleadoConSesion, auth } = require('../helpers/factories')

/**
 * `GET /permisos` — el catálogo de casillas que existen (D-92).
 *
 * Existe para que la pantalla que arma roles deje de mantener su propia lista
 * escrita a mano: hoy son dos listas, la del servidor y la del front, y ya
 * difieren en un caso. Es estático —sale del código, no de una colección— y por
 * eso no tiene alta, ni edición, ni baja.
 */
const PERMISOS = '/api/v1/permisos'

describe('GET /permisos', () => {
  let admin

  beforeEach(async () => {
    admin = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
  })

  const pedir = (sesion) => request(app).get(PERMISOS).set(auth(sesion.token))

  it('devuelve el catálogo completo con su sección y lo que exigen', async () => {
    const res = await pedir(admin)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('success')
    expect(res.body.data.permisos).toHaveLength(PERMISSIONS.length)

    const verMaquinas = res.body.data.permisos.find((p) => p.clave === 'viewMachines')
    expect(verMaquinas).toEqual({
      clave: 'viewMachines',
      etiqueta: 'Ver la maquinaria',
      seccion: 'maquinaria',
      subseccion: null,
      requiere: [],
      exigeAlcanceGlobal: false,
      acotableAAreas: false
    })

    /*
     * Las dos banderas que antes eran valores de la matriz por nivel (D-93).
     * Vienen resueltas para que la pantalla que arma un rol pueda avisar «esto
     * además exige ser administrador de plataforma» sin cruzar otra lista.
     */
    const empresas = res.body.data.permisos.find((p) => p.clave === 'manageCompanies')
    expect(empresas.exigeAlcanceGlobal).toBe(true)

    const verEmpleados = res.body.data.permisos.find((p) => p.clave === 'viewEmployees')
    expect(verEmpleados.acotableAAreas).toBe(true)

    // Modificar exige ver: es lo que la pantalla necesita para avisar sin
    // adivinarlo.
    const gestionar = res.body.data.permisos.find((p) => p.clave === 'manageMachines')
    expect(gestionar.requiere).toEqual(['viewMachines'])
    expect(gestionar.subseccion).toBeNull()

    // Y las que van dentro de una subsección la dicen.
    const incidencias = res.body.data.permisos.find(
      (p) => p.clave === 'manageMachineIncidents'
    )
    expect(incidencias.seccion).toBe('maquinaria')
    expect(incidencias.subseccion).toBe('incidencias')
  })

  it('devuelve las secciones que agrupan las casillas, con su etiqueta', async () => {
    const res = await pedir(admin)

    expect(res.body.data.secciones).toHaveLength(PERMISSION_SECTIONS.length)
    expect(res.body.data.secciones).toContainEqual({
      clave: 'maquinaria',
      etiqueta: 'Maquinaria'
    })

    // Ninguna casilla apunta a una sección que no venga en la lista.
    const claves = res.body.data.secciones.map((s) => s.clave)
    for (const permiso of res.body.data.permisos) {
      expect(claves).toContain(permiso.seccion)
    }
  })

  it('dice qué casillas trae quien pregunta', async () => {
    const res = await pedir(admin)

    const esperadas = PERMISSIONS.filter(({ clave }) =>
      can({ nivelAcceso: 'rh_admin', alcanceGlobal: false }, clave)
    ).map(({ clave }) => clave)

    expect(res.body.data.tengo.sort()).toEqual(esperadas.sort())

    // Un `rh_admin` sin alcance global NO trae los catálogos del grupo.
    expect(res.body.data.tengo).not.toContain('manageCompanies')
    expect(res.body.data.tengo).toContain('manageAccess')
  })

  it('el administrador de plataforma sí trae los catálogos del grupo', async () => {
    const plataforma = await crearEmpleadoConSesion({
      nivelAcceso: 'rh_admin',
      alcanceGlobal: true
    })
    const res = await pedir(plataforma)

    expect(res.body.data.tengo).toContain('manageCompanies')
    expect(res.body.data.tengo).toContain('manageAreas')
  })

  it('cada nivel recibe exactamente lo que dice la matriz', async () => {
    for (const nivelAcceso of ['rh_consulta', 'jefe_area']) {
      const sesion = await crearEmpleadoConSesion({ nivelAcceso })
      const res = await pedir(sesion)

      const esperadas = Object.entries(PERMISSION_MATRIX[nivelAcceso])
        .filter(([, valor]) => valor === true || valor === 'own_area')
        .map(([clave]) => clave)

      expect({ nivelAcceso, tengo: res.body.data.tengo.sort() }).toEqual({
        nivelAcceso,
        tengo: esperadas.sort()
      })
    }
  })

  it('sin sesión responde 401 en español', async () => {
    const res = await request(app).get(PERMISOS)

    expect(res.status).toBe(401)
    expect(res.body.message).toBe('Necesitas iniciar sesión para continuar')
  })
})
