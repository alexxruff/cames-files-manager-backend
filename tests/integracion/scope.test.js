const request = require('supertest')
const app = require('../../src/app')
const {
  crearEmpleado,
  crearEmpleadoConSesion,
  crearEmpresa,
  crearCategoria,
  adscribir,
  auth
} = require('../helpers/factories')

const RUTA = '/api/v1/empleados'

/**
 * Aislamiento entre empresas (modelo-datos §8.1).
 *
 * Es LA prueba de seguridad del modelo nuevo: con empleados globales, lo que
 * alguien ve ya no es un campo del documento sino el resultado de cruzar sus
 * adscripciones. Un olvido aquí muestra la nómina de una empresa a la otra.
 */
describe('Alcance por empresa', () => {
  it('sólo ve a los empleados adscritos a SU empresa', async () => {
    const edificacion = await crearEmpresa({ nombre: 'Edificación' })
    const infraestructura = await crearEmpresa({ nombre: 'Infraestructura' })

    const { token } = await crearEmpleadoConSesion({
      nombre: 'Admin Edificación',
      empresa: edificacion
    })

    const propio = await crearEmpleado({ nombre: 'Propio De Edificación' })
    await adscribir(edificacion, propio)

    const ajeno = await crearEmpleado({ nombre: 'Ajeno De Infraestructura' })
    await adscribir(infraestructura, ajeno)

    // Sin ninguna adscripción: sólo visible para el admin de plataforma.
    await crearEmpleado({ nombre: 'Sin Empresa' })

    const res = await request(app).get(RUTA).set(auth(token))

    expect(res.status).toBe(200)
    const nombres = res.body.data.empleados.map((e) => e.empleado.nombre)
    expect(nombres).toContain('Propio De Edificación')
    expect(nombres).toContain('Admin Edificación')
    expect(nombres).not.toContain('Ajeno De Infraestructura')
    expect(nombres).not.toContain('Sin Empresa')
  })

  it('una persona adscrita a dos empresas es visible desde las dos', async () => {
    const a = await crearEmpresa({ nombre: 'Empresa A' })
    const b = await crearEmpresa({ nombre: 'Empresa B' })

    const compartida = await crearEmpleado({ nombre: 'Persona Compartida' })
    await adscribir(a, compartida, { areas: ['operaciones_urbanizadora'] })
    await adscribir(b, compartida, { areas: ['costos_y_presupuestos'] })

    const desdeA = await crearEmpleadoConSesion({ empresa: a })
    const desdeB = await crearEmpleadoConSesion({ empresa: b })

    for (const sesion of [desdeA, desdeB]) {
      const res = await request(app).get(RUTA).set(auth(sesion.token))
      expect(res.body.data.empleados.map((e) => e.empleado.nombre)).toContain(
        'Persona Compartida'
      )
    }
  })

  it('cada empresa ve de esa persona sólo la adscripción que le corresponde', async () => {
    const a = await crearEmpresa({ nombre: 'Empresa A' })
    const b = await crearEmpresa({ nombre: 'Empresa B' })
    const compartida = await crearEmpleado({ nombre: 'Persona Compartida' })
    await adscribir(a, compartida, { areas: ['operaciones_urbanizadora'] })
    await adscribir(b, compartida, { areas: ['comercial'] })

    const { token } = await crearEmpleadoConSesion({ empresa: a })
    const res = await request(app).get(RUTA).set(auth(token))
    const renglon = res.body.data.empleados.find(
      (e) => e.empleado.nombre === 'Persona Compartida'
    )

    expect(renglon.adscripciones).toHaveLength(1)
    expect(renglon.adscripciones[0].empresaNombre).toBe('Empresa A')
    expect(renglon.adscripciones[0].areas).toEqual(['operaciones_urbanizadora'])
  })

  it('pedir el detalle de alguien de otra empresa responde 404, no 403', async () => {
    const propia = await crearEmpresa()
    const otra = await crearEmpresa()
    const { token } = await crearEmpleadoConSesion({ empresa: propia })

    const ajeno = await crearEmpleado()
    await adscribir(otra, ajeno)

    const res = await request(app).get(`${RUTA}/${ajeno._id}`).set(auth(token))
    expect(res.status).toBe(404)
  })

  it('mandar empresaId de otra empresa no amplía el alcance: 404', async () => {
    const propia = await crearEmpresa()
    const otra = await crearEmpresa()
    const { token } = await crearEmpleadoConSesion({ empresa: propia })
    const ajeno = await crearEmpleado({ nombre: 'Ajeno' })
    await adscribir(otra, ajeno)

    const res = await request(app).get(`${RUTA}?empresaId=${otra._id}`).set(auth(token))

    expect(res.status).toBe(404)
    expect(res.body.message).toMatch(/empresa no existe/i)
  })

  it('una adscripción dada de baja deja de dar visibilidad', async () => {
    const empresa = await crearEmpresa()
    const { token } = await crearEmpleadoConSesion({ empresa })

    const excompanero = await crearEmpleado({ nombre: 'Ya No Trabaja Aquí' })
    await adscribir(empresa, excompanero, {
      activo: false,
      motivoBaja: 'Renuncia voluntaria'
    })

    const res = await request(app).get(RUTA).set(auth(token))
    // Su adscripción está inactiva, así que ya no aparece en el listado.
    expect(res.body.data.empleados.map((e) => e.empleado.nombre)).not.toContain(
      'Ya No Trabaja Aquí'
    )
  })

  it('el administrador de plataforma ve a todos, con y sin empresa', async () => {
    const empresa = await crearEmpresa()
    const { token } = await crearEmpleadoConSesion({
      alcanceGlobal: true,
      sinAdscripcion: true
    })

    const conEmpresa = await crearEmpleado({ nombre: 'Con Empresa' })
    await adscribir(empresa, conEmpresa)
    await crearEmpleado({ nombre: 'Sin Empresa' })

    const res = await request(app).get(RUTA).set(auth(token))
    const nombres = res.body.data.empleados.map((e) => e.empleado.nombre)

    expect(nombres).toContain('Con Empresa')
    expect(nombres).toContain('Sin Empresa')
  })

  describe('jefe de área', () => {
    it('sólo ve a la gente de sus áreas, dentro de su empresa', async () => {
      const empresa = await crearEmpresa()
      const { token } = await crearEmpleadoConSesion({
        nivelAcceso: 'jefe_area',
        empresa,
        areas: ['operaciones_urbanizadora']
      })

      const suArea = await crearEmpleado({ nombre: 'De Obra' })
      await adscribir(empresa, suArea, { areas: ['operaciones_urbanizadora'] })
      const otraArea = await crearEmpleado({ nombre: 'De Ventas' })
      await adscribir(empresa, otraArea, { areas: ['comercial'] })

      const res = await request(app).get(RUTA).set(auth(token))
      const nombres = res.body.data.empleados.map((e) => e.empleado.nombre)

      expect(nombres).toContain('De Obra')
      expect(nombres).not.toContain('De Ventas')
    })

    it('un jefe de área sin áreas asignadas no ve nada, en vez de verlo todo', async () => {
      const empresa = await crearEmpresa()
      const { token } = await crearEmpleadoConSesion({
        nivelAcceso: 'jefe_area',
        empresa,
        areas: []
      })
      const alguien = await crearEmpleado({ nombre: 'Alguien' })
      await adscribir(empresa, alguien, { areas: ['operaciones_urbanizadora'] })

      const res = await request(app).get(RUTA).set(auth(token))
      expect(res.body.data.empleados).toEqual([])
      expect(res.body.data.total).toBe(0)
    })
  })
})

