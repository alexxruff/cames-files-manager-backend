const mongoose = require('mongoose')
const Portfolio = require('./portfolioModel')
const Client = require('../clients/clientModel')
const Company = require('../companies/companyModel')
const { AppError } = require('../../../middlewares/errorHandler')
const { empresaEsVisible } = require('../../../middlewares/scopeMiddleware')

/**
 * Carteras — empresa ↔ cliente (backend-spec §6.3).
 *
 * Es la pieza que hace posible el proyecto: **no hay proyecto sin cliente, y el
 * cliente tiene que estar en la cartera activa de la empresa del proyecto**.
 */
class PortfolioService {
  /** Los clientes de la cartera de una empresa, con los datos del catálogo. */
  async list(empresaId, { activo } = {}, contexto = {}) {
    await this.#assertEmpresaVisible(empresaId, contexto)

    const filtro = { empresaId: new mongoose.Types.ObjectId(empresaId) }
    if (activo !== undefined) filtro.activo = activo

    const carteras = await Portfolio.find(filtro)
      .populate({ path: 'clienteId', select: 'nombre rfc activo' })
      .sort({ createdAt: -1 })

    return {
      // Cada renglón lleva el vínculo Y el cliente: la pantalla necesita el
      // nombre, y pedirlo aparte serían N+1 peticiones.
      cartera: carteras
        .filter((c) => c.clienteId)
        .map((c) => ({
          ...c.toJSON(),
          cliente: {
            _id: c.clienteId._id.toString(),
            nombre: c.clienteId.nombre,
            rfc: c.clienteId.rfc ?? null,
            activo: c.clienteId.activo
          }
        }))
    }
  }

  /**
   * Mete un cliente del catálogo a la cartera de una empresa.
   *
   * Si el vínculo existe pero está inactivo, se **reactiva** en vez de crear
   * otro: el índice único lo impide y además duplicarlo perdería las notas y el
   * contacto que ya tenía.
   */
  async add(empresaId, datos, contexto = {}) {
    await this.#assertEmpresaVisible(empresaId, contexto)

    const cliente = await Client.findById(datos.clienteId)
    if (!cliente) throw AppError.notFound('El cliente no existe')
    if (!cliente.activo) {
      throw new AppError(400, 'Ese cliente está desactivado en el catálogo')
    }

    const existente = await Portfolio.findOne({ empresaId, clienteId: cliente._id })

    if (existente && existente.activo) {
      throw AppError.conflict('Ese cliente ya está en la cartera de la empresa', {
        code: 'CARTERA_DUPLICADA',
        data: { cartera: existente.toJSON() }
      })
    }

    const campos = {
      contactoNombre: datos.contactoNombre ?? null,
      contactoEmail: datos.contactoEmail ?? null,
      contactoTelefono: datos.contactoTelefono ?? null,
      notas: datos.notas ?? null
    }

    if (existente) {
      Object.assign(existente, campos, { activo: true })
      await existente.save()
      return { cartera: existente.toJSON(), reactivada: true }
    }

    const cartera = await Portfolio.create({
      empresaId,
      clienteId: cliente._id,
      ...campos
    })
    return { cartera: cartera.toJSON(), reactivada: false }
  }

  async update(id, datos, contexto = {}) {
    const cartera = await this.#buscarVisible(id, contexto)

    for (const campo of [
      'contactoNombre',
      'contactoEmail',
      'contactoTelefono',
      'notas'
    ]) {
      if (datos[campo] === undefined) continue
      cartera[campo] = datos[campo] === '' ? null : datos[campo]
    }

    await cartera.save()
    return { cartera: cartera.toJSON() }
  }

  /**
   * Saca o vuelve a meter un cliente en la cartera.
   *
   * **Sacarlo falla si la empresa tiene proyectos con él** (spec §6.3): dejar el
   * proyecto con un cliente que ya no está en la cartera rompe la regla que hace
   * válido al proyecto.
   */
  async setEstado(id, activo, contexto = {}) {
    const cartera = await this.#buscarVisible(id, contexto)

    if (!activo) {
      // Se requiere aquí y no arriba para no crear un ciclo de dependencias
      // entre carteras y proyectos.
      const Project = mongoose.model('Project')
      const conProyectos = await Project.countDocuments({
        empresaId: cartera.empresaId,
        clienteId: cartera.clienteId
      })
      if (conProyectos > 0) {
        throw new AppError(
          400,
          `No se puede sacar de la cartera: la empresa tiene ${conProyectos} ${conProyectos === 1 ? 'proyecto' : 'proyectos'} con ese cliente`
        )
      }
    }

    cartera.activo = activo
    await cartera.save()
    return { cartera: cartera.toJSON() }
  }

  /**
   * ¿Este cliente está en la cartera ACTIVA de esta empresa? Lo usa el alta de
   * proyectos, que es la razón de ser de esta colección.
   */
  async estaEnCarteraActiva(empresaId, clienteId) {
    return Boolean(await Portfolio.exists({ empresaId, clienteId, activo: true }))
  }

  async #assertEmpresaVisible(empresaId, contexto) {
    if (!mongoose.isValidObjectId(empresaId)) {
      throw new AppError(400, 'La empresa indicada no es válida')
    }
    // Fuera de alcance: 404, no 403.
    if (!empresaEsVisible({ empresasVisibles: contexto.empresasVisibles }, empresaId)) {
      throw AppError.notFound('La empresa no existe')
    }
    if (!(await Company.exists({ _id: empresaId }))) {
      throw AppError.notFound('La empresa no existe')
    }
  }

  async #buscarVisible(id, contexto) {
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError(400, 'El registro de cartera indicado no es válido')
    }
    const cartera = await Portfolio.findById(id)
    if (!cartera) throw AppError.notFound('Ese cliente no está en ninguna cartera')

    if (
      !empresaEsVisible(
        { empresasVisibles: contexto.empresasVisibles },
        cartera.empresaId
      )
    ) {
      throw AppError.notFound('Ese cliente no está en ninguna cartera')
    }
    return cartera
  }
}

module.exports = new PortfolioService()
