const mongoose = require('mongoose')
const Machine = require('./machineModel')
const Company = require('../companies/companyModel')
const storage = require('../../../services/storageService')
const intake = require('../../../services/attachmentIntake')
const { AppError } = require('../../../middlewares/errorHandler')
const { empresaEsVisible } = require('../../../middlewares/scopeMiddleware')
const { normalize, escapeRegex } = require('../../../utils/text')

/**
 * Catálogo de maquinaria por empresa (D-86).
 *
 * Tres reglas que impone el servidor:
 *
 * 1. **El catálogo es de la empresa.** Se lista y se da de alta bajo
 *    `/empresas/:id/maquinas`, y una máquina de una empresa fuera de alcance no
 *    existe: 404, nunca 403.
 * 2. **El identificador no se repite dentro de la empresa**, comparado sin
 *    acentos ni mayúsculas. Entre empresas sí puede repetirse.
 * 3. **La imagen es una imagen.** Entra por los dos caminos de siempre
 *    —`multipart` o `subidaId` (D-83)—, se reemplaza y no se versiona (D-79),
 *    y un PDF se rechaza con 415.
 */
class MachineService {
  /** GET /empresas/:id/maquinas */
  async listByCompany(
    empresaId,
    { incluirInactivas = false, busqueda } = {},
    contexto = {}
  ) {
    const empresa = await this.#buscarEmpresaVisible(empresaId, contexto)

    const filtro = { empresaId: empresa._id }
    if (!incluirInactivas) filtro.activo = true
    if (busqueda) {
      const termino = normalize(busqueda)
      if (termino) {
        const patron = new RegExp(escapeRegex(termino), 'i')
        // Por identificador o por modelo: es lo que la gente sabe de la máquina.
        filtro.$or = [{ identificadorNormalizado: patron }, { modeloNormalizado: patron }]
      }
    }

    const maquinas = await Machine.find(filtro)
      .sort({ identificador: 1 })
      .collation({ locale: 'es', numericOrdering: true })

    return {
      total: maquinas.length,
      maquinas: await Promise.all(maquinas.map((m) => this.#serializar(m)))
    }
  }

  /** GET /maquinas/:id */
  async getById(id, contexto = {}) {
    const maquina = await this.#buscarVisible(id, contexto)
    return { maquina: await this.#serializar(maquina) }
  }

  /** POST /empresas/:id/maquinas */
  async create(empresaId, datos, contexto = {}) {
    const empresa = await this.#buscarEmpresaVisible(empresaId, contexto)

    await this.#assertIdentificadorLibre(empresa._id, datos.identificador)

    /*
     * El id se genera aquí y no lo pone Mongoose al escribir, porque la clave
     * de la imagen en R2 cuelga de él y la foto sube ANTES que la base (D-79).
     */
    const id = new mongoose.Types.ObjectId()
    const entrada = await intake.resolver(datos, {
      destino: 'maquina',
      referencia: { empresaId: empresa._id },
      soloImagenes: true
    })
    const imagen = entrada
      ? await this.#guardarImagen({ _id: id }, entrada, contexto)
      : null

    try {
      const maquina = await Machine.create({
        _id: id,
        empresaId: empresa._id,
        identificador: datos.identificador,
        modelo: datos.modelo,
        imagen
      })
      return { maquina: await this.#serializar(maquina) }
    } catch (error) {
      // Lo recién subido se limpia: si la base no lo guardó, nadie lo alcanza.
      if (imagen) await storage.borrar(imagen.claveAlmacenamiento)
      throw this.#traducirChoque(error)
    }
  }

  /**
   * PATCH /maquinas/:id — identificador, modelo y/o la imagen.
   *
   * Acepta `multipart` con **sólo** la imagen y ningún campo, como el contrato
   * (D-81): así se le pone la foto a una máquina ya dada de alta.
   */
  async update(id, datos, contexto = {}) {
    const maquina = await this.#buscarVisible(id, contexto)

    if (datos.identificador !== undefined) {
      await this.#assertIdentificadorLibre(
        maquina.empresaId,
        datos.identificador,
        maquina._id
      )
      maquina.identificador = datos.identificador
    }
    if (datos.modelo !== undefined) maquina.modelo = datos.modelo

    /*
     * La imagen se reemplaza, no se versiona (D-79), y sólo si viene una nueva:
     * corregir el modelo no puede costar la foto. La anterior se borra al
     * final, cuando la base ya no la referencia.
     */
    const anterior = maquina.imagen?.claveAlmacenamiento ?? null
    const entrada = await intake.resolver(datos, {
      destino: 'maquina',
      referencia: { maquinaId: maquina._id },
      soloImagenes: true
    })
    const nueva = entrada ? await this.#guardarImagen(maquina, entrada, contexto) : null
    if (nueva) maquina.imagen = nueva

    try {
      await maquina.save()
    } catch (error) {
      if (nueva) await storage.borrar(nueva.claveAlmacenamiento)
      throw this.#traducirChoque(error)
    }

    if (nueva && anterior && anterior !== nueva.claveAlmacenamiento) {
      await storage.borrar(anterior)
    }

    return { maquina: await this.#serializar(maquina) }
  }

  /** PATCH /maquinas/:id/estado — la baja y la reactivación. */
  async setEstado(id, { activo }, contexto = {}) {
    const maquina = await this.#buscarVisible(id, contexto)

    if (maquina.activo === activo) {
      throw new AppError(
        400,
        activo ? 'La máquina ya está activa' : 'La máquina ya está dada de baja'
      )
    }

    maquina.activo = activo
    await maquina.save()
    return { maquina: await this.#serializar(maquina) }
  }

  /**
   * GET /maquinas/:id/imagen — un enlace fresco a la foto.
   *
   * La URL que viaja en cada máquina caduca a los 10 minutos y una ficha lleva
   * abierta más que eso; esto pide una nueva sin recargar el catálogo.
   */
  async urlDeImagen(id, contexto = {}) {
    const maquina = await this.#buscarVisible(id, contexto)

    if (!maquina.imagen) throw AppError.notFound('Esa máquina no tiene imagen')

    return {
      imagen: await storage.firmarAdjunto(maquina.imagen, maquina.identificador, {
        descargar: contexto.descargar === true ? true : null
      })
    }
  }

  /**
   * Que la máquina exista y sea visible, sin serializarla (D-83). Lo usa el
   * permiso de subida directa antes de firmar nada.
   */
  async assertVisible(id, contexto = {}) {
    return this.#buscarVisible(id, contexto)
  }

  /** Lo mismo para la empresa: el permiso del alta, cuando la máquina no existe. */
  async assertEmpresaVisible(empresaId, contexto = {}) {
    return this.#buscarEmpresaVisible(empresaId, contexto)
  }

  // ─── Interno ───────────────────────────────────────────────────────────────

  /** La máquina con la URL firmada de su imagen. */
  async #serializar(maquina) {
    const json = maquina.toJSON()
    return {
      ...json,
      imagen: await storage.firmarAdjunto(maquina.imagen, json.identificador)
    }
  }

  /**
   * Deja la imagen en su sitio y devuelve el subdocumento listo para guardar.
   * Al almacenamiento primero y a la base después, como todos los adjuntos: si
   * la base falla, quien llama borra el objeto recién guardado.
   */
  async #guardarImagen(maquina, entrada, contexto = {}) {
    const clave = storage.construirClaveAdjunto({
      carpeta: 'maquinas',
      ids: [maquina._id, 'imagen'],
      extension: entrada.tipoReal.extension
    })

    await entrada.guardarEn(clave)

    return {
      nombre: entrada.nombreOriginal || `imagen.${entrada.tipoReal.extension}`,
      mime: entrada.tipoReal.mime,
      tamanoBytes: entrada.tamanoBytes,
      subidoPor: contexto.user?.nombre || 'Sistema',
      subidoPorId: contexto.user?._id ?? null,
      subidoEn: new Date(),
      claveAlmacenamiento: clave
    }
  }

  async #assertIdentificadorLibre(empresaId, identificador, exceptoId = null) {
    const filtro = { empresaId, identificadorNormalizado: normalize(identificador) }
    if (exceptoId) filtro._id = { $ne: exceptoId }

    const existente = await Machine.findOne(filtro)
    if (existente) throw this.#errorDuplicada(existente)
  }

  /**
   * Dos altas simultáneas del mismo identificador pasan la comprobación previa
   * y una choca contra el índice: se traduce al mismo 409 que la otra.
   */
  #traducirChoque(error) {
    if (error.code !== 11000) return error
    const campos = Object.keys(error.keyPattern || error.keyValue || {})
    if (!campos.includes('identificadorNormalizado')) return error
    return this.#errorDuplicada(null)
  }

  /** Con la que ya está, cuando se sabe: el front puede abrirla desde el aviso. */
  #errorDuplicada(existente) {
    return AppError.conflict('Esa empresa ya tiene una máquina con ese identificador', {
      code: 'MAQUINA_DUPLICADA',
      errors: [
        { msg: 'Ya existe una máquina con ese identificador', path: 'identificador' }
      ],
      data: existente ? { maquina: existente.toJSON() } : undefined
    })
  }

  /** 404 si la empresa no existe o no es visible. */
  async #buscarEmpresaVisible(empresaId, contexto) {
    if (!mongoose.isValidObjectId(empresaId)) {
      throw new AppError(400, 'La empresa indicada no es válida')
    }
    if (
      !empresaEsVisible(
        { empresasVisibles: contexto.empresasVisibles ?? null },
        empresaId
      )
    ) {
      throw AppError.notFound('La empresa no existe')
    }
    const empresa = await Company.findById(empresaId).select('_id activo')
    if (!empresa) throw AppError.notFound('La empresa no existe')
    return empresa
  }

  /** 404 si no existe o su empresa no es visible. */
  async #buscarVisible(id, contexto) {
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError(400, 'La máquina indicada no es válida')
    }

    const maquina = await Machine.findById(id)
    if (
      !maquina ||
      !empresaEsVisible(
        { empresasVisibles: contexto.empresasVisibles ?? null },
        maquina.empresaId
      )
    ) {
      throw AppError.notFound('La máquina no existe')
    }
    return maquina
  }
}

module.exports = new MachineService()
