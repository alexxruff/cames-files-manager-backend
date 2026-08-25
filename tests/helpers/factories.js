const request = require('supertest')
const app = require('../../src/app')
const Employee = require('../../src/api/v1/employees/employeeModel')
const Credential = require('../../src/api/v1/credentials/credentialModel')
const Company = require('../../src/api/v1/companies/companyModel')
const Category = require('../../src/api/v1/categories/categoryModel')
const Affiliation = require('../../src/api/v1/affiliations/affiliationModel')
const Client = require('../../src/api/v1/clients/clientModel')
const Portfolio = require('../../src/api/v1/portfolios/portfolioModel')
const Project = require('../../src/api/v1/projects/projectModel')
const Assignment = require('../../src/api/v1/assignments/assignmentModel')

/**
 * Fábricas para el modelo nuevo: empresas, empleados, adscripciones y accesos.
 *
 * El usuario de la plataforma es un **empleado con acceso**, y su contraseña vive
 * en `credentials`. Crear una sesión implica entonces tres piezas, y por eso
 * existe `crearEmpleadoConSesion`: si cada prueba las armara a mano, la mitad del
 * archivo sería preparación.
 */

const PASSWORD_VALIDA = 'Urbacames1!'
let contador = 0

const siguiente = () => {
  contador += 1
  return contador
}

async function crearCategoria(nombre, tipo = 'administrativo') {
  return Category.create({ nombre: nombre || `Categoría ${siguiente()}`, tipo })
}

async function crearEmpresa(datos = {}) {
  return Company.create({ nombre: datos.nombre || `Empresa ${siguiente()}`, ...datos })
}

/**
 * Crea una persona. `acceso` es opcional: la mayoría de los empleados no entra a
 * la plataforma, igual que en producción.
 */
async function crearEmpleado(datos = {}) {
  const n = siguiente()
  const tipo = datos.tipo || 'administrativo'
  // La categoría tiene que ser del mismo tipo que la persona.
  const categoriaId = datos.categoriaId || (await crearCategoria(undefined, tipo))._id

  const empleado = await Employee.create({
    nombre: datos.nombre || `Empleado Prueba ${n}`,
    curp: datos.curp ?? null,
    categoriaId,
    tipo,
    email: datos.email ?? null,
    // Para las alertas de cumpleaños: la mayoría de las pruebas no la necesita.
    fechaNacimiento: datos.fechaNacimiento ?? null,
    activo: datos.activo ?? true,
    motivoBaja: datos.motivoBaja ?? null,
    acceso: datos.acceso
      ? {
          email: datos.acceso.email || `empleado${n}@urbacames.com`,
          nivelAcceso: datos.acceso.nivelAcceso || 'rh_admin',
          alcanceGlobal: datos.acceso.alcanceGlobal ?? false,
          activo: datos.acceso.activo ?? true,
          passwordActualizadaEn: datos.acceso.passwordActualizadaEn ?? null
        }
      : null
  })

  if (datos.acceso) {
    await Credential.create({
      empleadoId: empleado._id,
      passwordHash: await Credential.hashPassword(
        datos.acceso.password || PASSWORD_VALIDA
      )
    })
  }

  return empleado
}

/** Adscribe a un empleado a una empresa (ahí vive la relación laboral). */
async function adscribir(empresa, empleado, datos = {}) {
  return Affiliation.create({
    empresaId: empresa._id,
    empleadoId: empleado._id,
    areas: datos.areas || [],
    tipoContrato: datos.tipoContrato || 'indeterminado',
    fechaIngreso: datos.fechaIngreso || '2026-01-15',
    fechaTerminoContrato: datos.fechaTerminoContrato ?? null,
    activo: datos.activo ?? true,
    motivoBaja: datos.motivoBaja ?? null
  })
}

/**
 * Empleado + acceso + adscripción + sesión iniciada.
 *
 * @param {object} [datos]
 * @param {string} [datos.nivelAcceso]
 * @param {boolean} [datos.alcanceGlobal]
 * @param {object} [datos.empresa] empresa existente; si no, se crea una
 * @param {string[]} [datos.areas] áreas en esa empresa
 * @param {boolean} [datos.sinAdscripcion] para probar el caso sin empresas
 */
