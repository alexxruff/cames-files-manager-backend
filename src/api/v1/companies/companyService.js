const mongoose = require('mongoose')
const Company = require('./companyModel')
const Affiliation = require('../affiliations/affiliationModel')
const { AppError } = require('../../../middlewares/errorHandler')
const { normalize } = require('../../../utils/text')

/**
 * Empresas (backend-spec §6.3). La entidad raíz del grupo.
 *
 * Crearlas es exclusivo del administrador de plataforma: una empresa nueva
 * cambia la estructura de todo el grupo, no de un inquilino.
 */
class CompanyService {
  /**
   * Las empresas que el usuario puede ver, con los conteos que pinta la pantalla
   * de Organización.
   *
   * Los conteos se resuelven en el servidor con una agregación: pedirlos desde
   * el navegador serían N+1 peticiones por tarjeta.
   */
  async list(
    { incluirInactivas = false, busqueda } = {},
    { empresasVisibles = null } = {}
  ) {
    const match = {}
    if (!incluirInactivas) match.activo = true
    if (empresasVisibles !== null) {
      match._id = { $in: empresasVisibles.map((id) => new mongoose.Types.ObjectId(id)) }
    }
    if (busqueda) {
      const termino = normalize(busqueda)
      if (termino) match.nombreNormalizado = new RegExp(termino, 'i')
    }

    const empresas = await Company.find(match).sort({ nombre: 1 }).collation({
      locale: 'es'
    })

    const conteos = await this.#conteosPorEmpresa(empresas.map((e) => e._id))

    return {
      empresas: empresas.map((empresa) => ({
        empresa: empresa.toJSON(),
        conteos: conteos.get(empresa._id.toString()) || this.#conteosVacios()
      }))
    }
  }

  async getById(id, { empresasVisibles = null } = {}) {
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError(400, 'La empresa indicada no es válida')
    }
    if (empresasVisibles !== null && !empresasVisibles.includes(String(id))) {
      // Fuera de alcance: 404, no 403.
      throw AppError.notFound('La empresa no existe')
    }

    const empresa = await Company.findById(id)
    if (!empresa) throw AppError.notFound('La empresa no existe')

    const conteos = await this.#conteosPorEmpresa([empresa._id])
    return {
      empresa: empresa.toJSON(),
      conteos: conteos.get(empresa._id.toString()) || this.#conteosVacios()
    }
  }

  async create(datos) {
    const nombreNormalizado = normalize(datos.nombre)

    if (await Company.exists({ nombreNormalizado })) {
      throw AppError.conflict('Ya existe una empresa con ese nombre', {
        code: 'EMPRESA_DUPLICADA',
        errors: [{ msg: 'Ya existe una empresa con ese nombre', path: 'nombre' }]
      })
    }

    if (datos.rfc) {
      const rfc = String(datos.rfc).toUpperCase().trim()
      const existente = await Company.findOne({ rfc })
      if (existente) {
        throw AppError.conflict('Ya existe una empresa con ese RFC', {
          code: 'RFC_DUPLICADO',
          errors: [{ msg: 'Ya existe una empresa con ese RFC', path: 'rfc' }],
          data: { empresaId: existente._id.toString(), nombre: existente.nombre }
        })
      }
    }

    const empresa = await Company.create({
      nombre: datos.nombre,
      rfc: datos.rfc || null,
      activo: datos.activo ?? true
    })

    return { empresa: empresa.toJSON(), conteos: this.#conteosVacios() }
  }

  /**
   * Conteos por empresa para las tarjetas de Organización.
   *
   * `empleados` sale de las adscripciones activas. Los otros tres van en `null`
   * y no en `0` a propósito: `0` diría «no tiene ninguno» y la verdad es «el
   * módulo todavía no existe». Cuando existan, se llenan sin cambiar la forma.
   */
  async #conteosPorEmpresa(ids) {
    if (ids.length === 0) return new Map()

    const porEmpresa = await Affiliation.aggregate([
      { $match: { empresaId: { $in: ids }, activo: true } },
      { $group: { _id: '$empresaId', empleados: { $addToSet: '$empleadoId' } } },
      { $project: { empleados: { $size: '$empleados' } } }
    ])

    return new Map(
      porEmpresa.map((fila) => [
        fila._id.toString(),
        { ...this.#conteosVacios(), empleados: fila.empleados }
      ])
    )
  }

  #conteosVacios() {
    return {
      empleados: 0,
      clientes: null,
      proyectosActivos: null,
      alertasPendientes: null
    }
  }
}

module.exports = new CompanyService()
