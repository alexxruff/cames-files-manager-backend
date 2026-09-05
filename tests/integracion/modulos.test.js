const request = require('supertest')
const app = require('../../src/app')
const Machine = require('../../src/api/v1/machines/machineModel')
const MachineIncident = require('../../src/api/v1/machineIncidents/machineIncidentModel')
const IncidentType = require('../../src/api/v1/incidentTypes/incidentTypeModel')
const {
  crearEmpresa,
  crearEmpleadoConSesion,
  adscribir,
  auth
} = require('../helpers/factories')

/**
 * Los módulos activos de cada empresa (D-95).
 *
 * Lo que vigilan estas pruebas es el eje entero: que apagar una sección la
 * apague **para toda la empresa y para todos**, incluido el administrador de
 * plataforma; que responda **404** —lo que no está activo no existe— y no un
 * error propio; que **no borre nada**, y que quien está en dos empresas siga
 * viendo la sección en la que sí la tiene.
 */
const MODULOS = '/api/v1/modulos'
const EMPRESAS = '/api/v1/empresas'
const MAQUINAS = '/api/v1/maquinas'
const TIPOS = '/api/v1/tipos-incidencia'
const SUBIDAS = '/api/v1/subidas'

const apagarMaquinaria = (e, empresaId) =>
  request(app)
    .patch(`${EMPRESAS}/${empresaId}/modulos`)
    .set(auth(e.token))
    .send({
      modulos: [
        'empresas',
        'personal',
        'expedientes',
        'proyectos',
        'clientes',
        'plataforma'
      ]
    })

const encenderTodo = (e, empresaId) =>
  request(app)
    .patch(`${EMPRESAS}/${empresaId}/modulos`)
    .set(auth(e.token))
    .send({
      modulos: [
        'empresas',
        'personal',
        'expedientes',
        'proyectos',
        'clientes',
        'maquinaria',
        'plataforma'
      ]
    })

async function crearMaquina(e, empresaId, datos = {}) {
  const res = await request(app)
    .post(`${EMPRESAS}/${empresaId}/maquinas`)
    .set(auth(e.token))
    .send({ identificador: 'ECO-12', modelo: 'CAT 320D', ...datos })
  expect(res.status).toBe(201)
  return res.body.data.maquina
}

/** Administrador de plataforma: es quien decide los módulos de una empresa. */
const adminDePlataforma = (extra = {}) =>
  crearEmpleadoConSesion({ nivelAcceso: 'rh_admin', alcanceGlobal: true, ...extra })

