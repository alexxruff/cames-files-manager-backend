const mongoose = require('mongoose')
const Project = require('./projectModel')
const Client = require('../clients/clientModel')
const Category = require('../categories/categoryModel')
const Assignment = require('../assignments/assignmentModel')
const portfolioService = require('../portfolios/portfolioService')
const { AppError } = require('../../../middlewares/errorHandler')
const { normalize, escapeRegex } = require('../../../utils/text')
const { today, isAfter, isBefore, daysBetween } = require('../../../utils/dates')
const { empresaEsVisible } = require('../../../middlewares/scopeMiddleware')

/**
 * Proyectos (backend-spec §6.4).
 *
 * Las cuatro reglas que el servidor impone y que no se pueden dejar al front:
 *
 * 1. **No hay proyecto sin cliente**, y el cliente debe estar en la **cartera
 *    activa** de la empresa del proyecto.
 * 2. Al menos una categoría habilitada: sin eso no se puede asignar a nadie y el
 *    proyecto nace inservible.
 * 3. **La fecha de cierre sólo se mueve con `aplazar`**, con motivo y quedando en
 *    el historial. `update` la rechaza en vez de permitirla en silencio: es
 *    auditoría, no un adorno.
 * 4. Un proyecto no se borra: se finaliza, y se puede reabrir.
 */
const POR_PAGINA_DEFECTO = 25
const POR_PAGINA_MAXIMO = 100

