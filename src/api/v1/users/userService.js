const User = require('./userModel')
const Client = require('../clients/clientModel')
const { AppError } = require('../../../middlewares/errorHandler')
const { buildSearchFilter } = require('../../../utils/text')

/**
 * Reglas de negocio de usuarios (spec 9.2).
 *
 * El servicio no sabe nada de HTTP: recibe datos y un CONTEXTO
 * (`{ scopeFilter, ownerClienteId, actor }`) y devuelve documentos o lanza
 * `AppError`. Así las reglas se prueban sin levantar el servidor.
 *
 * Todas las consultas incluyen `scopeFilter`. En fase 1 es `{}`; en fase 2 hace
 * que un administrador de cliente sólo alcance a los usuarios de su cliente.
 */
class UserService {
  /**
   * @param {object} filtros
   * @param {string} [filtros.busqueda] Nombre o correo, ignora acentos.
   * @param {boolean} [filtros.incluirInactivos=false]
   * @param {object} contexto
   * @param {object} contexto.scopeFilter
   */
  async list({ busqueda, incluirInactivos = false } = {}, { scopeFilter = {} } = {}) {
    const filtro = { ...scopeFilter }

    // Por defecto sólo activos, pero se pueden pedir los dados de baja: sin esto
    // un usuario desactivado desaparece y no hay forma de reactivarlo.
    if (!incluirInactivos) filtro.active = true

    const busquedaFiltro = buildSearchFilter(busqueda, {
      camposNormalizados: ['nameNormalized'],
      camposDirectos: ['email']
    })
    if (busquedaFiltro) Object.assign(filtro, busquedaFiltro)

    return User.find(filtro).sort({ name: 1 }).collation({ locale: 'es' })
  }

  /** 404 si no existe O no es visible para quien pregunta (spec 4). */
  async getById(id, { scopeFilter = {} } = {}) {
    const usuario = await User.findOne({ _id: id, ...scopeFilter })
    if (!usuario) throw AppError.notFound('El usuario no existe')
    return usuario
  }

  /**
   * Alta hecha por un administrador. NO devuelve token: no es un registro.
   *
   * El `clienteId` no se toma del cuerpo cuando quien crea es un usuario de
   * cliente: hereda el suyo, siempre (spec 4).
   */
  async create(datos, { actor, ownerClienteId = null } = {}) {
    const esActorDeCliente = actor?.alcance === 'cliente'

    const alcance = esActorDeCliente ? 'cliente' : datos.alcance || 'interno'
    const clienteId = esActorDeCliente
      ? ownerClienteId
      : alcance === 'cliente'
        ? datos.clienteId || null
        : null

    if (alcance === 'cliente') {
      await this.#assertClienteExiste(clienteId)
    }

    const existente = await User.findOne({ email: datos.email })
    if (existente) {
      throw AppError.validation('Ya existe un usuario con ese correo', [
        { msg: 'Ya existe un usuario con ese correo', path: 'email' }
      ])
    }

    return User.create({
      name: datos.name,
      email: datos.email,
      password: datos.password,
      nivelAcceso: datos.nivelAcceso,
      area: datos.nivelAcceso === 'jefe_area' ? datos.area : null,
      alcance,
      clienteId
    })
  }

  /**
   * Actualiza campos permitidos. La contraseña NO se cambia por aquí
   * (`POST /auth/cambiar-password` o restablecimiento por administrador).
   */
  async update(id, datos, { actor, scopeFilter = {} } = {}) {
    const usuario = await this.getById(id, { scopeFilter })

    if (datos.email && datos.email !== usuario.email) {
      const enUso = await User.findOne({ email: datos.email, _id: { $ne: id } })
      if (enUso) {
        throw AppError.validation('Ya existe un usuario con ese correo', [
          { msg: 'Ya existe un usuario con ese correo', path: 'email' }
        ])
      }
    }

    // Un usuario de cliente no puede mover a nadie fuera de su cliente.
    if (actor?.alcance === 'cliente') {
      delete datos.alcance
      delete datos.clienteId
    }

    for (const campo of [
      'name',
      'email',
      'nivelAcceso',
      'area',
      'alcance',
      'clienteId'
    ]) {
      if (datos[campo] !== undefined) usuario[campo] = datos[campo]
    }

    if (usuario.alcance === 'cliente') {
      await this.#assertClienteExiste(usuario.clienteId)
    }

    // Quitarse a sí mismo la administración deja el sistema sin quien administre.
    if (
      actor &&
      usuario._id.equals(actor._id) &&
      actor.nivelAcceso === 'rh_admin' &&
      usuario.nivelAcceso !== 'rh_admin'
    ) {
      await this.#assertQuedaOtroAdmin(usuario._id, scopeFilter)
    }

    await usuario.save()
    return usuario
  }

  /** Baja lógica (spec 9.2): nunca se borra, el histórico debe seguir legible. */
  async deactivate(id, { actor, scopeFilter = {} } = {}) {
    const usuario = await this.getById(id, { scopeFilter })

    if (actor && usuario._id.equals(actor._id)) {
      throw new AppError(400, 'No puedes darte de baja a ti mismo')
    }

    if (!usuario.active) return usuario

    if (usuario.nivelAcceso === 'rh_admin') {
      await this.#assertQuedaOtroAdmin(usuario._id, scopeFilter)
    }

    usuario.active = false
    await usuario.save()
    return usuario
  }

  async reactivate(id, { scopeFilter = {} } = {}) {
    const usuario = await this.getById(id, { scopeFilter })
    if (usuario.active) return usuario
    usuario.active = true
    await usuario.save()
    return usuario
  }

  /** El sistema nunca puede quedarse sin un `rh_admin` activo. */
  async #assertQuedaOtroAdmin(idExcluido, scopeFilter = {}) {
    const otros = await User.countDocuments({
      ...scopeFilter,
      _id: { $ne: idExcluido },
      nivelAcceso: 'rh_admin',
      active: true
    })
    if (otros === 0) {
      throw new AppError(
        400,
        'Debe quedar al menos un administrador activo. Asigna otro antes de continuar.'
      )
    }
  }

  async #assertClienteExiste(clienteId) {
    if (!clienteId) {
      throw AppError.validation(
        'Un usuario de cliente necesita el cliente al que pertenece',
        [{ msg: 'El cliente es requerido', path: 'clienteId' }]
      )
    }
    const existe = await Client.exists({ _id: clienteId, activo: true })
    if (!existe) {
      throw AppError.validation('El cliente indicado no existe', [
        { msg: 'El cliente indicado no existe', path: 'clienteId' }
      ])
    }
  }
}

module.exports = new UserService()
