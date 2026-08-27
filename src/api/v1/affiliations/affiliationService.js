const mongoose = require('mongoose')
const Affiliation = require('./affiliationModel')
const Employee = require('../employees/employeeModel')
const Company = require('../companies/companyModel')
const Assignment = require('../assignments/assignmentModel')
const areaService = require('../areas/areaService')
const Project = require('../projects/projectModel')
const { AppError } = require('../../../middlewares/errorHandler')
const { today } = require('../../../utils/dates')
const {
  empresaEsVisible,
  areasVisibles
} = require('../../../middlewares/scopeMiddleware')

/**
 * Adscripciones — empresa ↔ empleado (backend-spec §6.3).
 *
 * Es el flujo que hace útil el catálogo compartido: se toma a alguien que ya
 * existe y se le vincula a una empresa, en vez de darlo de alta otra vez. El
 * alta (`POST /empleados`) crea la primera adscripción de una persona; este
 * módulo es para las que vienen después —moverla, sumarle una empresa, darla de
 * baja de una sin tocar las demás.
 */
class AffiliationService {
  /** Las adscripciones de una empresa, con la persona resuelta. */
  async list(
    empresaId,
    { activo = 'true', area, categoriaId, orden } = {},
    contexto = {}
  ) {
    await this.#assertEmpresaVisible(empresaId, contexto)
    if (area) await areaService.assertExiste(area, 'area')

    const filtro = { empresaId: new mongoose.Types.ObjectId(empresaId) }
    // Tres estados excluyentes (D-51): `'true'` (default) sólo activas, `'false'`
    // sólo bajas, `'todos'` sin filtro — nunca mezcladas salvo que se pida.
    if (activo === 'true') filtro.activo = true
    else if (activo === 'false') filtro.activo = false

    const propias = this.#areasDelJefe(empresaId, contexto)
    if (propias) {
      // Jefe de área: sólo ve SUS áreas de esta empresa. Si además pide un área
      // concreta, se queda dentro de las suyas — nunca amplía.
      filtro.areas = { $in: area ? propias.filter((a) => a === area) : propias }
    } else if (area) {
      filtro.areas = area
    }

    /*
     * `categoriaId` es de la PERSONA, no de la adscripción: se resuelve primero
     * contra `employees` y acota por `empleadoId`.
     *
     * El filtro por `tipo` se fue en D-59, junto con el desplegable de la tabla.
     */
    if (categoriaId) {
      const ids = await Employee.find({
        categoriaId: new mongoose.Types.ObjectId(categoriaId)
      }).select('_id')
      filtro.empleadoId = { $in: ids.map((e) => e._id) }
    }

    const adscripciones = await Affiliation.find(filtro)
      .populate({ path: 'empleadoId', select: 'nombre numeroEmpleado tipo activo' })
      .sort({ createdAt: -1 })

    /*
     * El orden por número se hace EN MEMORIA porque desde D-54 `numeroEmpleado`
     * es de la persona, no de la adscripción, y Mongo no ordena por un campo
     * poblado. No pesa: este listado no está paginado —devuelve las
     * adscripciones de UNA empresa— y ya las trajo todas para formatearlas.
     *
     * Quien no tiene número va al final en los dos sentidos, igual que en
     * `GET /empleados` (D-53).
     */
    const direccion = orden === 'numero_desc' ? -1 : 1
    const filas = adscripciones.filter((a) => a.empleadoId)
    filas.sort((a, b) => {
      const na = a.empleadoId.numeroEmpleado
      const nb = b.empleadoId.numeroEmpleado
      if (!na && !nb) return 0
      if (!na) return 1
      if (!nb) return -1
      return na === nb ? 0 : (na < nb ? -1 : 1) * direccion
    })

    return { adscripciones: filas.map((a) => this.#formatear(a)) }
  }

  /**
   * Adscribe a una persona que ya existe. Si ya tuvo adscripción a esa empresa
   * y se dio de baja, **se reactiva** la existente; no se crea otra (el índice
   * único lo impide).
   */
  async add(empresaId, datos, contexto = {}) {
    await this.#assertEmpresaVisible(empresaId, contexto)

    const empleado = await Employee.findById(datos.empleadoId)
    if (!empleado) throw AppError.notFound('El empleado no existe')
    if (!empleado.activo) {
      throw new AppError(400, 'Esta persona está dada de baja del sistema')
    }

    this.#validarAreas(datos.areas, empleado.tipo)
    await this.#assertAreasDelCatalogo(datos.areas)

    const existente = await Affiliation.findOne({ empresaId, empleadoId: empleado._id })
    if (existente && existente.activo) {
      throw AppError.conflict('Esa persona ya está adscrita a esa empresa', {
        code: 'ADSCRIPCION_DUPLICADA',
        data: { adscripcion: existente.toJSON() }
      })
    }

    const campos = {
      areas: datos.areas || [],
      tipoContrato: datos.tipoContrato,
      fechaIngreso: datos.fechaIngreso,
      fechaTerminoContrato: datos.fechaTerminoContrato || null
    }

    let adscripcion
    let reactivada = false
    if (existente) {
      Object.assign(existente, campos, {
        activo: true,
        motivoBaja: null,
        fechaBaja: null
      })
      await existente.save()
      adscripcion = existente
      reactivada = true
    } else {
      adscripcion = await Affiliation.create({
        empresaId,
        empleadoId: empleado._id,
        ...campos
      })
    }

    // El checklist sale de la unión de las adscripciones activas.
    await this.#resincronizarExpediente(empleado._id)

    return { adscripcion: adscripcion.toJSON(), reactivada }
  }

  /** `PATCH /adscripciones/:id` — mismos campos que el alta, menos la empresa. */
  async update(id, datos, contexto = {}) {
    const adscripcion = await this.#buscarVisible(id, contexto)
    const empleado = await Employee.findById(adscripcion.empleadoId).select('tipo')

    const areasNuevas = datos.areas === undefined ? adscripcion.areas : datos.areas
    this.#validarAreas(areasNuevas, empleado.tipo)
    // Sólo lo que llega nuevo: una adscripción vieja puede conservar un área que
    // ya se dio de baja, y editar su fecha de ingreso no debería fallar por eso.
    if (datos.areas !== undefined) await this.#assertAreasDelCatalogo(datos.areas)

    /*
     * Capturar aquí la fecha de término que el importador dejó pendiente la saca
     * sola de `datosPendientes`: lo hace el `pre('validate')` del modelo, para
     * que valga por cualquier camino y no sólo por este. `datosPendientes` no
     * está en la lista blanca de la validación, así que nadie puede ponerlo desde
     * el `PATCH` — sólo quitarlo, llenando el dato (D-46).
     */
    for (const campo of [
      'areas',
      'tipoContrato',
      'fechaIngreso',
      'fechaTerminoContrato'
    ]) {
      if (datos[campo] === undefined) continue
      adscripcion[campo] = datos[campo] === '' ? null : datos[campo]
    }

    await adscripcion.save()
    await this.#resincronizarExpediente(adscripcion.empleadoId)

    return { adscripcion: adscripcion.toJSON() }
  }

  /**
   * `PATCH /adscripciones/:id/estado` — baja o reactivación **de esta
   * empresa**, no del sistema (eso es `PATCH /empleados/:id/estado`).
   *
   * Dar de baja también cierra sus asignaciones abiertas a proyectos de esa
   * empresa: seguir "en obra" de una empresa de la que ya no depende no tiene
   * sentido, y los dejaría ahí para siempre en los reportes — mismo criterio
   * que al finalizar un proyecto (D-38).
   */
  async setEstado(id, { activo, motivo }, contexto = {}) {
    const adscripcion = await this.#buscarVisible(id, contexto)

    if (adscripcion.activo === activo) {
      return { adscripcion: adscripcion.toJSON() }
    }

    const sesion = await mongoose.startSession()
    try {
      await sesion.withTransaction(async () => {
        adscripcion.activo = activo
        adscripcion.motivoBaja = activo ? null : motivo
        adscripcion.fechaBaja = activo ? null : today()
        await adscripcion.save({ session: sesion })

        if (!activo) {
          const proyectos = await Project.find({ empresaId: adscripcion.empresaId })
            .select('_id')
            .session(sesion)
          await Assignment.updateMany(
            {
              empleadoId: adscripcion.empleadoId,
              proyectoId: { $in: proyectos.map((p) => p._id) },
              activo: true
            },
            { $set: { activo: false, fechaSalida: adscripcion.fechaBaja } },
            { session: sesion }
          )
        }
      })
    } finally {
      await sesion.endSession()
    }

    await this.#resincronizarExpediente(adscripcion.empleadoId)

    return { adscripcion: adscripcion.toJSON() }
  }

  // ─── Internos ──────────────────────────────────────────────────────────────

  /*
   * `require` aquí y no arriba: `recordService` requiere a `employeeService`
   * para el alcance, y con los dos `require` en el encabezado uno de los dos
   * captura un objeto vacío según el orden de carga (mismo motivo que en
   * `employeeService.create`).
   */
  async #resincronizarExpediente(empleadoId) {
    const recordService = require('../records/recordService')
    await recordService.sincronizar(empleadoId)
  }

  /** Que las áreas existan y estén activas en el catálogo (D-58). */
  async #assertAreasDelCatalogo(areas) {
    await areaService.assertUsables(areas, 'areas')
  }

