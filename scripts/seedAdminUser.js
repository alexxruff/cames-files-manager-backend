/**
 * Crea el primer administrador (`npm run seed:admin`).
 *
 * Sin esto no hay forma de entrar: no existe registro público, las cuentas las
 * crea un administrador y el primero tiene que salir de algún lado.
 *
 * Es idempotente: si el correo ya existe, no lo toca.
 *
 * Uso:
 *   SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… npm run seed:admin
 */
const env = require('../src/config/env')
const logger = require('../src/utils/logger')
const { connect, disconnect } = require('../src/config/database')
const User = require('../src/api/v1/users/userModel')

async function main() {
  const email = env.SEED_ADMIN_EMAIL
  const password = env.SEED_ADMIN_PASSWORD

  if (!email || !password) {
    logger.error(
      'Faltan SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD. Defínelas en .env o en la línea de comandos.'
    )
    process.exit(1)
  }

  await connect()

  const existente = await User.findOne({ email: email.toLowerCase() })
  if (existente) {
    logger.info('El administrador ya existe; no se hace nada', {
      email: existente.email,
      nivelAcceso: existente.nivelAcceso
    })
    await disconnect()
    return
  }

  const admin = await User.create({
    name: env.SEED_ADMIN_NAME,
    email,
    password,
    nivelAcceso: 'rh_admin',
    alcance: 'interno',
    clienteId: null
  })

  logger.info('Administrador creado', {
    _id: admin._id.toString(),
    email: admin.email
  })
  logger.warn('Cambia la contraseña en el primer inicio de sesión.')

  await disconnect()
}

main().catch(async (error) => {
  logger.error('No se pudo crear el administrador', {
    error: error.message,
    stack: error.stack
  })
  await disconnect().catch(() => {})
  process.exit(1)
})
