const Category = require('./categoryModel')
const Employee = require('../employees/employeeModel')
const { AppError } = require('../../../middlewares/errorHandler')
const { normalize } = require('../../../utils/text')

/**
 * Categorías (puestos) — catálogo compartido (backend-spec §6.2).
 *
 * Global y no por empresa: el empleado es global y lleva una `categoriaId`; con
 * un catálogo por empresa, alguien adscrito a dos tendría un puesto ambiguo.
 * Por eso el alta exige `alcanceGlobal`.
 */
class CategoryService {
  /** Cualquiera con sesión puede leerlas: pueblan los desplegables del alta. */
  async list({ tipo, incluirInactivas = false, busqueda } = {}) {
    const filtro = {}
    if (tipo) filtro.tipo = tipo
    if (!incluirInactivas) filtro.activo = true
    if (busqueda) {
      const termino = normalize(busqueda)
      if (termino) filtro.nombreNormalizado = new RegExp(termino, 'i')
    }

    const categorias = await Category.find(filtro)
      .sort({ nombre: 1 })
      .collation({ locale: 'es' })

    return { categorias: categorias.map((c) => c.toJSON()) }
  }

  /**
   * Alta **idempotente por nombre** (backend-spec §6.2): si la categoría ya
   * existe, se devuelve la que hay en vez de fallar. El alta ocurre desde el
   * formulario de un empleado —«mi puesto no está en la lista»— y hacer fallar
   * eso obligaría a la interfaz a distinguir «ya existe» de un error real.
   *
   * @returns {{categoria: object, creada: boolean}}
   */
  async create(datos) {
    const nombreNormalizado = normalize(datos.nombre)
    const existente = await Category.findOne({ nombreNormalizado })

    if (existente) {
      // Mismo nombre con otro tipo sí es un conflicto: "Auxiliar contable" no
      // puede ser administrativo y de obra a la vez.
      if (existente.tipo !== datos.tipo) {
        throw AppError.conflict(
          `La categoría "${existente.nombre}" ya existe como ${existente.tipo}`,
          {
            code: 'CATEGORIA_OTRO_TIPO',
            errors: [{ msg: 'Esa categoría ya existe con otro tipo', path: 'tipo' }],
            data: { categoria: existente.toJSON() }
          }
        )
      }
      return { categoria: existente.toJSON(), creada: false }
    }

    const categoria = await Category.create({
      nombre: datos.nombre,
      tipo: datos.tipo
    })
    return { categoria: categoria.toJSON(), creada: true }
  }

  /**
   * Activa o desactiva. Falla si hay empleados usándola: desactivar una
   * categoría en uso dejaría desplegables inconsistentes y personas con un
   * puesto que ya no existe.
   */
  async setEstado(id, activo) {
    const categoria = await Category.findById(id)
    if (!categoria) throw AppError.notFound('La categoría no existe')

    if (!activo) {
      if (categoria.esBase) {
        throw new AppError(400, 'Las categorías base no se pueden desactivar')
      }
      const enUso = await Employee.countDocuments({
        categoriaId: categoria._id,
        activo: true
      })
      if (enUso > 0) {
        throw new AppError(
          400,
          `No se puede desactivar: ${enUso} ${enUso === 1 ? 'persona la tiene' : 'personas la tienen'} como puesto`
        )
      }
    }

    categoria.activo = activo
    await categoria.save()
    return { categoria: categoria.toJSON() }
  }

  /** Valida que exista, esté activa y sirva para ese tipo de persona. */
  async assertUsableParaTipo(categoriaId, tipoEmpleado) {
    const categoria = await Category.findById(categoriaId)
    if (!categoria || !categoria.activo) {
      throw AppError.notFound('La categoría indicada no existe')
    }
    if (categoria.tipo !== tipoEmpleado) {
      throw AppError.validation(
        `La categoría "${categoria.nombre}" es de tipo ${categoria.tipo} y no aplica a personal ${tipoEmpleado === 'administrativo' ? 'administrativo' : 'de obra'}`,
        [{ msg: 'La categoría no corresponde al tipo de empleado', path: 'categoriaId' }]
      )
    }
    return categoria
  }
}

module.exports = new CategoryService()
