const fs = require('fs')
const path = require('path')
const request = require('supertest')
const app = require('../../src/app')
const Employee = require('../../src/api/v1/employees/employeeModel')
const Affiliation = require('../../src/api/v1/affiliations/affiliationModel')
const Category = require('../../src/api/v1/categories/categoryModel')
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
const {
  construirArchivo,
  fila,
  identidad,
  COLUMNAS
} = require('../helpers/nominaWorkbook')

/**
 * Importación de colaboradores desde el archivo de nómina (D-46).
 *
 * Los archivos de prueba los genera `tests/helpers/nominaWorkbook.js` con la
 * misma estructura que el reporte real, pero con datos inventados: el archivo
 * real trae CURP, NSS, salarios y cuentas bancarias de 145 personas y no debe
 * vivir en el repo (ahí lo explica con más detalle). Al final hay una prueba que
 * sí lo usa **si está presente**, y se salta si no.
 */

const RFC_EMPRESA = 'MCA180611HF1'

/** Empresa con el mismo RFC que el encabezado del archivo, y una sesión admin. */
const escenario = async ({ nivelAcceso = 'rh_admin' } = {}) => {
  await ensureBaseChecklistTemplates()
  const empresa = await crearEmpresa({ nombre: 'Maquinaria Cames', rfc: RFC_EMPRESA })
  const sesion = await crearEmpleadoConSesion({ nivelAcceso, empresa })
  return { empresa, sesion }
}

/** Genera `cantidad` filas válidas y distintas. */
const filas = (cantidad, ajustes = () => ({})) =>
  Array.from({ length: cantidad }, (_, i) => {
    const { curp, rfc } = identidad(i)
    return fila({
      id: String(1000 + i),
      nombre: `PERSONA${i}`,
      primerApellido: 'PRUEBA',
      segundoApellido: 'IMPORTADA',
      curp,
      rfc,
      ...ajustes(i)
    })
  })

const previsualizar = (token, buffer, campos = {}) => {
  const peticion = request(app)
    .post('/api/v1/empleados/importar/previsualizar')
    .set(auth(token))
  for (const [campo, valor] of Object.entries(campos))
    peticion.field(campo, String(valor))
  return peticion.attach('archivo', buffer, 'nomina.xlsx')
}

const importar = (token, buffer, campos = {}) => {
  const peticion = request(app).post('/api/v1/empleados/importar').set(auth(token))
  for (const [campo, valor] of Object.entries(campos))
    peticion.field(campo, String(valor))
  return peticion.attach('archivo', buffer, 'nomina.xlsx')
}

