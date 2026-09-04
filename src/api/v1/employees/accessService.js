const mongoose = require('mongoose')
const { AppError } = require('../../../middlewares/errorHandler')
const Employee = require('./employeeModel')
const Credential = require('../credentials/credentialModel')
const Role = require('../roles/roleModel')
const {
  PERMISSION_KEYS,
  PERMISSION_BY_KEY,
  permissionsOf
} = require('../../../utils/permissions')

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
  /**
   * El acceso de una persona con **de dónde le viene cada permiso** (D-93).
   *
   * Es la pregunta que sólo se puede contestar porque las excepciones son
   * aditivas: cada casilla encendida viene de su rol o de una excepción suya, y
   * no hay un tercer caso. Con negaciones habría que explicar además por qué NO
   * ve algo, y eso ya no cabe en una lista.
   */
  async detalle(empleadoId) {
    const empleado = await Employee.findById(empleadoId).populate({
      path: 'acceso.rolId',
      select: 'nombre permisos todosLosPermisos soloSusAreas activo'
    })
    if (!empleado) throw AppError.notFound('Ese empleado no existe')
    if (!empleado.acceso) {
      throw AppError.notFound('Esta persona no tiene acceso a la plataforma')
    }

    const rol = empleado.acceso.rolId
    return {
      email: empleado.acceso.email,
      nivelAcceso: empleado.acceso.nivelAcceso,
      alcanceGlobal: Boolean(empleado.acceso.alcanceGlobal),
      activo: Boolean(empleado.acceso.activo),
      passwordTemporal: Boolean(empleado.acceso.passwordTemporal),
      rol: rol ? { _id: rol._id.toString(), nombre: rol.nombre } : null,
      permisosExtra: empleado.acceso.permisosExtra || [],
      permisos: permissionsOf(empleado.acceso)
    }
  }

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
    const rolId = await this.#resolverRol(datos.rolId)
    const permisosExtra = this.#validarExtras(datos.permisosExtra)

    const passwordHash = await Credential.hashPassword(datos.password)
    const sesion = await mongoose.startSession()

    try {
      await sesion.withTransaction(async () => {
        empleado.acceso = {
          email,
          nivelAcceso: datos.nivelAcceso,
          alcanceGlobal: Boolean(datos.alcanceGlobal),
          activo: true,
          rolId,
          permisosExtra,
          passwordActualizadaEn: new Date(),
          /*
           * La contraseña inicial la escribe el administrador, así que **él la
           * conoce**: la persona tiene que cambiarla antes de poder usar el
           * sistema (D-49). Hasta entonces su sesión sólo sirve para eso.
           */
          passwordTemporal: true
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
    /*
     * `null` explícito le quita el rol y lo devuelve a resolverse por su nivel de
     * acceso, que es el respaldo de siempre. No es lo mismo que no mandar nada.
     */
    if (datos.rolId !== undefined) {
      empleado.acceso.rolId = await this.#resolverRol(datos.rolId)
    }
    if (datos.permisosExtra !== undefined) {
      empleado.acceso.permisosExtra = this.#validarExtras(datos.permisosExtra)
    }
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
   * El rol al que apunta un `rolId`, comprobando que exista y esté activo.
   *
   * `null` y `undefined` son cosas distintas y las dos válidas: `null` es
   * «déjalo sin rol» —se resolverá por su nivel de acceso— y `undefined` es «no
   * toques lo que tenga», que es quien lo llama el que distingue.
   */
  async #resolverRol(rolId) {
    if (!rolId) return null

    const rol = await Role.findById(rolId)
    if (!rol) throw AppError.notFound('Ese rol no existe')
    if (!rol.activo) {
      throw new AppError(400, 'Ese rol está dado de baja: elige otro')
    }

    return rol._id
  }

  /**
   * Las excepciones de la persona. Se comprueba que existan y **no** que sean
   * coherentes entre sí: son un añadido sobre un rol que ya lo es, y exigirle
   * aquí sus dependencias obligaría a repetir en la excepción lo que el rol ya
   * da.
   */
  #validarExtras(permisosExtra) {
    if (permisosExtra === undefined || permisosExtra === null) return []

    const claves = [...new Set(permisosExtra)]
    const inventadas = claves.filter((c) => !PERMISSION_KEYS.includes(c))
    if (inventadas.length > 0) {
      throw new AppError(400, `Ese permiso no existe: ${inventadas[0]}`)
    }

    /*
     * Un permiso que exige ser administrador de plataforma no se da como
     * excepción: no serviría de nada —el catálogo lo seguiría exigiendo— y
     * dejaría en la ficha de la persona un permiso que no tiene. Se dice claro en
     * vez de guardarlo mudo.
     */
    const global = claves.find((c) => PERMISSION_BY_KEY[c].exigeAlcanceGlobal)
    if (global) {
      throw new AppError(
        400,
        `«${PERMISSION_BY_KEY[global].etiqueta}» sólo la puede tener un administrador de plataforma, no se da como excepción`
      )
    }

    return claves
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
   *
   * La deja marcada como **temporal**: quien la repuso la conoce, así que la
   * plataforma queda bloqueada para esa persona hasta que ponga una suya
   * (D-49). Es lo que convierte «te repuse la contraseña» en algo seguro de
   * decir por teléfono.
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
          {
            $set: {
              'acceso.passwordActualizadaEn': ahora,
              // La repuso alguien más: temporal hasta que la persona la cambie.
              'acceso.passwordTemporal': true
            }
          },
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
