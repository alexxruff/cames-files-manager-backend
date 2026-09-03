const mongoose = require('mongoose')
const Record = require('./recordModel')
const Employee = require('../employees/employeeModel')
const Affiliation = require('../affiliations/affiliationModel')
const Assignment = require('../assignments/assignmentModel')
const Contract = require('../contracts/contractModel')
const Project = require('../projects/projectModel')
const ChecklistTemplate = require('../checklistTemplates/checklistTemplateModel')
const AccessLog = require('../accessLogs/accessLogModel')
const employeeService = require('../employees/employeeService')
const storage = require('../../../services/storageService')
const intake = require('../../../services/attachmentIntake')
const { AppError } = require('../../../middlewares/errorHandler')
const { esPrevisualizable } = require('../../../utils/fileTypes')
const { isCalendarDate, addMonths, today, compare } = require('../../../utils/dates')
const {
  construirChecklist,
  documentoEnBlanco,
  syncChecklist,
  unirRenglones,
  resolveTemplate,
  computeProgress,
  resolveDocuments,
  deriveSirocTracking,
  pickCurrentSirocContract
} = require('../../../utils/domain')
const {
  EXPIRING_DOCUMENT_TYPES,
  RECORD_STATUS_SEVERITY,
  documentLabel,
  isSensitiveDocument
} = require('../../../constants')
const { can, CAPABILITIES } = require('../../../utils/permissions')
const { empresaEsVisible } = require('../../../middlewares/scopeMiddleware')

const POR_PAGINA_DEFECTO = 25
const POR_PAGINA_MAXIMO = 100
/*
 * Tope interno para `employeeService.list` cuando se pide `estatus` (D-45): no
 * es el límite de una página, es "traer todo lo que hay que evaluar antes de
 * paginar". 2000 es generoso para el tamaño de plantilla de un solo grupo
 * empresarial; si algún día se queda corto, el síntoma es que `total` deja de
 * crecer aunque existan más expedientes con ese estatus.
 */
const LIMITE_PARA_FILTRAR_POR_ESTATUS = 2000

/**
 * Expedientes y sus documentos (backend-spec §6.5).
 *
 * **Uno por empleado**, creado a partir de la unión de las plantillas de sus
 * adscripciones activas. El expediente se crea con la persona; si alguien quedó
 * sin él —por haberse dado de alta antes de que esto existiera— se crea al
 * primer acceso, así que no hace falta una migración.
 */
/**
 * `claveAlmacenamiento` es `select: false`, así que no viene si no se pide. Hay
 * que pedirla **en toda lectura que después vaya a guardar**: al modificar el
 * arreglo de versiones, Mongoose lo reescribe completo, y lo que no se cargó se
 * guarda vacío. Sin esto, reemplazar un documento borraba la clave de las
 * versiones anteriores y sus archivos quedaban inalcanzables para siempre — que
 * es justo lo que el versionado existe para evitar. Ver D-41.
 */
const CAMPOS_OCULTOS =
  '+documentos.archivo.claveAlmacenamiento +documentos.versiones.archivo.claveAlmacenamiento'

class RecordService {
  /**
   * Devuelve el expediente del empleado, creándolo si no existe. Idempotente.
   *
   * @param {string} empleadoId
   * @param {object} [opciones]
   * @param {import('mongoose').ClientSession} [opciones.session] para crearlo
   *   dentro de la transacción del alta del empleado.
   */
  async asegurarParaEmpleado(empleadoId, { session } = {}) {
    const existente = await Record.findOne({ empleadoId })
      .select(CAMPOS_OCULTOS)
      .session(session || null)
    if (existente) return existente

    const { documentos, plantillas } = await this.#checklistQueLeToca(empleadoId, session)

    try {
      const [creado] = await Record.create([{ empleadoId, plantillas, documentos }], {
        session
      })
      return creado
    } catch (error) {
      // Otra petición lo creó en paralelo: el índice único lo impidió.
      if (error.code === 11000) {
        return Record.findOne({ empleadoId })
          .select(CAMPOS_OCULTOS)
          .session(session || null)
      }
      throw error
    }
  }

