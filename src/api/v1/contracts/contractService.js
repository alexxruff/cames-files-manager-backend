const mongoose = require('mongoose')
const Contract = require('./contractModel')
const Project = require('../projects/projectModel')
const storage = require('../../../services/storageService')
const { AppError } = require('../../../middlewares/errorHandler')
const { empresaEsVisible } = require('../../../middlewares/scopeMiddleware')
const { deriveSirocTracking } = require('../../../utils/domain')
const { detectarTipo, mensajeTipoNoPermitido } = require('../../../utils/fileTypes')
const { today, isAfter, isBefore } = require('../../../utils/dates')

/**
 * Contratos de un proyecto y su SIROC (backend-spec §6.7, plan §C4, D-70).
 *
 * El alcance **no se comprueba sobre el contrato**, sino sobre el proyecto al
 * que pertenece: es el proyecto el que tiene empresa, y la empresa la que decide
 * quién lo ve. Un contrato de un proyecto fuera de alcance responde 404, no 403.
 *
 * Todo contrato sale de aquí con su `seguimientoSiroc` (D-76): cuántas
 * actualizaciones pide, cuántas lleva y si la siguiente urge. **Se deriva en cada
 * lectura** —regla #6— y por eso no hay nada que marcar ni que apagar: el día que
 * se captura la renovación, el aviso desaparece solo.
 */