describe('Los módulos de cada empresa', () => {
  beforeAll(async () => {
    await Machine.init()
    await IncidentType.init()
    await MachineIncident.init()
  })

  describe('el catálogo', () => {
    it('dice qué módulos existen y cuáles se pueden apagar', async () => {
      const e = await crearEmpleadoConSesion({ nivelAcceso: 'rh_consulta' })

      const res = await request(app).get(MODULOS).set(auth(e.token))

      expect(res.status).toBe(200)
      const claves = res.body.data.modulos.map((m) => m.clave)
      expect(claves).toEqual([
        'empresas',
        'personal',
        'expedientes',
        'proyectos',
        'clientes',
        'maquinaria',
        'plataforma'
      ])

      const opcionales = res.body.data.modulos.filter((m) => m.opcional)
      expect(opcionales).toHaveLength(1)
      expect(opcionales[0]).toMatchObject({
        clave: 'maquinaria',
        etiqueta: 'Maquinaria',
        opcional: true
      })
    })

    it('sin sesión no responde', async () => {
      const res = await request(app).get(MODULOS)
      expect(res.status).toBe(401)
    })
  })

  describe('las empresas que ya existen', () => {
    it('siguen con todos los módulos activos, sin tocar un dato', async () => {
      const e = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })

      const res = await request(app)
        .get(`${EMPRESAS}/${e.empresa._id}`)
        .set(auth(e.token))

      expect(res.status).toBe(200)
      expect(res.body.data.empresa.modulos).toContain('maquinaria')
    })
  })

  describe('elegirlos', () => {
    it('se eligen desde el alta de la empresa', async () => {
      const e = await adminDePlataforma()

      const res = await request(app)
        .post(EMPRESAS)
        .set(auth(e.token))
        .send({ nombre: 'Constructora Sin Máquinas', modulos: ['personal', 'proyectos'] })

      expect(res.status).toBe(201)
      expect(res.body.data.empresa.modulos).not.toContain('maquinaria')
      // Los obligatorios están activos aunque no vinieran en la lista.
      expect(res.body.data.empresa.modulos).toEqual(
        expect.arrayContaining(['empresas', 'personal', 'expedientes', 'clientes'])
      )
    })

    it('sin decir nada, la empresa nueva nace con todo activo', async () => {
      const e = await adminDePlataforma()

      const res = await request(app)
        .post(EMPRESAS)
        .set(auth(e.token))
        .send({ nombre: 'Constructora Completa' })

      expect(res.status).toBe(201)
      expect(res.body.data.empresa.modulos).toContain('maquinaria')
    })

    it('se pueden cambiar después', async () => {
      const e = await adminDePlataforma()

      const res = await apagarMaquinaria(e, e.empresa._id)

      expect(res.status).toBe(200)
      expect(res.body.data.empresa.modulos).not.toContain('maquinaria')
      expect(res.body.data.modulos.find((m) => m.clave === 'maquinaria')).toMatchObject({
        activo: false,
        opcional: true
      })
    })

    it('los obligatorios siguen activos aunque se manden fuera de la lista', async () => {
      const e = await adminDePlataforma()

      const res = await request(app)
        .patch(`${EMPRESAS}/${e.empresa._id}/modulos`)
        .set(auth(e.token))
        .send({ modulos: [] })

      expect(res.status).toBe(200)
      const apagados = res.body.data.modulos.filter((m) => !m.activo).map((m) => m.clave)
      expect(apagados).toEqual(['maquinaria'])
    })

    it('un módulo inventado no se guarda', async () => {
      const e = await adminDePlataforma()

      const res = await request(app)
        .patch(`${EMPRESAS}/${e.empresa._id}/modulos`)
        .set(auth(e.token))
        .send({ modulos: ['personal', 'contabilidad'] })

      expect(res.status).toBe(400)
      expect(res.body.errors[0].msg).toBe('Estos módulos no existen: contabilidad')
    })

    it('sólo el administrador de plataforma los decide', async () => {
      const admin = await adminDePlataforma()
      const otro = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_admin',
        empresa: admin.empresa
      })

      const res = await apagarMaquinaria(otro, admin.empresa._id)

      expect(res.status).toBe(403)
      expect(res.body.message).toBe('No tienes permiso para realizar esta acción')
    })

    it('no se cuelan por el PATCH de la empresa', async () => {
      const e = await adminDePlataforma()

      const res = await request(app)
        .patch(`${EMPRESAS}/${e.empresa._id}`)
        .set(auth(e.token))
        .send({ modulos: ['personal'] })

      expect(res.status).toBe(400)
      expect(res.body.errors[0].msg).toContain('PATCH /empresas/:id/modulos')
    })
  })

  describe('antes de apagarlo se dice cuánto hay dentro', () => {
    it('cuenta las máquinas y las incidencias de esa empresa', async () => {
      const e = await adminDePlataforma()
      const maquina = await crearMaquina(e, e.empresa._id)

      const tipo = await request(app)
        .post(TIPOS)
        .set(auth(e.token))
        .send({ nombre: 'Falla hidráulica' })
      await request(app)
        .post(`${MAQUINAS}/${maquina._id}/incidencias`)
        .set(auth(e.token))
        .send({
          tipoId: tipo.body.data.tipo._id,
          descripcion: 'Botó aceite por la manguera',
          fechaIncidencia: '2026-08-05'
        })

      const res = await request(app)
        .get(`${EMPRESAS}/${e.empresa._id}/modulos`)
        .set(auth(e.token))

      expect(res.status).toBe(200)
      const maquinaria = res.body.data.modulos.find((m) => m.clave === 'maquinaria')
      expect(maquinaria.contenido).toEqual([
        { clave: 'maquinas', etiqueta: 'máquina', total: 1 },
        { clave: 'incidencias', etiqueta: 'incidencia', total: 1 }
      ])
    })

    it('los obligatorios no traen conteo: no se pueden apagar', async () => {
      const e = await adminDePlataforma()

      const res = await request(app)
        .get(`${EMPRESAS}/${e.empresa._id}/modulos`)
        .set(auth(e.token))

      const personal = res.body.data.modulos.find((m) => m.clave === 'personal')
      expect(personal).toMatchObject({ opcional: false, activo: true, contenido: [] })
    })

    it('la empresa de otro no existe', async () => {
      const e = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin' })
      const ajena = await crearEmpresa({ nombre: 'Empresa Ajena' })

      const res = await request(app)
        .get(`${EMPRESAS}/${ajena._id}/modulos`)
        .set(auth(e.token))

      expect(res.status).toBe(404)
      expect(res.body.message).toBe('La empresa no existe')
    })
  })

  describe('un módulo apagado no responde', () => {
    async function conMaquinariaApagada() {
      const admin = await adminDePlataforma()
      const maquina = await crearMaquina(admin, admin.empresa._id)

      // Quien trabaja en esa empresa, sin alcance global.
      const usuario = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_admin',
        empresa: admin.empresa
      })

      expect((await apagarMaquinaria(admin, admin.empresa._id)).status).toBe(200)
      return { admin, usuario, maquina }
    }

    it('el catálogo de la empresa contesta 404', async () => {
      const { usuario, admin } = await conMaquinariaApagada()

      const res = await request(app)
        .get(`${EMPRESAS}/${admin.empresa._id}/maquinas`)
        .set(auth(usuario.token))

      expect(res.status).toBe(404)
      expect(res.body.message).toBe('La sección de maquinaria no existe')
    })

    it('tampoco se da de alta una máquina', async () => {
      const { usuario, admin } = await conMaquinariaApagada()

      const res = await request(app)
        .post(`${EMPRESAS}/${admin.empresa._id}/maquinas`)
        .set(auth(usuario.token))
        .send({ identificador: 'ECO-99', modelo: 'CAT 320D' })

      expect(res.status).toBe(404)
    })

    it('la máquina que ya existía tampoco se abre por su dirección', async () => {
      const { usuario, maquina } = await conMaquinariaApagada()

      const res = await request(app)
        .get(`${MAQUINAS}/${maquina._id}`)
        .set(auth(usuario.token))

      expect(res.status).toBe(404)
    })

    it('ni siquiera para el administrador de plataforma', async () => {
      const { admin, maquina } = await conMaquinariaApagada()

      const catalogo = await request(app)
        .get(`${EMPRESAS}/${admin.empresa._id}/maquinas`)
        .set(auth(admin.token))
      const ficha = await request(app)
        .get(`${MAQUINAS}/${maquina._id}`)
        .set(auth(admin.token))

      expect(catalogo.status).toBe(404)
      expect(ficha.status).toBe(404)
    })

    it('el catálogo compartido de tipos de incidencia deja de servirle', async () => {
      const { usuario } = await conMaquinariaApagada()

      const res = await request(app).get(TIPOS).set(auth(usuario.token))

      expect(res.status).toBe(404)
      expect(res.body.message).toBe('La sección de maquinaria no existe')
    })

    it('tampoco se firma la subida de la imagen de una máquina', async () => {
      const { usuario, maquina } = await conMaquinariaApagada()

      const res = await request(app)
        .post(SUBIDAS)
        .set(auth(usuario.token))
        .send({
          destino: 'maquina',
          referencia: { maquinaId: maquina._id },
          nombre: 'foto.png',
          mime: 'image/png',
          tamanoBytes: 1024
        })

      expect(res.status).toBe(404)
    })

    it('las secciones obligatorias siguen respondiendo', async () => {
      const { usuario, admin } = await conMaquinariaApagada()

      const res = await request(app)
        .get(`${EMPRESAS}/${admin.empresa._id}`)
        .set(auth(usuario.token))

      expect(res.status).toBe(200)
      expect(res.body.data.empresa.modulos).not.toContain('maquinaria')
    })
  })

  describe('apagar no borra nada', () => {
    it('lo que había vuelve tal cual al encenderlo otra vez', async () => {
      const e = await adminDePlataforma()
      const maquina = await crearMaquina(e, e.empresa._id)

      await apagarMaquinaria(e, e.empresa._id)
      expect(await Machine.countDocuments({ empresaId: e.empresa._id })).toBe(1)

      await encenderTodo(e, e.empresa._id)

      const res = await request(app)
        .get(`${EMPRESAS}/${e.empresa._id}/maquinas`)
        .set(auth(e.token))

      expect(res.status).toBe(200)
      expect(res.body.data.maquinas).toHaveLength(1)
      expect(res.body.data.maquinas[0]._id).toBe(maquina._id)
    })
  })

  describe('quien está en dos empresas', () => {
    it('ve la sección sólo donde está activa', async () => {
      const admin = await adminDePlataforma()
      const otra = await crearEmpresa({ nombre: 'Maquinaria del Grupo' })
      await crearMaquina(admin, admin.empresa._id)

      const usuario = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_admin',
        empresa: admin.empresa
      })
      await adscribir(otra, usuario.empleado)

      const maquinaDeLaOtra = await crearMaquina(admin, otra._id, {
        identificador: 'ECO-77'
      })
      await apagarMaquinaria(admin, admin.empresa._id)

      const apagada = await request(app)
        .get(`${EMPRESAS}/${admin.empresa._id}/maquinas`)
        .set(auth(usuario.token))
      const encendida = await request(app)
        .get(`${EMPRESAS}/${otra._id}/maquinas`)
        .set(auth(usuario.token))

      expect(apagada.status).toBe(404)
      expect(encendida.status).toBe(200)
      expect(encendida.body.data.maquinas[0]._id).toBe(maquinaDeLaOtra._id)
    })

    it('la sesión trae los módulos de cada una', async () => {
      const admin = await adminDePlataforma()
      const otra = await crearEmpresa({ nombre: 'Maquinaria del Grupo' })

      const usuario = await crearEmpleadoConSesion({
        nivelAcceso: 'rh_admin',
        empresa: admin.empresa
      })
      await adscribir(otra, usuario.empleado)
      await apagarMaquinaria(admin, admin.empresa._id)

      const res = await request(app).get('/api/v1/auth/me').set(auth(usuario.token))

      expect(res.status).toBe(200)
      const porEmpresa = Object.fromEntries(
        res.body.data.user.empresas.map((e) => [e._id, e.modulos])
      )
      expect(porEmpresa[String(admin.empresa._id)]).not.toContain('maquinaria')
      expect(porEmpresa[String(otra._id)]).toContain('maquinaria')
    })
  })
})
