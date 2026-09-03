const IncidentType = require('./incidentTypeModel')
const { AppError } = require('../../../middlewares/errorHandler')
const { normalize, escapeRegex } = require('../../../utils/text')

/**
 * Catálogo de tipos de incidencia — compartido del grupo (D-88).
 *
 * Se parece a las áreas y a las categorías, con **una diferencia deliberada**:
 * aquí dar de baja un tipo que está en uso SÍ se permite. En aquellos catálogos
 * la baja se bloquea porque dejaría a una persona con un puesto o un área que ya
 * no existe; aquí no hay nada que quede inconsistente —la incidencia vieja
 * conserva su tipo y lo sigue mostrando—, y bloquear la baja obligaría a
 * arrastrar para siempre un tipo que se capturó mal una vez.
 *
 * Lo que la baja hace es dejar de ofrecerlo para incidencias NUEVAS.
 */
class IncidentTypeService {
  /** Cualquiera con sesión puede leerlos: pueblan el desplegable del alta. */
  async list({ incluirInactivos = false, busqueda } = {}) {
    const filtro = {}
    if (!incluirInactivos) filtro.activo = true
    if (busqueda) {
      const termino = normalize(busqueda)
      if (termino) filtro.nombreNormalizado = new RegExp(escapeRegex(termino), 'i')
    }

    const tipos = await IncidentType.find(filtro)
      .sort({ nombre: 1 })
      .collation({ locale: 'es' })

    return { total: tipos.length, tipos: tipos.map((t) => t.toJSON()) }
  }

  /**
   * Alta **idempotente por nombre**, como las áreas y las categorías (D-32): el
   * tipo se agrega desde el formulario de la incidencia —«esto no encaja en
   * ningún tipo»— y hacer fallar eso obligaría a la pantalla a distinguir «ya
   * existe» de un error de verdad.
   *
   * Uno que existe pero está de baja **no se reactiva solo**: se devuelve tal
   * cual y reactivarlo es una decisión aparte, con su propia ruta.
   */
  async create({ nombre }) {
    const existente = await IncidentType.findOne({
      nombreNormalizado: normalize(nombre)
    })
    if (existente) return { tipo: existente.toJSON(), yaExistia: true }

    const tipo = await IncidentType.create({ nombre, esBase: false })
    return { tipo: tipo.toJSON(), yaExistia: false }
  }

  /**
   * Renombrar. Corrige el nombre en TODA la historia, porque las incidencias lo
   * referencian por id: es lo que se espera de una corrección de ortografía y lo
   * que hace innecesario copiar el nombre en cada incidencia.
   */
  async update(id, { nombre }) {
    const tipo = await this.#buscar(id)

    const otro = await IncidentType.findOne({
      nombreNormalizado: normalize(nombre),
      _id: { $ne: tipo._id }
    })
    if (otro) {
      throw AppError.conflict(
        `Ya existe un tipo de incidencia con ese nombre: ${otro.nombre}`,
        {
          code: 'TIPO_INCIDENCIA_DUPLICADO',
          errors: [{ msg: 'Ya existe un tipo con ese nombre', path: 'nombre' }]
        }
      )
    }

    tipo.nombre = nombre
    await tipo.save()
    return { tipo: tipo.toJSON() }
  }

  /** Dar de baja o reactivar. Los sembrados no se dan de baja. */
  async setEstado(id, activo) {
    const tipo = await this.#buscar(id)

    if (!activo && tipo.esBase) {
      throw new AppError(400, 'Los tipos de incidencia base no se pueden dar de baja')
    }

    tipo.activo = activo
    await tipo.save()
    return { tipo: tipo.toJSON() }
  }

  /**
   * El tipo, exigiendo que exista y esté ACTIVO. Lo usa el alta de una
   * incidencia.
   *
   * Responde 400 y no 404 a propósito: el recurso de la petición es la máquina,
   * que sí existe; lo que está mal es un campo del cuerpo, y el `path` deja que
   * la pantalla lo marque en el desplegable.
   */
  async usable(tipoId) {
    const tipo = await IncidentType.findById(tipoId)
    if (!tipo) {
      throw AppError.validation('El tipo de incidencia indicado no existe', [
        { msg: 'El tipo de incidencia no existe', path: 'tipoId' }
      ])
    }
    if (!tipo.activo) {
      throw AppError.validation(
        `El tipo «${tipo.nombre}» está dado de baja: elige otro de la lista.`,
        [{ msg: 'El tipo de incidencia está dado de baja', path: 'tipoId' }]
      )
    }
    return tipo
  }

  // ─── Interno ───────────────────────────────────────────────────────────────

  async #buscar(id) {
    const tipo = await IncidentType.findById(id)
    if (!tipo) throw AppError.notFound('El tipo de incidencia no existe')
    return tipo
  }
}

module.exports = new IncidentTypeService()
