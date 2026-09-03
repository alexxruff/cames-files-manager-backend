const mongoose = require('mongoose')
const MachineAssignment = require('./machineAssignmentModel')
const machineService = require('../machines/machineService')
const Employee = require('../employees/employeeModel')
const Affiliation = require('../affiliations/affiliationModel')
const Assignment = require('../assignments/assignmentModel')
const Project = require('../projects/projectModel')
const { AppError } = require('../../../middlewares/errorHandler')
const { empresaEsVisible } = require('../../../middlewares/scopeMiddleware')
const { today, isBefore } = require('../../../utils/dates')
const { stintToJson, accumulateByEmployee } = require('../../../utils/domain')

/** Orden natural de identificadores: `ECO-2` antes que `ECO-10`. */
const porIdentificador = new Intl.Collator('es', { numeric: true, sensitivity: 'base' })

/**
 * La máquina asignada a un trabajador, y la historia de por dónde ha andado
 * (D-87).
 *
 * Cuatro reglas que impone el servidor, y son el porqué de todo este archivo:
 *
 * 1. **La obra no se captura.** Sale de la asignación del trabajador: una
 *    máquina no puede quedar en una obra donde su operador no está. Si la
 *    persona está en varias, el cliente dice en cuál; si está en una, no se
 *    pregunta nada.
 * 2. **Una máquina está con una sola persona a la vez.** Asignarla a otra cierra
 *    el tramo anterior con motivo `reasignacion` y lo deja en la historia. Una
 *    persona sí puede tener varias máquinas.
 * 3. **La máquina pierde al trabajador, no la obra.** Cuando al operador lo dan
 *    de baja o sale de la obra, el tramo se cierra y se abre otro en la MISMA
 *    obra sin trabajador. Sacarla de ahí es una decisión a mano: la devolución.
 * 4. **Los días no se guardan.** Cada tramo dice cuánto duró al leerse, y el
 *    vigente cuenta hasta hoy (`utils/domain/machineTime`).
 */