class ProjectService {
  async list(filtros = {}, contexto = {}) {
    const { empresaId, estado, clienteId, busqueda } = filtros
    const pagina = Math.max(1, Number(filtros.pagina) || 1)
    const porPagina = Math.min(
      POR_PAGINA_MAXIMO,
      Math.max(1, Number(filtros.porPagina) || POR_PAGINA_DEFECTO)
    )

    const filtro = {}
    const visibles = contexto.empresasVisibles

    if (empresaId) {
      if (!empresaEsVisible({ empresasVisibles: visibles }, empresaId)) {
        throw AppError.notFound('La empresa no existe')
      }
      filtro.empresaId = new mongoose.Types.ObjectId(empresaId)
    } else if (visibles !== null) {
      filtro.empresaId = {
        $in: (visibles || []).map((id) => new mongoose.Types.ObjectId(id))
      }
    }

    if (estado) filtro.estado = estado
    if (clienteId) filtro.clienteId = new mongoose.Types.ObjectId(clienteId)
    if (busqueda) {
      const termino = normalize(busqueda)
      if (termino) filtro.nombreNormalizado = new RegExp(escapeRegex(termino), 'i')
    }

    const [total, proyectos] = await Promise.all([
      Project.countDocuments(filtro),
      Project.find(filtro)
        // Lo que está por cerrar, primero: es lo que la gente busca.
        .sort({ estado: 1, fechaFinEstimada: 1 })
        .skip((pagina - 1) * porPagina)
        .limit(porPagina)
        .populate({ path: 'clienteId', select: 'nombre' })
        .populate({ path: 'empresaId', select: 'nombre' })
    ])

    return {
      total,
      pagina,
      porPagina,
      proyectos: proyectos.map((p) => this.#formatear(p))
    }
  }

  async getById(id, contexto = {}) {
    const proyecto = await this.#buscarVisible(id, contexto, { poblar: true })
    return { proyecto: this.#formatear(proyecto) }
  }

  async create(datos, contexto = {}) {
    if (
      !empresaEsVisible({ empresasVisibles: contexto.empresasVisibles }, datos.empresaId)
    ) {
      throw AppError.notFound('La empresa no existe')
    }

    await this.#assertClienteEnCartera(datos.empresaId, datos.clienteId)
    await this.#assertCategoriasValidas(datos.categorias)
    await this.#assertNombreLibre(datos.empresaId, datos.nombre)

    const proyecto = await Project.create({
      empresaId: datos.empresaId,
      clienteId: datos.clienteId,
      nombre: datos.nombre,
      fechaInicio: datos.fechaInicio,
      fechaFinEstimada: datos.fechaFinEstimada,
      categorias: datos.categorias
    })

    return this.getById(proyecto._id, contexto)
  }

  /** Nombre, cliente, fecha de inicio y categorías. **No** la fecha de cierre. */
  async update(id, datos, contexto = {}) {
    const proyecto = await this.#buscarVisible(id, contexto)

    if (datos.clienteId && String(datos.clienteId) !== String(proyecto.clienteId)) {
      await this.#assertClienteEnCartera(proyecto.empresaId, datos.clienteId)
      proyecto.clienteId = datos.clienteId
    }
    if (datos.categorias) {
      await this.#assertCategoriasValidas(datos.categorias)
      await this.#assertCategoriasNoEnUso(proyecto, datos.categorias)
      proyecto.categorias = datos.categorias
    }
    if (datos.nombre && normalize(datos.nombre) !== proyecto.nombreNormalizado) {
      await this.#assertNombreLibre(proyecto.empresaId, datos.nombre, proyecto._id)
      proyecto.nombre = datos.nombre
    }
    if (datos.fechaInicio) proyecto.fechaInicio = datos.fechaInicio

    await proyecto.save()
    return this.getById(proyecto._id, contexto)
  }

  /**
   * Mueve la fecha de cierre y **lo deja en el historial**: fecha anterior,
   * nueva, motivo, quién y cuándo. Es la única forma de moverla.
   */
  async aplazar(id, { fechaNueva, motivo }, contexto = {}) {
    const proyecto = await this.#buscarVisible(id, contexto)

    if (proyecto.estado === 'finalizado') {
      throw new AppError(
        400,
        'No se puede aplazar un proyecto finalizado. Reábrelo primero.'
      )
    }
    if (!isAfter(fechaNueva, proyecto.fechaFinEstimada)) {
      throw AppError.validation(
        `La fecha nueva debe ser posterior a la actual (${proyecto.fechaFinEstimada})`,
        [{ msg: 'La fecha nueva debe ser posterior a la actual', path: 'fechaNueva' }]
      )
    }

    const actor = contexto.user
    proyecto.aplazamientos.unshift({
      fechaAnterior: proyecto.fechaFinEstimada,
      fechaNueva,
      motivo,
      // El nombre, para que el histórico siga legible si la persona se va.
      registradoPor: actor?.nombre || 'Sistema',
      registradoPorId: actor?._id,
      registradoEn: new Date()
    })
    proyecto.fechaFinEstimada = fechaNueva

    await proyecto.save()
    return this.getById(proyecto._id, contexto)
  }

  /**
   * Finaliza el proyecto y **cierra las asignaciones abiertas** con la misma
   * fecha, en una transacción: una asignación activa en un proyecto terminado
   * contradice la regla de que no se asigna a un proyecto finalizado, y dejaría
   * gente "en obra" para siempre en los reportes.
   */
  async finalizar(id, { fechaFinReal }, contexto = {}) {
    const proyecto = await this.#buscarVisible(id, contexto)

    if (proyecto.estado === 'finalizado') {
      throw new AppError(400, 'El proyecto ya está finalizado')
    }
    if (isBefore(fechaFinReal, proyecto.fechaInicio)) {
      throw AppError.validation(
        'La fecha de cierre no puede ser anterior al inicio del proyecto',
        [
          {
            msg: 'La fecha de cierre no puede ser anterior al inicio',
            path: 'fechaFinReal'
          }
        ]
      )
    }

    const sesion = await mongoose.startSession()
    try {
      await sesion.withTransaction(async () => {
        proyecto.estado = 'finalizado'
        proyecto.fechaFinReal = fechaFinReal
        await proyecto.save({ session: sesion })

        await Assignment.updateMany(
          { proyectoId: proyecto._id, activo: true },
          { $set: { activo: false, fechaSalida: fechaFinReal } },
          { session: sesion }
        )
      })
    } finally {
      await sesion.endSession()
    }

    return this.getById(proyecto._id, contexto)
  }

  /**
   * Reabre: limpia `fechaFinReal` y vuelve a `en_curso`. Las asignaciones que se
   * cerraron al finalizar **no se reabren**: volver a poner a alguien en la obra
   * es una decisión, no un efecto secundario.
   */
  async reabrir(id, contexto = {}) {
    const proyecto = await this.#buscarVisible(id, contexto)

    if (proyecto.estado !== 'finalizado') {
      throw new AppError(400, 'El proyecto no está finalizado')
    }

    proyecto.estado = 'en_curso'
    proyecto.fechaFinReal = null
    await proyecto.save()

    return this.getById(proyecto._id, contexto)
  }

  /** Copia las categorías de otro proyecto: **suma sin quitar** y sin duplicar. */
  async clonarCategorias(id, { origenId }, contexto = {}) {
    const destino = await this.#buscarVisible(id, contexto)
    const origen = await this.#buscarVisible(origenId, contexto)

    if (String(origen._id) === String(destino._id)) {
      throw new AppError(400, 'El proyecto de origen debe ser distinto')
    }

    const antes = destino.categorias.map(String)
    const union = new Set([...antes, ...origen.categorias.map(String)])
    destino.categorias = [...union].map((c) => new mongoose.Types.ObjectId(c))
    await destino.save()

    const { proyecto } = await this.getById(destino._id, contexto)
    return { proyecto, agregadas: union.size - antes.length }
  }

  // ─── Validaciones compartidas ──────────────────────────────────────────────

  /** La regla que hace válido a un proyecto (spec §6.4). */
  async #assertClienteEnCartera(empresaId, clienteId) {
    const cliente = await Client.findById(clienteId)
    if (!cliente) throw AppError.notFound('El cliente no existe')

    if (!(await portfolioService.estaEnCarteraActiva(empresaId, clienteId))) {
      throw AppError.validation(
        `"${cliente.nombre}" no está en la cartera activa de esa empresa. Agrégalo a la cartera antes de crear el proyecto.`,
        [{ msg: 'El cliente no está en la cartera de la empresa', path: 'clienteId' }]
      )
    }
  }

  async #assertCategoriasValidas(categorias) {
    const ids = [...new Set((categorias || []).map(String))]
    if (ids.length === 0) {
      throw AppError.validation('Habilita al menos una categoría en el proyecto', [
        { msg: 'Habilita al menos una categoría', path: 'categorias' }
      ])
    }

    const activas = await Category.countDocuments({ _id: { $in: ids }, activo: true })
    if (activas !== ids.length) {
      throw AppError.validation('Alguna de las categorías no existe o está desactivada', [
        { msg: 'Categoría no válida', path: 'categorias' }
      ])
    }
  }

