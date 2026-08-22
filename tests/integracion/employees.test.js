const Employee = require('../../src/api/v1/employees/employeeModel')
const Affiliation = require('../../src/api/v1/affiliations/affiliationModel')
const Company = require('../../src/api/v1/companies/companyModel')
const Category = require('../../src/api/v1/categories/categoryModel')
const Client = require('../../src/api/v1/clients/clientModel')
const {
  crearEmpleado,
  crearEmpresa,
  crearCategoria,
  adscribir
} = require('../helpers/factories')

describe('Modelo Employee — la persona (modelo-datos §5.2)', () => {
  beforeAll(() => Employee.init())

  it('no lleva empresa, contrato ni áreas: eso vive en la adscripción', async () => {
    const empleado = await crearEmpleado()
    const json = empleado.toJSON()

    expect(json.empresaId).toBeUndefined()
    expect(json.tipoContrato).toBeUndefined()
    expect(json.areas).toBeUndefined()
    expect(json.fechaIngreso).toBeUndefined()
  })

  it('la mayoría no tiene acceso a la plataforma', async () => {
    const empleado = await crearEmpleado()
    expect(empleado.acceso).toBeNull()
    expect(empleado.puedeIniciarSesion()).toBe(false)
  })

  it('valida el formato de la CURP y la deja opcional', async () => {
    const sinCurp = await crearEmpleado()
    expect(sinCurp.curp).toBeNull()

    const conCurp = await crearEmpleado({ curp: 'PERR900101HDFRRL09' })
    expect(conCurp.curp).toBe('PERR900101HDFRRL09')

    await expect(crearEmpleado({ curp: 'NO-ES-CURP' })).rejects.toThrow(/CURP/i)
  })

  it('la CURP es única, pero varios pueden no tenerla todavía', async () => {
    await crearEmpleado({ curp: 'PERR900101HDFRRL09' })
    await expect(crearEmpleado({ curp: 'PERR900101HDFRRL09' })).rejects.toThrow()

    // Índice parcial: dos altas provisionales sin CURP conviven.
    await crearEmpleado()
    await crearEmpleado()
    expect(await Employee.countDocuments({ curp: null })).toBeGreaterThanOrEqual(2)
  })

  it('el correo de acceso es único entre todos los empleados', async () => {
    await crearEmpleado({ acceso: { email: 'repetido@urbacames.com' } })
    await expect(
      crearEmpleado({ acceso: { email: 'repetido@urbacames.com' } })
    ).rejects.toThrow()
  })

  it('el alcance global sólo se puede dar a un rh_admin', async () => {
    await expect(
      crearEmpleado({
        acceso: {
          email: 'malo@urbacames.com',
          nivelAcceso: 'rh_consulta',
          alcanceGlobal: true
        }
      })
    ).rejects.toThrow(/administrador de RH/i)

    const valido = await crearEmpleado({
      acceso: {
        email: 'bueno@urbacames.com',
        nivelAcceso: 'rh_admin',
        alcanceGlobal: true
      }
    })
    expect(valido.acceso.alcanceGlobal).toBe(true)
  })

  it('la baja del sistema exige motivo y al reactivar se limpia', async () => {
    const empleado = await crearEmpleado()
    empleado.activo = false
    await expect(empleado.save()).rejects.toThrow(/motivo de la baja/i)

    empleado.motivoBaja = 'Renuncia voluntaria'
    empleado.fechaBaja = '2026-08-21'
    await empleado.save()
    expect(empleado.activo).toBe(false)

    empleado.activo = true
    await empleado.save()
    expect(empleado.motivoBaja).toBeNull()
    expect(empleado.fechaBaja).toBeNull()
  })

  it('los opcionales salen como null, nunca cadena vacía', async () => {
    const empleado = await crearEmpleado({ email: '' })
    const json = empleado.toJSON()

    for (const campo of ['curp', 'rfc', 'nss', 'email', 'telefono', 'fechaNacimiento']) {
      expect(json[campo]).toBeNull()
    }
  })

  it('exige categoría y tipo', async () => {
    await expect(
      Employee.create({ nombre: 'Sin Nada', tipo: 'administrativo' })
    ).rejects.toThrow(/categoría/i)
    await expect(
      Employee.create({
        nombre: 'Sin Tipo',
        categoriaId: (await crearCategoria())._id
      })
    ).rejects.toThrow(/tipo/i)
  })
})