  /**
   * `PATCH /adscripciones/:id/jefaturas` — quién dirige qué área (D-60).
   *
   * Va en su propia ruta y con su propia capacidad, aunque el dato se guarde en
   * la adscripción: no es parte de la relación laboral, es **quién ve a quién**.
   * Mezclarlo con `PATCH /adscripciones/:id` habría hecho que corregir una fecha
   * de ingreso y repartir visibilidad exigieran el mismo permiso.
   *
   * Las áreas que dirige **no tienen que ser** donde trabaja: un director puede
   * dirigir Contabilidad sin estar adscrito a ella. Lo único que hace falta es
   * que tenga adscripción a esta empresa, y eso ya lo garantiza el `:id`.
   */
  async setJefaturas(id, dirigeAreas, contexto = {}) {
    const adscripcion = await this.#buscarVisible(id, contexto)

    // Que existan y estén activas: dirigir un área dada de baja no significa
    // nada, y sería una forma silenciosa de no ver a nadie.
    await areaService.assertUsables(dirigeAreas, 'dirigeAreas')

    // Sin duplicados: dirigir dos veces la misma área no es dirigirla más.
    adscripcion.dirigeAreas = [...new Set(dirigeAreas)]
    await adscripcion.save()

    return { adscripcion: adscripcion.toJSON() }
  }