  /**
   * Re-sincroniza el checklist con lo que hoy exigen sus adscripciones, sin
   * perder trabajo hecho (modelo-datos §6.2).
   */
  /**
   * Como `asegurarParaEmpleado`, pero además rellena el checklist si quedó
   * vacío. Un expediente sin renglones no se puede llenar: no sale en los
   * faltantes y —antes de D-42— tampoco aceptaba subidas.
   *
   * Se sana **al leer** porque la causa siempre es que el checklist no se pudo
   * resolver al crearlo (plantillas mal guardadas, o alta sin adscripción
   * activa), y esa causa se corrige después. No es un `sincronizar` en cada
   * lectura: si ya tiene renglones, no escribe nada.
   */
  async #asegurarConChecklist(empleadoId) {
    const expediente = await this.asegurarParaEmpleado(empleadoId)
    return this.#rellenarSiEstaVacio(expediente)
  }

  async #rellenarSiEstaVacio(expediente) {
    if (expediente.documentos.length > 0) return expediente
    return this.sincronizar(expediente.empleadoId)
  }

  async sincronizar(empleadoId, { session } = {}) {
    const expediente = await this.asegurarParaEmpleado(empleadoId, { session })
    const { documentos, plantillas } = await this.#checklistQueLeToca(empleadoId, session)

    expediente.documentos = syncChecklist(
      expediente.documentos.map((d) => d.toObject()),
      documentos.map((d) => ({
        tipo: d.tipo,
        requerido: d.requerido,
        vigenciaMeses: d.vigenciaMeses
      }))
    )
    expediente.plantillas = plantillas
    await expediente.save({ session })

    return expediente
  }

  /**
   * GET /expedientes — listado paginado (backend-spec §6.5). Mismos filtros que
   * `/empleados`, más `estatus` (el semáforo derivado).
   *
   * `estatus` no se puede filtrar en Mongo sin duplicar en el pipeline la
   * lógica de vigencias (D-10; modelo-datos §9.1 lo pide evitar explícitamente:
   * "el avance no se calcula en el pipeline"). Así que se resuelve el avance de
   * TODOS los que cumplen los demás filtros —sin paginar en la base— y se
   * filtra, ordena y pagina aquí. Ver D-45.
   */
  async list(filtros = {}, contexto = {}) {
    const estatus = filtros.estatus || null
    const pagina = Math.max(1, Number(filtros.pagina) || 1)
    const porPagina = Math.min(
      POR_PAGINA_MAXIMO,
      Math.max(1, Number(filtros.porPagina) || POR_PAGINA_DEFECTO)
    )

    // El alcance, la búsqueda y los filtros de persona son los mismos que
    // `/empleados`: se reutiliza tal cual, con el tope alto de arriba.
    const { empleados } = await employeeService.list(
      {
        busqueda: filtros.busqueda,
        empresaId: filtros.empresaId,
        area: filtros.area,
        tipo: filtros.tipo,
        activo: filtros.activo,
        pagina: 1,
        porPagina: LIMITE_PARA_FILTRAR_POR_ESTATUS,
        limitePorPagina: LIMITE_PARA_FILTRAR_POR_ESTATUS
      },
      contexto
    )

    const ids = empleados.map((renglon) => renglon.empleado._id)
    const registros =
      ids.length === 0 ? [] : await Record.find({ empleadoId: { $in: ids } })
    const porEmpleado = new Map(registros.map((r) => [r.empleadoId.toString(), r]))

    let filas = empleados
      .map((renglon) => {
        const expediente = porEmpleado.get(renglon.empleado._id)
        // No debería faltar —D-41/D-42 garantizan uno por persona—, pero si
        // faltara no hay nada que mostrar para esa fila.
        return expediente ? this.#formatear(expediente, renglon) : null
      })
      .filter(Boolean)

    if (estatus) filas = filas.filter((fila) => fila.avance.estatus === estatus)

    filas.sort((a, b) => {
      if (filtros.orden === 'nombre_desc') {
        return b.empleado.empleado.nombre.localeCompare(a.empleado.empleado.nombre)
      }
      if (filtros.orden === 'nombre_asc') {
        return a.empleado.empleado.nombre.localeCompare(b.empleado.empleado.nombre)
      }
      // Por defecto, lo más urgente primero: vencido, incompleto, por vencer,
      // completo (RECORD_STATUS_SEVERITY).
      const diferencia =
        RECORD_STATUS_SEVERITY[a.avance.estatus] -
        RECORD_STATUS_SEVERITY[b.avance.estatus]
      return diferencia !== 0
        ? diferencia
        : a.empleado.empleado.nombre.localeCompare(b.empleado.empleado.nombre)
    })

    const total = filas.length
    const inicio = (pagina - 1) * porPagina

    return {
      total,
      pagina,
      porPagina,
      expedientes: filas.slice(inicio, inicio + porPagina)
    }
  }

  /** El expediente de un empleado visible, con su avance derivado. */
  async porEmpleado(empleadoId, contexto = {}) {
    // 404 si el empleado no existe o no es visible para quien pregunta.
    const renglon = await employeeService.getById(empleadoId, contexto)
    const expediente = await this.#asegurarConChecklist(empleadoId)

    return {
      ...this.#formatear(expediente, renglon),
      obras: await this.#obrasDe(empleadoId, contexto)
    }
  }

  async porId(expedienteId, contexto = {}) {
    if (!mongoose.isValidObjectId(expedienteId)) {
      throw new AppError(400, 'El expediente indicado no es válido')
    }
    const expediente = await Record.findById(expedienteId)
    if (!expediente) throw AppError.notFound('El expediente no existe')

    // El alcance es el del empleado: si no lo ve, el expediente no existe para él.
    const renglon = await employeeService.getById(expediente.empleadoId, contexto)
    return {
      ...this.#formatear(await this.#rellenarSiEstaVacio(expediente), renglon),
      obras: await this.#obrasDe(expediente.empleadoId, contexto)
    }
  }

  /**
   * Sube (o reemplaza) un documento del checklist.
   *
   * Reglas del spec §6.5:
   * - Subir se permite **desde cualquier estatus**: así se reemplaza uno
   *   rechazado o uno que venció.
   * - La versión nueva se numera, se inserta **al inicio**, marca
   *   `reemplazadaEn` en la anterior, pone el documento en `in_review` y
   *   **limpia el rechazo anterior**: no debe contaminar la entrega nueva.
   * - Un empleado dado de baja **del sistema** tiene el expediente en sólo
   *   lectura. La baja de una sola adscripción no lo bloquea: sigue trabajando
   *   en otra empresa.
   */
  async subirDocumento(expedienteId, tipo, datos, contexto = {}) {
    const { expediente, empleado } = await this.#paraEscritura(expedienteId, contexto)

    /*
     * Se puede subir cualquiera de los 12 tipos del catálogo, esté o no en su
     * checklist: la plantilla define qué es OBLIGATORIO, no qué se permite
     * guardar. Si no estaba, entra como renglón **no requerido**.
     *
     * Antes esto era un 400, y era un error de diseño con consecuencias: si las
     * plantillas fallaban —o la persona no tenía adscripción activa— el
     * expediente nacía vacío y no se podía subir NADA. Un documento que nadie
     * exige sigue siendo un documento que RH necesita guardar. `syncChecklist`
     * conserva estos renglones. Ver D-42.
     */
    let documento = expediente.documento(tipo)
    if (!documento) {
      expediente.documentos.push(documentoEnBlanco({ tipo, requerido: false }))
      documento = expediente.documento(tipo)
    }

    /*
     * 1. El archivo, venga en la petición (`multipart`) o ya subido directo al
     *    almacenamiento (D-83). En los dos casos el tipo se decide **por
     *    contenido**: ni la extensión ni el `Content-Type` sirven, porque los
     *    controla quien sube. El nombre sólo desempata entre formatos que
     *    comparten contenedor y habilita el CSV, que no tiene firma (D-78).
     */
    const entrada = await intake.resolver(datos, {
      destino: 'expediente',
      referencia: { expedienteId: expediente._id, tipoDocumento: tipo }
    })
    if (!entrada) {
      throw AppError.validation('Adjunta el archivo del documento', [
        { msg: 'El archivo es requerido', path: 'archivo' }
      ])
    }

    // 2. La vigencia, si este documento caduca.
    const vigenciaHasta = await this.#resolverVigencia(documento, empleado, datos)

    // 3. Al almacenamiento primero, a la base después.
    const version = (documento.versiones?.length || 0) + 1
    const clave = storage.construirClave({
      empleadoId: empleado._id,
      tipo,
      version,
      extension: entrada.tipoReal.extension
    })

    await entrada.guardarEn(clave)

    const registroArchivo = {
      nombre: entrada.nombreOriginal || `${tipo}.${entrada.tipoReal.extension}`,
      mime: entrada.tipoReal.mime,
      tamanoBytes: entrada.tamanoBytes,
      // El NOMBRE de quien sube, no sólo el id: es histórico.
      subidoPor: contexto.user?.nombre || 'Sistema',
      subidoPorId: contexto.user?._id,
      subidoEn: new Date(),
      claveAlmacenamiento: clave
    }

    try {
      // La versión anterior queda marcada como reemplazada.
      if (documento.versiones?.length > 0) {
        documento.versiones[0].reemplazadaEn = new Date()
      }

      documento.versiones.unshift({
        version,
        archivo: registroArchivo,
        estatus: 'in_review',
        vigenciaHasta
      })

      documento.estatus = 'in_review'
      documento.archivo = registroArchivo
      documento.vigenciaHasta = vigenciaHasta
      // El rechazo anterior no debe contaminar la entrega nueva.
      documento.motivoRechazo = null
      documento.revisadoPor = null
      documento.revisadoEn = null

      await expediente.save()
    } catch (error) {
      // Si la base falla, el objeto ya subido quedaría huérfano. Se limpia.
      await storage.borrar(clave)
      throw error
    }

    return {
      ...this.#formatear(
        expediente,
        await employeeService.getById(empleado._id, contexto)
      ),
      obras: await this.#obrasDe(empleado._id, contexto)
    }
  }

  /**
   * POST /expedientes/:id/documentos/:tipo/revisar (backend-spec §6.5, D-43).
   * `rh_admin` y `rh_consulta` (`REVIEW_DOCUMENTS`, D-44). Un solo endpoint para
   * validar y rechazar: `aprobado` decide cuál de las dos.
   *
   * Revisa la **versión vigente** (la última subida, `versiones[0]`), que es la
   * única que tiene sentido revisar. Pasa el documento y esa versión a
   * `validated` o `rejected`, con quién y cuándo.
   *
   * `estatus: 'in_review'` es un candado, no un detalle: evita revisar un
   * documento vacío (`pending`) o uno que ya se revisó.
   */
  async revisarDocumento(expedienteId, tipo, { aprobado, motivo } = {}, contexto = {}) {
    const { expediente } = await this.#paraEscritura(expedienteId, contexto)

    const documento = expediente.documento(tipo)
    if (!documento || documento.estatus !== 'in_review') {
      throw AppError.validation(
        `"${documentLabel(tipo)}" no tiene una entrega pendiente de revisión`,
        [{ msg: 'Este documento no está en revisión', path: 'tipo' }]
      )
    }

    const revisadoPor = contexto.user?.nombre || 'Sistema'
    const revisadoEn = new Date()
    const nuevoEstatus = aprobado ? 'validated' : 'rejected'
    const motivoRechazo = aprobado ? null : motivo

    documento.estatus = nuevoEstatus
    documento.motivoRechazo = motivoRechazo
    documento.revisadoPor = revisadoPor
    documento.revisadoEn = revisadoEn

    const version = documento.versiones[0]
    version.estatus = nuevoEstatus
    version.motivoRechazo = motivoRechazo
    version.revisadoPor = revisadoPor
    version.revisadoEn = revisadoEn

    await expediente.save()

    return {
      ...this.#formatear(
        expediente,
        await employeeService.getById(expediente.empleadoId, contexto)
      ),
      obras: await this.#obrasDe(expediente.empleadoId, contexto)
    }
  }

  /**
   * URL firmada para abrir una versión concreta, y **registro en bitácora**.
   *
   * El bucket es privado: no hay URL pública. Cada apertura pasa por aquí, que
   * comprueba permisos, firma por 10 minutos y deja rastro — requisito legal, no
   * un extra.
   */
  async urlDeVersion(expedienteId, tipo, version, contexto = {}) {
    const expediente = await Record.findById(expedienteId).select(
      '+documentos.versiones.archivo.claveAlmacenamiento'
    )
    if (!expediente) throw AppError.notFound('El expediente no existe')

    const renglon = await employeeService.getById(expediente.empleadoId, contexto)
    const documento = expediente.documento(tipo)
    if (!documento) throw AppError.notFound('Ese documento no está en el expediente')

    // El jefe de área ve que está entregado, pero no puede abrir los sensibles.
    if (isSensitiveDocument(tipo) && !this.#puedeAbrirSensibles(contexto)) {
      throw AppError.forbidden(
        `"${documentLabel(tipo)}" contiene datos personales sensibles y no tienes permiso para abrirlo`
      )
    }

    const laVersion = (documento.versiones || []).find(
      (v) => v.version === Number(version)
    )
    if (!laVersion) throw AppError.notFound('Esa versión del documento no existe')

    const url = await storage.urlDeDescarga(laVersion.archivo.claveAlmacenamiento, {
      nombreArchivo: laVersion.archivo.nombre,
      // Un Word o un Excel servidos `inline` son una pantalla de basura: lo que
      // el navegador no previsualiza se descarga siempre (D-78).
      descargar: contexto.descargar === true || !esPrevisualizable(laVersion.archivo.mime)
    })

    await AccessLog.create({
      empleadoId: contexto.user?._id,
      usuarioNombre: contexto.user?.nombre || 'Sistema',
      accion: contexto.descargar ? 'descargar_documento' : 'ver_documento',
      expedienteId: expediente._id,
      sujetoId: expediente.empleadoId,
      sujetoNombre: renglon.empleado.nombre,
      tipoDocumento: tipo,
      version: Number(version),
      ip: contexto.ip || null,
      userAgent: contexto.userAgent || null
    })

    return {
      url,
      expiraEnSegundos: contexto.ttlSegundos || undefined,
      archivo: {
        nombre: laVersion.archivo.nombre,
        mime: laVersion.archivo.mime,
        tamanoBytes: laVersion.archivo.tamanoBytes,
        previsualizable: esPrevisualizable(laVersion.archivo.mime)
      }
    }
  }

  // ─── Internos ──────────────────────────────────────────────────────────────

  /** El checklist que le toca hoy, por unión de sus adscripciones activas. */
  async #checklistQueLeToca(empleadoId, session) {
    const [adscripciones, plantillas] = await Promise.all([
      Affiliation.find({ empleadoId, activo: true })
        .select('empresaId areas tipoContrato activo')
        .session(session || null),
      /*
       * `$ne: false`, no `=== true`: es la misma regla que aplica
       * `resolveTemplate` (`p.activo !== false`). Con `activo: true` una
       * plantilla guardada antes de que el campo existiera queda invisible, y
       * como el checklist sale de aquí, TODO el expediente nace vacío y no se
       * puede subir nada. Pasó en la base de desarrollo. Ver D-42.
       */
      ChecklistTemplate.find({ activo: { $ne: false } }).session(session || null)
    ])

    const planas = plantillas.map((p) => ({
      _id: p._id,
      clave: p.clave,
      activo: p.activo,
      empresaId: p.empresaId,
      areas: p.areas,
      tiposContrato: p.tiposContrato,
      documentos: (p.documentos || []).map((d) => ({
        tipo: d.tipo,
        requerido: d.requerido,
        vigenciaMeses: d.vigenciaMeses ?? null
      }))
    }))

    /*
     * Sin adscripciones activas no hay de dónde sacar el checklist: se usa la
     * plantilla general como red de seguridad, para que el expediente exista y
     * se pueda empezar a llenar. Al adscribirlo se re-sincroniza.
     */
    if (adscripciones.length === 0) {
      const general = resolveTemplate(planas, { tipoContrato: 'indeterminado' })
      if (!general) return { documentos: [], plantillas: [] }
      const renglones = unirRenglones([general.documentos])
      return {
        documentos: renglones.map((r) => ({
          tipo: r.tipo,
          requerido: r.requerido,
          estatus: 'pending',
          vigenciaMeses: r.vigenciaMeses,
          vigenciaHasta: null,
          archivo: null,
          motivoRechazo: null,
          revisadoPor: null,
          revisadoEn: null,
          versiones: []
        })),
        plantillas: [general._id]
      }
    }

    return construirChecklist(
      adscripciones.map((a) => ({
        empresaId: a.empresaId,
        areas: a.areas,
        tipoContrato: a.tipoContrato,
        activo: a.activo
      })),
      planas
    )
  }

  /** Expediente + empleado, comprobando que se pueda escribir en él. */
  async #paraEscritura(expedienteId, contexto) {
    if (!mongoose.isValidObjectId(expedienteId)) {
      throw new AppError(400, 'El expediente indicado no es válido')
    }
    const expediente = await Record.findById(expedienteId).select(CAMPOS_OCULTOS)
    if (!expediente) throw AppError.notFound('El expediente no existe')

    // Alcance: si no ve al empleado, para él el expediente no existe.
    await employeeService.getById(expediente.empleadoId, contexto)

    const empleado = await Employee.findById(expediente.empleadoId)
    if (!empleado.activo) {
      throw new AppError(
        400,
        'Esta persona está dada de baja del sistema: su expediente es de sólo lectura'
      )
    }

    return { expediente, empleado }
  }

  /**
   * La vigencia con la que queda la versión nueva (spec §6.5 y §7.7 del modelo
   * anterior, que se conserva):
   *
   * - `contrato`: la fecha de término de su contrato **temporal más próximo**. Si
   *   todos sus contratos son indeterminados, no lleva vigencia.
   * - Los demás que caducan: la que manden, o hoy + `vigenciaMeses` como
   *   propuesta si no la mandan.
   */
  async #resolverVigencia(documento, empleado, datos) {
    const caduca = EXPIRING_DOCUMENT_TYPES.includes(documento.tipo)

    if (datos.vigenciaHasta) {
      if (!isCalendarDate(datos.vigenciaHasta)) {
        throw AppError.validation('La vigencia debe tener el formato AAAA-MM-DD', [
          { msg: 'Fecha con formato inválido', path: 'vigenciaHasta' }
        ])
      }
      if (!caduca) {
        throw AppError.validation(
          `"${documentLabel(documento.tipo)}" no lleva vigencia`,
          [{ msg: 'Este documento no caduca', path: 'vigenciaHasta' }]
        )
      }
      return datos.vigenciaHasta
    }

    if (!caduca) return null

    if (documento.tipo === 'contrato') {
      const temporales = await Affiliation.find({
        empleadoId: empleado._id,
        activo: true,
        fechaTerminoContrato: { $ne: null }
      }).select('fechaTerminoContrato')

      if (temporales.length === 0) return null // indeterminado: no vence
      // La más próxima: es la condición más estricta.
      return temporales
        .map((a) => a.fechaTerminoContrato)
        .sort((a, b) => compare(a, b))[0]
    }

    if (documento.vigenciaMeses) {
      return addMonths(today(), documento.vigenciaMeses)
    }

    throw AppError.validation(
      `"${documentLabel(documento.tipo)}" necesita fecha de vigencia`,
      [{ msg: 'Indica hasta cuándo es vigente', path: 'vigenciaHasta' }]
    )
  }

  #puedeAbrirSensibles(contexto) {
    return can(contexto.user?.acceso, CAPABILITIES.OPEN_SENSITIVE_DOCUMENTS)
  }

  /**
   * Expediente + empleado + avance derivado, listo para responder.
   *
   * `empleado` es el **RenglonEmpleado** completo, la misma forma que devuelven
   * `/empleados` y las rutas de acceso: así `data.empleado` significa siempre lo
   * mismo y la pantalla del expediente tiene a mano su empresa y su contrato.
   *
   * Los estatus `expiring` y `expired` se derivan aquí al leer; en la base sólo
   * viven los cuatro persistibles.
   */
  /**
   * Forma de respuesta única de todo el módulo. `empleado` es **el mismo renglón
   * que devuelve `GET /empleados/:id`** —con categoría y adscripciones—, en las
   * tres rutas: la del alta del documento incluida. Si una devolviera sólo la
   * persona, el front tendría que ramificar por endpoint.
   */
  #formatear(expediente, renglonEmpleado) {
    const json = expediente.toJSON()

    return {
      expediente: { ...json, documentos: resolveDocuments(json.documentos) },
      empleado: renglonEmpleado,
      avance: computeProgress(json.documentos)
    }
  }

  /**
   * Las obras de la persona, con el SIROC que la cubre — **derivado al leer**.
   *
   * No hay ningún id nuevo guardado en ninguna parte: la cadena
   * `empleado → asignación activa → proyecto → contrato → siroc` ya está
   * completa en la base, y guardar el eslabón final la desincronizaría en cuanto
   * alguien refrende el aviso o cierre una fase. Mismo criterio que D-71, que
   * resolvió la trazabilidad de la asignación sin guardar nada.
   *
   * Cuál de los contratos del proyecto manda lo decide
   * `pickCurrentSirocContract`: el que cubre hoy y, si ninguno, el último que
   * estuvo activo. Un proyecto sin contratos con SIROC no aparece.
   *
   * El alcance es el de siempre: un proyecto de una empresa que quien pregunta
   * no ve **no sale en la lista**, sin avisar de su existencia.
   *
   * @returns {Promise<object[]>} vacío si no está asignado a ninguna obra
   */
  async #obrasDe(empleadoId, contexto = {}) {
    const asignaciones = await Assignment.find({ empleadoId, activo: true })
    if (asignaciones.length === 0) return []

    const proyectos = await Project.find({
      _id: { $in: asignaciones.map((a) => a.proyectoId) }
    }).select('nombre empresaId')

    const visibles = new Map(
      proyectos
        .filter((p) =>
          empresaEsVisible({ empresasVisibles: contexto.empresasVisibles }, p.empresaId)
        )
        .map((p) => [p._id.toString(), p])
    )
    if (visibles.size === 0) return []

    const contratos = await Contract.find({ proyectoId: { $in: [...visibles.keys()] } })

    const porProyecto = new Map()
    /*
     * El documento de Mongoose se guarda al lado del `toJSON` porque la clave de
     * almacenamiento del archivo del SIROC no viaja en la forma pública —ni
     * debe—, y sin ella no hay nada que firmar (D-80).
     */
    const originales = new Map()
    for (const contrato of contratos) {
      const clave = contrato.proyectoId.toString()
      if (!porProyecto.has(clave)) porProyecto.set(clave, [])
      porProyecto.get(clave).push(contrato.toJSON())
      originales.set(contrato._id.toString(), contrato)
    }

    const filas = []
    for (const asignacion of asignaciones) {
      const clave = asignacion.proyectoId.toString()
      const proyecto = visibles.get(clave)
      if (!proyecto) continue

      const elegido = pickCurrentSirocContract(porProyecto.get(clave) ?? [])
      if (!elegido) continue

      const { contrato, vigente } = elegido
      filas.push({
        asignacionId: asignacion._id.toString(),
        proyecto: { _id: proyecto._id.toString(), nombre: proyecto.nombre },
        contrato: {
          _id: contrato._id,
          numero: contrato.numero,
          nombre: contrato.nombre,
          fase: contrato.fase,
          fechaInicio: contrato.fechaInicio,
          fechaFin: contrato.fechaFin,
          estado: contrato.estado,
          // Con el contrato escaneado, si lo tiene (D-81): quien ve bajo qué
          // obra trabaja alguien puede abrir el documento que la respalda.
          archivo: await storage.firmarAdjunto(
            originales.get(contrato._id)?.archivo,
            storage.nombreDeContrato(contrato)
          )
        },
        // Con el aviso escaneado y el acuse de cada renovación (D-80): quien
        // ve el SIROC de la obra ve también su papel, sin ir al proyecto.
        siroc: await storage.firmarSiroc(
          contrato.siroc,
          originales.get(contrato._id)?.siroc
        ),
        /*
         * `false` = la obra ya pasó y esto es el último aviso que la cubrió. Se
         * dice explícito para que el front no tenga que compararlo con hoy: la
         * misma razón por la que `seguimientoSiroc` trae su `mensaje` hecho.
         */
        vigente,
        seguimientoSiroc: deriveSirocTracking(contrato)
      })
    }

    // Primero lo que cubre hoy; entre iguales, por nombre de obra.
    return filas.sort((a, b) => {
      if (a.vigente !== b.vigente) return a.vigente ? -1 : 1
      return a.proyecto.nombre.localeCompare(b.proyecto.nombre)
    })
  }
}

module.exports = new RecordService()
