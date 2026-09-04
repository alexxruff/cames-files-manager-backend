const mongoose = require('mongoose')
const Employee = require('../../src/api/v1/employees/employeeModel')
const Credential = require('../../src/api/v1/credentials/credentialModel')
const Company = require('../../src/api/v1/companies/companyModel')
const Affiliation = require('../../src/api/v1/affiliations/affiliationModel')
const { crearEmpleado, crearEmpresa, adscribir } = require('../helpers/factories')

/**
 * Por qué las credenciales son una colección aparte (D-27).
 *
 * Esta prueba existe para que nadie "simplifique" el modelo metiendo el
 * `passwordHash` dentro de `empleados` con `select: false`. La primera parte
 * demuestra que esa protección NO alcanza en este sistema; la segunda, que con la
 * colección separada el problema no puede ocurrir.
 */
describe('Aislamiento del material secreto', () => {
  describe('por qué NO se embebe el hash en el empleado', () => {
    it('`select: false` en un subdocumento no protege en agregaciones ni en $lookup', async () => {
      // Modelo de ejemplo con el hash embebido, como se había propuesto.
      const schema = new mongoose.Schema(
        {
          nombre: String,
          acceso: {
            type: {
              email: String,
              password: { type: String, select: false }
            },
            default: null,
            _id: false
          }
        },
        { collection: 'demo_embebido' }
      )
      const Demo = mongoose.models.DemoEmbebido || mongoose.model('DemoEmbebido', schema)

      await Demo.create({
        nombre: 'Ana Ruiz',
        acceso: { email: 'ana@urbacames.com', password: '$2b$12$hash_super_secreto' }
      })

      // find() sí lo respeta…
      const porFind = await Demo.findOne({})
      expect(porFind.acceso.password).toBeUndefined()

      // …pero seleccionar el padre lo trae de vuelta,
      const conSelect = await Demo.findOne({}).select('acceso')
      expect(conSelect.acceso.password).toBe('$2b$12$hash_super_secreto')

      // y la agregación lo ignora por completo.
      const [porAggregate] = await Demo.aggregate([{ $match: {} }])
      expect(porAggregate.acceso.password).toBe('$2b$12$hash_super_secreto')

      await Demo.collection.drop()
    })
  })

  describe('con la colección separada, no hay forma de filtrarlo', () => {
    it('el listado por agregación con $lookup no puede traer el hash', async () => {
      const empresa = await crearEmpresa()
      const empleado = await crearEmpleado({
        acceso: { email: 'con-acceso@urbacames.com' }
      })
      await adscribir(empresa, empleado)

      // La consulta más peligrosa del sistema: el listado de empleados.
      const resultado = await Affiliation.aggregate([
        { $match: { empresaId: empresa._id } },
        {
          $lookup: {
            from: 'employees',
            localField: 'empleadoId',
            foreignField: '_id',
            as: 'empleado'
          }
        },
        { $unwind: '$empleado' }
      ])

      const serializado = JSON.stringify(resultado)
      expect(serializado).not.toMatch(/\$2[aby]\$/)
      expect(serializado).not.toMatch(/passwordHash/)
      expect(resultado[0].empleado.acceso.email).toBe('con-acceso@urbacames.com')
    })

    it('el documento del empleado no contiene ningún campo de contraseña', async () => {
      const empleado = await crearEmpleado({ acceso: { email: 'x@urbacames.com' } })
      const crudo = await Employee.collection.findOne({ _id: empleado._id })

      /*
       * La lista es exhaustiva a propósito: si algún día alguien vuelve a meter
       * el hash en `empleados.acceso`, esta prueba falla. `passwordTemporal` es
       * una marca, no material secreto (D-49), y `rolId` y `permisosExtra` son
       * de dónde salen sus permisos (D-93) — tampoco lo son. Agregar un campo
       * aquí es una decisión: si lo que se agrega es un secreto, va en
       * `credentials`, no en esta lista.
       */
      expect(Object.keys(crudo.acceso).sort()).toEqual([
        'activo',
        'alcanceGlobal',
        'email',
        'nivelAcceso',
        'passwordActualizadaEn',
        'passwordTemporal',
        'permisosExtra',
        'rolId'
      ])
      expect(JSON.stringify(crudo)).not.toMatch(/\$2[aby]\$/)
    })

    it('la credencial no expone el hash ni al serializarla a JSON', async () => {
      const empleado = await crearEmpleado({ acceso: { email: 'y@urbacames.com' } })
      const credencial = await Credential.findOne({ empleadoId: empleado._id }).select(
        '+passwordHash'
      )

      // Se leyó a propósito con el hash…
      expect(credencial.passwordHash).toMatch(/^\$2[aby]\$/)
      // …y aun así el JSON no lo lleva.
      expect(JSON.stringify(credencial)).not.toMatch(/\$2[aby]\$/)
      expect(credencial.toJSON().passwordHash).toBeUndefined()
      expect(credencial.toJSON().resetToken).toBeUndefined()
    })

    it('la relación es uno a uno: no se pueden crear dos credenciales de la misma persona', async () => {
      await Credential.init()
      const empleado = await crearEmpleado({ acceso: { email: 'z@urbacames.com' } })

      await expect(
        Credential.create({
          empleadoId: empleado._id,
          passwordHash: await Credential.hashPassword('Urbacames1!')
        })
      ).rejects.toThrow()
    })

    it('la empresa tampoco arrastra nada al popular sus adscripciones', async () => {
      const empresa = await crearEmpresa()
      const empleado = await crearEmpleado({ acceso: { email: 'w@urbacames.com' } })
      await adscribir(empresa, empleado)

      const adscripciones = await Affiliation.find({ empresaId: empresa._id }).populate(
        'empleadoId'
      )
      expect(JSON.stringify(adscripciones)).not.toMatch(/\$2[aby]\$/)
      expect(await Company.countDocuments({})).toBe(1)
    })
  })
})