describe('Modelo Affiliation — la relación laboral (modelo-datos §5b.1)', () => {
  beforeAll(() => Affiliation.init())

  it('guarda contrato, áreas y fechas por empresa', async () => {
    const empresa = await crearEmpresa()
    const empleado = await crearEmpleado()

    const adscripcion = await adscribir(empresa, empleado, {
      areas: ['obra', 'mantenimiento'],
      tipoContrato: 'obra_determinada',
      fechaIngreso: '2026-03-01',
      fechaTerminoContrato: '2026-12-31'
    })

    expect(adscripcion.toJSON()).toMatchObject({
      empresaId: empresa._id.toString(),
      empleadoId: empleado._id.toString(),
      areas: ['obra', 'mantenimiento'],
      tipoContrato: 'obra_determinada',
      fechaIngreso: '2026-03-01',
      fechaTerminoContrato: '2026-12-31',
      activo: true
    })
  })

  it('la misma persona puede tener condiciones distintas en dos empresas', async () => {
    const a = await crearEmpresa()
    const b = await crearEmpresa()
    const empleado = await crearEmpleado()

    await adscribir(a, empleado, { tipoContrato: 'indeterminado', areas: ['ventas'] })
    await adscribir(b, empleado, {
      tipoContrato: 'determinado',
      fechaTerminoContrato: '2027-01-31',
      areas: ['obra']
    })

    const suyas = await Affiliation.find({ empleadoId: empleado._id })
    expect(suyas).toHaveLength(2)
    expect(suyas.map((a2) => a2.tipoContrato).sort()).toEqual([
      'determinado',
      'indeterminado'
    ])
  })

  it('es única por par empresa+empleado: al volver se reactiva, no se duplica', async () => {
    const empresa = await crearEmpresa()
    const empleado = await crearEmpleado()
    await adscribir(empresa, empleado)

    await expect(adscribir(empresa, empleado)).rejects.toThrow()
  })

  it('un contrato temporal exige fecha de término posterior al ingreso', async () => {
    const empresa = await crearEmpresa()
    const empleado = await crearEmpleado()

    await expect(
      adscribir(empresa, empleado, { tipoContrato: 'determinado' })
    ).rejects.toThrow(/fecha de término/i)

    await expect(
      adscribir(empresa, empleado, {
        tipoContrato: 'determinado',
        fechaIngreso: '2026-05-01',
        fechaTerminoContrato: '2026-05-01'
      })
    ).rejects.toThrow(/posterior/i)
  })

  it('un indeterminado no conserva fecha de término', async () => {
    const empresa = await crearEmpresa()
    const empleado = await crearEmpleado()
    const adscripcion = await adscribir(empresa, empleado, {
      tipoContrato: 'indeterminado',
      fechaTerminoContrato: '2027-01-01'
    })
    expect(adscripcion.fechaTerminoContrato).toBeNull()
  })

  it('dar de baja la adscripción exige motivo y no toca al empleado', async () => {
    const empresa = await crearEmpresa()
    const empleado = await crearEmpleado()
    const adscripcion = await adscribir(empresa, empleado)

    adscripcion.activo = false
    await expect(adscripcion.save()).rejects.toThrow(/motivo de la baja/i)

    adscripcion.motivoBaja = 'Fin de obra'
    await adscripcion.save()

    const persona = await Employee.findById(empleado._id)
    expect(persona.activo).toBe(true)
  })
})

describe('Catálogos compartidos', () => {
  beforeAll(async () => {
    await Promise.all([Company.init(), Category.init(), Client.init()])
  })

  it('el nombre de la empresa es único ignorando acentos y mayúsculas', async () => {
    await crearEmpresa({ nombre: 'Urbacames Edificación' })
    await expect(crearEmpresa({ nombre: 'urbacames edificacion' })).rejects.toThrow()
  })

  it('el cliente es global y su nombre único, sin empresa dueña', async () => {
    const cliente = await Client.create({ nombre: 'Grupo Alvarado' })

    expect(cliente.toJSON().empresaId).toBeUndefined()
    await expect(Client.create({ nombre: 'grupo alvarado' })).rejects.toThrow()
  })

  it('la categoría es global, su nombre único y lleva tipo', async () => {
    const categoria = await Category.create({
      nombre: 'Residente de Obra',
      tipo: 'mano_de_obra'
    })
    expect(categoria.tipo).toBe('mano_de_obra')

    await expect(
      Category.create({ nombre: 'residente de obra', tipo: 'mano_de_obra' })
    ).rejects.toThrow()
    // El tipo es obligatorio: el desplegable del alta se filtra por él.
    await expect(Category.create({ nombre: 'Sin tipo' })).rejects.toThrow(/tipo/i)
  })
})
