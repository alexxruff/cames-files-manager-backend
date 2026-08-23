const mongoose = require('mongoose')
const Client = require('./clientModel')
const Portfolio = require('../portfolios/portfolioModel')
const { AppError } = require('../../../middlewares/errorHandler')
const { normalize, escapeRegex } = require('../../../utils/text')
const { CAPABILITIES, can, isPlatformAdmin } = require('../../../utils/permissions')

/**
 * Clientes — catálogo compartido (backend-spec §6.2, modelo-datos §5.3).
 *
 * NO pertenece a ninguna empresa: es el mismo cliente para todo el grupo. Qué
 * empresa lo usa se registrará en `carteras`, que todavía no existe.
 *
 * ALCANCE (modelo-datos §8.1). El listado devuelve **los clientes de las carteras
 * activas de las empresas visibles**, no el catálogo completo. El administrador de
 * plataforma ve todo, porque administra el catálogo.
 *
 * Con una excepción necesaria: `catalogoCompleto=true` devuelve el catálogo global
 * y **exige poder administrar clientes**. Sin esa salida, quien va a meter un
 * cliente a su cartera no puede comprobar si ya existe en el grupo y termina
 * creando un duplicado — que es justo lo que el catálogo compartido viene a
 * evitar.
 */
const POR_PAGINA_DEFECTO = 25
const POR_PAGINA_MAXIMO = 100

class ClientService {
  /**
   * Listado paginado, acotado por alcance.
   *
   * @param {object} filtros
   * @param {boolean} [filtros.catalogoCompleto] Ver el catálogo global en vez de
   *   sólo los clientes de las carteras propias. Exige administrar clientes.
   * @param {object} contexto `{ user, empresasVisibles }`
   */
  async list(
    {
      busqueda,
      incluirInactivos = false,
      orden = 'nombre_asc',
      catalogoCompleto = false,
      ...paginacion
    } = {},
    contexto = {}
  ) {
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

    const idsPermitidos = await this.#idsEnAlcance(contexto, catalogoCompleto)
    if (idsPermitidos !== null) {
      if (idsPermitidos.length === 0) {
        return { total: 0, pagina, porPagina, clientes: [] }
      }
      filtro._id = { $in: idsPermitidos }
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

  /**
   * Los ids de cliente que este usuario puede ver, o `null` si no hay límite.
   *
   * `null` = sin filtro: administrador de plataforma, o alguien que pidió el
   * catálogo completo y puede administrar clientes.
   */
  async #idsEnAlcance({ user, empresasVisibles = null } = {}, catalogoCompleto = false) {
    if (isPlatformAdmin(user?.acceso)) return null

    if (catalogoCompleto) {
      if (!can(user?.acceso, CAPABILITIES.MANAGE_CLIENTS)) {
        throw AppError.forbidden(
          'No tienes permiso para consultar el catálogo completo de clientes'
        )
      }
      return null
    }

    // Los de las carteras ACTIVAS de sus empresas.
    const carteras = await Portfolio.find({
      empresaId: {
        $in: (empresasVisibles || []).map((id) => new mongoose.Types.ObjectId(id))
      },
      activo: true
    }).select('clienteId')

    return [...new Set(carteras.map((c) => String(c.clienteId)))].map(
      (id) => new mongoose.Types.ObjectId(id)
    )
  }

  /**
   * Un cliente por id. Visible si está en una cartera propia, o si quien pregunta
   * administra clientes (necesita ver el catálogo para no duplicar).
   */
  async getById(id, contexto = {}) {
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError(400, 'El cliente indicado no es válido')
    }
    const cliente = await Client.findById(id)
    if (!cliente) throw AppError.notFound('El cliente no existe')

    const acceso = contexto.user?.acceso
    const puedeVerCatalogo =
      isPlatformAdmin(acceso) || can(acceso, CAPABILITIES.MANAGE_CLIENTS)

    if (!puedeVerCatalogo) {
      const enSuCartera = await Portfolio.exists({
        clienteId: cliente._id,
        activo: true,
        empresaId: {
          $in: (contexto.empresasVisibles || []).map(
            (empresaId) => new mongoose.Types.ObjectId(empresaId)
          )
        }
      })
      // Fuera de alcance: 404, no 403.
      if (!enSuCartera) throw AppError.notFound('El cliente no existe')
    }

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