describe('POST /api/v1/empleados/importar', () => {
  describe('primera importación', () => {
    it('crea a las personas, sus categorías, sus adscripciones y sus expedientes', async () => {
      const { empresa, sesion } = await escenario()
      const archivo = await construirArchivo({
        filas: filas(6, (i) => ({
          puesto: i < 4 ? 'Operador' : 'Analista',
          departamento: i < 4 ? 'Operaciones' : 'Administración',
          contrato: i < 4 ? 'obra_determinada' : 'indeterminado'
        }))
      })

      const res = await importar(sesion.token, archivo, { empresaId: empresa._id })

      expect(res.status).toBe(201)
      expect(res.body.data.aplicado).toBe(true)
      expect(res.body.data.resumen).toMatchObject({
        filas: 6,
        nuevos: 6,
        yaExisten: 0,
        conError: 0
      })

      // Dos categorías nuevas: Operador (mano de obra) y Analista (administrativo).
      expect(res.body.data.categoriasNuevas).toEqual(
        expect.arrayContaining([
          { nombre: 'Operador', tipo: 'mano_de_obra', filas: 4 },
          { nombre: 'Analista', tipo: 'administrativo', filas: 2 }
        ])
      )
      expect(await Category.countDocuments({ nombreNormalizado: 'operador' })).toBe(1)

      const importadas = await Employee.find({ nombre: /PERSONA/ })
      expect(importadas).toHaveLength(6)
      expect(await Affiliation.countDocuments({ empresaId: empresa._id })).toBe(7) // +1: el admin de la sesión
      // El expediente nace con la persona, igual que en `POST /empleados`.
      expect(
        await Record.countDocuments({ empleadoId: { $in: importadas.map((e) => e._id) } })
      ).toBe(6)
    })

    it('guarda las fechas del archivo sin correrlas un día (D-09)', async () => {
      const { empresa, sesion } = await escenario()
      const archivo = await construirArchivo({
        filas: filas(1, () => ({
          fechaIngreso: '2021-09-20',
          fechaNacimiento: '1982-05-25'
        }))
      })

      await importar(sesion.token, archivo, { empresaId: empresa._id })

      const persona = await Employee.findOne({ nombre: /PERSONA0/ })
      const adscripcion = await Affiliation.findOne({ empleadoId: persona._id })
      expect(persona.fechaNacimiento).toBe('1982-05-25')
      expect(adscripcion.fechaIngreso).toBe('2021-09-20')
    })

    it('los contratos temporales entran sin fecha de término, marcados como pendientes', async () => {
      const { empresa, sesion } = await escenario()
      const archivo = await construirArchivo({
        filas: filas(2, (i) => ({
          contrato: i === 0 ? 'obra_determinada' : 'indeterminado'
        }))
      })

      const res = await importar(sesion.token, archivo, { empresaId: empresa._id })

      expect(res.body.data.resumen.nuevos).toBe(2)
      expect(res.body.data.avisos.join(' ')).toContain('SIN fecha de término')

      const temporal = await Employee.findOne({ nombre: 'PERSONA0 PRUEBA IMPORTADA' })
      const suya = await Affiliation.findOne({ empleadoId: temporal._id })
      expect(suya.tipoContrato).toBe('obra_determinada')
      expect(suya.fechaTerminoContrato).toBeNull()
      expect(suya.datosPendientes).toEqual(['fechaTerminoContrato'])
    })

    it('los que vienen de Baja entran dados de baja de la empresa, con motivo', async () => {
      const { empresa, sesion } = await escenario()
      const archivo = await construirArchivo({
        filas: filas(2, (i) => ({ estatus: i === 0 ? 'Baja' : 'Alta' }))
      })

      await importar(sesion.token, archivo, { empresaId: empresa._id })

      const baja = await Employee.findOne({ nombre: 'PERSONA0 PRUEBA IMPORTADA' })
      const suya = await Affiliation.findOne({ empleadoId: baja._id })
      expect(suya.activo).toBe(false)
      expect(suya.motivoBaja).toBeTruthy()
      expect(suya.fechaBaja).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      // La persona NO se da de baja del sistema: sólo de esta empresa.
      expect(baja.activo).toBe(true)
    })

    it('Reingreso cuenta como activo, igual que Alta', async () => {
      const { empresa, sesion } = await escenario()
      const archivo = await construirArchivo({
        filas: filas(1, () => ({ estatus: 'Reingreso' }))
      })

      await importar(sesion.token, archivo, { empresaId: empresa._id })

      const persona = await Employee.findOne({ nombre: /PERSONA0/ })
      expect((await Affiliation.findOne({ empleadoId: persona._id })).activo).toBe(true)
    })

    it('conserva el departamento del archivo aunque no sea un área nuestra', async () => {
      const { empresa, sesion } = await escenario()
      const archivo = await construirArchivo({
        filas: filas(1, () => ({ departamento: 'Axis Zapopan', puesto: 'Operador' }))
      })

      const res = await importar(sesion.token, archivo, { empresaId: empresa._id })

      const persona = await Employee.findOne({ nombre: /PERSONA0/ })
      const suya = await Affiliation.findOne({ empleadoId: persona._id })
      expect(suya.departamento).toBe('Axis Zapopan')
      expect(suya.areas).toEqual(['obra'])
      expect(res.body.data.nuevos[0].avisos.join(' ')).toContain('parece una obra')
    })

    it('guarda la nómina pero NO la devuelve en ninguna respuesta', async () => {
      const { empresa, sesion } = await escenario()
      const archivo = await construirArchivo({
        filas: filas(1, () => ({ salarioDiario: 1146.95, cuenta: '072320010550241376' }))
      })

      await importar(sesion.token, archivo, { empresaId: empresa._id })

      const persona = await Employee.findOne({ nombre: /PERSONA0/ })
      const conNomina = await Affiliation.findOne({ empleadoId: persona._id }).select(
        '+nomina'
      )
      expect(conNomina.nomina.salarioDiario).toBe(1146.95)
      expect(conNomina.nomina.cuenta).toBe('072320010550241376')

      /*
       * Salario y cuenta son datos personales sensibles y hoy los vería
       * cualquiera que pueda ver la adscripción. Se guardan, no se exponen:
       * mientras no se decida quién puede verlos, ninguna respuesta los trae.
       */
      expect(conNomina.toJSON().nomina).toBeUndefined()
      const listado = await request(app)
        .get(`/api/v1/empresas/${empresa._id}/adscripciones`)
        .set(auth(sesion.token))
      expect(JSON.stringify(listado.body)).not.toContain('1146.95')
      expect(JSON.stringify(listado.body)).not.toContain('072320010550241376')
    })
  })

  describe('re-importar el mismo archivo', () => {
    it('la segunda vez no crea nada', async () => {
      const { empresa, sesion } = await escenario()
      const archivo = await construirArchivo({ filas: filas(5) })

      const primera = await importar(sesion.token, archivo, { empresaId: empresa._id })
      expect(primera.body.data.resumen.nuevos).toBe(5)

      const personasTrasPrimera = await Employee.countDocuments({})
      const categoriasTrasPrimera = await Category.countDocuments({})

      const segunda = await importar(sesion.token, archivo, { empresaId: empresa._id })

      expect(segunda.status).toBe(201)
      expect(segunda.body.data.resumen).toMatchObject({
        filas: 5,
        nuevos: 0,
        yaExisten: 5,
        sinCambios: 5,
        conError: 0
      })
      expect(segunda.body.data.categoriasNuevas).toEqual([])
      expect(await Employee.countDocuments({})).toBe(personasTrasPrimera)
      expect(await Category.countDocuments({})).toBe(categoriasTrasPrimera)
      expect(await Affiliation.countDocuments({ empresaId: empresa._id })).toBe(6)
    })

    it('la previsualización dice quiénes se van a sumar antes de tocar la base', async () => {
      const { empresa, sesion } = await escenario()
      const primerArchivo = await construirArchivo({ filas: filas(3) })
      await importar(sesion.token, primerArchivo, { empresaId: empresa._id })

      // El archivo del mes siguiente: los 3 de antes y 2 nuevos.
      const segundoArchivo = await construirArchivo({ filas: filas(5) })
      const vista = await previsualizar(sesion.token, segundoArchivo, {
        empresaId: empresa._id
      })

      expect(vista.status).toBe(200)
      expect(vista.body.data.aplicado).toBe(false)
      expect(vista.body.data.resumen).toMatchObject({ filas: 5, nuevos: 2, yaExisten: 3 })
      expect(vista.body.data.nuevos.map((n) => n.nombre)).toEqual([
        'PERSONA3 PRUEBA IMPORTADA',
        'PERSONA4 PRUEBA IMPORTADA'
      ])
      // Y no escribió nada.
      expect(await Employee.countDocuments({ nombre: /PERSONA/ })).toBe(3)
    })

    it('un Alta que ahora viene como Baja da de baja la adscripción de esa empresa', async () => {
      const { empresa, sesion } = await escenario()
      await importar(sesion.token, await construirArchivo({ filas: filas(1) }), {
        empresaId: empresa._id
      })

      const conBaja = await construirArchivo({
        filas: filas(1, () => ({ estatus: 'Baja' }))
      })
      const res = await importar(sesion.token, conBaja, { empresaId: empresa._id })

      expect(res.body.data.resumen).toMatchObject({ nuevos: 0, seDanDeBaja: 1 })
      const persona = await Employee.findOne({ nombre: /PERSONA0/ })
      const suya = await Affiliation.findOne({ empleadoId: persona._id })
      expect(suya.activo).toBe(false)
      expect(persona.activo).toBe(true)
    })

    it('un Baja que ahora viene como Reingreso reactiva la adscripción', async () => {
      const { empresa, sesion } = await escenario()
      await importar(
        sesion.token,
        await construirArchivo({ filas: filas(1, () => ({ estatus: 'Baja' })) }),
        { empresaId: empresa._id }
      )

      const conReingreso = await construirArchivo({
        filas: filas(1, () => ({ estatus: 'Reingreso' }))
      })
      const res = await importar(sesion.token, conReingreso, { empresaId: empresa._id })

      expect(res.body.data.resumen).toMatchObject({ nuevos: 0, seReactivan: 1 })
      const persona = await Employee.findOne({ nombre: /PERSONA0/ })
      const suya = await Affiliation.findOne({ empleadoId: persona._id })
      expect(suya.activo).toBe(true)
      expect(suya.motivoBaja).toBeNull()
      expect(suya.fechaBaja).toBeNull()
    })

    it('no pisa un dato de la persona que se corrigió a mano', async () => {
      const { empresa, sesion } = await escenario()
      const archivo = await construirArchivo({
        filas: filas(1, () => ({ email: 'viejo@urbacames.com', celular: '3300000000' }))
      })
      await importar(sesion.token, archivo, { empresaId: empresa._id })

      const persona = await Employee.findOne({ nombre: /PERSONA0/ })
      await request(app)
        .patch(`/api/v1/empleados/${persona._id}`)
        .set(auth(sesion.token))
        .send({ email: 'corregido@urbacames.com' })
        .expect(200)

      // El archivo sigue trayendo el correo viejo: no debe deshacer la corrección.
      const res = await importar(sesion.token, archivo, { empresaId: empresa._id })

      expect(res.body.data.resumen.sinCambios).toBe(1)
      expect((await Employee.findById(persona._id)).email).toBe('corregido@urbacames.com')
    })

    it('sí rellena en la persona lo que estaba vacío', async () => {
      const { empresa, sesion } = await escenario()
      await importar(
        sesion.token,
        await construirArchivo({ filas: filas(1, () => ({ email: null })) }),
        { empresaId: empresa._id }
      )
      const persona = await Employee.findOne({ nombre: /PERSONA0/ })
      expect(persona.email).toBeNull()

      const conCorreo = await construirArchivo({
        filas: filas(1, () => ({ email: 'nuevo@urbacames.com' }))
      })
      const res = await importar(sesion.token, conCorreo, { empresaId: empresa._id })

      expect(res.body.data.yaExisten[0].cambios).toContain('email')
      expect((await Employee.findById(persona._id)).email).toBe('nuevo@urbacames.com')
    })

    it('en la relación laboral manda el archivo: contrato, departamento y nómina', async () => {
      const { empresa, sesion } = await escenario()
      await importar(
        sesion.token,
        await construirArchivo({
          filas: filas(1, () => ({
            departamento: 'Operaciones',
            contrato: 'indeterminado',
            salarioDiario: 500
          }))
        }),
        { empresaId: empresa._id }
      )

      const nuevoArchivo = await construirArchivo({
        filas: filas(1, () => ({
          departamento: 'Axis 3',
          contrato: 'obra_determinada',
          salarioDiario: 750
        }))
      })
      const res = await importar(sesion.token, nuevoArchivo, { empresaId: empresa._id })

      expect(res.body.data.resumen.actualizan).toBe(1)
      expect(res.body.data.yaExisten[0].cambios).toEqual(
        expect.arrayContaining(['departamento', 'tipoContrato', 'nomina'])
      )

      const persona = await Employee.findOne({ nombre: /PERSONA0/ })
      const suya = await Affiliation.findOne({ empleadoId: persona._id }).select(
        '+nomina'
      )
      expect(suya.departamento).toBe('Axis 3')
      expect(suya.tipoContrato).toBe('obra_determinada')
      expect(suya.nomina.salarioDiario).toBe(750)
    })

    it('no toca a quien está en la base y ya NO viene en el archivo', async () => {
      const { empresa, sesion } = await escenario()
      await importar(sesion.token, await construirArchivo({ filas: filas(3) }), {
        empresaId: empresa._id
      })

      // El archivo nuevo trae sólo a la primera persona.
      const recortado = await construirArchivo({ filas: filas(3).slice(0, 1) })
      const res = await importar(sesion.token, recortado, { empresaId: empresa._id })

      expect(res.body.data.resumen).toMatchObject({ filas: 1, nuevos: 0, seDanDeBaja: 0 })
      // Las otras dos siguen activas: el archivo no es autoridad para dar de baja.
      const activas = await Affiliation.countDocuments({
        empresaId: empresa._id,
        activo: true
      })
      expect(activas).toBe(4) // 3 importadas + el admin de la sesión
    })

    it('una persona del grupo que ya existe en otra empresa se adscribe, no se duplica', async () => {
      const { empresa, sesion } = await escenario()
      const otraEmpresa = await crearEmpresa({ nombre: 'Urbacames Edificación' })
      const categoria = await crearCategoria('Operador', 'mano_de_obra')
      const { curp, rfc } = identidad(0)
      const yaExiste = await crearEmpleado({
        nombre: 'PERSONA0 PRUEBA IMPORTADA',
        tipo: 'mano_de_obra',
        categoriaId: categoria._id,
        curp
      })
      await Employee.updateOne({ _id: yaExiste._id }, { $set: { rfc } })
      await adscribir(otraEmpresa, yaExiste, { areas: ['obra'] })

      const res = await importar(
        sesion.token,
        await construirArchivo({ filas: filas(1) }),
        {
          empresaId: empresa._id
        }
      )

      expect(res.body.data.resumen).toMatchObject({ nuevos: 0, seAdscriben: 1 })
      expect(await Employee.countDocuments({ curp })).toBe(1)
      // Ahora tiene dos adscripciones, una por empresa. La de la otra, intacta.
      expect(await Affiliation.countDocuments({ empleadoId: yaExiste._id })).toBe(2)
      expect(
        (
          await Affiliation.findOne({
            empleadoId: yaExiste._id,
            empresaId: otraEmpresa._id
          })
        ).activo
      ).toBe(true)
    })

    it('reutiliza la categoría existente aunque el puesto venga con otra escritura', async () => {
      const { empresa, sesion } = await escenario()
      await crearCategoria('Peón', 'mano_de_obra')

      const archivo = await construirArchivo({
        filas: filas(2, () => ({ puesto: 'PEON  ', departamento: 'Operaciones' }))
      })
      const res = await importar(sesion.token, archivo, { empresaId: empresa._id })

      expect(res.body.data.categoriasNuevas).toEqual([])
      expect(await Category.countDocuments({ nombreNormalizado: 'peon' })).toBe(1)
      const persona = await Employee.findOne({ nombre: /PERSONA0/ })
      expect(persona.tipo).toBe('mano_de_obra')
    })

    it('rechaza la fila si el puesto está desactivado, en vez de reactivarlo en silencio', async () => {
      const { empresa, sesion } = await escenario()
      const categoria = await crearCategoria('Operador', 'mano_de_obra')
      await Category.updateOne({ _id: categoria._id }, { $set: { activo: false } })

      const res = await importar(
        sesion.token,
        await construirArchivo({ filas: filas(2, () => ({ puesto: 'Operador' })) }),
        { empresaId: empresa._id }
      )

      expect(res.status).toBe(201)
      expect(res.body.data.resumen).toMatchObject({ nuevos: 0, conError: 2 })
      expect(res.body.data.conError[0].motivo).toContain('está desactivado')
      expect(await Employee.countDocuments({ nombre: /PERSONA/ })).toBe(0)
      // Y la decisión de desactivarla sigue en pie.
      expect((await Category.findById(categoria._id)).activo).toBe(false)
    })

    it('respeta el tipo del catálogo cuando el puesto ya existe con otro', async () => {
      const { empresa, sesion } = await escenario()
      // Alguien decidió que "Residente" es de obra: el catálogo manda sobre la
      // deducción por palabras del puesto.
      await crearCategoria('Residente', 'mano_de_obra')

      const archivo = await construirArchivo({
        filas: filas(1, () => ({ puesto: 'Residente ' }))
      })
      const res = await importar(sesion.token, archivo, { empresaId: empresa._id })

      expect(res.status).toBe(201)
      expect(res.body.data.resumen.conError).toBe(0)
      expect(res.body.data.nuevos[0].tipo).toBe('mano_de_obra')
      expect(res.body.data.nuevos[0].avisos.join(' ')).toContain('se respeta el catálogo')
      expect((await Employee.findOne({ nombre: /PERSONA0/ })).tipo).toBe('mano_de_obra')
    })
  })

  describe('la empresa destino', () => {
    it('avisa y no aplica cuando el RFC del archivo no es el de la empresa', async () => {
      await ensureBaseChecklistTemplates()
      const empresa = await crearEmpresa({
        nombre: 'Otra del grupo',
        rfc: 'UED150101AB1'
      })
      const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin', empresa })
      const archivo = await construirArchivo({ filas: filas(2) })

      const vista = await previsualizar(sesion.token, archivo, { empresaId: empresa._id })
      expect(vista.status).toBe(200)
      expect(vista.body.data.empresa.rfcCoincide).toBe(false)

      const rechazada = await importar(sesion.token, archivo, { empresaId: empresa._id })
      expect(rechazada.status).toBe(409)
      expect(rechazada.body.code).toBe('RFC_DISTINTO')
      expect(rechazada.body.message).toContain('MCA180611HF1')
      expect(await Employee.countDocuments({ nombre: /PERSONA/ })).toBe(0)

      const confirmada = await importar(sesion.token, archivo, {
        empresaId: empresa._id,
        confirmarRfcDistinto: true
      })
      expect(confirmada.status).toBe(201)
      expect(confirmada.body.data.resumen.nuevos).toBe(2)
    })

    it('avisa, pero no bloquea, si la empresa no tiene RFC capturado', async () => {
      await ensureBaseChecklistTemplates()
      const empresa = await crearEmpresa({ nombre: 'Sin RFC' })
      const sesion = await crearEmpleadoConSesion({ nivelAcceso: 'rh_admin', empresa })

      const res = await importar(
        sesion.token,
        await construirArchivo({ filas: filas(1) }),
        {
          empresaId: empresa._id
        }
      )

      expect(res.status).toBe(201)
      expect(res.body.data.empresa.rfcCoincide).toBeNull()
      expect(res.body.data.avisos.join(' ')).toContain('no tiene RFC capturado')
    })

    it('404 con una empresa fuera de su alcance, no 403', async () => {
      const propia = await escenario()
      const ajena = await crearEmpresa({ nombre: 'Empresa ajena', rfc: 'AJE200101XY9' })

      const res = await importar(
        propia.sesion.token,
        await construirArchivo({ filas: filas(1) }),
        {
          empresaId: ajena._id
        }
      )

      expect(res.status).toBe(404)
      expect(res.body.message).toBe('La empresa no existe')
    })
  })

  describe('archivos que no sirven', () => {
    it('400 diciendo qué columnas faltan', async () => {
      const { empresa, sesion } = await escenario()
      const sinCurpNiPuesto = COLUMNAS.filter((c) => c !== 'CURP' && c !== 'Puesto')
      const archivo = await construirArchivo({
        columnas: sinCurpNiPuesto,
        filas: filas(1)
      })

      const res = await importar(sesion.token, archivo, { empresaId: empresa._id })

      expect(res.status).toBe(400)
      expect(res.body.message).toContain('CURP')
      expect(res.body.message).toContain('Puesto')
      expect(res.body.errors[0].msg).toContain('Falta la columna')
    })

    it('415 si lo que se sube no es un .xlsx', async () => {
      const { empresa, sesion } = await escenario()

      const res = await importar(sesion.token, Buffer.from('esto es un PDF, casi'), {
        empresaId: empresa._id
      })

      expect(res.status).toBe(415)
      expect(res.body.message).toContain('.xlsx')
    })

    it('400 si no se adjunta archivo', async () => {
      const { empresa, sesion } = await escenario()

      const res = await request(app)
        .post('/api/v1/empleados/importar')
        .set(auth(sesion.token))
        .field('empresaId', String(empresa._id))

      expect(res.status).toBe(400)
      expect(res.body.message).toContain('archivo')
    })

    it('400 si no se indica la empresa', async () => {
      const { sesion } = await escenario()

      const res = await importar(
        sesion.token,
        await construirArchivo({ filas: filas(1) })
      )

      expect(res.status).toBe(400)
      expect(res.body.errors[0].msg).toContain('empresa')
    })
  })

  describe('filas malas dentro de un archivo bueno', () => {
    it('importa las buenas y reporta las malas con su número de fila', async () => {
      const { empresa, sesion } = await escenario()
      const buenas = filas(2)
      const archivo = await construirArchivo({
        filas: [
          ...buenas,
          fila({ id: '9001', nombre: 'SIN', primerApellido: 'CURP', curp: null }),
          fila({
            id: '9002',
            nombre: 'CONTRATO',
            primerApellido: 'RARO',
            curp: identidad(50).curp,
            rfc: identidad(50).rfc,
            contratoCrudo: 'Convenio de colaboración'
          })
        ]
      })

      const res = await importar(sesion.token, archivo, { empresaId: empresa._id })

      expect(res.status).toBe(201)
      expect(res.body.data.resumen).toMatchObject({ filas: 4, nuevos: 2, conError: 2 })
      // Las filas de datos empiezan en la 6: los encabezados están en la 5.
      expect(res.body.data.conError.map((e) => e.fila)).toEqual([8, 9])
      expect(res.body.data.conError[0].motivo).toContain('CURP')
      expect(res.body.data.conError[1].motivo).toContain('Convenio de colaboración')
      expect(await Employee.countDocuments({ nombre: /PERSONA/ })).toBe(2)
    })

    it('detecta una CURP repetida dentro del mismo archivo', async () => {
      const { empresa, sesion } = await escenario()
      const { curp, rfc } = identidad(0)
      const archivo = await construirArchivo({
        filas: [
          fila({ id: '1', nombre: 'PRIMERA', primerApellido: 'FILA', curp, rfc }),
          fila({ id: '2', nombre: 'SEGUNDA', primerApellido: 'FILA', curp, rfc })
        ]
      })

      const res = await importar(sesion.token, archivo, { empresaId: empresa._id })

      expect(res.body.data.resumen).toMatchObject({ nuevos: 1, conError: 1 })
      expect(res.body.data.conError[0].motivo).toContain('ya viene en la fila 6')
      expect(await Employee.countDocuments({ curp })).toBe(1)
    })
  })

  /*
   * Desde D-54 el número es de la PERSONA y único en todo el grupo, así que deja
   * de ser una llave "dentro de esta empresa": reconoce entre empresas, y puede
   * chocar con alguien de otra.
   */
  describe('el número de trabajador entre empresas (D-54)', () => {
    it('reconoce por número a quien ya se importó en otra empresa', async () => {
      const { empresa, sesion } = await escenario()
      const otraEmpresa = await crearEmpresa({ nombre: 'Otra Del Grupo' })
      // Existe ya, con número, pero sin la CURP de la fila: la única llave que
      // queda es el número.
      const yaExiste = await crearEmpleado({
        nombre: 'YA EXISTE EN EL GRUPO',
        numeroEmpleado: '1000'
      })
      await adscribir(otraEmpresa, yaExiste)

      const archivo = await construirArchivo({ filas: filas(1) })
      const res = await importar(sesion.token, archivo, { empresaId: empresa._id })

      expect(res.status).toBe(201)
      // No se creó a nadie: se le adscribió a la empresa nueva.
      expect(res.body.data.resumen).toMatchObject({ nuevos: 0, seAdscriben: 1 })
      expect(res.body.data.yaExisten[0].avisos.join(' ')).toContain(
        'número de trabajador'
      )
      expect(await Affiliation.countDocuments({ empleadoId: yaExiste._id })).toBe(2)
    })

    it('rechaza la fila cuyo número ya es de otra persona, sin tumbar las demás', async () => {
      const { empresa, sesion } = await escenario()
      const { curp, rfc } = identidad(0)

      // Esta persona ES la de la fila (misma CURP), pero el número '1000' lo
      // tiene un tercero: importarla reventaría el índice único.
      const laDeLaFila = await crearEmpleado({ nombre: 'LA DE LA FILA', curp, rfc })
      await adscribir(empresa, laDeLaFila)
      const tercero = await crearEmpleado({
        nombre: 'EL DEL NUMERO',
        numeroEmpleado: '1000'
      })
      await adscribir(empresa, tercero)

      const archivo = await construirArchivo({ filas: filas(2) })
      const res = await importar(sesion.token, archivo, { empresaId: empresa._id })

      expect(res.status).toBe(201)
      expect(res.body.data.resumen).toMatchObject({ conError: 1, nuevos: 1 })
      expect(res.body.data.conError[0].motivo).toContain('EL DEL NUMERO')
      // La otra fila sí entró.
      expect(await Employee.countDocuments({ nombre: /PERSONA1/ })).toBe(1)
    })

    it('no pisa un número corregido a mano al re-importar', async () => {
      const { empresa, sesion } = await escenario()
      const archivo = await construirArchivo({ filas: filas(1) })
      await importar(sesion.token, archivo, { empresaId: empresa._id })

      const persona = await Employee.findOne({ nombre: /PERSONA0/ })
      expect(persona.numeroEmpleado).toBe('1000')

      // RH lo corrige a mano y el archivo vuelve a subirse igual.
      persona.numeroEmpleado = 'CORREGIDO-1'
      await persona.save()
      await importar(sesion.token, archivo, { empresaId: empresa._id })

      expect((await Employee.findById(persona._id)).numeroEmpleado).toBe('CORREGIDO-1')
    })
  })

  describe('permisos', () => {
    it('403 para rh_consulta', async () => {
      const { empresa, sesion } = await escenario({ nivelAcceso: 'rh_consulta' })
      const res = await importar(
        sesion.token,
        await construirArchivo({ filas: filas(1) }),
        {
          empresaId: empresa._id
        }
      )
      expect(res.status).toBe(403)
    })

    it('403 para jefe_area', async () => {
      const { empresa, sesion } = await escenario({ nivelAcceso: 'jefe_area' })
      const res = await importar(
        sesion.token,
        await construirArchivo({ filas: filas(1) }),
        {
          empresaId: empresa._id
        }
      )
      expect(res.status).toBe(403)
    })

    it('401 sin sesión', async () => {
      const empresa = await crearEmpresa({ nombre: 'Maquinaria Cames', rfc: RFC_EMPRESA })
      const res = await request(app)
        .post('/api/v1/empleados/importar')
        .field('empresaId', String(empresa._id))
        .attach('archivo', await construirArchivo({ filas: filas(1) }), 'nomina.xlsx')
      expect(res.status).toBe(401)
    })

    it('la previsualización exige el mismo permiso que aplicar', async () => {
      const { empresa, sesion } = await escenario({ nivelAcceso: 'rh_consulta' })
      const res = await previsualizar(
        sesion.token,
        await construirArchivo({ filas: filas(1) }),
        {
          empresaId: empresa._id
        }
      )
      expect(res.status).toBe(403)
    })
  })

  describe('lo que la importación deja en la adscripción', () => {
    /** Importa una persona y devuelve su adscripción en esta empresa. */
    const importarUna = async (ajustes = () => ({})) => {
      const { empresa, sesion } = await escenario()
      await importar(sesion.token, await construirArchivo({ filas: filas(1, ajustes) }), {
        empresaId: empresa._id
      })
      const persona = await Employee.findOne({ nombre: /PERSONA0/ })
      const adscripcion = await Affiliation.findOne({ empleadoId: persona._id })
      return { empresa, sesion, persona, adscripcion }
    }

    /*
     * `nomina` va con `select: false`, y los servicios de adscripciones cargan el
     * documento SIN ella y luego lo guardan. Si Mongoose la borrara al guardar,
     * dar de baja a alguien perdería su salario en silencio. Esta prueba existe
     * porque ese fallo no daría ningún error.
     */
    it('la nómina sobrevive a un guardado que no la seleccionó', async () => {
      const { sesion, adscripcion } = await importarUna(() => ({ salarioDiario: 987.65 }))

      await request(app)
        .patch(`/api/v1/adscripciones/${adscripcion._id}/estado`)
        .set(auth(sesion.token))
        .send({ activo: false, motivo: 'Terminó la obra en la que estaba' })
        .expect(200)

      const despues = await Affiliation.findById(adscripcion._id).select('+nomina')
      expect(despues.activo).toBe(false)
      expect(despues.nomina.salarioDiario).toBe(987.65)
    })

    it('capturar la fecha de término saca el pendiente de la lista', async () => {
      const { sesion, adscripcion } = await importarUna(() => ({
        contrato: 'obra_determinada'
      }))
      expect(adscripcion.datosPendientes).toEqual(['fechaTerminoContrato'])

      const res = await request(app)
        .patch(`/api/v1/adscripciones/${adscripcion._id}`)
        .set(auth(sesion.token))
        .send({ fechaTerminoContrato: '2026-12-31' })

      expect(res.status).toBe(200)
      expect(res.body.data.adscripcion.fechaTerminoContrato).toBe('2026-12-31')
      expect(res.body.data.adscripcion.datosPendientes).toEqual([])
    })

    it('no se puede marcar un pendiente desde el PATCH: sólo lo escribe el importador', async () => {
      const { sesion, adscripcion } = await importarUna()

      const res = await request(app)
        .patch(`/api/v1/adscripciones/${adscripcion._id}`)
        .set(auth(sesion.token))
        .send({ datosPendientes: ['fechaTerminoContrato'] })

      expect(res.status).toBe(400)
      expect(res.body.message).toContain('datosPendientes')
      expect((await Affiliation.findById(adscripcion._id)).datosPendientes).toEqual([])
    })

    it('devuelve los campos nuevos en el listado de adscripciones', async () => {
      const { empresa, sesion, persona } = await importarUna(() => ({
        departamento: 'Plenares',
        contrato: 'obra_determinada'
      }))

      const res = await request(app)
        .get(`/api/v1/empresas/${empresa._id}/adscripciones`)
        .set(auth(sesion.token))

      const suya = res.body.data.adscripciones.find(
        (a) => a.empleadoId === persona._id.toString()
      )
      expect(suya).toMatchObject({
        departamento: 'Plenares',
        datosPendientes: ['fechaTerminoContrato']
      })
      // El número es de la persona (D-54): viaja en `empleado`, no en la raíz.
      expect(suya.numeroEmpleado).toBeUndefined()
      expect(suya.empleado.numeroEmpleado).toBe('1000')
      expect(suya.nomina).toBeUndefined()
    })
  })

  /*
   * El archivo real no vive en el repo (trae datos personales de 145 personas
   * reales), pero si está en `docs/` se comprueba con él: es la única forma de
   * verificar los 19 puestos, los 5 contratos y las 280 fechas de verdad.
   */
  describe('con el archivo real de Urbacames, si está presente', () => {
    const ruta = path.join(__dirname, '..', '..', 'docs', 'Colaboradores_20260824.xlsx')
    const existe = fs.existsSync(ruta)
    const pruebaSiExiste = existe ? it : it.skip

    pruebaSiExiste(
      'importa las 145 filas y la segunda vez no crea nada',
      async () => {
        const { empresa, sesion } = await escenario()
        const archivo = fs.readFileSync(ruta)

        const primera = await importar(sesion.token, archivo, { empresaId: empresa._id })

        expect(primera.status).toBe(201)
        expect(primera.body.data.empresa.rfcCoincide).toBe(true)
        expect(primera.body.data.archivo).toMatchObject({
          empresa: 'MAQUINARIA CAMES',
          rfc: 'MCA180611HF1',
          filas: 145
        })
        expect(primera.body.data.resumen).toMatchObject({
          filas: 145,
          nuevos: 145,
          conError: 0
        })
        expect(primera.body.data.categoriasNuevas).toHaveLength(19)

        const segunda = await importar(sesion.token, archivo, { empresaId: empresa._id })
        expect(segunda.body.data.resumen).toMatchObject({
          filas: 145,
          nuevos: 0,
          yaExisten: 145,
          sinCambios: 145,
          conError: 0
        })
        expect(await Employee.countDocuments({})).toBe(146) // 145 + el admin
      },
      300000
    )
  })
})
