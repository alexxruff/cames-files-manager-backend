const mongoose = require('mongoose')
const Client = require('./clientModel')
const Portfolio = require('../portfolios/portfolioModel')
const Project = require('../projects/projectModel')
const storage = require('../../../services/storageService')
const { AppError } = require('../../../middlewares/errorHandler')
const { normalize, escapeRegex } = require('../../../utils/text')
const { attachmentToJson } = require('../../../utils/attachments')
const { detectarTipo, mensajeTipoNoPermitido } = require('../../../utils/fileTypes')
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

    return {
      total,
      pagina,
      porPagina,
      clientes: await Promise.all(clientes.map((c) => this.#conArchivos(c)))
    }
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

    await this.#assertEnAlcance(cliente, contexto)
    return { cliente: await this.#conArchivos(cliente) }
  }

  /**
   * Quien ADMINISTRA clientes ve el catálogo completo (D-40): es compartido, y
   * acotarlo por cartera le impediría dar de alta a quien todavía no está en
   * ninguna. Al resto se le exige que esté en la cartera de una empresa suya, y
   * fuera de alcance es **404, no 403**.
   */
  async #assertEnAlcance(cliente, contexto) {
    const acceso = contexto.user?.acceso
    if (isPlatformAdmin(acceso) || can(acceso, CAPABILITIES.MANAGE_CLIENTS)) return

    const enSuCartera = await Portfolio.exists({
      clienteId: cliente._id,
      activo: true,
      empresaId: {
        $in: (contexto.empresasVisibles || []).map(
          (empresaId) => new mongoose.Types.ObjectId(empresaId)
        )
      }
    })
    if (!enSuCartera) throw AppError.notFound('El cliente no existe')
  }

  async create(datos) {
    await this.#assertNombreLibre(datos.nombre)
    await this.#assertRfcLibre(datos.rfc)

    const cliente = await Client.create(this.#soloCamposPermitidos(datos))
    return { cliente: await this.#conArchivos(cliente) }
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

    return { cliente: await this.#conArchivos(cliente) }
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
    return { cliente: await this.#conArchivos(cliente) }
  }

  // ─── Registros de obra (D-66) ─────────────────────────────────────────────

  /**
   * Alta de un registro de obra. **Idempotente por número**, igual que los
   * registros patronales (D-65) y por lo mismo: la interfaz no tiene que
   * preguntar antes de crear.
   */
  async agregarRegistroObra(clienteId, { numero, descripcion, archivo }, contexto = {}) {
    const cliente = await this.#buscarEnAlcance(clienteId, contexto)
    const buscado = String(numero).trim().toUpperCase()

    const existente = cliente.registrosObra.find((r) => r.numero === buscado)
    /*
     * Ya estaba. Si además venía archivo se guarda igual: quien llenó el
     * formulario con número y archivo espera que el archivo quede, y la
     * alternativa —descartarlo en silencio— es la peor de las dos.
     */
    if (existente) {
      if (archivo) await this.#guardarArchivo(cliente, existente, archivo, contexto)
      return {
        cliente: await this.#conArchivos(cliente),
        registro: await this.#registroFirmado(existente),
        yaExistia: true
      }
    }

    cliente.registrosObra.push({ numero: buscado, descripcion: descripcion || null })
    const creado = cliente.registrosObra.find((r) => r.numero === buscado)

    if (archivo) await this.#guardarArchivo(cliente, creado, archivo, contexto)
    else await cliente.save()

    return {
      cliente: await this.#conArchivos(cliente),
      registro: await this.#registroFirmado(creado),
      yaExistia: false
    }
  }

  /**
   * Corregir número o descripción. El **número sí se puede cambiar**: quien lo
   * referencie apunta al `_id`, así que corregir un dígito no rompe nada.
   */
  async actualizarRegistroObra(clienteId, registroId, datos, contexto = {}) {
    const { cliente, registro } = await this.#buscarRegistroObra(
      clienteId,
      registroId,
      contexto
    )

    if (datos.numero !== undefined) registro.numero = datos.numero
    if (datos.descripcion !== undefined) registro.descripcion = datos.descripcion || null

    if (datos.archivo)
      await this.#guardarArchivo(cliente, registro, datos.archivo, contexto)
    else await cliente.save()

    return {
      cliente: await this.#conArchivos(cliente),
      registro: await this.#registroFirmado(registro)
    }
  }

  /**
   * Dar de baja o reactivar.
   *
   * No lo borra: un proyecto finalizado puede seguir apuntando a uno que ya no
   * se usa para obras nuevas. Pero **no se da de baja uno que un proyecto EN
   * CURSO esté usando** (D-67), que además es el que da los SIROC de sus
   * contratos.
   */
  async setEstadoRegistroObra(clienteId, registroId, activo, contexto = {}) {
    const { cliente, registro } = await this.#buscarRegistroObra(
      clienteId,
      registroId,
      contexto
    )

    if (!activo) {
      const enUso = await Project.countDocuments({
        registroObraId: registro._id,
        estado: 'en_curso'
      })
      if (enUso > 0) {
        throw new AppError(
          400,
          `No se puede dar de baja: ${enUso} ${enUso === 1 ? 'proyecto en curso lo usa' : 'proyectos en curso lo usan'}. Ciérralos o cámbiales el registro primero.`
        )
      }
    }

    registro.activo = activo
    await cliente.save()
    return {
      cliente: await this.#conArchivos(cliente),
      registro: await this.#registroFirmado(registro)
    }
  }

  /**
   * URL firmada del archivo, para abrirlo o descargarlo (D-79).
   *
   * Existe además de la URL que ya viaja en cada registro porque esa caduca a
   * los 10 minutos: sin esto, quien deja la pantalla abierta un rato tiene que
   * recargar el cliente entero para volver a bajar el mismo papel.
   */
  async urlDeArchivoRegistroObra(clienteId, registroId, contexto = {}) {
    const { registro } = await this.#buscarRegistroObra(clienteId, registroId, contexto)

    if (!registro.archivo) {
      throw AppError.notFound('Ese registro de obra no tiene archivo')
    }

    return {
      archivo: await storage.firmarAdjunto(registro.archivo, registro.numero, {
        descargar: contexto.descargar === true ? true : null
      })
    }
  }

  /**
   * Guarda el archivo del registro y **borra el que reemplaza**.
   *
   * Al almacenamiento primero y a la base después, como en el expediente: si la
   * base falla, se limpia el objeto recién subido en vez de dejarlo huérfano. El
   * anterior se borra al final, cuando ya nadie lo referencia — al revés, un
   * fallo al guardar dejaría el registro apuntando a un archivo borrado.
   */
  async #guardarArchivo(cliente, registro, archivo, contexto = {}) {
    const tipoReal = detectarTipo(archivo.buffer, archivo.nombreOriginal)
    if (!tipoReal) throw new AppError(415, mensajeTipoNoPermitido(archivo.buffer))

    const clave = storage.construirClaveAdjunto({
      carpeta: 'registros-obra',
      ids: [cliente._id, registro._id],
      extension: tipoReal.extension
    })

    await storage.subir({
      buffer: archivo.buffer,
      clave,
      contentType: tipoReal.mime
    })

    const anterior = registro.archivo?.claveAlmacenamiento || null

    registro.archivo = {
      nombre: archivo.nombreOriginal || `registro-obra.${tipoReal.extension}`,
      mime: tipoReal.mime,
      tamanoBytes: archivo.buffer.length,
      subidoPor: contexto.user?.nombre || 'Sistema',
      subidoPorId: contexto.user?._id ?? null,
      subidoEn: new Date(),
      claveAlmacenamiento: clave
    }

    try {
      await cliente.save()
    } catch (error) {
      await storage.borrar(clave)
      throw error
    }

    if (anterior && anterior !== clave) await storage.borrar(anterior)
  }

  /** El cliente serializado, con la URL firmada de cada archivo. */
  async #conArchivos(cliente) {
    const json = cliente.toJSON()

    json.registrosObra = await Promise.all(
      (cliente.registrosObra || [])
        .filter((r) => r && r.numero)
        .map((r) => this.#registroFirmado(r))
    )

    return json
  }

  async #registroFirmado(r) {
    return {
      ...this.#registro(r),
      archivo: await storage.firmarAdjunto(r.archivo, r.numero)
    }
  }

  #registro(r) {
    return {
      _id: r._id.toString(),
      numero: r.numero,
      descripcion: r.descripcion ?? null,
      // Sin `url`: firmarla es asíncrono. `#registroFirmado` la agrega.
      archivo: attachmentToJson(r.archivo),
      activo: r.activo
    }
  }

  /** El cliente, comprobando el alcance. Una sola consulta, no dos. */
  async #buscarEnAlcance(clienteId, contexto) {
    if (!mongoose.isValidObjectId(clienteId)) {
      throw new AppError(400, 'El cliente indicado no es válido')
    }
    const cliente = await Client.findById(clienteId)
    if (!cliente) throw AppError.notFound('El cliente no existe')

    await this.#assertEnAlcance(cliente, contexto)
    return cliente
  }

  async #buscarRegistroObra(clienteId, registroId, contexto) {
    const cliente = await this.#buscarEnAlcance(clienteId, contexto)
    if (!mongoose.isValidObjectId(registroId)) {
      throw new AppError(400, 'El registro de obra indicado no es válido')
    }
    const registro = cliente.registrosObra.id(registroId)
    if (!registro) throw AppError.notFound('El registro de obra no existe')
    return { cliente, registro }
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
        data: { cliente: await this.#conArchivos(existente) }
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
        data: { cliente: await this.#conArchivos(existente) }
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