  /**
   * `GET /empresas/:id/jefaturas` — el catálogo de áreas de la empresa con quién
   * dirige cada una (D-60).
   *
   * Es la vista de la pantalla de configuración: se entra por el ÁREA, no por la
   * persona. Se arma leyendo las adscripciones, así que no hay un segundo lugar
   * donde el dato pueda quedar desincronizado.
   */
  async jefaturas(empresaId, contexto = {}) {
    await this.#assertEmpresaVisible(empresaId, contexto)

    const conJefatura = await Affiliation.find({
      empresaId: new mongoose.Types.ObjectId(empresaId),
      activo: true,
      'dirigeAreas.0': { $exists: true }
    }).populate({ path: 'empleadoId', select: 'nombre numeroEmpleado activo' })

    const porArea = new Map()
    for (const adscripcion of conJefatura) {
      if (!adscripcion.empleadoId) continue
      for (const clave of adscripcion.dirigeAreas) {
        if (!porArea.has(clave)) porArea.set(clave, [])
        porArea.get(clave).push({
          adscripcionId: adscripcion._id.toString(),
          empleadoId: adscripcion.empleadoId._id.toString(),
          nombre: adscripcion.empleadoId.nombre,
          numeroEmpleado: adscripcion.empleadoId.numeroEmpleado ?? null
        })
      }
    }

    /*
     * Se listan TODAS las áreas activas, no sólo las que tienen jefe: la
     * pantalla necesita ver cuáles están sin dirigir, que es la mitad de para
     * qué sirve.
     */
    const { areas } = await areaService.list({ activa: 'true' })

    return {
      jefaturas: areas.map((area) => ({
        area: { clave: area.clave, nombre: area.nombre, temporal: area.temporal },
        jefes: porArea.get(area.clave) || []
      }))
    }
  }

  /** Un administrativo necesita al menos un área (modelo-datos §5b.1). */
  #validarAreas(areas, tipoEmpleado) {
    if (tipoEmpleado === 'administrativo' && (areas || []).length === 0) {
      throw AppError.validation('Un empleado administrativo necesita al menos un área', [
        { msg: 'Indica al menos un área', path: 'areas' }
      ])
    }
  }

  /**
   * Áreas propias del jefe de área en esta empresa, o `null` si no está
   * limitado por área (entonces ve todo).
   */
  #areasDelJefe(empresaId, contexto) {
    const { user, areasPorEmpresa = {} } = contexto
    return areasVisibles({ user, areasPorEmpresa }, empresaId)
  }

  async #assertEmpresaVisible(empresaId, contexto) {
    if (!mongoose.isValidObjectId(empresaId)) {
      throw new AppError(400, 'La empresa indicada no es válida')
    }
    if (!empresaEsVisible({ empresasVisibles: contexto.empresasVisibles }, empresaId)) {
      throw AppError.notFound('La empresa no existe')
    }
    if (!(await Company.exists({ _id: empresaId }))) {
      throw AppError.notFound('La empresa no existe')
    }
  }

  async #buscarVisible(id, contexto) {
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError(400, 'La adscripción indicada no es válida')
    }
    const adscripcion = await Affiliation.findById(id)
    if (!adscripcion) throw AppError.notFound('La adscripción no existe')

    if (
      !empresaEsVisible(
        { empresasVisibles: contexto.empresasVisibles },
        adscripcion.empresaId
      )
    ) {
      throw AppError.notFound('La adscripción no existe')
    }
    return adscripcion
  }

  #formatear(adscripcion) {
    const persona = adscripcion.empleadoId
    return {
      ...adscripcion.toJSON(),
      empleado: {
        _id: persona._id.toString(),
        nombre: persona.nombre,
        // De la persona desde D-54; el renglón ya no lo trae en la raíz.
        numeroEmpleado: persona.numeroEmpleado ?? null,
        tipo: persona.tipo,
        activo: persona.activo
      }
    }
  }
}

module.exports = new AffiliationService()