async function crearEmpleadoConSesion(datos = {}) {
  // Con `sinAdscripcion` no se crea empresa: crearla de todas formas metía una
  // empresa fantasma en la base y descuadraba las pruebas que cuentan empresas.
  const empresa = datos.sinAdscripcion ? null : datos.empresa || (await crearEmpresa())
  const password = datos.password || PASSWORD_VALIDA

  const empleado = await crearEmpleado({
    nombre: datos.nombre,
    tipo: datos.tipo,
    activo: datos.activo,
    acceso: {
      email: datos.email,
      password,
      nivelAcceso: datos.nivelAcceso || 'rh_admin',
      alcanceGlobal: datos.alcanceGlobal ?? false,
      activo: datos.accesoActivo ?? true
    }
  })

  const adscripcion = datos.sinAdscripcion
    ? null
    : await adscribir(empresa, empleado, { areas: datos.areas })

  const respuesta = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: empleado.acceso.email, password })

  if (respuesta.status !== 200) {
    /*
     * El cuerpo se incluye Y el texto crudo: hubo un fallo intermitente que sólo
     * decía `404 {}` —cuerpo vacío, que ninguna ruta de la API produce— y sin el
     * texto no había por dónde empezar. Si vuelve a pasar, aquí está la causa.
     */
    throw new Error(
      `No se pudo iniciar sesión en la fábrica: ${respuesta.status} ` +
        `body=${JSON.stringify(respuesta.body)} ` +
        `text=${JSON.stringify(String(respuesta.text || '').slice(0, 500))} ` +
        `type=${respuesta.type} email=${empleado.acceso.email} ` +
        `mongoose=${require('mongoose').connection.readyState}`
    )
  }

  return {
    empleado,
    empresa,
    adscripcion,
    token: respuesta.body.data.token,
    user: respuesta.body.data.user
  }
}

async function crearCliente(datos = {}) {
  return Client.create({ nombre: datos.nombre || `Cliente ${siguiente()}`, ...datos })
}

/** Mete un cliente a la cartera de una empresa. Sin esto no hay proyecto posible. */
async function agregarACartera(empresa, cliente, datos = {}) {
  return Portfolio.create({
    empresaId: empresa._id,
    clienteId: cliente._id,
    activo: datos.activo ?? true,
    ...datos
  })
}

/**
 * Proyecto listo para usar: crea el cliente y su cartera si no se pasan, porque
 * el servicio exige que el cliente esté en la cartera activa de la empresa.
 */
async function crearProyecto(empresa, datos = {}) {
  const cliente = datos.cliente || (await crearCliente())
  if (!datos.sinCartera) await agregarACartera(empresa, cliente)

  const categoria = datos.categoria || (await crearCategoria(undefined, 'mano_de_obra'))

  const proyecto = await Project.create({
    empresaId: empresa._id,
    clienteId: cliente._id,
    nombre: datos.nombre || `Proyecto ${siguiente()}`,
    fechaInicio: datos.fechaInicio || '2026-09-01',
    fechaFinEstimada: datos.fechaFinEstimada || '2027-03-01',
    categorias: datos.categorias || [categoria._id],
    estado: datos.estado || 'en_curso',
    fechaFinReal: datos.fechaFinReal ?? null
  })

  return { proyecto, cliente, categoria }
}

/** Asigna a alguien a un proyecto, saltándose las validaciones del servicio. */
async function asignar(proyecto, empleado, categoriaId, datos = {}) {
  return Assignment.create({
    proyectoId: proyecto._id,
    empleadoId: empleado._id,
    categoriaId: categoriaId || proyecto.categorias[0],
    fechaAsignacion: datos.fechaAsignacion || '2026-09-15',
    fechaSalida: datos.fechaSalida ?? null,
    activo: datos.activo ?? true
  })
}

const auth = (token) => ({ Authorization: `Bearer ${token}` })

module.exports = {
  PASSWORD_VALIDA,
  crearCategoria,
  crearEmpresa,
  crearEmpleado,
  adscribir,
  crearEmpleadoConSesion,
  crearCliente,
  agregarACartera,
  crearProyecto,
  asignar,
  auth
}
