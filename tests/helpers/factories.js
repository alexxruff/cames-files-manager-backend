const request = require('supertest')
const app = require('../../src/app')
const Employee = require('../../src/api/v1/employees/employeeModel')
const Credential = require('../../src/api/v1/credentials/credentialModel')
const Company = require('../../src/api/v1/companies/companyModel')
const Category = require('../../src/api/v1/categories/categoryModel')
const Affiliation = require('../../src/api/v1/affiliations/affiliationModel')

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
    throw new Error(
      `No se pudo iniciar sesión en la fábrica: ${respuesta.status} ${JSON.stringify(respuesta.body)}`
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

const auth = (token) => ({ Authorization: `Bearer ${token}` })

module.exports = {
  PASSWORD_VALIDA,
  crearCategoria,
  crearEmpresa,
  crearEmpleado,
  adscribir,
  crearEmpleadoConSesion,
  auth
}
