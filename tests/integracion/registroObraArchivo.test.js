const request = require('supertest')
const app = require('../../src/app')
const {
  crearEmpleadoConSesion,
  crearEmpleado,
  crearCliente,
  crearCategoria,
  agregarACartera,
  crearRegistroPatronal,
  crearRegistroObra,
  adscribir,
  asignar,
  auth
} = require('../helpers/factories')

/**
 * Dónde aparece —y dónde NO— la llave `archivo` (D-79).
 *
 * `findRegistry` resuelve los dos registros con la misma forma, así que al darle
 * archivo al de obra es fácil metérselo también al **patronal**, que no tiene
 * ese campo. Eso no rompe ninguna prueba: sólo agrega una llave que el front
 * empieza a leer y que nadie pidió.
 *
 * Por eso esta prueba no mira una respuesta: **recorre el JSON entero** de todas
 * las que devuelven registros y afirma en qué rutas aparece la llave. Una fuga
 * nueva aparece como una ruta de más, aunque nadie haya escrito una aserción
 * para ella.
 */
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)])

/** Todas las rutas del JSON donde aparece la llave `archivo`. */
function rutasConArchivo(valor, ruta = '', encontradas = []) {
  if (Array.isArray(valor)) {
    valor.forEach((v, i) => rutasConArchivo(v, `${ruta}[${i}]`, encontradas))
  } else if (valor && typeof valor === 'object') {
    for (const [clave, v] of Object.entries(valor)) {
      const aqui = ruta ? `${ruta}.${clave}` : clave
      if (clave === 'archivo') encontradas.push(aqui)
      rutasConArchivo(v, aqui, encontradas)
    }
  }
  return encontradas
}

describe('la llave `archivo` sólo cuelga del registro de OBRA', () => {
  it('recorre el JSON de todas las respuestas que devuelven registros', async () => {
    const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
    const { token, empresa } = sesion
    const cliente = await crearCliente({ nombre: 'Constructora Sonda' })
    await agregarACartera(empresa, cliente)
    const categoria = await crearCategoria(undefined, 'mano_de_obra')
    const registroPatronal = await crearRegistroPatronal(empresa)
    const registroObra = await crearRegistroObra(cliente)

    // Un registro de obra CON archivo: si algo se contagia, se ve aquí.
    await request(app)
      .patch(`/api/v1/clientes/${cliente._id}/registros-obra/${registroObra._id}`)
      .set(auth(token))
      .attach('archivo', PDF, 'escaneo.pdf')

    const proyecto = await request(app)
      .post('/api/v1/proyectos')
      .set(auth(token))
      .send({
        empresaId: empresa._id.toString(),
        clienteId: cliente._id.toString(),
        nombre: 'Torre Sonda',
        fechaInicio: '2026-09-01',
        fechaFinEstimada: '2027-06-30',
        categorias: [categoria._id.toString()],
        registroPatronalId: registroPatronal._id.toString(),
        registroObraId: registroObra._id.toString()
      })
    const proyectoId = proyecto.body.data.proyecto._id

    const persona = await crearEmpleado({
      nombre: 'Ana Ruiz Sonda',
      tipo: 'mano_de_obra',
      categoriaId: categoria._id
    })
    await adscribir(empresa, persona, { areas: ['operaciones_urbanizadora'] })
    const asignacion = await asignar({ _id: proyectoId }, persona, categoria._id)

    const respuestas = {
      'GET /empresas/:id': `/api/v1/empresas/${empresa._id}`,
      'GET /empresas': '/api/v1/empresas',
      'GET /proyectos/:id': `/api/v1/proyectos/${proyectoId}`,
      'GET /proyectos': '/api/v1/proyectos',
      'GET /asignaciones/:id': `/api/v1/asignaciones/${asignacion._id}`,
      'GET /proyectos/:id/asignaciones': `/api/v1/proyectos/${proyectoId}/asignaciones`,
      'GET /clientes/:id': `/api/v1/clientes/${cliente._id}`,
      'GET /adscripciones': `/api/v1/adscripciones?empresaId=${empresa._id}`
    }

    const informe = {}
    for (const [nombre, ruta] of Object.entries(respuestas)) {
      const res = await request(app).get(ruta).set(auth(token))
      informe[nombre] = {
        status: res.status,
        archivoEn: rutasConArchivo(res.body.data)
      }
    }

    /*
     * Las rutas EXACTAS, no un «no contiene patronal»: así, si mañana aparece
     * `archivo` en un sitio nuevo —el que sea—, esto falla y hay que decidirlo
     * a propósito en vez de enterarse por el front.
     */
    expect(informe).toEqual({
      // Aquí viven los registros PATRONALES: ninguna llave `archivo`.
      'GET /empresas/:id': { status: 200, archivoEn: [] },
      'GET /empresas': { status: 200, archivoEn: [] },
      // El renglón de la asignación lleva el registro patronal como texto.
      'GET /proyectos/:id/asignaciones': { status: 200, archivoEn: [] },
      // No existe listado global de adscripciones; se consulta para que, si
      // algún día existe, esta prueba obligue a mirarlo.
      'GET /adscripciones': { status: 404, archivoEn: [] },

      // Y donde sí aplica, exactamente una vez y colgando del de obra.
      'GET /proyectos/:id': { status: 200, archivoEn: ['proyecto.registroObra.archivo'] },
      'GET /proyectos': {
        status: 200,
        archivoEn: ['proyectos[0].registroObra.archivo']
      },
      'GET /asignaciones/:id': {
        status: 200,
        archivoEn: ['trazabilidad.registroObra.archivo']
      },
      'GET /clientes/:id': {
        status: 200,
        archivoEn: ['cliente.registrosObra[0].archivo']
      }
    })
  }, 60000)
})
