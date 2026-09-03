const mongoose = require('mongoose')
const MachineIncident = require('./machineIncidentModel')
const machineService = require('../machines/machineService')
const incidentTypeService = require('../incidentTypes/incidentTypeService')
/*
 * El MODELO de los tramos, no su servicio: aquí sólo se LEE la historia de la
 * máquina para derivar quién la tenía. Pasar por el servicio arrastraría todo el
 * ciclo de asignación para una consulta de lectura.
 */
const MachineAssignment = require('../machineAssignments/machineAssignmentModel')
const { AppError } = require('../../../middlewares/errorHandler')
const { today, isBefore } = require('../../../utils/dates')
const { stintToJson, incidentToJson } = require('../../../utils/domain')

/**
 * Las incidencias de una máquina (D-88).
 *
 * Tres reglas que impone el servidor:
 *
 * 1. **El tipo sale del catálogo compartido**, y tiene que estar activo al
 *    levantarla. Las viejas conservan el suyo aunque se dé de baja después.
 * 2. **La fecha es la de cuando sucedió**, no la de cuando se capturó: puede ser
 *    de días atrás y no puede ser del futuro.
 * 3. **El trabajador y la obra de ese momento no se teclean**: se derivan de la
 *    historia de asignaciones al leer (`utils/domain/machineIncidents`).
 *
 * El alcance es el de la máquina: si su empresa no es visible, la máquina no
 * existe —404, nunca 403— y sus incidencias tampoco.
 */
class MachineIncidentService {
  /**
   * GET /maquinas/:id/incidencias?estado=abiertas|resueltas|todas
   *
   * Ordenadas por la fecha en que sucedieron, de la más reciente a la más vieja.
   * Los contadores van SIEMPRE completos, filtre lo que filtre: la pantalla
   * necesita saber cuántas abiertas hay aunque esté viendo las resueltas.
   */
  async list(maquinaId, { estado = 'todas' } = {}, contexto = {}) {
    const maquina = await machineService.assertVisible(maquinaId, contexto)

    const [incidencias, tramos] = await Promise.all([
      MachineIncident.find({ maquinaId: maquina._id })
        .sort({ fechaIncidencia: -1, createdAt: -1 })
        .populate({ path: 'tipoId', select: 'nombre activo' }),
      this.#historia(maquina._id)
    ])

    const todas = incidencias.map((i) => incidentToJson(i, { tramos }))
    const abiertas = todas.filter((i) => i.abierta)
    const listadas =
      estado === 'abiertas'
        ? abiertas
        : estado === 'resueltas'
          ? todas.filter((i) => !i.abierta)
          : todas

    return {
      maquina: this.#resumen(maquina),
      estado,
      total: listadas.length,
      abiertas: abiertas.length,
      resueltas: todas.length - abiertas.length,
      incidencias: listadas
    }
  }

  /**
   * POST /maquinas/:id/incidencias — levantar una.
   *
   * Se permite sobre una máquina **dada de baja**: muchas veces la incidencia es
   * justo el motivo de la baja, y capturarla después de darla es lo normal.
   */
  async create(maquinaId, datos, contexto = {}) {
    const maquina = await machineService.assertVisible(maquinaId, contexto)
    const tipo = await incidentTypeService.usable(datos.tipoId)

    const fechaIncidencia = datos.fechaIncidencia || today()
    this.#assertNoEsDelFuturo(fechaIncidencia, 'fechaIncidencia')

    const incidencia = await MachineIncident.create({
      maquinaId: maquina._id,
      empresaId: maquina.empresaId,
      tipoId: tipo._id,
      descripcion: datos.descripcion,
      fechaIncidencia
    })

    return { incidencia: await this.#serializar(incidencia, maquina) }
  }

  /**
   * POST /incidencias/:id/resolucion — darla por atendida.
   *
   * La nota es opcional; la fecha, si no viene, es hoy. Una incidencia ya
   * resuelta no se vuelve a resolver: se responde 409 con la fecha que tiene,
   * para que la pantalla pueda decir por qué no hizo nada.
   */
  async resolver(incidenciaId, datos = {}, contexto = {}) {
    const incidencia = await this.#buscarVisible(incidenciaId, contexto)

    if (incidencia.fechaResolucion) {
      throw AppError.conflict(
        `Esa incidencia ya se resolvió el ${incidencia.fechaResolucion}`,
        { code: 'INCIDENCIA_YA_RESUELTA' }
      )
    }

    const fechaResolucion = datos.fechaResolucion || today()
    this.#assertNoEsDelFuturo(fechaResolucion, 'fechaResolucion')

    if (isBefore(fechaResolucion, incidencia.fechaIncidencia)) {
      throw AppError.validation(
        `La incidencia sucedió el ${incidencia.fechaIncidencia}: no puede resolverse antes de esa fecha.`,
        [{ msg: 'Fecha anterior a la incidencia', path: 'fechaResolucion' }]
      )
    }

    incidencia.fechaResolucion = fechaResolucion
    incidencia.notaResolucion = datos.notaResolucion?.trim() || null
    await incidencia.save()

    return { incidencia: await this.#serializar(incidencia) }
  }

  // ─── Interno ───────────────────────────────────────────────────────────────

  /**
   * La historia completa de una máquina, en la forma de `stintToJson`: es contra
   * esto que se cruza la fecha de cada incidencia. Se trae UNA vez por consulta,
   * no una por incidencia.
   */
  async #historia(maquinaId) {
    const tramos = await MachineAssignment.find({ maquinaId })
      .sort({ fechaAsignacion: -1, createdAt: -1 })
      .populate({ path: 'empleadoId', select: 'nombre' })
      .populate({ path: 'proyectoId', select: 'nombre' })

    return tramos.map((t) => stintToJson(t))
  }

  /** Una incidencia con su tipo y su contexto, ya resuelta la historia. */
  async #serializar(incidencia, maquina = null) {
    await incidencia.populate({ path: 'tipoId', select: 'nombre activo' })
    const tramos = await this.#historia(maquina?._id ?? incidencia.maquinaId)
    return incidentToJson(incidencia, { tramos })
  }

  /** Lo mínimo de la máquina para encabezar el listado. */
  #resumen(maquina) {
    return {
      _id: maquina._id.toString(),
      empresaId: String(maquina.empresaId),
      identificador: maquina.identificador,
      modelo: maquina.modelo,
      activo: maquina.activo
    }
  }

  /** Capturar algo que todavía no pasa es una fecha mal tecleada. */
  #assertNoEsDelFuturo(fecha, campo) {
    if (isBefore(today(), fecha)) {
      throw AppError.validation('La fecha no puede ser del futuro', [
        { msg: 'La fecha no puede ser del futuro', path: campo }
      ])
    }
  }

  /**
   * 404 si la incidencia no existe o su máquina no es visible. Se comprueba
   * contra la MÁQUINA, no contra el `empresaId` copiado: es la misma puerta que
   * usa todo lo demás de maquinaria, y así no hay dos definiciones de alcance.
   */
  async #buscarVisible(id, contexto) {
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError(400, 'La incidencia indicada no es válida')
    }

    const incidencia = await MachineIncident.findById(id)
    if (!incidencia) throw AppError.notFound('La incidencia no existe')

    try {
      await machineService.assertVisible(incidencia.maquinaId, contexto)
    } catch {
      // La máquina no es visible: la incidencia tampoco existe para quien pregunta.
      throw AppError.notFound('La incidencia no existe')
    }

    return incidencia
  }
}

module.exports = new MachineIncidentService()