class MachineAssignmentService {
  /**
   * POST /maquinas/:id/asignacion — entregarle la máquina a alguien.
   *
   * `proyectoId` es **opcional y sólo desempata**: nunca decide la obra por su
   * cuenta, tiene que ser una de las obras donde el trabajador está asignado
   * hoy, en la empresa de la máquina.
   */
  async asignar(maquinaId, datos, contexto = {}) {
    const maquina = await machineService.assertVisible(maquinaId, contexto)
    if (!maquina.activo) {
      throw new AppError(
        400,
        'Esa máquina está dada de baja. Reactívala antes de asignarla.'
      )
    }

    const empleado = await this.#buscarEmpleadoAsignable(datos.empleadoId)
    const obras = await this.#obrasDelTrabajador(empleado._id, maquina.empresaId)
    const asignacion = this.#elegirObra(obras, datos.proyectoId, empleado)

    const fechaAsignacion = datos.fechaAsignacion || today()
    if (isBefore(fechaAsignacion, asignacion.fechaAsignacion)) {
      throw AppError.validation(
        `${empleado.nombre} entró a esa obra el ${asignacion.fechaAsignacion}: la máquina no puede entregársele antes.`,
        [
          {
            msg: 'Fecha anterior a la asignación del trabajador',
            path: 'fechaAsignacion'
          }
        ]
      )
    }

    let tramo = null
    let liberada = null

    const sesion = await mongoose.startSession()
    try {
      await sesion.withTransaction(async () => {
        // Cada intento parte de cero: `withTransaction` puede reintentar.
        liberada = null

        const vigente = await this.#tramoVigente(maquina._id, {
          sesion,
          conNombres: true
        })

        if (vigente) {
          this.#assertNoEsElMismo(vigente, empleado, asignacion.proyectoId._id)
          if (isBefore(fechaAsignacion, vigente.fechaAsignacion)) {
            throw AppError.validation(
              `El tramo vigente de esa máquina empezó el ${vigente.fechaAsignacion}: no se puede entregar antes de esa fecha.`,
              [{ msg: 'Fecha anterior al tramo vigente', path: 'fechaAsignacion' }]
            )
          }

          /*
           * El día del cambio de manos lo cuentan los dos: ese día la tuvieron
           * ambos. Cerrar ANTES de crear no es un detalle de estilo — el índice
           * único parcial sólo admite un tramo vigente por máquina.
           */
          vigente.activo = false
          vigente.fechaDevolucion = fechaAsignacion
          vigente.motivoCierre = 'reasignacion'
          await vigente.save({ session: sesion })
          liberada = stintToJson(vigente)
        }

        const [creado] = await MachineAssignment.create(
          [
            {
              maquinaId: maquina._id,
              empresaId: maquina.empresaId,
              proyectoId: asignacion.proyectoId._id,
              empleadoId: empleado._id,
              asignacionId: asignacion._id,
              fechaAsignacion
            }
          ],
          { session: sesion }
        )
        tramo = creado
      })
    } catch (error) {
      throw this.#traducirChoque(error)
    } finally {
      await sesion.endSession()
    }

    await tramo.populate([
      { path: 'empleadoId', select: 'nombre' },
      { path: 'proyectoId', select: 'nombre' }
    ])

    return {
      maquina: await machineService.serializar(maquina, stintToJson(tramo)),
      liberada,
      avisos: liberada ? [this.#avisoDeLiberacion(liberada)] : []
    }
  }

  /**
   * POST /maquinas/:id/devolucion — de vuelta al patio.
   *
   * Es lo **único** que saca una máquina de la obra sin llevarla a otra: por eso
   * una máquina que se quedó sin trabajador sigue apareciendo en su obra hasta
   * que alguien decide traerla.
   */
  async devolver(maquinaId, datos = {}, contexto = {}) {
    const maquina = await machineService.assertVisible(maquinaId, contexto)

    const vigente = await this.#tramoVigente(maquina._id, { conNombres: true })
    if (!vigente) throw new AppError(400, 'Esa máquina no está asignada a ninguna obra')

    const fechaDevolucion = datos.fechaDevolucion || today()
    if (isBefore(fechaDevolucion, vigente.fechaAsignacion)) {
      throw AppError.validation(
        `La máquina salió a la obra el ${vigente.fechaAsignacion}: no puede devolverse antes de esa fecha.`,
        [{ msg: 'Fecha anterior a la entrega', path: 'fechaDevolucion' }]
      )
    }

    vigente.activo = false
    vigente.fechaDevolucion = fechaDevolucion
    vigente.motivoCierre = 'devolucion'
    await vigente.save()

    return {
      // Sin tramo vigente: disponible.
      maquina: await machineService.serializar(maquina, null),
      devuelta: stintToJson(vigente)
    }
  }

  /**
   * GET /maquinas/:id/historial — quién la ha usado, dónde y cuánto tiempo.
   *
   * Los días de cada tramo y el acumulado por trabajador vienen calculados: el
   * tramo vigente cuenta hasta hoy y nadie tiene que contar días a mano.
   */
  async historial(maquinaId, contexto = {}) {
    const maquina = await machineService.assertVisible(maquinaId, contexto)

    const tramos = await MachineAssignment.find({ maquinaId: maquina._id })
      .sort({ fechaAsignacion: -1, createdAt: -1 })
      .populate({ path: 'empleadoId', select: 'nombre' })
      .populate({ path: 'proyectoId', select: 'nombre' })

    const historia = tramos.map((t) => stintToJson(t))

    return {
      maquina: {
        _id: maquina._id.toString(),
        identificador: maquina.identificador,
        modelo: maquina.modelo,
        activo: maquina.activo
      },
      actual: historia.find((t) => t.vigente) ?? null,
      total: historia.length,
      tramos: historia,
      porTrabajador: accumulateByEmployee(historia)
    }
  }

  /** GET /proyectos/:id/maquinas — qué máquinas hay en la obra y con quién. */
  async deLaObra(proyectoId, contexto = {}) {
    const proyecto = await this.#buscarProyectoVisible(proyectoId, contexto)

    const tramos = await MachineAssignment.find({
      proyectoId: proyecto._id,
      activo: true
    })
      .populate({ path: 'maquinaId' })
      .populate({ path: 'empleadoId', select: 'nombre' })
      .populate({ path: 'proyectoId', select: 'nombre' })

    return this.#maquinasDeLosTramos(tramos)
  }

  /** GET /empleados/:id/maquinas — qué máquinas trae esa persona. */
  async delTrabajador(empleadoId, contexto = {}) {
    const empleado = await this.#buscarEmpleadoVisible(empleadoId, contexto)

    const filtro = { empleadoId: empleado._id, activo: true }
    // El alcance de las máquinas es el de SU empresa, no el de la persona: quien
    // está adscrito a dos empresas puede traer máquinas de las dos.
    if (contexto.empresasVisibles !== null && contexto.empresasVisibles !== undefined) {
      filtro.empresaId = {
        $in: contexto.empresasVisibles.map((id) => new mongoose.Types.ObjectId(id))
      }
    }

    const tramos = await MachineAssignment.find(filtro)
      .populate({ path: 'maquinaId' })
      .populate({ path: 'empleadoId', select: 'nombre' })
      .populate({ path: 'proyectoId', select: 'nombre' })

    return this.#maquinasDeLosTramos(tramos)
  }

  /**
   * El trabajador se fue: la máquina pierde a la persona, **no la obra** (D-87).
   *
   * Lo llaman la salida de la obra (`assignmentService.salida`) y la baja del
   * trabajador (`employeeService.setEstado`), siempre dentro de SU transacción:
   * o pasan las dos cosas o ninguna. Cierra cada tramo vigente y abre otro en la
   * misma obra con `empleadoId: null`, que es el estado «aquí está la máquina,
   * pero sin operador».
   *
   * @param {object} datos
   * @param {*} datos.empleadoId
   * @param {*} [datos.proyectoId] sólo los de esa obra; sin él, todas sus máquinas
   * @param {string} datos.fecha `'YYYY-MM-DD'` en que dejó de tenerlas
   * @param {'salida_de_obra'|'baja_de_trabajador'} datos.motivo
   * @param {object} [sesion] la sesión de la transacción de quien llama
   * @returns {Promise<Array>} lo que quedó sin trabajador, para poder avisarlo
   */
  async liberarDelTrabajador({ empleadoId, proyectoId = null, fecha, motivo }, sesion) {
    const filtro = { empleadoId, activo: true }
    if (proyectoId) filtro.proyectoId = proyectoId

    const consulta = MachineAssignment.find(filtro)
      .populate({ path: 'maquinaId', select: 'identificador modelo' })
      .populate({ path: 'proyectoId', select: 'nombre' })
    if (sesion) consulta.session(sesion)

    const vigentes = await consulta
    const liberadas = []

    for (const tramo of vigentes) {
      /*
       * La fecha de salida puede ser anterior a la entrega de la máquina —se
       * captura después, y a veces con fecha de días atrás—. Se recorta al
       * inicio del tramo: un tramo no puede cerrarse antes de empezar.
       */
      const corte = isBefore(fecha, tramo.fechaAsignacion) ? tramo.fechaAsignacion : fecha
      const maquina = tramo.maquinaId
      const obra = tramo.proyectoId

      tramo.activo = false
      tramo.fechaDevolucion = corte
      tramo.motivoCierre = motivo
      await tramo.save(sesion ? { session: sesion } : {})

      // El tramo nuevo: misma obra, sin trabajador. Después de cerrar el
      // anterior, que el índice sólo admite un vigente por máquina.
      await MachineAssignment.create(
        [
          {
            maquinaId: maquina?._id ?? tramo.maquinaId,
            empresaId: tramo.empresaId,
            proyectoId: obra?._id ?? tramo.proyectoId,
            empleadoId: null,
            asignacionId: null,
            fechaAsignacion: corte
          }
        ],
        sesion ? { session: sesion } : {}
      )

      liberadas.push({
        maquinaId: String(maquina?._id ?? tramo.maquinaId),
        identificador: maquina?.identificador ?? null,
        modelo: maquina?.modelo ?? null,
        proyectoId: String(obra?._id ?? tramo.proyectoId),
        proyectoNombre: obra?.nombre ?? null,
        motivo
      })
    }

    return liberadas
  }

  // ─── Interno ───────────────────────────────────────────────────────────────

  /** El tramo vigente de una máquina, o `null` si está en el patio. */
  async #tramoVigente(maquinaId, { sesion = null, conNombres = false } = {}) {
    const consulta = MachineAssignment.findOne({ maquinaId, activo: true })
    if (conNombres) {
      consulta
        .populate({ path: 'empleadoId', select: 'nombre' })
        .populate({ path: 'proyectoId', select: 'nombre' })
    }
    if (sesion) consulta.session(sesion)
    return consulta
  }

  /** Las máquinas de una lista de tramos vigentes, ya serializadas. */
  async #maquinasDeLosTramos(tramos) {
    const conMaquina = tramos
      .filter((t) => t.maquinaId)
      .sort((a, b) =>
        porIdentificador.compare(a.maquinaId.identificador, b.maquinaId.identificador)
      )

    return {
      total: conMaquina.length,
      maquinas: await Promise.all(
        conMaquina.map((t) => machineService.serializar(t.maquinaId, stintToJson(t)))
      )
    }
  }

  async #buscarEmpleadoAsignable(empleadoId) {
    if (!mongoose.isValidObjectId(empleadoId)) {
      throw new AppError(400, 'El empleado indicado no es válido')
    }

    const empleado = await Employee.findById(empleadoId).select('nombre activo')
    if (!empleado) throw AppError.notFound('El empleado no existe')
    if (!empleado.activo) {
      throw AppError.validation(
        `${empleado.nombre} está dado de baja: no se le puede entregar una máquina.`,
        [{ msg: 'El empleado está dado de baja', path: 'empleadoId' }]
      )
    }
    return empleado
  }

  /**
   * Las obras donde el trabajador está HOY, dentro de la empresa de la máquina.
   *
   * El cruce con la empresa no es cosmético: la máquina es de una empresa y no
   * puede irse a la obra de otra, aunque la persona esté adscrita a las dos.
   */
  async #obrasDelTrabajador(empleadoId, empresaId) {
    const asignaciones = await Assignment.find({ empleadoId, activo: true })
      .sort({ fechaAsignacion: -1 })
      .populate({ path: 'proyectoId', select: 'nombre empresaId estado' })

    return asignaciones.filter(
      (a) => a.proyectoId && String(a.proyectoId.empresaId) === String(empresaId)
    )
  }

  /**
   * En cuál de sus obras va la máquina.
   *
   * Una obra: no se pregunta. Varias sin elegir: 400 con la lista, para que la
   * pantalla pueda preguntar. Ninguna: la persona no está en obra y no hay dónde
   * poner la máquina.
   */
  #elegirObra(obras, proyectoId, empleado) {
    const abiertas = obras.filter((o) => o.proyectoId.estado !== 'finalizado')

    if (proyectoId) {
      const elegida = obras.find((o) => String(o.proyectoId._id) === String(proyectoId))
      if (!elegida) {
        throw AppError.validation(`${empleado.nombre} no está asignado a esa obra.`, [
          { msg: 'El empleado no está asignado a esa obra', path: 'proyectoId' }
        ])
      }
      if (elegida.proyectoId.estado === 'finalizado') {
        throw AppError.validation(
          `«${elegida.proyectoId.nombre}» ya está finalizada: no se le pueden llevar máquinas.`,
          [{ msg: 'El proyecto está finalizado', path: 'proyectoId' }]
        )
      }
      return elegida
    }

    if (abiertas.length === 0) {
      throw AppError.validation(
        `${empleado.nombre} no está asignado a ninguna obra de esta empresa. Asígnalo a la obra antes de entregarle la máquina.`,
        [{ msg: 'El empleado no está asignado a ninguna obra', path: 'empleadoId' }]
      )
    }

    if (abiertas.length === 1) return abiertas[0]

    throw new AppError(
      400,
      `${empleado.nombre} está en ${abiertas.length} obras: dinos en cuál va la máquina.`,
      {
        code: 'OBRA_REQUERIDA',
        errors: [{ msg: 'Indica en qué obra va la máquina', path: 'proyectoId' }],
        // Con la lista, para que la pantalla pregunte en vez de adivinar.
        data: {
          obras: abiertas.map((o) => ({
            proyectoId: o.proyectoId._id.toString(),
            proyectoNombre: o.proyectoId.nombre,
            asignacionId: o._id.toString(),
            fechaAsignacion: o.fechaAsignacion
          }))
        }
      }
    )
  }

  /** Volver a asignar lo mismo a la misma persona no es un cambio: es un error. */
  #assertNoEsElMismo(vigente, empleado, proyectoId) {
    const mismaPersona = String(vigente.empleadoId?._id ?? vigente.empleadoId ?? '')
    const mismaObra = String(vigente.proyectoId?._id ?? vigente.proyectoId)

    if (mismaPersona === String(empleado._id) && mismaObra === String(proyectoId)) {
      throw AppError.conflict(
        `${empleado.nombre} ya tiene esa máquina en esa obra desde el ${vigente.fechaAsignacion}`,
        { code: 'MAQUINA_YA_ASIGNADA' }
      )
    }
  }

  /** Lo que hay que decirle a quien reasigna: a quién se le quitó. */
  #avisoDeLiberacion(liberada) {
    const obra = liberada.proyectoNombre ? ` en ${liberada.proyectoNombre}` : ''

    if (!liberada.empleadoId) {
      return `La máquina estaba${obra} sin trabajador desde el ${liberada.fechaAsignacion}.`
    }

    return `La máquina se le quitó a ${liberada.empleadoNombre}${obra}, que la tuvo ${liberada.dias} ${liberada.dias === 1 ? 'día' : 'días'}.`
  }

  /**
   * Dos asignaciones simultáneas de la misma máquina: una crea el tramo y la
   * otra choca contra el índice parcial. Se traduce a un 409 con salida.
   */
  #traducirChoque(error) {
    if (error?.code !== 11000) return error
    return AppError.conflict(
      'Esa máquina se acaba de asignar a alguien más. Vuelve a cargar su ficha.',
      { code: 'MAQUINA_YA_ASIGNADA' }
    )
  }

  /** 404 si el empleado no existe o no está en ninguna empresa visible. */
  async #buscarEmpleadoVisible(empleadoId, contexto) {
    if (!mongoose.isValidObjectId(empleadoId)) {
      throw new AppError(400, 'El empleado indicado no es válido')
    }

    const empleado = await Employee.findById(empleadoId).select('nombre activo')
    if (!empleado) throw AppError.notFound('El empleado no existe')

    const { empresasVisibles = null } = contexto
    if (empresasVisibles !== null) {
      /*
       * Sin exigir la adscripción activa: a quien acaban de dar de baja hay que
       * poder preguntarle qué máquinas trae, que es justo cuando importa.
       */
      const adscrito = await Affiliation.exists({
        empleadoId: empleado._id,
        empresaId: { $in: empresasVisibles }
      })
      if (!adscrito) throw AppError.notFound('El empleado no existe')
    }

    return empleado
  }

  /** 404 si el proyecto no existe o su empresa no es visible. */
  async #buscarProyectoVisible(proyectoId, contexto) {
    if (!mongoose.isValidObjectId(proyectoId)) {
      throw new AppError(400, 'El proyecto indicado no es válido')
    }

    const proyecto = await Project.findById(proyectoId).select('_id empresaId nombre')
    if (
      !proyecto ||
      !empresaEsVisible(
        { empresasVisibles: contexto.empresasVisibles ?? null },
        proyecto.empresaId
      )
    ) {
      throw AppError.notFound('El proyecto no existe')
    }
    return proyecto
  }
}

module.exports = new MachineAssignmentService()
