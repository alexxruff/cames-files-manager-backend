const request = require('supertest')
const app = require('../../src/app')
const User = require('../../src/api/v1/users/userModel')

const PASSWORD_VALIDA = 'Urbacames1!'

let contador = 0

/**
 * Crea un usuario en la base. `password` se hashea por el hook del modelo.
 * Devuelve el documento, no el JSON, para poder inspeccionar campos internos.
 */
async function crearUsuario(datos = {}) {
  contador += 1
  return User.create({
    name: datos.name || `Usuario Prueba ${contador}`,
    email: datos.email || `usuario${contador}@urbacames.com`,
    password: datos.password || PASSWORD_VALIDA,
    nivelAcceso: datos.nivelAcceso || 'rh_admin',
    area: datos.area ?? null,
    alcance: datos.alcance || 'interno',
    clienteId: datos.clienteId ?? null,
    active: datos.active ?? true
  })
}

/** Crea un usuario y devuelve `{ usuario, token }` listo para usar en headers. */
async function crearUsuarioConSesion(datos = {}) {
  const usuario = await crearUsuario(datos)
  const respuesta = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: usuario.email, password: datos.password || PASSWORD_VALIDA })

  if (respuesta.status !== 200) {
    throw new Error(
      `No se pudo iniciar sesión en la fábrica: ${respuesta.status} ${JSON.stringify(respuesta.body)}`
    )
  }

  return { usuario, token: respuesta.body.data.token }
}

const auth = (token) => ({ Authorization: `Bearer ${token}` })

module.exports = { PASSWORD_VALIDA, crearUsuario, crearUsuarioConSesion, auth }
