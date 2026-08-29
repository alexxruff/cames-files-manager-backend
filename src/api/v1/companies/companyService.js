const mongoose = require('mongoose')
const Company = require('./companyModel')
const Affiliation = require('../affiliations/affiliationModel')
const Portfolio = require('../portfolios/portfolioModel')
const Project = require('../projects/projectModel')
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
      registrosPatronales: datos.registrosPatronales || [],
      activo: datos.activo ?? true
    })

    return { empresa: empresa.toJSON(), conteos: this.#conteosVacios() }
  }

  /**
   * `PATCH /empresas/:id` — corregir los datos de una empresa (D-64).
   *
   * Faltaba: una empresa sólo se podía crear y consultar, así que un RFC mal
   * capturado no había manera de arreglarlo. Los demás catálogos —clientes,
   * categorías, áreas— sí lo tenían.
   *
   * **Los registros patronales se reemplazan, no se acumulan.** Se manda la lista
   * completa: agregar uno es mandar los que ya estaban más el nuevo, y quitar uno
   * es mandar la lista sin él. Es lo que permite a la pantalla guardar lo que
   * muestra sin llevar la cuenta de qué cambió, igual que las jefaturas (D-60).
   */
  async update(id, datos) {
    const empresa = await this.#buscar(id)

    if (datos.nombre && normalize(datos.nombre) !== empresa.nombreNormalizado) {
      const nombreNormalizado = normalize(datos.nombre)
      if (await Company.exists({ nombreNormalizado, _id: { $ne: empresa._id } })) {
        throw AppError.conflict('Ya existe una empresa con ese nombre', {
          code: 'EMPRESA_DUPLICADA',
          errors: [{ msg: 'Ya existe una empresa con ese nombre', path: 'nombre' }]
        })
      }
    }

    if (datos.rfc) {
      const rfc = String(datos.rfc).toUpperCase().trim()
      const otra = await Company.findOne({ rfc, _id: { $ne: empresa._id } })
      if (otra) {
        throw AppError.conflict('Ya existe una empresa con ese RFC', {
          code: 'RFC_DUPLICADO',
          errors: [{ msg: 'Ya existe una empresa con ese RFC', path: 'rfc' }],
          data: { empresaId: otra._id.toString(), nombre: otra.nombre }
        })
      }
    }

    // `registrosPatronales` ya NO se toca aquí: tiene sus propias rutas (D-65).
    for (const campo of ['nombre', 'rfc']) {
      if (datos[campo] === undefined) continue
      // Un opcional vacío es "sin valor", no cadena vacía (regla #5 del contrato).
      empresa[campo] = datos[campo] === '' ? null : datos[campo]
    }
    if (datos.branding) Object.assign(empresa.branding, datos.branding)
    if (datos.configuracion) Object.assign(empresa.configuracion, datos.configuracion)

    await empresa.save()

    const [conteos] = await this.#conteosPorEmpresa([empresa._id])
    return { empresa: empresa.toJSON(), conteos: conteos || this.#conteosVacios() }
  }

  /**
   * `PATCH /empresas/:id/estado` — dar de baja o reactivar (D-64).
   *
   * **No se da de baja una empresa con gente adscrita o proyectos abiertos.** Es
   * el mismo candado que las categorías y las áreas, y por la misma razón: una
   * empresa inactiva deja de ser visible y de aceptar importaciones, así que su
   * gente quedaría en un limbo que nadie ve. Primero se cierra lo que cuelga.
   */
  async setEstado(id, activo) {
    const empresa = await this.#buscar(id)

    if (!activo) {
      const [adscritos, proyectosAbiertos] = await Promise.all([
        Affiliation.countDocuments({ empresaId: empresa._id, activo: true }),
        Project.countDocuments({ empresaId: empresa._id, estado: { $ne: 'finalizado' } })
      ])

      const bloqueos = []
      if (adscritos > 0) {
        bloqueos.push(
          `${adscritos} ${adscritos === 1 ? 'persona adscrita' : 'personas adscritas'}`
        )
      }
      if (proyectosAbiertos > 0) {
        bloqueos.push(
          `${proyectosAbiertos} ${proyectosAbiertos === 1 ? 'proyecto abierto' : 'proyectos abiertos'}`
        )
      }
      if (bloqueos.length > 0) {
        throw new AppError(
          400,
          `No se puede dar de baja: la empresa todavía tiene ${bloqueos.join(' y ')}. Ciérralos primero.`
        )
      }
    }

    empresa.activo = activo
    await empresa.save()

    const [conteos] = await this.#conteosPorEmpresa([empresa._id])
    return { empresa: empresa.toJSON(), conteos: conteos || this.#conteosVacios() }
  }

  // ─── Registros patronales (D-65) ──────────────────────────────────────────

  /**
   * Alta de un registro patronal. **Idempotente por número**, igual que las
   * categorías y las áreas: volver a mandar uno que ya existe devuelve el que hay
   * en vez de un 409, para que la interfaz no tenga que preguntar antes de crear.
   *
   * Si existe pero está dado de baja, se devuelve tal cual **sin reactivarlo**:
   * crear no debería deshacer una baja que alguien decidió.
   */
  async agregarRegistroPatronal(empresaId, { numero, descripcion }) {
    const empresa = await this.#buscar(empresaId)
    const buscado = String(numero).trim().toUpperCase()

    const existente = empresa.registrosPatronales.find((r) => r.numero === buscado)
    if (existente) {
      return {
        empresa: empresa.toJSON(),
        registro: this.#registro(existente),
        yaExistia: true
      }
    }

    empresa.registrosPatronales.push({
      numero: buscado,
      descripcion: descripcion || null
    })
    await empresa.save()

    const creado = empresa.registrosPatronales.find((r) => r.numero === buscado)
    return {
      empresa: empresa.toJSON(),
      registro: this.#registro(creado),
      yaExistia: false
    }
  }

  /**
   * Corregir número o descripción.
   *
   * El **número sí se puede cambiar**: es justo para lo que sirve que el registro
   * tenga `_id` propio. Quien lo referencie apunta al id, así que corregir un
   * dígito no rompe nada.
   */
  async actualizarRegistroPatronal(empresaId, registroId, datos) {
    const { empresa, registro } = await this.#buscarRegistro(empresaId, registroId)

    if (datos.numero !== undefined) registro.numero = datos.numero
    if (datos.descripcion !== undefined) registro.descripcion = datos.descripcion || null

    await empresa.save()
    return { empresa: empresa.toJSON(), registro: this.#registro(registro) }
  }

  /**
   * Dar de baja o reactivar un registro patronal.
   *
   * Dar de baja **no lo borra**: deja de ofrecerse para obras nuevas y se puede
   * reactivar. No hay nada que bloquear todavía porque aún nadie lo referencia;
   * cuando el proyecto lo haga (fase 3), aquí entra el candado de «no se da de
   * baja uno que un proyecto en curso esté usando».
   */
  async setEstadoRegistroPatronal(empresaId, registroId, activo) {
    const { empresa, registro } = await this.#buscarRegistro(empresaId, registroId)

    registro.activo = activo
    await empresa.save()
    return { empresa: empresa.toJSON(), registro: this.#registro(registro) }
  }

  /** La forma del contrato para un registro suelto. */
  #registro(r) {
    return {
      _id: r._id.toString(),
      numero: r.numero,
      descripcion: r.descripcion ?? null,
      activo: r.activo
    }
  }

  async #buscarRegistro(empresaId, registroId) {
    const empresa = await this.#buscar(empresaId)
    if (!mongoose.isValidObjectId(registroId)) {
      throw new AppError(400, 'El registro patronal indicado no es válido')
    }
    const registro = empresa.registrosPatronales.id(registroId)
    if (!registro) throw AppError.notFound('El registro patronal no existe')
    return { empresa, registro }
  }

  /** 404 con el mismo mensaje siempre: exista o no, es lo mismo para quien pide. */
  async #buscar(id) {
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError(400, 'La empresa indicada no es válida')
    }
    const empresa = await Company.findById(id)
    if (!empresa) throw AppError.notFound('La empresa no existe')
    return empresa
  }

  /**
   * Conteos por empresa para las tarjetas de Organización, resueltos con tres
   * agregaciones en paralelo. Pedirlos desde el navegador serían N+1 peticiones
   * por tarjeta.
   *
   * `alertasPendientes` sigue en `null` —y no en `0`— porque el módulo de alertas
   * no existe: `0` diría «no tiene ninguna» y sería mentira.
   */
  async #conteosPorEmpresa(ids) {
    if (ids.length === 0) return new Map()

    const [empleados, clientes, proyectos] = await Promise.all([
      // Personas con adscripción activa, sin contar dos veces a nadie.
      Affiliation.aggregate([
        { $match: { empresaId: { $in: ids }, activo: true } },
        { $group: { _id: '$empresaId', valor: { $addToSet: '$empleadoId' } } },
        { $project: { valor: { $size: '$valor' } } }
      ]),
      // Clientes en la cartera activa.
      Portfolio.aggregate([
        { $match: { empresaId: { $in: ids }, activo: true } },
        { $group: { _id: '$empresaId', valor: { $sum: 1 } } }
      ]),
      // Sólo los proyectos en curso: es lo que la tarjeta anuncia.
      Project.aggregate([
        { $match: { empresaId: { $in: ids }, estado: 'en_curso' } },
        { $group: { _id: '$empresaId', valor: { $sum: 1 } } }
      ])
    ])

    const porEmpresa = new Map(ids.map((id) => [id.toString(), this.#conteosVacios()]))
    const volcar = (filas, campo) => {
      for (const fila of filas) {
        const clave = fila._id.toString()
        const actual = porEmpresa.get(clave) || this.#conteosVacios()
        porEmpresa.set(clave, { ...actual, [campo]: fila.valor })
      }
    }

    volcar(empleados, 'empleados')
    volcar(clientes, 'clientes')
    volcar(proyectos, 'proyectosActivos')

    return porEmpresa
  }

  #conteosVacios() {
    return {
      empleados: 0,
      clientes: 0,
      proyectosActivos: 0,
      // Pendiente: el módulo de alertas no existe. `null` = «todavía no se sabe».
      alertasPendientes: null
    }
  }
}

module.exports = new CompanyService()
