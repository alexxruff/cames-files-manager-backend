const Area = require('./areaModel')
const Affiliation = require('../affiliations/affiliationModel')
const { AppError } = require('../../../middlewares/errorHandler')
const { normalize } = require('../../../utils/text')
const { AREAS_BASE } = require('../../../constants')

/**
 * Nombre → clave del contrato. **Pura y determinista**: la importación la usa
 * para saber qué clave VA a tener un área que todavía no existe, sin escribirla
 * (la previsualización no escribe nada, D-46).
 */
const claveDesdeNombre = (nombre) =>
  normalize(nombre)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'area'

/**
 * Catálogo de áreas (D-58).
 *
 * Sustituye al enum fijo: aquí se crean, se dan de baja y se reactivan, y aquí
 * se valida que un área exista antes de guardarla en una adscripción.
 */
class AreaService {
  /**
   * @param {object} filtros `{ activa: 'true'|'false'|'todos', temporal }`
   */
  async list({ activa = 'true', temporal } = {}) {
    const filtro = {}
    // Tres estados excluyentes, igual que `activo` en empleados (D-52): pedir
    // las dadas de baja tiene que traer exactamente eso.
    if (activa === 'true') filtro.activa = true
    else if (activa === 'false') filtro.activa = false
    if (temporal !== undefined) filtro.temporal = temporal

    const areas = await Area.find(filtro).sort({ esBase: -1, nombre: 1 })
    return { areas: areas.map((a) => a.toJSON()) }
  }

  /**
   * Alta a mano. **Idempotente por nombre**, igual que las categorías (D-32):
   * volver a mandar una que ya existe devuelve la que hay en vez de un 409, para
   * que la interfaz no tenga que preguntar antes de crear.
   *
   * Si existe pero está de baja, NO se reactiva sola: se devuelve tal cual y
   * reactivar es una decisión aparte, con su propia ruta. Crear no debería
   * deshacer una baja sin que nadie lo pida.
   */
  async create({ nombre }) {
    const existente = await Area.findOne({ nombreNormalizado: normalize(nombre) })
    if (existente) return { area: existente.toJSON(), yaExistia: true }

    const area = await Area.create({
      clave: await this.#claveLibre(nombre),
      nombre,
      esBase: false,
      temporal: false
    })
    return { area: area.toJSON(), yaExistia: false }
  }

  /** Renombrar. La `clave` no se toca: las adscripciones la guardan. */
  async update(id, { nombre }) {
    const area = await this.#buscar(id)

    const otra = await Area.findOne({
      nombreNormalizado: normalize(nombre),
      _id: { $ne: area._id }
    })
    if (otra) {
      throw AppError.conflict(`Ya existe un área con ese nombre: ${otra.nombre}`)
    }

    area.nombre = nombre
    await area.save()
    return { area: area.toJSON() }
  }

  /**
   * Dar de baja o reactivar.
   *
   * **Quién puede** (D-58): las temporales —las que dejó el archivo de nómina—
   * las cierra RH, que es quien sabe que la obra terminó. El resto del catálogo
   * es del administrador de plataforma, como las categorías y las empresas.
   *
   * **No se da de baja un área que alguien tiene asignada**: primero se
   * reasigna, subiendo el archivo o a mano. Es el mismo candado que las
   * categorías, y por la misma razón: sin él, un jefe de área dejaría de ver a
   * su gente sin que nadie se enterara.
   */
  async setEstado(
    id,
    activa,
    { puedeAdministrar = false, puedeCerrarTemporales = false }
  ) {
    const area = await this.#buscar(id)

    if (!puedeAdministrar && !(area.temporal && puedeCerrarTemporales)) {
      throw AppError.forbidden(
        area.temporal
          ? 'No tienes permiso para dar de baja áreas'
          : 'Sólo un administrador de plataforma puede dar de baja un área del catálogo; las temporales las cierra RH'
      )
    }

    if (!activa) {
      if (area.esBase) {
        throw new AppError(400, 'Las áreas base no se pueden dar de baja')
      }
      const enUso = await Affiliation.countDocuments({
        areas: area.clave,
        activo: true
      })
      if (enUso > 0) {
        throw new AppError(
          400,
          `No se puede dar de baja: ${enUso} ${enUso === 1 ? 'persona la tiene' : 'personas la tienen'} asignada. Reasígnalas primero.`
        )
      }
    }

    area.activa = activa
    await area.save()
    return { area: area.toJSON() }
  }

