/**
 * Crea un acceso de administrador a mano (`npm run seed:admin`).
 *
 * El arranque ya crea el administrador de plataforma inicial si nadie puede
 * entrar (ver `src/services/bootstrapAdmin.js`). Este script sirve para el caso
 * distinto: agregar un administrador **con contraseña fuerte** en un ambiente
 * concreto, sin pasar por la API.
 *
 *   SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… npm run seed:admin
 *
 * A diferencia del bootstrap, aquí la contraseña **sí** debe cumplir las reglas
 * de la plataforma. Es idempotente por correo de acceso.
 */
const mongoose = require('mongoose')
const env = require('../src/config/env')
const logger = require('../src/utils/logger')
const { connect, disconnect } = require('../src/config/database')
const Employee = require('../src/api/v1/employees/employeeModel')
const Credential = require('../src/api/v1/credentials/credentialModel')
const Category = require('../src/api/v1/categories/categoryModel')

const PATRON_PASSWORD = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[!@#$%^&*]).*$/

async function main() {
  const email = (env.SEED_ADMIN_EMAIL || '').toLowerCase().trim()
  const password = env.SEED_ADMIN_PASSWORD

  if (!email || !password) {
    logger.error('Faltan SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD')
    process.exit(1)
  }
  if (password.length < 8 || !PATRON_PASSWORD.test(password)) {
    logger.error(
      'La contraseña debe tener 8+ caracteres con mayúscula, minúscula, número y uno de !@#$%^&*'
    )
    process.exit(1)
  }

  await connect()

  const existente = await Employee.findOne({ 'acceso.email': email })
  if (existente) {
    logger.info('Ya existe un acceso con ese correo; no se hace nada', {
      email,
      nivelAcceso: existente.acceso.nivelAcceso
    })
    return disconnect()
  }

  const passwordHash = await Credential.hashPassword(password)
  const sesion = await mongoose.startSession()
  let empleado

  try {
    await sesion.withTransaction(async () => {
      let categoria = await Category.findOne({ nombre: 'Administración' }).session(sesion)
      if (!categoria) {
        ;[categoria] = await Category.create(
          [{ nombre: 'Administración', esBase: true }],
          {
            session: sesion
          }
        )
      }
      ;[empleado] = await Employee.create(
        [
          {
            nombre: env.SEED_ADMIN_NAME,
            categoriaId: categoria._id,
            tipo: 'administrativo',
            acceso: {
              email,
              nivelAcceso: 'rh_admin',
              alcanceGlobal: true,
              activo: true,
              passwordActualizadaEn: new Date()
            }
          }
        ],
        { session: sesion }
      )
      await Credential.create([{ empleadoId: empleado._id, passwordHash }], {
        session: sesion
      })
    })
  } finally {
    await sesion.endSession()
  }

  logger.info('Administrador de plataforma creado', {
    _id: empleado._id.toString(),
    email
  })

  await disconnect()
}

main().catch(async (error) => {
  logger.error('No se pudo crear el administrador', { error: error.message })
  await disconnect().catch(() => {})
  process.exit(1)
})
