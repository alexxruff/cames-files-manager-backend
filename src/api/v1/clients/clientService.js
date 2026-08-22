const mongoose = require('mongoose')
const Client = require('./clientModel')
const { AppError } = require('../../../middlewares/errorHandler')
const { normalize, escapeRegex } = require('../../../utils/text')

/**
 * Clientes — catálogo compartido (backend-spec §6.2, modelo-datos §5.3).
 *
 * NO pertenece a ninguna empresa: es el mismo cliente para todo el grupo. Qué
 * empresa lo usa se registrará en `carteras`, que todavía no existe.
 *
 * ALCANCE, PENDIENTE: según modelo-datos §8.1, el listado debería mostrar «los
 * clientes de las carteras de mis empresas». Sin `carteras` eso no se puede
 * filtrar, así que hoy cualquiera con sesión ve el catálogo completo. Cuando
 * exista, el listado se acota y el front verá menos clientes que ahora — está
 * avisado en la guía para que no lo tome por un bug.
 */
const POR_PAGINA_DEFECTO = 25
const POR_PAGINA_MAXIMO = 100

class ClientService {
  /** Listado paginado. Mismos parámetros que `/empleados`, por consistencia. */
  async list({
    busqueda,
    incluirInactivos = false,
    orden = 'nombre_asc',
    ...paginacion
  } = {}) {
    const pagina = Math.max(1, Number(paginacion.pagina) || 1)
    const porPagina = Math.min(
      POR_PAGINA_MAXIMO,
      Math.max(1, Number(paginacion.porPagina) || POR_PAGINA_DEFECTO)
    )

    const filtro = {}
    if (!incluirInactivos) filtro.activo = true
    if (busqueda) {
      const termino = normalize(busqueda)
      if (termino) filtro.nombreNormalizado = new RegExp(escapeRegex(termino), 'i')
    }

    const [total, clientes] = await Promise.all([
      Client.countDocuments(filtro),
      Client.find(filtro)
        .sort({ nombre: orden === 'nombre_desc' ? -1 : 1 })
        .collation({ locale: 'es' })
        .skip((pagina - 1) * porPagina)
        .limit(porPagina)
    ])

    return { total, pagina, porPagina, clientes: clientes.map((c) => c.toJSON()) }
  }

  async getById(id) {
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError(400, 'El cliente indicado no es válido')
    }
    const cliente = await Client.findById(id)
    if (!cliente) throw AppError.notFound('El cliente no existe')
    return { cliente: cliente.toJSON() }
  }

  async create(datos) {
    await this.#assertNombreLibre(datos.nombre)
    await this.#assertRfcLibre(datos.rfc)

    const cliente = await Client.create(this.#soloCamposPermitidos(datos))
    return { cliente: cliente.toJSON() }
  }

  async update(id, datos) {
    const cliente = await Client.findById(id)
    if (!cliente) throw AppError.notFound('El cliente no existe')

    if (datos.nombre && normalize(datos.nombre) !== cliente.nombreNormalizado) {
      await this.#assertNombreLibre(datos.nombre, cliente._id)
    }
    if (datos.rfc) {
      await this.#assertRfcLibre(datos.rfc, cliente._id)
    }

    Object.assign(cliente, this.#soloCamposPermitidos(datos, { parcial: true }))
    await cliente.save()

    return { cliente: cliente.toJSON() }
  }

  /**
   * Activa o desactiva. Es la «eliminación» del catálogo: **nada se borra**,
   * porque un cliente puede tener proyectos e historial colgando y un expediente
   * es un registro de auditoría (modelo-datos §4).
   */
  async setEstado(id, activo) {
    const cliente = await Client.findById(id)
    if (!cliente) throw AppError.notFound('El cliente no existe')

    if (!activo) await this.#assertSePuedeDesactivar(cliente)

    cliente.activo = activo
    await cliente.save()
    return { cliente: cliente.toJSON() }
  }

  /** Sólo estos campos; el resto se ignora en vez de escribirse por accidente. */
  #soloCamposPermitidos(datos, { parcial = false } = {}) {
    const campos = [
      'nombre',
      'rfc',
      'contactoNombre',
      'contactoEmail',
      'contactoTelefono'
    ]
    const limpio = {}
    for (const campo of campos) {
      if (parcial && datos[campo] === undefined) continue
      // Un opcional vacío es "sin valor", no cadena vacía (regla del contrato).
      limpio[campo] = datos[campo] === '' ? null : (datos[campo] ?? null)
    }
    return limpio
  }

  async #assertNombreLibre(nombre, exceptoId = null) {
    const filtro = { nombreNormalizado: normalize(nombre) }
    if (exceptoId) filtro._id = { $ne: exceptoId }

    const existente = await Client.findOne(filtro)
    if (existente) {
      throw AppError.conflict('Ya existe un cliente con ese nombre', {
        code: 'CLIENTE_DUPLICADO',
        errors: [{ msg: 'Ya existe un cliente con ese nombre', path: 'nombre' }],
        // Con el id, la interfaz puede ofrecer «ya existe, ¿lo usas?» en vez de
        // dejar a la persona atorada en un error.
        data: { cliente: existente.toJSON() }
      })
    }
  }

  async #assertRfcLibre(rfc, exceptoId = null) {
    if (!rfc) return
    const filtro = { rfc: String(rfc).toUpperCase().trim() }
    if (exceptoId) filtro._id = { $ne: exceptoId }

    const existente = await Client.findOne(filtro)
    if (existente) {
      throw AppError.conflict('Ya existe un cliente con ese RFC', {
        code: 'RFC_DUPLICADO',
        errors: [{ msg: 'Ya existe un cliente con ese RFC', path: 'rfc' }],
        data: { cliente: existente.toJSON() }
      })
    }
  }

  /**
   * TODO: cuando existan `proyectos` y `carteras`, desactivar debe fallar si el
   * cliente tiene **proyectos en curso** (backend-spec §6.2). Hoy esas
   * colecciones no existen, así que no hay nada que comprobar; el hueco queda
   * aquí para que se llene en su paso y no se olvide en un servicio distinto.
   */
  async #assertSePuedeDesactivar() {
    return true
  }
}

module.exports = new ClientService()