  /**
   * Las claves que existen y están activas, para validar lo que llega por HTTP.
   *
   * Devuelve un `Set`: quien valida una lista de áreas lo pide una vez y compara
   * en memoria, en vez de una consulta por área.
   */
  async clavesActivas() {
    const areas = await Area.find({ activa: true }).select('clave')
    return new Set(areas.map((a) => a.clave))
  }

  /**
   * Valida que cada área exista y esté activa. Lanza con el mensaje que ve el
   * usuario y el `path` que le pidan (cambia según el recurso).
   */
  async assertUsables(claves, path = 'areas') {
    const lista = claves || []
    if (lista.length === 0) return

    const activas = await this.clavesActivas()
    const invalidas = lista.filter((clave) => !activas.has(clave))
    if (invalidas.length === 0) return

    // Se distingue «no existe» de «está de baja»: son dos arreglos distintos.
    const deBaja = await Area.find({ clave: { $in: invalidas } }).select('clave nombre')
    const nombresDeBaja = deBaja.map((a) => a.nombre)

    throw AppError.validation(
      nombresDeBaja.length > 0
        ? `Estas áreas están dadas de baja: ${nombresDeBaja.join(', ')}`
        : `Áreas no válidas: ${invalidas.join(', ')}`,
      [{ msg: 'Selecciona un área válida', path }]
    )
  }

  /**
   * Que el área exista, **activa o no**.
   *
   * Es la comprobación de los FILTROS (`?area=`), no la de guardar: a un área
   * dada de baja todavía hay gente asignada —es justo a quien hay que
   * reasignar—, y no poder filtrarla dejaría esa lista fuera de alcance.
   */
  async assertExiste(clave, path = 'area') {
    if (!clave) return
    if (await Area.exists({ clave })) return

    throw AppError.validation(`El área "${clave}" no existe`, [
      { msg: 'Selecciona un área válida', path }
    ])
  }

  /**
   * El área que corresponde a un texto de la columna `Departamento`, creándola
   * como **temporal** si no existe (D-58).
   *
   * Es el mismo trato que ya reciben los puestos en la importación (D-46): el
   * dato viene del archivo, no es una decisión de catálogo, y rechazar la fila
   * por un departamento nuevo dejaría la función inservible.
   *
   * Busca por nombre normalizado Y por clave, para que «Recursos Humanos», «RECURSOS
   * HUMANOS» y `recursos_humanos` caigan todos en la misma.
   *
   * @returns {{ area: object, creada: boolean }}
   */
  async resolverDesdeTexto(texto) {
    const normalizado = normalize(texto)
    const existente = await Area.findOne({
      $or: [{ nombreNormalizado: normalizado }, { clave: normalizado }]
    })
    if (existente) return { area: existente, creada: false }

    const area = await Area.create({
      clave: await this.#claveLibre(texto),
      nombre: String(texto).trim(),
      esBase: false,
      temporal: true
    })
    return { area, creada: true }
  }

  /** 404 con el mismo mensaje siempre: exista o no, fuera de alcance es lo mismo. */
  async #buscar(id) {
    const area = await Area.findById(id)
    if (!area) throw AppError.notFound('El área no existe')
    return area
  }

  /**
   * Clave a partir del nombre, sin chocar con una que ya exista.
   *
   * Las base traen la suya escrita a mano (`constants/areas.js`) porque tienen
   * que coincidir con lo que ya está guardado en producción; ésta es sólo para
   * las que se crean después.
   */
  async #claveLibre(nombre) {
    const base = claveDesdeNombre(nombre)

    // Reservadas: una clave nueva no puede colarse encima de una área base.
    const reservadas = new Set(AREAS_BASE.map((a) => a.clave))

    let clave = base
    let intento = 1
    // Con dos áreas llamadas «Axis 3» y «Axis-3» el normalizado ya las une, así
    // que este bucle casi nunca corre; existe para no reventar cuando corre.
    while (reservadas.has(clave) || (await Area.exists({ clave }))) {
      intento += 1
      clave = `${base}_${intento}`
    }
    return clave
  }
}

module.exports = new AreaService()
module.exports.claveDesdeNombre = claveDesdeNombre
