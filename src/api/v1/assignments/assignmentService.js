const mongoose = require('mongoose')
const Assignment = require('./assignmentModel')
const Project = require('../projects/projectModel')
const Employee = require('../employees/employeeModel')
const Affiliation = require('../affiliations/affiliationModel')
const Company = require('../companies/companyModel')
const machineAssignmentService = require('../machineAssignments/machineAssignmentService')
const storage = require('../../../services/storageService')
const { AppError } = require('../../../middlewares/errorHandler')
const {
  empresaEsVisible,
  areasVisibles
} = require('../../../middlewares/scopeMiddleware')
const { isBefore } = require('../../../utils/dates')
const { idAString } = require('../../../utils/ids')
const {
  findRegistry,
  matchesEmployerRegistry,
  employerRegistryWarning
} = require('../../../utils/domain')

/**
 * Asignaciones — proyecto ↔ empleado (backend-spec §6.4, modelo-datos §5b.3).
 *
 * Dos reglas que el servidor impone:
 *
 * 1. El empleado necesita **adscripción activa a la empresa del proyecto**. No se
 *    pone en una obra de Empresa 1 a alguien que no trabaja para Empresa 1.
 * 2. No se asigna a alguien dado de baja ni a un proyecto finalizado.
 *
 * El puesto ya no es una de ellas (D-82): a la obra va quien haga falta, sin
 * importar su categoría.
 *
 * Y una tercera que **avisa en vez de bloquear** (G2, Fase 6): que la persona
 * cotice en el registro patronal del proyecto. Maquinaria CAMES ya tiene 144
 * personas repartidas en cuatro registros, así que impedirlo frenaría trabajo
 * legítimo; el aviso deja el dato a la vista y quien lo lee decide.
 *
 * Quitar a alguien **no borra**: cierra la asignación con `fechaSalida`. Hay que
 * poder responder quién estaba en la obra el día de un accidente.
 */
class AssignmentService {
  async listByProject(proyectoId, { activo } = {}, contexto = {}) {
    const proyecto = await this.#buscarProyectoVisible(proyectoId, contexto)

    const filtro = { proyectoId: proyecto._id }
    if (activo !== undefined) filtro.activo = activo

    const asignaciones = await Assignment.find(filtro)
      .sort({ activo: -1, fechaAsignacion: -1 })
      .populate({ path: 'empleadoId', select: 'nombre tipo activo' })
      .populate({ path: 'categoriaId', select: 'nombre' })

    const conEmpleado = asignaciones.filter((a) => a.empleadoId)

    /*
     * G2 en el listado, y no sólo al asignar: el aviso del alta lo ve quien
     * captura, una vez. Lo que RH necesita después es poder mirar la obra y
     * encontrar a los que cotizan en otro registro sin abrir uno por uno.
     */
    const registros = await this.#registrosPatronalesDe(proyecto.empresaId)
    const registroDelProyecto = findRegistry(registros, proyecto.registroPatronalId)
    const registroPorEmpleado = await this.#registrosPatronalesDeLaGente(
      proyecto.empresaId,
      conEmpleado.map((a) => a.empleadoId._id),
      registros
    )

