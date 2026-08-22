const mongoose = require('mongoose')
const { AppError } = require('../../../middlewares/errorHandler')
const Employee = require('./employeeModel')
const Credential = require('../credentials/credentialModel')

/**
 * Administración de accesos a la plataforma.
 *
 * El acceso es un **sub-recurso del empleado**, no una entidad aparte. Eso hace
 * estructuralmente imposible el problema que el front señaló como innegociable:
 * no se puede «crear un usuario» y terminar con dos registros de la misma
 * persona, porque para dar acceso hay que partir de un empleado que ya existe.
 *
 * Cada operación escribe dos colecciones (`employees.acceso` y `credentials`) y
 * por eso va en **transacción**: un acceso sin credencial no podría entrar, y una
 * credencial sin acceso sería un secreto huérfano.
 */
class AccessService {
  /** Concede acceso a un empleado que ya existe. */
  async grant(empleadoId, datos, { actor } = {}) {
    const empleado = await this.#buscarEmpleado(empleadoId)

    if (empleado.acceso) {
      throw new AppError(
        409,
        'Esta persona ya tiene acceso a la plataforma. Edítalo en vez de crearlo.'
      )
    }
    if (!empleado.activo) {
      throw new AppError(400, 'No se puede dar acceso a una persona dada de baja')
    }

    const email = String(datos.email).toLowerCase().trim()
    await this.#assertEmailLibre(email)
    this.#assertAlcanceGlobalPermitido(datos, actor)

    const passwordHash = await Credential.hashPassword(datos.password)
    const sesion = await mongoose.startSession()

    try {
      await sesion.withTransaction(async () => {
        empleado.acceso = {
          email,
          nivelAcceso: datos.nivelAcceso,
          alcanceGlobal: Boolean(datos.alcanceGlobal),
          activo: true,
          passwordActualizadaEn: new Date()
        }
        await empleado.save({ session: sesion })
        await Credential.create([{ empleadoId: empleado._id, passwordHash }], {
          session: sesion
        })
      })
    } finally {
      await sesion.endSession()
    }

    return empleado
  }

  /** Cambia nivel, alcance, correo de acceso o lo activa/desactiva. */
  async update(empleadoId, datos, { actor } = {}) {
    const empleado = await this.#buscarEmpleado(empleadoId)
    if (!empleado.acceso) {
      throw AppError.notFound('Esta persona no tiene acceso a la plataforma')
    }

    // Se captura ANTES de aplicar los cambios: si se lee después, el propio
    // cambio ya borró la evidencia y la guarda de más abajo nunca se dispara.
    const eraAdminGlobal = Boolean(empleado.acceso.alcanceGlobal)

    if (actor && empleado._id.equals(actor._id) && datos.activo === false) {
      throw new AppError(400, 'No puedes quitarte tu propio acceso')
    }

    if (datos.email !== undefined) {
      const email = String(datos.email).toLowerCase().trim()
      if (email !== empleado.acceso.email) {
        await this.#assertEmailLibre(email, empleado._id)
        empleado.acceso.email = email
      }
    }

    if (datos.nivelAcceso !== undefined) empleado.acceso.nivelAcceso = datos.nivelAcceso
    if (datos.alcanceGlobal !== undefined) {
      this.#assertAlcanceGlobalPermitido(datos, actor)
      empleado.acceso.alcanceGlobal = Boolean(datos.alcanceGlobal)
    }
    if (datos.activo !== undefined) empleado.acceso.activo = Boolean(datos.activo)

    // No dejar el sistema sin administrador de plataforma.
    const dejaDeSerlo =
      eraAdminGlobal && (!empleado.acceso.alcanceGlobal || !empleado.acceso.activo)
    if (dejaDeSerlo) {
      await this.#assertQuedaOtroAdminGlobal(empleado._id)
    }

    await empleado.save()
    return empleado
  }

  /**
   * Quita el acceso. La **persona y su expediente quedan intactos**: se borra la
   * credencial y se pone `acceso: null`.
   */
  async revoke(empleadoId, { actor } = {}) {
    const empleado = await this.#buscarEmpleado(empleadoId)
    if (!empleado.acceso) return empleado

    if (actor && empleado._id.equals(actor._id)) {
      throw new AppError(400, 'No puedes quitarte tu propio acceso')
    }
    if (empleado.acceso.alcanceGlobal) {
      await this.#assertQuedaOtroAdminGlobal(empleado._id)
    }

    const sesion = await mongoose.startSession()
    try {
      await sesion.withTransaction(async () => {
        await Credential.deleteOne({ empleadoId: empleado._id }, { session: sesion })
        await Employee.updateOne(
          { _id: empleado._id },
          { $set: { acceso: null } },
          { session: sesion }
        )
      })
    } finally {
      await sesion.endSession()
    }

    return Employee.findById(empleado._id)
  }

  /**
   * Un administrador repone la contraseña de alguien. Invalida sus sesiones
   * abiertas, igual que un cambio hecho por la propia persona.
   */
  async resetPassword(empleadoId, { password }) {
    const empleado = await this.#buscarEmpleado(empleadoId)
    if (!empleado.acceso) {
      throw AppError.notFound('Esta persona no tiene acceso a la plataforma')
    }

    const passwordHash = await Credential.hashPassword(password)
    const ahora = new Date()

    const sesion = await mongoose.startSession()
    try {
      await sesion.withTransaction(async () => {
        await Credential.updateOne(
          { empleadoId: empleado._id },
          {
            $set: {
              passwordHash,
              resetToken: null,
              resetExpiraEn: null,
              intentosFallidos: 0,
              bloqueadaHasta: null
            }
          },
          { session: sesion, upsert: false }
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

    return Employee.findById(empleado._id)
  }

  async #buscarEmpleado(empleadoId) {
    if (!mongoose.isValidObjectId(empleadoId)) {
      throw new AppError(400, 'El empleado indicado no es válido')
    }
    const empleado = await Employee.findById(empleadoId)
    if (!empleado) throw AppError.notFound('El empleado no existe')
    return empleado
  }

  async #assertEmailLibre(email, exceptoId = null) {
    const filtro = { 'acceso.email': email }
    if (exceptoId) filtro._id = { $ne: exceptoId }
    if (await Employee.exists(filtro)) {
      throw AppError.validation('Ya existe un acceso con ese correo', [
        { msg: 'Ya existe un acceso con ese correo', path: 'email' }
      ])
    }
  }

  /**
   * Sólo un administrador de plataforma puede crear otro: si no, cualquier
   * `rh_admin` de una empresa se ascendería a ver todo el grupo.
   */
  #assertAlcanceGlobalPermitido(datos, actor) {
    if (!datos.alcanceGlobal) return
    if (!actor?.acceso?.alcanceGlobal) {
      throw new AppError(
        403,
        'Sólo un administrador de plataforma puede otorgar alcance global'
      )
    }
  }

  async #assertQuedaOtroAdminGlobal(idExcluido) {
    const otros = await Employee.countDocuments({
      _id: { $ne: idExcluido },
      activo: true,
      'acceso.alcanceGlobal': true,
      'acceso.activo': true
    })
    if (otros === 0) {
      throw new AppError(
        400,
        'Debe quedar al menos un administrador de plataforma activo. Asigna otro antes de continuar.'
      )
    }
  }
}

module.exports = new AccessService()
