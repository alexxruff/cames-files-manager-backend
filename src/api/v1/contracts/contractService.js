const mongoose = require('mongoose')
const Contract = require('./contractModel')
const Project = require('../projects/projectModel')
const storage = require('../../../services/storageService')
const { AppError } = require('../../../middlewares/errorHandler')
const { empresaEsVisible } = require('../../../middlewares/scopeMiddleware')
const { deriveSirocTracking, deriveContractTracking } = require('../../../utils/domain')
const intake = require('../../../services/attachmentIntake')
const { today, isAfter, isBefore, addMonths, addDays } = require('../../../utils/dates')

/** Días después del inicio del contrato en que aún se puede fechar el SIROC (D-85). */
const DIAS_PARA_REGISTRAR_SIROC = 7

/**
 * Desde qué día se puede fechar el siguiente refrendo (D-85): un mes y 25 días
 * después del movimiento anterior, con la misma aritmética de fin de mes que la
 * vigencia (1 ene → 26 feb; 31 ene → 28 feb → 25 mar).
 */
const fechaMinimaDeActualizacion = (anterior) => addDays(addMonths(anterior, 1), 25)

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
 *
 * Y con su `seguimientoContrato` (D-84), que es dónde está el contrato en su
 * propia vida y si dejó un cabo suelto. Va aparte del SIROC a propósito: un
 * contrato que pasó su fecha de fin y nadie cerró no debe un trámite ante el
 * IMSS, debe que alguien lo cierre, y decirlo con el aviso del SIROC hacía que se
 * capturaran refrendos que nadie pidió sólo para apagar el rojo.
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

    this.#validarFechasEnProyecto(proyecto, datos)

    /*
     * El id se genera aquí y no lo pone Mongoose al escribir, porque la clave del
     * archivo en R2 cuelga de él y el papel se sube ANTES que la base (D-79). Es
     * el mismo id en los reintentos: lo que choca es el número, no el documento.
     */
    const id = new mongoose.Types.ObjectId()
    const entrada = await intake.resolver(datos, {
      destino: 'contrato',
      referencia: { proyectoId: proyecto._id }
    })
    const archivo = entrada
      ? await this.#guardarAdjunto({ _id: id }, entrada, 'contrato', contexto)
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
          monto: this.#normalizarMonto(datos.monto),
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
   * PUT /contratos/:id/archivo — subir el contrato escaneado, o reemplazarlo.
   *
   * Existe porque **editar un contrato dejó de existir** (D-90) y era el `PATCH`
   * quien recibía el papel (D-81): quien captura casi nunca tiene el escaneo a
   * la mano el día que teclea las fechas, y sin esta ruta la única salida sería
   * eliminar el contrato y volver a capturarlo entero.
   *
   * Toca **sólo el archivo**, y el que toca es el del contrato ORIGINAL: el
   * papel de cada modificación es suyo y se sube por su propia ruta.
   */
  async reemplazarArchivoContrato(id, datos, contexto = {}) {
    const { contrato } = await this.#buscarVisible(id, contexto)

    const anterior = contrato.archivo?.claveAlmacenamiento ?? null
    const entrada = await intake.resolver(datos, {
      destino: 'contrato',
      referencia: { contratoId: contrato._id }
    })
    if (!entrada) {
      throw AppError.validation('Adjunta el contrato escaneado', [
        { msg: 'El archivo es requerido', path: 'archivo' }
      ])
    }

    const nuevo = await this.#guardarAdjunto(contrato, entrada, 'contrato', contexto)
    contrato.archivo = nuevo

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

  // ─── Las modificaciones del contrato (D-90) ────────────────────────────────

  /**
   * POST /contratos/:id/modificaciones — registrar una.
   *
   * **No es editar el contrato**, que ya no se puede: es un hecho nuevo. El
   * cliente aplazó la obra, cambió el precio o se anexaron requerimientos, se
   * firmó un convenio modificatorio, y desde ese día valen otras fechas y otro
   * monto.
   *
   * Lo que hace, en orden: fotografía los términos originales —la primera vez, y
   * sólo la primera—, agrega la modificación con los suyos, y **pisa los campos
   * del contrato con los nuevos**. Por eso el techo del SIROC (D-84), el
   * expediente (D-77) y los candados del proyecto (G3) siguen leyendo
   * `fechaInicio`/`fechaFin` y no se enteran de nada: hay una verdad vigente y su
   * pasado, no dos versiones.
   */
  async registrarModificacion(id, datos, contexto = {}) {
    const { contrato, proyecto } = await this.#buscarVisible(id, contexto)

    /*
     * Un contrato cerrado no se modifica: lo que se pacta de nuevo se pacta
     * sobre algo vivo. Se dice con qué se destraba, porque las dos salidas son
     * distintas —reabrir no es reactivar— y desde fuera no se adivina.
     */
    if (!contrato.activo) {
      throw new AppError(
        400,
        'Ese contrato está dado de baja: reactívalo antes de registrar una modificación'
      )
    }
    if (contrato.estado === 'finalizado') {
      throw new AppError(
        400,
        'Ese contrato ya está finalizado: reábrelo antes de registrar una modificación'
      )
    }

    // Sin fecha se asume hoy. Casi nunca lo es: el convenio se firma y se
    // captura días después, y la que vale es la del papel.
    const hoy = today()
    const fechaAcuerdo = datos.fechaAcuerdo ?? hoy
    if (isAfter(fechaAcuerdo, hoy)) {
      throw new AppError(400, 'La fecha del acuerdo no puede ser futura')
    }

    // Las fechas nuevas caben en el proyecto, igual que las del alta (D-85).
    this.#validarFechasEnProyecto(proyecto, datos)
    if (isBefore(datos.fechaFin, datos.fechaInicio)) {
      throw new AppError(400, 'La fecha de fin no puede ser anterior a la de inicio')
    }

    // El convenio escaneado, si vino. Opcional al capturar, como el acuse del
    // reporte bimestral (D-80): el papel llega después.
    const entrada = await intake.resolver(datos, {
      destino: 'contrato-modificacion',
      referencia: { contratoId: contrato._id }
    })
    const archivo = entrada
      ? await this.#guardarAdjunto(contrato, entrada, 'modificacion', contexto)
      : null

    /*
     * La fotografía del original se toma UNA vez, al modificar por primera vez:
     * después, lo anterior a cada modificación es la modificación de antes.
     */
    if ((contrato.modificaciones ?? []).length === 0) {
      contrato.original = {
        fechaInicio: contrato.fechaInicio,
        fechaFin: contrato.fechaFin,
        monto: contrato.monto ?? null
      }
    }

    const monto = this.#normalizarMonto(datos.monto)
    contrato.modificaciones.push({
      fechaAcuerdo,
      motivo: datos.motivo || null,
      fechaInicio: datos.fechaInicio,
      fechaFin: datos.fechaFin,
      monto,
      archivo
    })
    contrato.markModified('modificaciones')

    // Desde aquí, lo que vale es lo nuevo.
    contrato.fechaInicio = datos.fechaInicio
    contrato.fechaFin = datos.fechaFin
    contrato.monto = monto

    try {
      await contrato.save()
    } catch (error) {
      if (archivo) await storage.borrar(archivo.claveAlmacenamiento)
      throw error
    }

    return { contrato: await this.#serializar(contrato) }
  }

  /**
   * DELETE /contratos/:id/modificaciones/ultima — deshacer la última.
   *
   * Sólo la última, como en los reportes bimestrales: el contrato vuelve a los
   * términos de la modificación anterior o, si era la única, a los del alta —y
   * entonces se queda otra vez sin historia—. Borrar una de en medio reescribiría
   * el pasado y dejaría al contrato con términos que nadie pactó.
   */
  async quitarUltimaModificacion(id, contexto = {}) {
    const { contrato } = await this.#buscarVisible(id, contexto)

    if (!contrato.modificaciones?.length) {
      throw new AppError(400, 'Ese contrato no tiene modificaciones registradas')
    }

    const quitada = contrato.modificaciones.pop()
    const previa = contrato.modificaciones[contrato.modificaciones.length - 1] ?? null
    const vigentes = previa ?? contrato.original

    if (vigentes) {
      contrato.fechaInicio = vigentes.fechaInicio
      contrato.fechaFin = vigentes.fechaFin
      contrato.monto = vigentes.monto ?? null
    }
    // Sin modificaciones no hay original que guardar: vuelve a no tener historia.
    if (contrato.modificaciones.length === 0) contrato.original = null

    contrato.markModified('modificaciones')
    await contrato.save()

    // Su convenio se va con ella: era de esa modificación, no del contrato.
    if (quitada?.archivo?.claveAlmacenamiento) {
      await storage.borrar(quitada.archivo.claveAlmacenamiento)
    }

    return { contrato: await this.#serializar(contrato) }
  }

  /**
   * GET /contratos/:id/modificaciones/:indice/archivo — el convenio de una.
   *
   * Se direcciona por **posición**, como los reportes bimestrales: las
   * modificaciones no tienen `_id`, el arreglo va en orden y sólo se quita la
   * última.
   */
  async urlDeArchivoModificacion(id, indice, contexto = {}) {
    const { contrato } = await this.#buscarVisible(id, contexto)

    const modificacion = (contrato.modificaciones ?? [])[indice]
    if (!modificacion) throw AppError.notFound('Esa modificación no existe')
    if (!modificacion.archivo) {
      throw AppError.notFound('Esa modificación no tiene convenio adjunto')
    }

    return {
      archivo: await storage.firmarAdjunto(
        modificacion.archivo,
        storage.nombreDeModificacion(contrato, modificacion),
        { descargar: contexto.descargar === true ? true : null }
      )
    }
  }

  /**
   * PUT /contratos/:id/modificaciones/:indice/archivo — adjuntar el convenio a
   * una modificación ya capturada, o reemplazar el que tenga.
   *
   * Igual que el acuse del reporte bimestral (D-80) y por lo mismo: el papel
   * firmado casi siempre llega después, y sin esto la única salida sería deshacer
   * la modificación —que devuelve el contrato a sus términos viejos— para volver
   * a capturarla. Toca **sólo el archivo**: ni las fechas, ni el monto, ni el
   * orden. Y sirve para cualquiera, no sólo la última.
   */
  async reemplazarArchivoModificacion(id, indice, datos, contexto = {}) {
    const { contrato } = await this.#buscarVisible(id, contexto)

    const modificacion = (contrato.modificaciones ?? [])[indice]
    if (!modificacion) throw AppError.notFound('Esa modificación no existe')

    const anterior = modificacion.archivo?.claveAlmacenamiento ?? null
    const entrada = await intake.resolver(datos, {
      destino: 'contrato-modificacion',
      referencia: { contratoId: contrato._id }
    })
    if (!entrada) {
      throw AppError.validation('Adjunta el convenio modificatorio', [
        { msg: 'El archivo es requerido', path: 'archivo' }
      ])
    }

    const nuevo = await this.#guardarAdjunto(contrato, entrada, 'modificacion', contexto)
    modificacion.archivo = nuevo
    contrato.markModified('modificaciones')

    try {
      await contrato.save()
    } catch (error) {
      await storage.borrar(nuevo.claveAlmacenamiento)
      throw error
    }

    if (anterior && anterior !== nuevo.claveAlmacenamiento) await storage.borrar(anterior)

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

    /*
     * El aviso se presenta al arrancar la obra: `fechaRegistro` cae entre el
     * inicio del contrato y siete días después (D-85). Se comprueba **sólo si
     * cambia**: corregir el número de un SIROC viejo reenvía la misma fecha, y lo
     * ya capturado no se toca.
     */
    if (datos.fechaRegistro !== contrato.siroc?.fechaRegistro) {
      const limite = addDays(contrato.fechaInicio, DIAS_PARA_REGISTRAR_SIROC)
      if (
        isBefore(datos.fechaRegistro, contrato.fechaInicio) ||
        isAfter(datos.fechaRegistro, limite)
      ) {
        throw new AppError(
          400,
          `La fecha de registro del SIROC debe estar entre el ${contrato.fechaInicio} y el ${limite}: el aviso se presenta al arrancar el contrato`
        )
      }
    }

    const primera = actualizaciones[0]?.fecha
    if (primera && isBefore(primera, datos.fechaRegistro)) {
      throw new AppError(
        400,
        `Ese SIROC ya tiene un reporte bimestral del ${primera}: la fecha de registro no puede ser posterior. Quita el SIROC si necesitas capturarlo de nuevo.`
      )
    }

    /*
     * Corregir el aviso **no tira su archivo** (D-80): el número mal tecleado no
     * invalida el papel escaneado. Sólo lo reemplaza mandar uno nuevo, y el
     * anterior se borra hasta que la base ya no lo referencia.
     */
    const anterior = contrato.siroc?.archivo?.claveAlmacenamiento ?? null
    const entrada = await intake.resolver(datos, {
      destino: 'siroc-aviso',
      referencia: { contratoId: contrato._id }
    })
    const archivo = entrada
      ? await this.#guardarAdjunto(contrato, entrada, 'aviso', contexto)
      : this.#planoAdjunto(contrato.siroc?.archivo)
    const claveNueva = entrada ? archivo.claveAlmacenamiento : null

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
        'El contrato ya no está en curso: su SIROC no necesita más reportes bimestrales'
      )
    }

    // Sin fecha se asume hoy, que es el caso normal: se captura al volver del IMSS.
    const hoy = today()
    const fecha = datos.fecha ?? hoy

    if (isAfter(fecha, hoy)) {
      throw new AppError(
        400,
        'El reporte bimestral del SIROC no puede tener fecha futura'
      )
    }

    /*
     * La fecha de fin es el techo (D-84): pasada ella el contrato ya no acumula
     * refrendos, y sin este corte se le podía colgar uno cada dos meses para
     * siempre por API, aunque la pantalla dejara de ofrecerlo.
     *
     * Se mira la fecha DE LA ACTUALIZACIÓN y no el día de hoy a propósito:
     * capturar tarde un refrendo que sí se tramitó dentro del contrato es lo
     * normal —el papel llega después— y eso tiene que seguir entrando.
     */
    if (contrato.fechaFin && isAfter(fecha, contrato.fechaFin)) {
      throw new AppError(
        400,
        `El contrato terminó el ${contrato.fechaFin} y su SIROC ya no requiere reportes bimestrales: finaliza el contrato, o corrige su fecha de fin si la obra sigue`
      )
    }

    const previas = contrato.siroc.actualizaciones ?? []
    const anterior = previas[previas.length - 1]?.fecha ?? contrato.siroc.fechaRegistro
    if (isBefore(fecha, anterior)) {
      throw new AppError(
        400,
        previas.length === 0
          ? `El reporte bimestral no puede ser anterior al registro del SIROC (${anterior})`
          : `Ya hay un reporte bimestral del ${anterior}: el nuevo no puede ser anterior`
      )
    }

    /*
     * Un refrendo no se fecha antes de un mes y 25 días del movimiento anterior
     * (D-85): registrar el aviso y su actualización el mismo día corría la
     * ventana sin que el IMSS hubiera pedido nada. Es la aritmética de la
     * vigencia —mismo día del mes siguiente, recortado a fin de mes— más 25
     * días, cinco antes de que venza. Sólo se mira la que entra: las ya
     * capturadas no se tocan.
     */
    const minima = fechaMinimaDeActualizacion(anterior)
    if (isBefore(fecha, minima)) {
      throw new AppError(
        400,
        `El SIROC se ${previas.length === 0 ? 'registró' : 'reportó'} el ${anterior}: el siguiente reporte bimestral no puede fecharse antes del ${minima}`
      )
    }

    // El acuse de ESTA renovación, si vino (D-80). Es opcional: se puede
    // capturar la fecha al volver del IMSS y escanear el papel más tarde.
    const entrada = await intake.resolver(datos, {
      destino: 'siroc-actualizacion',
      referencia: { contratoId: contrato._id }
    })
    const archivo = entrada
      ? await this.#guardarAdjunto(contrato, entrada, 'actualizacion', contexto)
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
      throw new AppError(400, 'Ese SIROC no tiene reportes bimestrales registrados')
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

  /**
   * DELETE /contratos/:id — borrarlo de verdad (D-90).
   *
   * **No es la baja.** `activo: false` es un contrato que existió y se canceló:
   * sigue en la historia del proyecto y se puede reactivar. Esto es para el
   * contrato que **nunca debió existir** —se capturó en el proyecto equivocado, o
   * con el número de otro—, y por eso se lleva todo: el SIROC con sus reportes
   * bimestrales, las modificaciones, y **cada archivo** de los tres.
   *
   * Con eso se liberan las dos cosas que bloqueaban: el **número de SIROC**, que
   * es único en todo el sistema (G4) y sin esto quedaba muerto para siempre, y el
   * **número del contrato** dentro del proyecto, que el siguiente alta reusa.
   *
   * No se puede deshacer, y a propósito no pide nada más que la capacidad de
   * gestionar proyectos: quien captura un contrato es quien corrige su error. El
   * aviso previo es de la pantalla, y para eso la respuesta dice qué se llevó.
   */
  async eliminar(id, contexto = {}) {
    const { contrato } = await this.#buscarVisible(id, contexto)

    const claves = this.#clavesDelContrato(contrato)
    const eliminado = {
      _id: contrato._id.toString(),
      numero: contrato.numero,
      nombre: contrato.nombre ?? null,
      fase: contrato.fase ?? null,
      sirocNumero: contrato.siroc?.numero ?? null,
      reportesBimestrales: contrato.siroc?.actualizaciones?.length ?? 0,
      modificaciones: contrato.modificaciones?.length ?? 0,
      archivos: claves.length
    }

    await contrato.deleteOne()

    // Después de la base, como en `quitarSiroc`: si esto falla queda un objeto
    // huérfano —que nadie alcanza— y no un contrato apuntando a la nada.
    for (const clave of claves) await storage.borrar(clave)

    return { eliminado }
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
    if (!actualizacion)
      throw AppError.notFound('Ese reporte bimestral del SIROC no existe')
    if (!actualizacion.archivo) {
      throw AppError.notFound('Ese reporte bimestral del SIROC no tiene acuse')
    }

    return {
      archivo: await storage.firmarAdjunto(
        actualizacion.archivo,
        storage.nombreDeReporteBimestral(contrato.siroc.numero, actualizacion.fecha),
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
  async reemplazarArchivoActualizacion(id, indice, datos, contexto = {}) {
    const { contrato } = await this.#buscarVisible(id, contexto)

    if (!contrato.siroc) throw new AppError(400, 'Ese contrato no tiene SIROC registrado')

    const actualizacion = (contrato.siroc.actualizaciones ?? [])[indice]
    if (!actualizacion)
      throw AppError.notFound('Ese reporte bimestral del SIROC no existe')

    /*
     * A propósito NO se exige que el contrato siga en curso, al revés que
     * capturar el refrendo: el acuse que llega tarde es justamente el caso que
     * esta ruta viene a resolver, y una obra puede haber cerrado mientras tanto.
     */
    const anterior = actualizacion.archivo?.claveAlmacenamiento ?? null
    const entrada = await intake.resolver(datos, {
      destino: 'siroc-actualizacion',
      referencia: { contratoId: contrato._id }
    })
    if (!entrada) {
      throw AppError.validation('Adjunta el acuse del reporte bimestral', [
        { msg: 'El archivo es requerido', path: 'archivo' }
      ])
    }
    const nuevo = await this.#guardarAdjunto(contrato, entrada, 'actualizacion', contexto)

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

  /**
   * Que el contrato exista y sea visible, sin devolverlo serializado (D-83).
   *
   * Lo usa el permiso de subida directa: antes de firmar nada hay que responder
   * la misma pregunta que respondería la ruta que va a confirmar —incluido el
   * 404 cuando el contrato es de otra empresa—.
   */
  async assertVisible(id, contexto = {}) {
    const { contrato } = await this.#buscarVisible(id, contexto)
    return contrato
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
   * El contrato con sus dos seguimientos al lado. Derivados en cada lectura, no
   * guardados (regla #6): el mismo contrato responde distinto mañana.
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
      // Y su línea del tiempo, con el papel de cada entrada firmado (D-90).
      historia: await storage.firmarHistoria(json.historia, contrato),
      seguimientoSiroc: deriveSirocTracking(json),
      seguimientoContrato: deriveContractTracking(json)
    }
  }

  /**
   * Deja el adjunto en su sitio y devuelve el subdocumento listo para guardar.
   *
   * Recibe la **entrada** de `attachmentIntake`, así que le da igual si el
   * archivo llegó en `multipart` o si el navegador lo subió directo a R2 (D-83):
   * el tipo ya viene comprobado por contenido en los dos casos.
   *
   * Al almacenamiento primero y a la base después, como en el expediente y en el
   * registro de obra: si la base falla, quien llama borra el objeto recién
   * guardado en vez de dejarlo huérfano.
   *
   * @param {'aviso'|'actualizacion'|'contrato'|'modificacion'} clase qué papel
   *   es, para la ruta en R2
   */
  async #guardarAdjunto(contrato, entrada, clase, contexto = {}) {
    /*
     * Lo del SIROC cuelga de `siroc/{contratoId}/` y el contrato escaneado de
     * `contratos/{contratoId}/`: son papeles distintos —uno es del IMSS y el
     * otro del cliente— y separarlos hace legible el bucket.
     */
    // El convenio modificatorio es papel del contrato, no del IMSS: va con él.
    const esDelContrato = clase === 'contrato' || clase === 'modificacion'
    const clave = storage.construirClaveAdjunto({
      carpeta: esDelContrato ? 'contratos' : 'siroc',
      ids: [contrato._id, clase],
      extension: entrada.tipoReal.extension
    })

    await entrada.guardarEn(clave)

    return {
      nombre:
        entrada.nombreOriginal ||
        `${esDelContrato ? clase : 'siroc'}.${entrada.tipoReal.extension}`,
      mime: entrada.tipoReal.mime,
      tamanoBytes: entrada.tamanoBytes,
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

  /**
   * Las claves de TODO lo que cuelga de un contrato: su papel, el del aviso, el
   * acuse de cada reporte bimestral y el convenio de cada modificación. Es lo
   * que hay que borrar del almacenamiento al eliminarlo (D-90).
   */
  #clavesDelContrato(contrato) {
    return [
      contrato.archivo?.claveAlmacenamiento,
      ...this.#clavesDelSiroc(contrato.siroc),
      ...(contrato.modificaciones ?? []).map((m) => m?.archivo?.claveAlmacenamiento)
    ].filter(Boolean)
  }

  /** Las claves de todo lo que cuelga de un SIROC: el aviso y cada acuse. */
  #clavesDelSiroc(siroc) {
    const claves = [siroc?.archivo?.claveAlmacenamiento]
    for (const a of siroc?.actualizaciones ?? [])
      claves.push(a?.archivo?.claveAlmacenamiento)
    return claves.filter(Boolean)
  }

  /**
   * El número más bajo que nadie usa en el proyecto.
   *
   * Los dados de baja **siguen ocupando el suyo**: existen, y reusarlo chocaría
   * contra el índice único. El que sí queda libre es el de un contrato
   * **eliminado** (D-90), y por eso esto es el hueco más bajo y no el último más
   * uno: eliminar y volver a capturar es justo lo que motiva el borrado, y quien
   * lo hace espera recuperar el número, no el siguiente.
   */
  async #siguienteNumero(proyectoId) {
    const usados = await Contract.find({ proyectoId }).select('numero').lean()
    const ocupados = new Set(usados.map((c) => c.numero))

    let numero = 1
    while (ocupados.has(numero)) numero += 1
    return numero
  }

  /**
   * El monto como se guarda: pesos con centavos y ni un decimal más, o `null`.
   *
   * `null` es «no se capturó» —los contratos anteriores a D-90— y no es lo mismo
   * que `0`, que es una cifra que alguien tecleó.
   */
  #normalizarMonto(monto) {
    if (monto === undefined || monto === null || monto === '') return null
    return Math.round(Number(monto) * 100) / 100
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

  /**
   * Las fechas del contrato caen dentro de las del proyecto (D-85): del inicio
   * del proyecto a su fin real o, si no lo tiene, al estimado. Sólo se revisan
   * las que vienen en `datos`, así el `PATCH` de una sola fecha no reprueba la
   * otra si es anterior a la regla.
   */
  #validarFechasEnProyecto(proyecto, datos) {
    const fin = proyecto.fechaFinReal ?? proyecto.fechaFinEstimada
    if (
      datos.fechaInicio !== undefined &&
      isBefore(datos.fechaInicio, proyecto.fechaInicio)
    ) {
      throw new AppError(
        400,
        `La fecha de inicio del contrato no puede ser anterior al inicio del proyecto (${proyecto.fechaInicio})`
      )
    }
    if (datos.fechaFin !== undefined && fin && isAfter(datos.fechaFin, fin)) {
      throw new AppError(
        400,
        `La fecha de fin del contrato no puede ser posterior al fin del proyecto (${fin})`
      )
    }
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