  /**
   * Quitar una categoría que alguien ya está usando en el proyecto dejaría
   * asignaciones inválidas: se avisa en vez de romper el historial.
   */
  async #assertCategoriasNoEnUso(proyecto, nuevas) {
    const quitadas = proyecto.categorias
      .map(String)
      .filter((c) => !nuevas.map(String).includes(c))
    if (quitadas.length === 0) return

    const enUso = await Assignment.countDocuments({
      proyectoId: proyecto._id,
      activo: true,
      categoriaId: { $in: quitadas }
    })
    if (enUso > 0) {
      throw new AppError(
        400,
        `No se puede quitar esa categoría: ${enUso} ${enUso === 1 ? 'persona asignada la tiene' : 'personas asignadas la tienen'}`
      )
    }
  }

  async #assertNombreLibre(empresaId, nombre, exceptoId = null) {
    const filtro = { empresaId, nombreNormalizado: normalize(nombre) }
    if (exceptoId) filtro._id = { $ne: exceptoId }

    const existente = await Project.findOne(filtro)
    if (existente) {
      throw AppError.conflict('Esa empresa ya tiene un proyecto con ese nombre', {
        code: 'PROYECTO_DUPLICADO',
        errors: [{ msg: 'Ya existe un proyecto con ese nombre', path: 'nombre' }],
        data: { proyecto: existente.toJSON() }
      })
    }
  }

  /** 404 si no existe o su empresa no es visible. */
  async #buscarVisible(id, contexto, { poblar = false } = {}) {
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError(400, 'El proyecto indicado no es válido')
    }

    const consulta = Project.findById(id)
    if (poblar) {
      consulta
        .populate({ path: 'clienteId', select: 'nombre' })
        .populate({ path: 'empresaId', select: 'nombre' })
    }
    const proyecto = await consulta
    if (!proyecto) throw AppError.notFound('El proyecto no existe')

    if (
      !empresaEsVisible(
        { empresasVisibles: contexto.empresasVisibles },
        proyecto.empresaId?._id || proyecto.empresaId
      )
    ) {
      throw AppError.notFound('El proyecto no existe')
    }
    return proyecto
  }

  /** Agrega los nombres de empresa y cliente, y los días que faltan para cerrar. */
  #formatear(proyecto) {
    const json = proyecto.toJSON()
    const cliente = proyecto.clienteId
    const empresa = proyecto.empresaId

    return {
      ...json,
      empresaId: (empresa?._id || empresa)?.toString() ?? null,
      clienteId: (cliente?._id || cliente)?.toString() ?? null,
      empresaNombre: empresa?.nombre ?? null,
      clienteNombre: cliente?.nombre ?? null,
      // Derivado, nunca almacenado: negativo si ya se pasó de la fecha.
      diasParaCierre:
        proyecto.estado === 'en_curso'
          ? daysBetween(today(), proyecto.fechaFinEstimada)
          : null
    }
  }
}

module.exports = new ProjectService()