describe('GET /empleados — filtros, orden y paginación', () => {
  const prepararEquipo = async () => {
    const empresa = await crearEmpresa()
    const sesion = await crearEmpleadoConSesion({ nombre: 'AAA Admin', empresa })

    for (const nombre of ['Bruno Vega', 'Ávila Rocío', 'Zulema Gómez']) {
      const persona = await crearEmpleado({ nombre })
      await adscribir(empresa, persona, { areas: ['operaciones_urbanizadora'] })
    }
    return { empresa, ...sesion }
  }

  it('devuelve total, pagina y porPagina, y corta la página después de ordenar', async () => {
    const { token } = await prepararEquipo()

    const primera = await request(app)
      .get(`${RUTA}?pagina=1&porPagina=2`)
      .set(auth(token))
    const segunda = await request(app)
      .get(`${RUTA}?pagina=2&porPagina=2`)
      .set(auth(token))

    expect(primera.body.data).toMatchObject({ total: 4, pagina: 1, porPagina: 2 })
    expect(primera.body.data.empleados).toHaveLength(2)
    expect(segunda.body.data.empleados).toHaveLength(2)
    // Sin repetidos entre páginas.
    const ids = [
      ...primera.body.data.empleados.map((e) => e.empleado._id),
      ...segunda.body.data.empleados.map((e) => e.empleado._id)
    ]
    expect(new Set(ids).size).toBe(4)
  })

  it('una página más allá del final devuelve lista vacía y el total real', async () => {
    const { token } = await prepararEquipo()
    const res = await request(app).get(`${RUTA}?pagina=99`).set(auth(token))

    expect(res.status).toBe(200)
    expect(res.body.data.empleados).toEqual([])
    expect(res.body.data.total).toBe(4)
  })

  it('ordena por nombre en los dos sentidos, ignorando acentos', async () => {
    const { token } = await prepararEquipo()

    const asc = await request(app).get(`${RUTA}?orden=nombre_asc`).set(auth(token))
    const desc = await request(app).get(`${RUTA}?orden=nombre_desc`).set(auth(token))

    const nombresAsc = asc.body.data.empleados.map((e) => e.empleado.nombre)
    expect(nombresAsc).toEqual(['AAA Admin', 'Ávila Rocío', 'Bruno Vega', 'Zulema Gómez'])
    expect(desc.body.data.empleados.map((e) => e.empleado.nombre)).toEqual(
      [...nombresAsc].reverse()
    )
  })

  it('busca por nombre ignorando acentos y con coincidencia parcial', async () => {
    const { token } = await prepararEquipo()

    const res = await request(app).get(`${RUTA}?busqueda=gomez`).set(auth(token))
    expect(res.body.data.empleados.map((e) => e.empleado.nombre)).toEqual([
      'Zulema Gómez'
    ])

    const parcial = await request(app).get(`${RUTA}?busqueda=avi`).set(auth(token))
    expect(parcial.body.data.empleados).toHaveLength(1)
  })

  it('busca también por número de empleado (D-51)', async () => {
    const empresa = await crearEmpresa()
    const { token } = await crearEmpleadoConSesion({ empresa })
    const persona = await crearEmpleado({
      nombre: 'Persona Con Número',
      numeroEmpleado: '0042'
    })
    await adscribir(empresa, persona)

    const res = await request(app).get(`${RUTA}?busqueda=0042`).set(auth(token))
    expect(res.body.data.empleados.map((e) => e.empleado.nombre)).toEqual([
      'Persona Con Número'
    ])

    const sinCoincidencia = await request(app)
      .get(`${RUTA}?busqueda=9999`)
      .set(auth(token))
    expect(sinCoincidencia.body.data.empleados).toEqual([])
  })

  it('filtra por tipo y por soloConAcceso', async () => {
    const empresa = await crearEmpresa()
    const { token } = await crearEmpleadoConSesion({ empresa })
    const obrero = await crearEmpleado({ nombre: 'Obrero Uno', tipo: 'mano_de_obra' })
    await adscribir(empresa, obrero)

    const porTipo = await request(app).get(`${RUTA}?tipo=mano_de_obra`).set(auth(token))
    const conAcceso = await request(app)
      .get(`${RUTA}?soloConAcceso=true`)
      .set(auth(token))

    expect(porTipo.body.data.empleados.map((e) => e.empleado.nombre)).toEqual([
      'Obrero Uno'
    ])
    // Sólo el administrador de la sesión tiene acceso.
    expect(conAcceso.body.data.empleados).toHaveLength(1)
    expect(conAcceso.body.data.empleados[0].empleado.acceso).not.toBeNull()
  })

  it('oculta a los dados de baja por defecto; activo=false trae sólo esos, sin mezclar (D-51)', async () => {
    const empresa = await crearEmpresa()
    const { token } = await crearEmpleadoConSesion({ empresa })
    const inactivo = await crearEmpleado({
      nombre: 'Dado De Baja',
      activo: false,
      motivoBaja: 'Renuncia'
    })
    await adscribir(empresa, inactivo)

    const porDefecto = await request(app).get(RUTA).set(auth(token))
    const soloBajas = await request(app).get(`${RUTA}?activo=false`).set(auth(token))
    const todos = await request(app).get(`${RUTA}?activo=todos`).set(auth(token))

    expect(porDefecto.body.data.empleados.map((e) => e.empleado.nombre)).not.toContain(
      'Dado De Baja'
    )

    // Exclusivo: sólo el dado de baja, sin mezclar con la sesión (activa).
    expect(soloBajas.body.data.empleados.map((e) => e.empleado.nombre)).toEqual([
      'Dado De Baja'
    ])

    expect(todos.body.data.empleados.map((e) => e.empleado.nombre)).toContain(
      'Dado De Baja'
    )
  })

  it('la respuesta trae la forma definitiva del contrato', async () => {
    const { token, empresa } = await prepararEquipo()
    const res = await request(app).get(`${RUTA}?porPagina=1`).set(auth(token))
    const renglon = res.body.data.empleados[0]

    expect(renglon).toMatchObject({
      categoriaNombre: expect.any(String),
      asignaciones: [],
      avanceExpediente: null,
      expedienteId: null
    })
    expect(renglon.empleado._id).toEqual(expect.any(String))
    expect(renglon.adscripciones[0].empresaId).toBe(empresa._id.toString())
    // Nada de campos internos ni secretos.
    expect(renglon.empleado.nombreNormalizado).toBeUndefined()
    expect(JSON.stringify(renglon)).not.toMatch(/\$2[aby]\$/)
  })

  it('valida los parámetros con mensajes en español', async () => {
    const { token } = await prepararEquipo()
    const malos = [
      `${RUTA}?pagina=0`,
      `${RUTA}?porPagina=500`,
      `${RUTA}?orden=por_fecha`,
      `${RUTA}?tipo=inventado`,
      `${RUTA}?area=taller`,
      `${RUTA}?soloConAcceso=quizas`,
      `${RUTA}?categoriaId=no-es-id`,
      `${RUTA}?activo=quizas`
    ]

    for (const ruta of malos) {
      const res = await request(app).get(ruta).set(auth(token))
      expect(res.status).toBe(400)
      expect(res.body.errors[0].msg).not.toBe('Invalid value')
    }
  })

  it('filtra por categoriaId', async () => {
    const empresa = await crearEmpresa()
    const { token } = await crearEmpleadoConSesion({ empresa })
    const categoriaAlbanil = await crearCategoria('Albañil', 'mano_de_obra')
    const albanil = await crearEmpleado({
      nombre: 'Albañil Uno',
      categoriaId: categoriaAlbanil._id
    })
    await adscribir(empresa, albanil)

    const res = await request(app)
      .get(`${RUTA}?categoriaId=${categoriaAlbanil._id}`)
      .set(auth(token))

    expect(res.body.data.empleados.map((e) => e.empleado.nombre)).toEqual(['Albañil Uno'])
  })

  describe('orden por número de empleado (D-50)', () => {
    it('ordena sin empresaId, aunque sean de empresas distintas (D-53)', async () => {
      const empresaA = await crearEmpresa({ nombre: 'Empresa A' })
      const empresaB = await crearEmpresa({ nombre: 'Empresa B' })
      const { token } = await crearEmpleadoConSesion({
        alcanceGlobal: true,
        sinAdscripcion: true
      })

      for (const [nombre, numeroEmpleado, empresa] of [
        ['Persona Seis', '0006', empresaB],
        ['Persona Dos', '0002', empresaA],
        ['Persona Cinco', '0005', empresaA]
      ]) {
        const persona = await crearEmpleado({ nombre, numeroEmpleado })
        await adscribir(empresa, persona)
      }

      const nuestras = ['Persona Dos', 'Persona Cinco', 'Persona Seis']
      const ordenados = async (orden) => {
        const res = await request(app).get(`${RUTA}?orden=${orden}`).set(auth(token))
        expect(res.status).toBe(200)
        return res.body.data.empleados
          .map((e) => e.empleado.nombre)
          .filter((nombre) => nuestras.includes(nombre))
      }

      expect(await ordenados('numero_asc')).toEqual(nuestras)
      expect(await ordenados('numero_desc')).toEqual([...nuestras].reverse())
    })

    it('manda al final a quien no tiene número, en los dos sentidos', async () => {
      const empresa = await crearEmpresa()
      const { token } = await crearEmpleadoConSesion({
        alcanceGlobal: true,
        sinAdscripcion: true
      })

      const conNumero = await crearEmpleado({
        nombre: 'Con Numero',
        numeroEmpleado: '0007'
      })
      await adscribir(empresa, conNumero)
      const sinNumero = await crearEmpleado({ nombre: 'Sin Numero' })
      await adscribir(empresa, sinNumero)

      for (const orden of ['numero_asc', 'numero_desc']) {
        const res = await request(app).get(`${RUTA}?orden=${orden}`).set(auth(token))
        const nombres = res.body.data.empleados.map((e) => e.empleado.nombre)
        // El único con número encabeza; el resto (sin número, la sesión incluida)
        // queda detrás.
        expect(nombres[0]).toBe('Con Numero')
        expect(nombres).toContain('Sin Numero')
      }
    })

    it('ordena por numeroEmpleado en los dos sentidos, dentro de una empresa', async () => {
      const empresa = await crearEmpresa()
      // Sin adscripción propia: si no, la sesión también saldría en el listado
      // con `numeroEmpleado: null` y descuadraría el orden esperado.
      const { token } = await crearEmpleadoConSesion({
        alcanceGlobal: true,
        sinAdscripcion: true
      })

      for (const [nombre, numeroEmpleado] of [
        ['Persona C', '0003'],
        ['Persona A', '0001'],
        ['Persona B', '0002']
      ]) {
        const persona = await crearEmpleado({ nombre, numeroEmpleado })
        await adscribir(empresa, persona)
      }

      const asc = await request(app)
        .get(`${RUTA}?empresaId=${empresa._id}&orden=numero_asc`)
        .set(auth(token))
      const desc = await request(app)
        .get(`${RUTA}?empresaId=${empresa._id}&orden=numero_desc`)
        .set(auth(token))

      const numerosAsc = asc.body.data.empleados.map((e) => e.empleado.numeroEmpleado)
      expect(numerosAsc).toEqual(['0001', '0002', '0003'])
      expect(desc.body.data.empleados.map((e) => e.empleado.numeroEmpleado)).toEqual(
        [...numerosAsc].reverse()
      )
    })
  })
})