    return {
      asignaciones: conEmpleado.map((a) => {
        const registroEmpleado = registroPorEmpleado.get(String(a.empleadoId._id)) ?? null
        return {
          ...a.toJSON(),
          empleadoNombre: a.empleadoId.nombre,
          empleadoTipo: a.empleadoId.tipo,
          categoriaNombre: a.categoriaId?.nombre ?? null,
          // El de SU adscripción en esta empresa, no el del proyecto.
          registroPatronalEmpleado: registroEmpleado,
          // `null` = no se puede comparar, que no es lo mismo que `false`.
          registroPatronalCoincide: matchesEmployerRegistry(
            registroEmpleado,
            registroDelProyecto?.numero ?? null
          )
        }
      })
    }
  }

  /**
   * GET /asignaciones/:id — el detalle, con la **cadena resuelta** (Fase 6).
   *
   * `empleado → empresa → registro patronal → proyecto → registro de obra`, toda
   * de una vez. Se arma al leer cruzando lo que ya existe; **no se persiste
   * ningún id nuevo en la asignación** (plan §C5): duplicarlos crearía dos
   * verdades, y la de la adscripción cambiaría sin que la asignación se enterara.
   */
  async getById(id, contexto = {}) {
    const asignacion = await this.#buscarAsignacion(id)
    const proyecto = await this.#buscarProyectoVisible(asignacion.proyectoId, contexto, {
      poblar: true
    })

    await asignacion.populate([
      { path: 'empleadoId', select: 'nombre tipo activo' },
      { path: 'categoriaId', select: 'nombre' }
    ])

    const empresa = proyecto.empresaId
    const cliente = proyecto.clienteId
    const empleado = asignacion.empleadoId

    const adscripcion = empleado
      ? await Affiliation.findOne({
          empresaId: empresa._id,
          empleadoId: empleado._id
        }).select('activo registroPatronalId condiciones.registroPatronal')
      : null

    const registroEmpleado = this.#numeroDeLaAdscripcion(
      adscripcion,
      empresa.registrosPatronales
    )
    const registroPatronal = findRegistry(
      empresa.registrosPatronales,
      proyecto.registroPatronalId
    )
    const registroObra = await storage.firmarRegistro(
      findRegistry(cliente?.registrosObra, proyecto.registroObraId, {
        conArchivo: true
      }),
      cliente?.registrosObra
    )

    const aviso = employerRegistryWarning({
      empleadoNombre: empleado?.nombre,
      registroEmpleado,
      registroProyecto: registroPatronal?.numero ?? null
    })

    return {
      asignacion: {
        ...asignacion.toJSON(),
        empleadoNombre: empleado?.nombre ?? null,
        empleadoTipo: empleado?.tipo ?? null,
        categoriaNombre: asignacion.categoriaId?.nombre ?? null
      },
      trazabilidad: {
        empleado: empleado
          ? { _id: empleado._id.toString(), nombre: empleado.nombre }
          : null,
        empresa: { _id: empresa._id.toString(), nombre: empresa.nombre },
        // La adscripción es el eslabón: de ahí sale el registro de la persona.
        adscripcionId: adscripcion?._id.toString() ?? null,
        adscripcionActiva: adscripcion?.activo ?? null,
        /*
         * El id está cuando la adscripción ya está **vinculada** al catálogo de
         * la empresa (D-72); `null` significa que el número de arriba es el texto
         * crudo de la nómina y nadie lo ha validado contra nada.
         */
        registroPatronalEmpleadoId: idAString(adscripcion?.registroPatronalId),
        registroPatronalEmpleado: registroEmpleado,
        proyecto: { _id: proyecto._id.toString(), nombre: proyecto.nombre },
        registroPatronal,
        cliente: cliente ? { _id: cliente._id.toString(), nombre: cliente.nombre } : null,
        registroObra,
        registroPatronalCoincide: matchesEmployerRegistry(
          registroEmpleado,
          registroPatronal?.numero ?? null
        )
      },
      avisos: aviso ? [aviso] : []
    }
  }

  /**
   * Quiénes se pueden asignar (modelo-datos §9.3): adscritos y activos en la
   * empresa del proyecto y que no estén ya asignados. Es el selector de la
   * pantalla, y por eso se resuelve en el servidor: son cruces que el navegador
   * no debería hacer.
   *
   * El puesto **no filtra** desde D-82: a una obra va quien haga falta, y quién
   * es de la empresa lo dice la adscripción, no la categoría.
   */
  async asignables(proyectoId, contexto = {}) {
    const proyecto = await this.#buscarProyectoVisible(proyectoId, contexto)

    // Un jefe de área sólo puede asignar de sus áreas en esa empresa.
    const areas = areasVisibles(
      {
        user: contexto.user,
        areasPorEmpresa: contexto.areasPorEmpresa,
        empresasVisibles: contexto.empresasVisibles
      },
      proyecto.empresaId
    )

    const empleados = await Affiliation.aggregate([
      {
        $match: {
          empresaId: proyecto.empresaId,
          activo: true,
          ...(areas !== null ? { areas: { $in: areas } } : {})
        }
      },
      {
        $lookup: {
          from: 'employees',
          localField: 'empleadoId',
          foreignField: '_id',
          as: 'e'
        }
      },
      { $unwind: '$e' },
      { $match: { 'e.activo': true } },
      {
        // Fuera los que ya están asignados a este proyecto.
        $lookup: {
          from: 'assignments',
          let: { emp: '$empleadoId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$empleadoId', '$$emp'] },
                    { $eq: ['$proyectoId', proyecto._id] },
                    { $eq: ['$activo', true] }
                  ]
                }
              }
            }
          ],
          as: 'ya'
        }
      },
      { $match: { ya: { $size: 0 } } },
      {
        $lookup: {
          from: 'categories',
          localField: 'e.categoriaId',
          foreignField: '_id',
          as: 'cat'
        }
      },
      { $unwind: { path: '$cat', preserveNullAndEmptyArrays: true } },
      { $sort: { 'e.nombreNormalizado': 1 } },
      {
        $project: {
          _id: '$e._id',
          nombre: '$e.nombre',
          tipo: '$e.tipo',
          categoriaId: '$e.categoriaId',
          categoriaNombre: '$cat.nombre',
          areas: '$areas'
        }
      }
    ])

    return {
      asignables: empleados.map((e) => ({
        _id: e._id.toString(),
        nombre: e.nombre,
        tipo: e.tipo,
        categoriaId: e.categoriaId.toString(),
        categoriaNombre: e.categoriaNombre ?? null,
        areas: e.areas || []
      }))
    }
  }

  async create(proyectoId, datos, contexto = {}) {
    const proyecto = await this.#buscarProyectoVisible(proyectoId, contexto)

    if (proyecto.estado === 'finalizado') {
      throw new AppError(400, 'No se puede asignar personal a un proyecto finalizado')
    }

    const empleado = await Employee.findById(datos.empleadoId)
    if (!empleado) throw AppError.notFound('El empleado no existe')
    if (!empleado.activo) {
      throw new AppError(400, 'No se puede asignar a una persona dada de baja')
    }

    // La regla: adscripción activa a la empresa del proyecto.
    const adscripcion = await Affiliation.findOne({
      empresaId: proyecto.empresaId,
      empleadoId: empleado._id,
      activo: true
    })
    if (!adscripcion) {
      throw AppError.validation(
        `${empleado.nombre} no está adscrito a la empresa de este proyecto. Adscríbelo antes de asignarlo.`,
        [{ msg: 'El empleado no está adscrito a esa empresa', path: 'empleadoId' }]
      )
    }

    // Un jefe de área sólo asigna gente de sus áreas.
    const areas = areasVisibles(
      {
        user: contexto.user,
        areasPorEmpresa: contexto.areasPorEmpresa,
        empresasVisibles: contexto.empresasVisibles
      },
      proyecto.empresaId
    )
    if (areas !== null && !(adscripcion.areas || []).some((a) => areas.includes(a))) {
      throw AppError.forbidden(
        areas.length > 0
          ? `Sólo puedes asignar personal de tus áreas: ${areas.join(', ')}`
          : 'No tienes áreas asignadas en esa empresa'
      )
    }

    if (isBefore(datos.fechaAsignacion, proyecto.fechaInicio)) {
      throw AppError.validation(
        `La fecha de asignación no puede ser anterior al inicio del proyecto (${proyecto.fechaInicio})`,
        [{ msg: 'Fecha anterior al inicio del proyecto', path: 'fechaAsignacion' }]
      )
    }

    /*
     * G2: **avisa, no bloquea**. Se calcula ANTES de escribir sólo porque hace
     * falta el registro del proyecto, pero no puede impedir el alta: la
     * asignación se crea igual y el aviso viaja con la respuesta.
     */
    const registros = await this.#registrosPatronalesDe(proyecto.empresaId)
    const aviso = employerRegistryWarning({
      empleadoNombre: empleado.nombre,
      registroEmpleado: this.#numeroDeLaAdscripcion(adscripcion, registros),
      registroProyecto:
        findRegistry(registros, proyecto.registroPatronalId)?.numero ?? null
    })

    try {
      const asignacion = await Assignment.create({
        proyectoId: proyecto._id,
        empleadoId: empleado._id,
        // Su puesto en ESTA obra. El proyecto ya no restringe cuáles valen
        // (D-82), así que si el front no lo manda vale el de la persona.
        categoriaId: datos.categoriaId || empleado.categoriaId,
        fechaAsignacion: datos.fechaAsignacion
      })
      return {
        ...(await this.#unaConNombres(asignacion._id)),
        avisos: aviso ? [aviso] : []
      }
    } catch (error) {
      // El índice parcial: ya tiene una asignación ACTIVA en este proyecto.
      if (error.code === 11000) {
        throw AppError.conflict(`${empleado.nombre} ya está asignado a este proyecto`, {
          code: 'ASIGNACION_DUPLICADA'
        })
      }
      throw error
    }
  }

  /**
   * Cierra la asignación. No borra: el histórico es el punto.
   *
   * **Y sus máquinas pierden al trabajador, no la obra** (D-87): la máquina se
   * queda donde está —una excavadora no vuelve al patio porque su operador ya no
   * esté en la obra— y pasa a estar «sin trabajador» hasta que alguien la
   * reasigne o la devuelva. Va en la misma transacción que la salida: dejar la
   * asignación cerrada y la máquina en manos de quien ya se fue es justo la
   * mentira que esto evita.
   */
  async salida(id, { fechaSalida }, contexto = {}) {
    const asignacion = await this.#buscarAsignacion(id)

    // El alcance se comprueba por el proyecto al que pertenece.
    await this.#buscarProyectoVisible(asignacion.proyectoId, contexto)

    if (!asignacion.activo) {
      throw new AppError(400, 'Esa asignación ya está cerrada')
    }

    let maquinasLiberadas = []

    const sesion = await mongoose.startSession()
    try {
      await sesion.withTransaction(async () => {
        // Cada intento parte de cero: `withTransaction` puede reintentar.
        maquinasLiberadas = []

        asignacion.activo = false
        asignacion.fechaSalida = fechaSalida
        await asignacion.save({ session: sesion })

        maquinasLiberadas = await machineAssignmentService.liberarDelTrabajador(
          {
            empleadoId: asignacion.empleadoId,
            proyectoId: asignacion.proyectoId,
            fecha: fechaSalida,
            motivo: 'salida_de_obra'
          },
          sesion
        )
      })
    } finally {
      await sesion.endSession()
    }

    return {
      ...(await this.#unaConNombres(asignacion._id)),
      // Lo que quedó en la obra sin operador, para que la pantalla lo diga.
      maquinasLiberadas,
      avisos: maquinasLiberadas.map(
        (m) =>
          `La máquina ${m.identificador} se queda en ${m.proyectoNombre} sin trabajador.`
      )
    }
  }

  /**
   * El catálogo de registros patronales de la empresa, una sola vez.
   *
   * Tanto el proyecto como la adscripción guardan **sólo el id** (plan §C3,
   * D-72), y ninguno de los dos se resuelve con `populate`: son subdocumentos.
   * El número, que es lo comparable y lo que se muestra, sale de aquí.
   */
  async #registrosPatronalesDe(empresaId) {
    const empresa = await Company.findById(empresaId).select('registrosPatronales')
    return empresa?.registrosPatronales || []
  }

  /**
   * El número de registro patronal de una adscripción.
   *
   * **El vínculo manda sobre el texto** (D-72): si la adscripción ya apunta a un
   * registro del catálogo, el número sale de ahí —canónico, y garantizado a
   * existir en la empresa—. Si todavía no —la Fase 7 es gradual y M3 deja nulo lo
   * que no resuelve—, se cae al texto que dejó la nómina.
   *
   * Por eso la comparación no cambió: lo que cambió es de dónde sale el número.
   */
  #numeroDeLaAdscripcion(adscripcion, registros) {
    if (!adscripcion) return null
    return (
      findRegistry(registros, adscripcion.registroPatronalId)?.numero ??
      adscripcion.condiciones?.registroPatronal ??
      null
    )
  }

  /**
   * `empleadoId → su número de registro patronal en esa empresa`.
   *
   * Sin filtrar por `activo`: el listado incluye asignaciones cerradas, y a esa
   * gente se le pudo dar de baja de la empresa. Excluirlas dejaría el renglón
   * histórico sin el dato que justo se quiere ver. Hay a lo más una adscripción
   * por (empresa, empleado) — índice único —, así que no hay ambigüedad.
   */
  async #registrosPatronalesDeLaGente(empresaId, empleadoIds, registros) {
    if (empleadoIds.length === 0) return new Map()

    const adscripciones = await Affiliation.find({
      empresaId,
      empleadoId: { $in: empleadoIds }
    }).select('empleadoId registroPatronalId condiciones.registroPatronal')

    return new Map(
      adscripciones.map((a) => [
        String(a.empleadoId),
        this.#numeroDeLaAdscripcion(a, registros)
      ])
    )
  }

  async #unaConNombres(id) {
    const asignacion = await Assignment.findById(id)
      .populate({ path: 'empleadoId', select: 'nombre tipo' })
      .populate({ path: 'categoriaId', select: 'nombre' })

    return {
      asignacion: {
        ...asignacion.toJSON(),
        empleadoNombre: asignacion.empleadoId?.nombre ?? null,
        empleadoTipo: asignacion.empleadoId?.tipo ?? null,
        categoriaNombre: asignacion.categoriaId?.nombre ?? null
      }
    }
  }

  /** Existe, sin mirar alcance todavía: eso lo decide su proyecto. */
  async #buscarAsignacion(id) {
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError(400, 'La asignación indicada no es válida')
    }
    const asignacion = await Assignment.findById(id)
    if (!asignacion) throw AppError.notFound('La asignación no existe')
    return asignacion
  }

  async #buscarProyectoVisible(proyectoId, contexto, { poblar = false } = {}) {
    if (!mongoose.isValidObjectId(proyectoId)) {
      throw new AppError(400, 'El proyecto indicado no es válido')
    }

    const consulta = Project.findById(proyectoId)
    if (poblar) {
      // Con los registros, que es lo que hace falta para resolver la cadena.
      consulta
        .populate({ path: 'empresaId', select: 'nombre registrosPatronales' })
        .populate({ path: 'clienteId', select: 'nombre registrosObra' })
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
}

module.exports = new AssignmentService()
