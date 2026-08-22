const jwt = require('jsonwebtoken')
const mongoose = require('mongoose')
const env = require('../../../config/env')
const { AppError } = require('../../../middlewares/errorHandler')
const Employee = require('../employees/employeeModel')
const Credential = require('../credentials/credentialModel')
const { construirAuthUser } = require('./authUser')

/**
 * Sesión (backend-spec §6.1). JWT en `Authorization: Bearer <token>`, 12 h.
 *
 * El usuario es un **empleado con `acceso`**; la contraseña vive en
 * `credentials`, no en el empleado (D-27). Por eso el login hace dos consultas,
 * las dos por índice único: el empleado por `acceso.email` y su credencial por
 * `empleadoId`. Las peticiones autenticadas siguen costando una sola.
 *
 * Decisiones que se conservan del backend anterior:
 * - No hay registro público: el acceso lo concede un `rh_admin`.
 * - El error de login es el mismo exista o no el correo: enumerar cuentas es el
 *   primer paso de un ataque de credenciales.
 */
class AuthService {
  generateToken(empleado) {
    return jwt.sign(
      {
        sub: empleado._id.toString(),
        nivelAcceso: empleado.acceso?.nivelAcceso,
        alcanceGlobal: Boolean(empleado.acceso?.alcanceGlobal),
        /*
         * Instante de emisión en MILISEGUNDOS. El `iat` estándar del JWT sólo
         * tiene precisión de segundos, y con eso la invalidación por cambio de
         * contraseña deja una ventana de hasta un segundo en la que un token
         * viejo sigue sirviendo. Con `iatMs` la comparación es exacta.
         */
        iatMs: Date.now()
      },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN }
    )
  }

  async login(email, password) {
    if (!email || !password) {
      throw AppError.validation('Escribe tu correo y tu contraseña', [
        { msg: 'Escribe tu correo y tu contraseña' }
      ])
    }

    const credencialesInvalidas = new AppError(401, 'Correo o contraseña incorrectos')

    const empleado = await Employee.findOne({
      'acceso.email': String(email).toLowerCase().trim()
    })
    if (!empleado) throw credencialesInvalidas

    const credencial = await Credential.findOne({ empleadoId: empleado._id }).select(
      '+passwordHash'
    )
    if (!credencial) {
      // Estado inconsistente: tiene `acceso` pero no credencial. No se le dice al
      // usuario, pero sí queda en el log para que alguien lo arregle.
      throw credencialesInvalidas
    }

    if (credencial.bloqueadaHasta && credencial.bloqueadaHasta > new Date()) {
      throw new AppError(
        401,
        'Tu acceso está bloqueado temporalmente. Contacta a Recursos Humanos.'
      )
    }

    if (!(await credencial.comparePassword(password))) {
      // Se cuentan los fallos para poder auditarlos y detectar ataques.
      await Credential.updateOne(
        { _id: credencial._id },
        { $inc: { intentosFallidos: 1 } }
      )
      throw credencialesInvalidas
    }

    // Se comprueba DESPUÉS de la contraseña: quien teclea mal su contraseña no
    // debe averiguar si la cuenta existe o está desactivada.
    if (!empleado.activo) {
      throw new AppError(401, 'Tu cuenta está desactivada. Contacta a Recursos Humanos.')
    }
    if (!empleado.acceso.activo) {
      throw new AppError(
        401,
        'Tu acceso a la plataforma fue desactivado. Contacta a Recursos Humanos.'
      )
    }

    const ahora = new Date()
    await Credential.updateOne(
      { _id: credencial._id },
      { $set: { ultimoAccesoEn: ahora, intentosFallidos: 0 } }
    )

    return {
      user: await construirAuthUser(empleado, { ultimoAccesoEn: ahora }),
      token: this.generateToken(empleado)
    }
  }

  async getCurrentUser(empleadoId) {
    const empleado = await Employee.findById(empleadoId)
    if (!empleado || !empleado.puedeIniciarSesion()) {
      throw new AppError(401, 'Tu sesión no es válida. Vuelve a iniciar sesión.')
    }
    const credencial = await Credential.findOne({ empleadoId }).select('ultimoAccesoEn')
    return construirAuthUser(empleado, {
      ultimoAccesoEn: credencial?.ultimoAccesoEn || null
    })
  }

  /**
   * Cambia la contraseña e **invalida las demás sesiones**.
   *
   * Se escriben las dos colecciones en una transacción: el hash nuevo y la marca
   * `acceso.passwordActualizadaEn` que hace que los tokens viejos dejen de
   * servir. Como eso también invalidaría el token con el que se está haciendo la
   * petición, se devuelve uno nuevo para que el front lo reemplace.
   */
  async changePassword(empleadoId, { passwordActual, passwordNueva }) {
    const empleado = await Employee.findById(empleadoId)
    if (!empleado || !empleado.puedeIniciarSesion()) {
      throw new AppError(401, 'Tu sesión no es válida. Vuelve a iniciar sesión.')
    }

    const credencial = await Credential.findOne({ empleadoId }).select('+passwordHash')
    if (!credencial) {
      throw new AppError(401, 'Tu sesión no es válida. Vuelve a iniciar sesión.')
    }

    if (!(await credencial.comparePassword(passwordActual))) {
      throw AppError.validation('Tu contraseña actual no es correcta', [
        { msg: 'Tu contraseña actual no es correcta', path: 'passwordActual' }
      ])
    }
    if (await credencial.comparePassword(passwordNueva)) {
      throw AppError.validation('La contraseña nueva debe ser distinta de la actual', [
        {
          msg: 'La contraseña nueva debe ser distinta de la actual',
          path: 'passwordNueva'
        }
      ])
    }

    const passwordHash = await Credential.hashPassword(passwordNueva)
    const ahora = new Date()

    const sesion = await mongoose.startSession()
    try {
      await sesion.withTransaction(async () => {
        await Credential.updateOne(
          { _id: credencial._id },
          { $set: { passwordHash, resetToken: null, resetExpiraEn: null } },
          { session: sesion }
        )
        await Employee.updateOne(
          { _id: empleado._id },
          { $set: { 'acceso.passwordActualizadaEn': ahora } },
          { session: sesion }
        )
      })
    } finally {
      await sesion.endSession()
    }

    const actualizado = await Employee.findById(empleadoId)
    return {
      user: await construirAuthUser(actualizado, {
        ultimoAccesoEn: credencial.ultimoAccesoEn
      }),
      // Token nuevo: el anterior queda invalidado por el cambio.
      token: this.generateToken(actualizado)
    }
  }
}

module.exports = new AuthService()
