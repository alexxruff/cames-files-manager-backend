const mongoose = require('mongoose')
const env = require('../config/env')
const logger = require('../utils/logger')
const Employee = require('../api/v1/employees/employeeModel')
const Credential = require('../api/v1/credentials/credentialModel')
const Category = require('../api/v1/categories/categoryModel')

/**
 * Administrador de plataforma inicial (bootstrap).
 *
 * PROBLEMA QUE RESUELVE: no hay registro público, así que un sistema recién
 * instalado no tiene por dónde entrar. Se crea un empleado con acceso
 * `rh_admin` + `alcanceGlobal` —el administrador de plataforma, el único que
 * puede dar de alta en los catálogos compartidos y crear empresas.
 *
 * Se descartó un endpoint público de bootstrap: abriría una ventana en cada
 * instalación nueva en la que quien llegue primero se queda con el sistema.
 * Ver D-21.
 *
 * CUÁNDO CORRE: sólo si **nadie** puede entrar a la plataforma
 * (`acceso: null` en todos). Así una base con empleados importados pero sin
 * accesos también obtiene su puerta de entrada, y cambiar la contraseña de este
 * usuario es permanente.
 *
 * CÓMO QUITARLO: `BOOTSTRAP_ADMIN_ENABLED=false`, o borrar este archivo, su
 * llamada en `src/server.js` y las variables `BOOTSTRAP_ADMIN_*`.
 */

/** Categoría mínima para poder crear a la persona (el campo es obligatorio). */
const CATEGORIA_BOOTSTRAP = 'Administración'

async function ensureBootstrapAdmin({
  enabled = env.BOOTSTRAP_ADMIN_ENABLED,
  name = env.BOOTSTRAP_ADMIN_NAME,
  email = env.BOOTSTRAP_ADMIN_EMAIL,
  password = env.BOOTSTRAP_ADMIN_PASSWORD
} = {}) {
  if (!enabled) return { creado: false, motivo: 'deshabilitado' }

  const conAcceso = await Employee.countDocuments({ acceso: { $ne: null } })
  if (conAcceso > 0) {
    logger.debug('Bootstrap omitido: ya hay accesos configurados', { conAcceso })
    return { creado: false, motivo: 'ya-hay-accesos' }
  }

  const correo = String(email).trim().toLowerCase()
  const passwordHash = await Credential.hashPassword(password)
  const ahora = new Date()

  const sesion = await mongoose.startSession()
  let empleado

  try {
    await sesion.withTransaction(async () => {
      // La categoría es obligatoria en el empleado; se siembra la mínima.
      let categoria = await Category.findOne({ nombre: CATEGORIA_BOOTSTRAP }).session(
        sesion
      )
      if (!categoria) {
        ;[categoria] = await Category.create(
          [{ nombre: CATEGORIA_BOOTSTRAP, tipo: 'administrativo', esBase: true }],
          { session: sesion }
        )
      }

      ;[empleado] = await Employee.create(
        [
          {
            nombre: name,
            categoriaId: categoria._id,
            tipo: 'administrativo',
            acceso: {
              email: correo,
              nivelAcceso: 'rh_admin',
              alcanceGlobal: true, // administrador de plataforma
              activo: true,
              passwordActualizadaEn: ahora
            }
          }
        ],
        { session: sesion }
      )

      await Credential.create([{ empleadoId: empleado._id, passwordHash }], {
        session: sesion
      })
    })
  } catch (error) {
    if (error.code === 11000) {
      // Otra instancia lo creó entre el conteo y el insert: no es un fallo.
      return { creado: false, motivo: 'ya-existia' }
    }
    throw error
  } finally {
    await sesion.endSession()
  }

  logger.warn(
    'Se creó el administrador de plataforma inicial con la contraseña de arranque. ' +
      'Cámbiala en tu primer acceso (POST /auth/cambiar-password) y pon ' +
      'BOOTSTRAP_ADMIN_ENABLED=false en producción.',
    { _id: empleado._id.toString(), email: correo, alcanceGlobal: true }
  )

  return { creado: true, motivo: 'creado', email: correo }
}

module.exports = { ensureBootstrapAdmin }