class ContractService {
  /** GET /proyectos/:id/contratos */
  async listByProject(proyectoId, { incluirInactivos = false } = {}, contexto = {}) {
    const proyecto = await this.#buscarProyectoVisible(proyectoId, contexto)

    const filtro = { proyectoId: proyecto._id }
    if (!incluirInactivos) filtro.activo = true

    const contratos = await Contract.find(filtro).sort({ numero: 1 })
    return { contratos: await Promise.all(contratos.map((c) => this.#serializar(c))) }
  }

  /** POST /proyectos/:id/contratos */
  async create(proyectoId, datos, contexto = {}) {
    const proyecto = await this.#buscarProyectoVisible(proyectoId, contexto)

    if (proyecto.estado === 'finalizado') {
      throw new AppError(400, 'No se pueden agregar contratos a un proyecto finalizado')
    }

    /*
     * El id se genera aquí y no lo pone Mongoose al escribir, porque la clave del
     * archivo en R2 cuelga de él y el papel se sube ANTES que la base (D-79). Es
     * el mismo id en los reintentos: lo que choca es el número, no el documento.
     */
    const id = new mongoose.Types.ObjectId()
    const archivo = datos.archivo
      ? await this.#subirAdjunto({ _id: id }, datos.archivo, 'contrato', contexto)
      : null

    /*
     * El número es una secuencia y la asigna el servidor. Se reintenta porque dos
     * altas simultáneas calcularían el mismo siguiente y una chocaría contra el
     * índice único: reintentar recalcula sobre el estado ya escrito.
     */
    for (let intento = 0; intento < 3; intento++) {
      try {
        const contrato = await Contract.create({
          _id: id,
          proyectoId: proyecto._id,
          numero: await this.#siguienteNumero(proyecto._id),
          nombre: datos.nombre || null,
          fase: datos.fase || null,
          fechaInicio: datos.fechaInicio,
          fechaFin: datos.fechaFin,
          archivo
        })
        return { contrato: await this.#serializar(contrato) }
      } catch (error) {
        const chocaElNumero = error.code === 11000 && !this.#esChoqueDeSiroc(error)
        if (!chocaElNumero || intento === 2) {
          // Lo recién subido se limpia: si la base no lo guardó, nadie lo alcanza.
          if (archivo) await storage.borrar(archivo.claveAlmacenamiento)
          throw error
        }
      }
    }
  }

  /**
   * PATCH /contratos/:id — nombre, fase, fechas y el contrato escaneado. El
   * SIROC y el estado, no.
   *
   * Acepta `multipart` con **sólo** el archivo y ningún campo: así se adjunta el
   * papel a un contrato ya capturado, que es el caso normal —las fechas se
   * teclean el día que se firma y el escaneo llega después— y evita una ruta
   * aparte para lo mismo (D-81).
   */
  async update(id, datos, contexto = {}) {
    const { contrato } = await this.#buscarVisible(id, contexto)

    // `|| null`: mandar cadena vacía es cómo se borra la etiqueta (regla 5).
    if (datos.nombre !== undefined) contrato.nombre = datos.nombre || null
    if (datos.fase !== undefined) contrato.fase = datos.fase || null
    if (datos.fechaInicio !== undefined) contrato.fechaInicio = datos.fechaInicio
    if (datos.fechaFin !== undefined) contrato.fechaFin = datos.fechaFin

    /*
     * El papel se reemplaza, no se versiona (D-79), y sólo si viene uno nuevo:
     * corregir la fase no puede costar el escaneo. El anterior se borra al
     * final, cuando la base ya no lo referencia.
     */
    const anterior = contrato.archivo?.claveAlmacenamiento ?? null
    const nuevo = datos.archivo
      ? await this.#subirAdjunto(contrato, datos.archivo, 'contrato', contexto)
      : null
    if (nuevo) contrato.archivo = nuevo

    try {
      await contrato.save()
    } catch (error) {
      if (nuevo) await storage.borrar(nuevo.claveAlmacenamiento)
      throw error
    }

    if (nuevo && anterior && anterior !== nuevo.claveAlmacenamiento) {
      await storage.borrar(anterior)
    }

    return { contrato: await this.#serializar(contrato) }
  }

  /**
   * PUT /contratos/:id/siroc — registrarlo o corregirlo.
   *
   * `PUT` y no `PATCH` porque reemplaza el SIROC entero: mandar sólo la fecha y
   * dejar el número anterior sería exactamente la mezcla que produce avisos de
   * obra a medias.
   *
   * Del aviso se capturan **dos datos y ya**: su número y el día en que se
   * registró (D-76). No hay fecha final que teclear —la ventana de dos meses la
   * calcula `seguimientoSiroc`—, y si el cuerpo trae una, se ignora.
   */
  async setSiroc(id, datos, contexto = {}) {
    const { contrato } = await this.#buscarVisible(id, contexto)

    const numero = String(datos.numero).trim().toUpperCase()

    /*
     * Se consulta antes de escribir para poder decir DÓNDE está el choque —el
     * proyecto y el contrato que ya lo tienen—, que es lo que necesita quien
     * captura. El índice único sigue siendo la garantía real: esta consulta sólo
     * mejora el mensaje, y la carrera la sigue atrapando el `catch`.
     */
    const choque = await this.#buscarChoqueDeSiroc(numero, contrato._id)
    if (choque) throw choque

    /*
     * Las renovaciones sobreviven a corregir el aviso (D-76): son del MISMO
     * SIROC —el número no cambia al actualizarlo— y arrastran la ventana
     * vigente. Con su acuse, que también es de ellas (D-80). Quien quiera
     * empezar de cero tiene `DELETE /siroc`, que se lleva el aviso entero.
     */
    const actualizaciones = (contrato.siroc?.actualizaciones ?? []).map((a) => ({
      fecha: a.fecha,
      nota: a.nota ?? null,
      archivo: this.#planoAdjunto(a.archivo)
    }))

    const primera = actualizaciones[0]?.fecha
    if (primera && isBefore(primera, datos.fechaRegistro)) {
      throw new AppError(
        400,
        `Ese SIROC ya tiene una actualización del ${primera}: la fecha de registro no puede ser posterior. Quita el SIROC si necesitas capturarlo de nuevo.`
      )
    }

    /*
     * Corregir el aviso **no tira su archivo** (D-80): el número mal tecleado no
     * invalida el papel escaneado. Sólo lo reemplaza mandar uno nuevo, y el
     * anterior se borra hasta que la base ya no lo referencia.
     */
    const anterior = contrato.siroc?.archivo?.claveAlmacenamiento ?? null
    const archivo = datos.archivo
      ? await this.#subirAdjunto(contrato, datos.archivo, 'aviso', contexto)
      : this.#planoAdjunto(contrato.siroc?.archivo)
    const claveNueva = datos.archivo ? archivo.claveAlmacenamiento : null

    contrato.siroc = {
      numero,
      fechaRegistro: datos.fechaRegistro,
      actualizaciones,
      archivo
    }

    try {
      await contrato.save()
    } catch (error) {
      // Lo recién subido se limpia: si la base no lo guardó, nadie lo alcanza.
      if (claveNueva) await storage.borrar(claveNueva)

      if (this.#esChoqueDeSiroc(error)) {
        throw (
          (await this.#buscarChoqueDeSiroc(numero, contrato._id)) ||
          AppError.conflict(`El SIROC ${numero} ya está registrado en otro contrato`, {
            code: 'SIROC_DUPLICADO'
          })
        )
      }
      throw error
    }

    if (claveNueva && anterior && anterior !== claveNueva) await storage.borrar(anterior)

    return { contrato: await this.#serializar(contrato) }
  }

  /**
   * DELETE /contratos/:id/siroc — quitarlo.
   *
   * Existe porque el número es único global: un SIROC capturado en el contrato
   * equivocado deja ese número bloqueado para siempre, y corregirlo en el
   * contrato correcto sería imposible. Quitar el SIROC **también libera** el
   * registro de obra del proyecto, que estaba bloqueado por él (G3).
   */
  async quitarSiroc(id, contexto = {}) {
    const { contrato } = await this.#buscarVisible(id, contexto)

    if (!contrato.siroc) throw new AppError(400, 'Ese contrato no tiene SIROC registrado')

    // Se va el aviso, se van sus papeles: el del registro y el acuse de cada
    // renovación. Nada los referenciaría después (D-80).
    const claves = this.#clavesDelSiroc(contrato.siroc)

    contrato.siroc = null
    await contrato.save()

    for (const clave of claves) await storage.borrar(clave)

    return { contrato: await this.#serializar(contrato) }
  }

  /**
   * POST /contratos/:id/siroc/actualizaciones — registrar una renovación.
   *
   * No crea un SIROC nuevo: el número es el mismo y lo que corre es la ventana
   * de dos meses, que a partir de aquí se cuenta desde esta fecha (D-76).
   */
  async registrarActualizacion(id, datos, contexto = {}) {
    const { contrato } = await this.#buscarVisible(id, contexto)

    if (!contrato.siroc) throw new AppError(400, 'Ese contrato no tiene SIROC registrado')

    if (contrato.estado === 'finalizado' || !contrato.activo) {
      throw new AppError(
        400,
        'El contrato ya no está en curso: su SIROC no necesita actualizarse'
      )
    }

    // Sin fecha se asume hoy, que es el caso normal: se captura al volver del IMSS.
    const hoy = today()
    const fecha = datos.fecha ?? hoy

    if (isAfter(fecha, hoy)) {
      throw new AppError(400, 'La actualización del SIROC no puede tener fecha futura')
    }

    const previas = contrato.siroc.actualizaciones ?? []
    const anterior = previas[previas.length - 1]?.fecha ?? contrato.siroc.fechaRegistro
    if (isBefore(fecha, anterior)) {
      throw new AppError(
        400,
        previas.length === 0
          ? `La actualización no puede ser anterior al registro del SIROC (${anterior})`
          : `Ya hay una actualización del ${anterior}: la nueva no puede ser anterior`
      )
    }

    // El acuse de ESTA renovación, si vino (D-80). Es opcional: se puede
    // capturar la fecha al volver del IMSS y escanear el papel más tarde.
    const archivo = datos.archivo
      ? await this.#subirAdjunto(contrato, datos.archivo, 'actualizacion', contexto)
      : null

    contrato.siroc.actualizaciones.push({ fecha, nota: datos.nota || null, archivo })
    contrato.markModified('siroc.actualizaciones')

    try {
      await contrato.save()
    } catch (error) {
      if (archivo) await storage.borrar(archivo.claveAlmacenamiento)
      throw error
    }

    return { contrato: await this.#serializar(contrato) }
  }

  /**
   * DELETE /contratos/:id/siroc/actualizaciones/ultima — deshacer la última.
   *
   * Sólo la última, y por la misma razón que existe `quitarSiroc`: una fecha mal
   * tecleada corre la ventana de dos meses y el contrato empieza a callar avisos
   * que debería dar. Borrar una de en medio, en cambio, reescribiría la historia.
   */
  async quitarUltimaActualizacion(id, contexto = {}) {
    const { contrato } = await this.#buscarVisible(id, contexto)

    if (!contrato.siroc?.actualizaciones?.length) {
      throw new AppError(400, 'Ese SIROC no tiene actualizaciones registradas')
    }

    const quitada = contrato.siroc.actualizaciones.pop()
    contrato.markModified('siroc.actualizaciones')
    await contrato.save()

    // Su acuse se va con ella: era de esa renovación, no del aviso.
    if (quitada?.archivo?.claveAlmacenamiento) {
      await storage.borrar(quitada.archivo.claveAlmacenamiento)
    }

    return { contrato: await this.#serializar(contrato) }
  }

  /** POST /contratos/:id/finalizar */
  async finalizar(id, contexto = {}) {
    const { contrato } = await this.#buscarVisible(id, contexto)

    if (contrato.estado === 'finalizado') {
      throw new AppError(400, 'Ese contrato ya está finalizado')
    }

    contrato.estado = 'finalizado'
    await contrato.save()
    return { contrato: await this.#serializar(contrato) }
  }

  /** POST /contratos/:id/reabrir */
  async reabrir(id, contexto = {}) {
    const { contrato, proyecto } = await this.#buscarVisible(id, contexto)

    if (contrato.estado === 'en_curso') {
      throw new AppError(400, 'Ese contrato ya está en curso')
    }
    if (proyecto.estado === 'finalizado') {
      throw new AppError(
        400,
        'El proyecto está finalizado. Reábrelo antes de reabrir sus contratos.'
      )
    }

    contrato.estado = 'en_curso'
    await contrato.save()
    return { contrato: await this.#serializar(contrato) }
  }

  /** PATCH /contratos/:id/estado — la baja, distinta de finalizar. */
  async setEstado(id, { activo }, contexto = {}) {
    const { contrato } = await this.#buscarVisible(id, contexto)

    contrato.activo = activo
    await contrato.save()
    return { contrato: await this.#serializar(contrato) }
  }

  // ─── El papel del contrato (D-81) ──────────────────────────────────────────

  /**
   * GET /contratos/:id/archivo — un enlace fresco al contrato escaneado.
   *
   * Igual que el del aviso: la URL que ya viaja dentro de cada contrato caduca a
   * los 10 minutos, y una pantalla de proyecto lleva abierta más que eso.
   */
  async urlDeArchivoContrato(id, contexto = {}) {
    const { contrato } = await this.#buscarVisible(id, contexto)

    if (!contrato.archivo) throw AppError.notFound('Ese contrato no tiene archivo')

    return {
      archivo: await storage.firmarAdjunto(
        contrato.archivo,
        storage.nombreDeContrato(contrato),
        { descargar: contexto.descargar === true ? true : null }
      )
    }
  }

  // ─── El papel del aviso (D-80) ─────────────────────────────────────────────

  /**
   * GET /contratos/:id/siroc/archivo — un enlace fresco al aviso escaneado.
   *
   * Existe además de la URL que ya viaja en cada contrato porque esa caduca a
   * los 10 minutos: sin esto, quien deja la pantalla abierta un rato tendría que
   * recargar el proyecto entero para volver a abrir el mismo papel.
   */
  async urlDeArchivoSiroc(id, contexto = {}) {
    const { contrato } = await this.#buscarVisible(id, contexto)

    if (!contrato.siroc) throw AppError.notFound('Ese contrato no tiene SIROC registrado')
    if (!contrato.siroc.archivo) throw AppError.notFound('Ese SIROC no tiene archivo')

    return {
      archivo: await storage.firmarAdjunto(
        contrato.siroc.archivo,
        contrato.siroc.numero,
        {
          descargar: contexto.descargar === true ? true : null
        }
      )
    }
  }

  /**
   * GET /contratos/:id/siroc/actualizaciones/:indice/archivo — el acuse de una
   * renovación concreta.
   *
   * Se direcciona por **posición** porque las renovaciones no tienen `_id`
   * (D-76). Es estable: el arreglo sólo crece y sólo se puede quitar la última.
   */
  async urlDeArchivoActualizacion(id, indice, contexto = {}) {
    const { contrato } = await this.#buscarVisible(id, contexto)

    if (!contrato.siroc) throw AppError.notFound('Ese contrato no tiene SIROC registrado')

    const actualizacion = (contrato.siroc.actualizaciones ?? [])[indice]
    if (!actualizacion) throw AppError.notFound('Esa actualización del SIROC no existe')
    if (!actualizacion.archivo) {
      throw AppError.notFound('Esa actualización del SIROC no tiene archivo')
    }

    return {
      archivo: await storage.firmarAdjunto(
        actualizacion.archivo,
        storage.nombreDeActualizacion(contrato.siroc.numero, actualizacion.fecha),
        { descargar: contexto.descargar === true ? true : null }
      )
    }
  }

  /**
   * PUT /contratos/:id/siroc/actualizaciones/:indice/archivo — ponerle el acuse
   * a una renovación **ya capturada**, o reemplazar el que tenga.
   *
   * Existe porque el acuse sellado casi siempre llega **después** de capturar el
   * refrendo, y sin esta ruta la única salida era deshacer la actualización para
   * volver a capturarla con el papel — lo que **mueve la ventana de dos meses** y
   * con ella todos los avisos de vencimiento (D-76). Seis veces al año por obra.
   *
   * Toca **sólo el archivo**: ni la fecha, ni la nota, ni el orden, ni la cuenta
   * de refrendos, ni la vigencia. Y sirve para cualquiera de ellas, no sólo la
   * última: las de en medio no se podían tocar de ninguna manera.
   */
  async reemplazarArchivoActualizacion(id, indice, archivo, contexto = {}) {
    const { contrato } = await this.#buscarVisible(id, contexto)

    if (!contrato.siroc) throw new AppError(400, 'Ese contrato no tiene SIROC registrado')

    const actualizacion = (contrato.siroc.actualizaciones ?? [])[indice]
    if (!actualizacion) throw AppError.notFound('Esa actualización del SIROC no existe')

    /*
     * A propósito NO se exige que el contrato siga en curso, al revés que
     * capturar el refrendo: el acuse que llega tarde es justamente el caso que
     * esta ruta viene a resolver, y una obra puede haber cerrado mientras tanto.
     */
    const anterior = actualizacion.archivo?.claveAlmacenamiento ?? null
    const nuevo = await this.#subirAdjunto(contrato, archivo, 'actualizacion', contexto)

    actualizacion.archivo = nuevo
    contrato.markModified('siroc.actualizaciones')

    try {
      await contrato.save()
    } catch (error) {
      await storage.borrar(nuevo.claveAlmacenamiento)
      throw error
    }

    // El anterior, hasta que la base ya no lo referencia. No se versiona (D-79).
    if (anterior && anterior !== nuevo.claveAlmacenamiento) await storage.borrar(anterior)

    return { contrato: await this.#serializar(contrato) }
  }

  // ─── Lo que consulta el proyecto para sus candados (G3) ────────────────────

  /** Cuántos contratos VIVOS cuelgan del proyecto. */
  async contarPorProyecto(proyectoId) {
    return Contract.countDocuments({ proyectoId, activo: true })
  }

  /** Si alguno de ellos ya tiene SIROC. */
  async algunoConSiroc(proyectoId) {
    const conSiroc = await Contract.countDocuments({
      proyectoId,
      activo: true,
      'siroc.numero': { $type: 'string' }
    })
    return conSiroc > 0
  }

  // ─── Interno ───────────────────────────────────────────────────────────────

  /**
   * El contrato con su `seguimientoSiroc` al lado. Derivado en cada lectura, no
   * guardado (regla #6): el mismo contrato responde distinto mañana.
   */
  async #serializar(contrato) {
    const json = contrato.toJSON()
    return {
      ...json,
      // El SIROC sale con la URL firmada de su aviso y la de cada acuse (D-80).
      siroc: await storage.firmarSiroc(json.siroc, contrato.siroc),
      // Y el contrato, con la del papel firmado (D-81).
      archivo: await storage.firmarAdjunto(
        contrato.archivo,
        storage.nombreDeContrato(json)
      ),
      seguimientoSiroc: deriveSirocTracking(json)
    }
  }

  /**
   * Sube el adjunto y devuelve el subdocumento listo para guardar.
   *
   * Al almacenamiento primero y a la base después, como en el expediente y en el
   * registro de obra: si la base falla, quien llama borra el objeto recién
   * subido en vez de dejarlo huérfano.
   *
   * @param {'aviso'|'actualizacion'|'contrato'} clase qué papel es, para la ruta
   *   en R2
   */
  async #subirAdjunto(contrato, archivo, clase, contexto = {}) {
    const tipoReal = detectarTipo(archivo.buffer, archivo.nombreOriginal)
    if (!tipoReal) throw new AppError(415, mensajeTipoNoPermitido(archivo.buffer))

    /*
     * Lo del SIROC cuelga de `siroc/{contratoId}/` y el contrato escaneado de
     * `contratos/{contratoId}/`: son papeles distintos —uno es del IMSS y el
     * otro del cliente— y separarlos hace legible el bucket.
     */
    const esDelContrato = clase === 'contrato'
    const clave = storage.construirClaveAdjunto({
      carpeta: esDelContrato ? 'contratos' : 'siroc',
      ids: [contrato._id, clase],
      extension: tipoReal.extension
    })

    await storage.subir({ buffer: archivo.buffer, clave, contentType: tipoReal.mime })

    return {
      nombre:
        archivo.nombreOriginal ||
        `${esDelContrato ? 'contrato' : 'siroc'}.${tipoReal.extension}`,
      mime: tipoReal.mime,
      tamanoBytes: archivo.buffer.length,
      subidoPor: contexto.user?.nombre || 'Sistema',
      subidoPorId: contexto.user?._id ?? null,
      subidoEn: new Date(),
      claveAlmacenamiento: clave
    }
  }

  /**
   * El adjunto como objeto plano, con su clave.
   *
   * `contrato.siroc = { ... }` reemplaza el subdocumento entero, así que lo que
   * se conserva hay que volvérselo a dar: pasarle el subdocumento de Mongoose
   * tal cual funciona por accidente y deja de funcionar en cuanto cambia el
   * casteo. `toObject` cuando lo es, el objeto cuando ya es plano.
   */
  #planoAdjunto(archivo) {
    if (!archivo) return null
    return typeof archivo.toObject === 'function' ? archivo.toObject() : archivo
  }

  /** Las claves de todo lo que cuelga de un SIROC: el aviso y cada acuse. */
  #clavesDelSiroc(siroc) {
    const claves = [siroc?.archivo?.claveAlmacenamiento]
    for (const a of siroc?.actualizaciones ?? [])
      claves.push(a?.archivo?.claveAlmacenamiento)
    return claves.filter(Boolean)
  }

  async #siguienteNumero(proyectoId) {
    // Incluye los dados de baja: reusar su número chocaría contra el índice.
    const ultimo = await Contract.findOne({ proyectoId })
      .sort({ numero: -1 })
      .select('numero')
    return (ultimo?.numero ?? 0) + 1
  }

  #esChoqueDeSiroc(error) {
    if (error.code !== 11000) return false
    const campos = Object.keys(error.keyPattern || error.keyValue || {})
    return campos.includes('siroc.numero')
  }

  /** El 409 con el contrato y el proyecto que ya lo usan, o `null` si no hay. */
  async #buscarChoqueDeSiroc(numero, exceptoId) {
    const otro = await Contract.findOne({
      'siroc.numero': numero,
      _id: { $ne: exceptoId }
    }).populate({ path: 'proyectoId', select: 'nombre' })

    if (!otro) return null

    const nombreProyecto = otro.proyectoId?.nombre ?? 'otro proyecto'
    return AppError.conflict(
      `El SIROC ${numero} ya está registrado en el contrato ${otro.numero} de ${nombreProyecto}`,
      {
        code: 'SIROC_DUPLICADO',
        data: {
          contratoId: otro._id.toString(),
          contratoNumero: otro.numero,
          proyectoId: otro.proyectoId?._id?.toString() ?? null,
          proyectoNombre: otro.proyectoId?.nombre ?? null
        }
      }
    )
  }

  async #buscarVisible(id, contexto) {
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError(400, 'El contrato indicado no es válido')
    }
    const contrato = await Contract.findById(id)
    if (!contrato) throw AppError.notFound('El contrato no existe')

    const proyecto = await this.#buscarProyectoVisible(contrato.proyectoId, contexto, {
      mensaje: 'El contrato no existe'
    })
    return { contrato, proyecto }
  }

  async #buscarProyectoVisible(proyectoId, contexto, { mensaje } = {}) {
    if (!mongoose.isValidObjectId(proyectoId)) {
      throw new AppError(400, 'El proyecto indicado no es válido')
    }
    const proyecto = await Project.findById(proyectoId)
    if (!proyecto) throw AppError.notFound(mensaje || 'El proyecto no existe')

    if (
      !empresaEsVisible(
        { empresasVisibles: contexto.empresasVisibles },
        proyecto.empresaId
      )
    ) {
      throw AppError.notFound(mensaje || 'El proyecto no existe')
    }
    return proyecto
  }
}

module.exports = new ContractService()
