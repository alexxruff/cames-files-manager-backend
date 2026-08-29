const mongoose = require('mongoose')
const Contract = require('./contractModel')
const Project = require('../projects/projectModel')
const { AppError } = require('../../../middlewares/errorHandler')
const { empresaEsVisible } = require('../../../middlewares/scopeMiddleware')

/**
 * Contratos de un proyecto y su SIROC (backend-spec §6.7, plan §C4, D-70).
 *
 * El alcance **no se comprueba sobre el contrato**, sino sobre el proyecto al
 * que pertenece: es el proyecto el que tiene empresa, y la empresa la que decide
 * quién lo ve. Un contrato de un proyecto fuera de alcance responde 404, no 403.
 */
class ContractService {
  /** GET /proyectos/:id/contratos */
  async listByProject(proyectoId, { incluirInactivos = false } = {}, contexto = {}) {
    const proyecto = await this.#buscarProyectoVisible(proyectoId, contexto)

    const filtro = { proyectoId: proyecto._id }
    if (!incluirInactivos) filtro.activo = true

    const contratos = await Contract.find(filtro).sort({ numero: 1 })
    return { contratos: contratos.map((c) => c.toJSON()) }
  }

  /** POST /proyectos/:id/contratos */
  async create(proyectoId, datos, contexto = {}) {
    const proyecto = await this.#buscarProyectoVisible(proyectoId, contexto)

    if (proyecto.estado === 'finalizado') {
      throw new AppError(400, 'No se pueden agregar contratos a un proyecto finalizado')
    }

    /*
     * El número es una secuencia y la asigna el servidor. Se reintenta porque dos
     * altas simultáneas calcularían el mismo siguiente y una chocaría contra el
     * índice único: reintentar recalcula sobre el estado ya escrito.
     */
    for (let intento = 0; intento < 3; intento++) {
      try {
        const contrato = await Contract.create({
          proyectoId: proyecto._id,
          numero: await this.#siguienteNumero(proyecto._id),
          nombre: datos.nombre ?? null,
          fechaInicio: datos.fechaInicio,
          fechaFin: datos.fechaFin
        })
        return { contrato: contrato.toJSON() }
      } catch (error) {
        const chocaElNumero = error.code === 11000 && !this.#esChoqueDeSiroc(error)
        if (!chocaElNumero || intento === 2) throw error
      }
    }
  }

  /** PATCH /contratos/:id — nombre y fechas. El SIROC y el estado, no. */
  async update(id, datos, contexto = {}) {
    const { contrato } = await this.#buscarVisible(id, contexto)

    if (datos.nombre !== undefined) contrato.nombre = datos.nombre || null
    if (datos.fechaInicio !== undefined) contrato.fechaInicio = datos.fechaInicio
    if (datos.fechaFin !== undefined) contrato.fechaFin = datos.fechaFin

    await contrato.save()
    return { contrato: contrato.toJSON() }
  }

  /**
   * PUT /contratos/:id/siroc — registrarlo o corregirlo.
   *
   * `PUT` y no `PATCH` porque reemplaza el SIROC entero: mandar sólo la vigencia
   * y dejar el número anterior sería exactamente la mezcla que produce avisos de
   * obra a medias.
   */
  async setSiroc(id, datos, contexto = {}) {
    const { contrato } = await this.#buscarVisible(id, contexto)

    const numero = String(datos.numero).trim().toUpperCase()

    /*
     * Se consulta antes de escribir para poder decir DÓNDE está el choque —el
     * proyecto y el contrato que ya lo tienen—, que es lo que necesita quien
     * captura. El índice único sigue siendo la garantía real: esta consulta sólo
     * mejora el mensaje, y la carrera la sigue atrapando el `catch`.
     */
    const choque = await this.#buscarChoqueDeSiroc(numero, contrato._id)
    if (choque) throw choque

    contrato.siroc = {
      numero,
      fechaRegistro: datos.fechaRegistro,
      vigenciaHasta: datos.vigenciaHasta ?? null
    }

    try {
      await contrato.save()
    } catch (error) {
      if (this.#esChoqueDeSiroc(error)) {
        throw (
          (await this.#buscarChoqueDeSiroc(numero, contrato._id)) ||
          AppError.conflict(`El SIROC ${numero} ya está registrado en otro contrato`, {
            code: 'SIROC_DUPLICADO'
          })
        )
      }
      throw error
    }

    return { contrato: contrato.toJSON() }
  }

  /**
   * DELETE /contratos/:id/siroc — quitarlo.
   *
   * Existe porque el número es único global: un SIROC capturado en el contrato
   * equivocado deja ese número bloqueado para siempre, y corregirlo en el
   * contrato correcto sería imposible. Quitar el SIROC **también libera** el
   * registro de obra del proyecto, que estaba bloqueado por él (G3).
   */
  async quitarSiroc(id, contexto = {}) {
    const { contrato } = await this.#buscarVisible(id, contexto)

    if (!contrato.siroc) throw new AppError(400, 'Ese contrato no tiene SIROC registrado')

    contrato.siroc = null
    await contrato.save()
    return { contrato: contrato.toJSON() }
  }

  /** POST /contratos/:id/finalizar */
  async finalizar(id, contexto = {}) {
    const { contrato } = await this.#buscarVisible(id, contexto)

    if (contrato.estado === 'finalizado') {
      throw new AppError(400, 'Ese contrato ya está finalizado')
    }

    contrato.estado = 'finalizado'
    await contrato.save()
    return { contrato: contrato.toJSON() }
  }

  /** POST /contratos/:id/reabrir */
  async reabrir(id, contexto = {}) {
    const { contrato, proyecto } = await this.#buscarVisible(id, contexto)

    if (contrato.estado === 'en_curso') {
      throw new AppError(400, 'Ese contrato ya está en curso')
    }
    if (proyecto.estado === 'finalizado') {
      throw new AppError(
        400,
        'El proyecto está finalizado. Reábrelo antes de reabrir sus contratos.'
      )
    }

    contrato.estado = 'en_curso'
    await contrato.save()
    return { contrato: contrato.toJSON() }
  }

  /** PATCH /contratos/:id/estado — la baja, distinta de finalizar. */
  async setEstado(id, { activo }, contexto = {}) {
    const { contrato } = await this.#buscarVisible(id, contexto)

    contrato.activo = activo
    await contrato.save()
    return { contrato: contrato.toJSON() }
  }

  // ─── Lo que consulta el proyecto para sus candados (G3) ────────────────────

  /** Cuántos contratos VIVOS cuelgan del proyecto. */
  async contarPorProyecto(proyectoId) {
    return Contract.countDocuments({ proyectoId, activo: true })
  }

  /** Si alguno de ellos ya tiene SIROC. */
  async algunoConSiroc(proyectoId) {
    const conSiroc = await Contract.countDocuments({
      proyectoId,
      activo: true,
      'siroc.numero': { $type: 'string' }
    })
    return conSiroc > 0
  }

  // ─── Interno ───────────────────────────────────────────────────────────────

  async #siguienteNumero(proyectoId) {
    // Incluye los dados de baja: reusar su número chocaría contra el índice.
    const ultimo = await Contract.findOne({ proyectoId })
      .sort({ numero: -1 })
      .select('numero')
    return (ultimo?.numero ?? 0) + 1
  }

  #esChoqueDeSiroc(error) {
    if (error.code !== 11000) return false
    const campos = Object.keys(error.keyPattern || error.keyValue || {})
    return campos.includes('siroc.numero')
  }

  /** El 409 con el contrato y el proyecto que ya lo usan, o `null` si no hay. */
  async #buscarChoqueDeSiroc(numero, exceptoId) {
    const otro = await Contract.findOne({
      'siroc.numero': numero,
      _id: { $ne: exceptoId }
    }).populate({ path: 'proyectoId', select: 'nombre' })

    if (!otro) return null

    const nombreProyecto = otro.proyectoId?.nombre ?? 'otro proyecto'
    return AppError.conflict(
      `El SIROC ${numero} ya está registrado en el contrato ${otro.numero} de ${nombreProyecto}`,
      {
        code: 'SIROC_DUPLICADO',
        data: {
          contratoId: otro._id.toString(),
          contratoNumero: otro.numero,
          proyectoId: otro.proyectoId?._id?.toString() ?? null,
          proyectoNombre: otro.proyectoId?.nombre ?? null
        }
      }
    )
  }

  async #buscarVisible(id, contexto) {
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError(400, 'El contrato indicado no es válido')
    }
    const contrato = await Contract.findById(id)
    if (!contrato) throw AppError.notFound('El contrato no existe')

    const proyecto = await this.#buscarProyectoVisible(contrato.proyectoId, contexto, {
      mensaje: 'El contrato no existe'
    })
    return { contrato, proyecto }
  }

  async #buscarProyectoVisible(proyectoId, contexto, { mensaje } = {}) {
    if (!mongoose.isValidObjectId(proyectoId)) {
      throw new AppError(400, 'El proyecto indicado no es válido')
    }
    const proyecto = await Project.findById(proyectoId)
    if (!proyecto) throw AppError.notFound(mensaje || 'El proyecto no existe')

    if (
      !empresaEsVisible(
        { empresasVisibles: contexto.empresasVisibles },
        proyecto.empresaId
      )
    ) {
      throw AppError.notFound(mensaje || 'El proyecto no existe')
    }
    return proyecto
  }
}

module.exports = new ContractService()
