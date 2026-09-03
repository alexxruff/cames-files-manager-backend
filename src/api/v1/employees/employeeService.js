const mongoose = require('mongoose')
const Employee = require('./employeeModel')
const Affiliation = require('../affiliations/affiliationModel')
const categoryService = require('../categories/categoryService')
const areaService = require('../areas/areaService')
const machineAssignmentService = require('../machineAssignments/machineAssignmentService')
const { AppError } = require('../../../middlewares/errorHandler')
const { normalize, escapeRegex } = require('../../../utils/text')
const { today } = require('../../../utils/dates')
const { computeProgress } = require('../../../utils/domain/progress')
const {
  areasVisibles,
  empresaEsVisible
} = require('../../../middlewares/scopeMiddleware')
const {
  CAPABILITIES,
  canManageEmployeeType,
  isLimitedToOwnArea,
  isPlatformAdmin
} = require('../../../utils/permissions')

/**
 * Consultas sobre el catálogo de empleados (backend-spec §6.2).
 *
 * Con empleados globales, «los empleados que puedo ver» ya no es un campo: se
 * resuelve cruzando `adscripciones` con las empresas visibles del usuario
 * (modelo-datos §8.1 y §9.1). Por eso es una agregación y no un `find`.
 *
 * La forma de cada renglón es la definitiva del contrato. `asignaciones` y
 * `avanceExpediente` vienen vacíos hasta que existan esos módulos: se prefiere
 * una forma estable con campos vacíos que cambiarla después y romper al front.
 */
const POR_PAGINA_DEFECTO = 25
const POR_PAGINA_MAXIMO = 100

/**
 * Campos de la PERSONA que `PATCH /empleados/:id` puede tocar.
 *
 * Fuera quedan a propósito: `acceso` (tiene su sub-recurso), `activo` /
 * `motivoBaja` / `fechaBaja` (van por `/estado`) y todo lo laboral —empresa,
 * contrato, áreas—, que vive en la adscripción y no en la persona.
 */
const CAMPOS_EDITABLES = Object.freeze([
  'nombre',
  'numeroEmpleado',
  'curp',
  'rfc',
  'nss',
  'fechaNacimiento',
  'email',
  'telefono',
  'categoriaId'
])

class EmployeeService {
  /**
   * @param {object} filtros
   * @param {object} contexto `{ empresasVisibles, areasPorEmpresa, user }`
   */
  async list(filtros = {}, contexto = {}) {
    const {
      busqueda,
      empresaId,
      area,
      categoriaId,
      soloConAcceso = false,
      activo = 'true',
      orden = 'nombre_asc'
    } = filtros

    const pagina = Math.max(1, Number(filtros.pagina) || 1)
    /*
     * `filtros.limitePorPagina` es un tope interno, NO parte del contrato HTTP:
     * `employeeController.list` arma `filtros` campo por campo desde `req.query`
     * y no lo incluye, así que nadie puede pedirlo por la ruta pública. Existe
     * para `recordService.list` (`GET /expedientes`, D-45): necesita traer a
     * TODOS los que cumplen los demás filtros —sin cortar en 100— porque
     * `estatus` es derivado y se filtra después, en memoria.
     */
    const porPagina = Math.min(
      filtros.limitePorPagina || POR_PAGINA_MAXIMO,
      Math.max(1, Number(filtros.porPagina) || POR_PAGINA_DEFECTO)
    )

    // Un área inexistente en el filtro es un 400 con mensaje, no una lista
    // vacía sin explicación (D-58). Las dadas de baja SÍ se pueden filtrar.
    if (area) await areaService.assertExiste(area, 'area')

    const { empresasVisibles = null } = contexto

    // ─── 1. Filtro sobre la persona ─────────────────────────────────────────
    const match = {}
    if (filtros.id) {
      if (!mongoose.isValidObjectId(filtros.id)) {
        throw new AppError(400, 'El empleado indicado no es válido')
      }
      match._id = new mongoose.Types.ObjectId(filtros.id)
    }
    /*
     * `activo` es de la PERSONA (baja del sistema, D-51), tres estados
     * excluyentes: `'true'` (default) sólo activos, `'false'` sólo bajas,
     * `'todos'` sin filtro — nunca mezclados salvo que se pida explícitamente.
     */
    if (activo === 'true') match.activo = true
    else if (activo === 'false') match.activo = false
    if (categoriaId) match.categoriaId = new mongoose.Types.ObjectId(categoriaId)
    if (soloConAcceso) match.acceso = { $ne: null }

    /*
     * Nombre O número de trabajador (D-51). Los dos son campos de la PERSONA
     * desde D-54, así que se resuelven en el primer `$match` —antes del
     * `$lookup`, con índice— en vez de después de cruzar las adscripciones.
     */
    if (busqueda) {
      const patron = new RegExp(escapeRegex(normalize(busqueda)), 'i')
      match.$or = [{ nombreNormalizado: patron }, { numeroEmpleado: patron }]
    }

    // ─── 2. Adscripciones, ya recortadas al alcance ─────────────────────────
    const filtroEmpresas = []
    /*
     * Sólo cuentan las adscripciones ACTIVAS cuando se ven los empleados
     * activos: el listado por defecto es del personal actual, y una
     * adscripción cerrada se conserva para auditoría pero no da visibilidad.
     * Con `activo=false` o `activo=todos` NO se restringe aquí: alguien dado de
     * baja del sistema puede conservar una adscripción que nunca se cerró, y
     * exigirla activa lo escondería justo del filtro pensado para encontrarlo.
     */
    if (activo === 'true') filtroEmpresas.push({ activo: true })
    if (empresasVisibles !== null) {
      filtroEmpresas.push({
        empresaId: { $in: empresasVisibles.map((id) => new mongoose.Types.ObjectId(id)) }
      })
    }
    if (empresaId) {
      // Acota dentro de lo visible; el middleware ya verificó que sea visible.
      filtroEmpresas.push({ empresaId: new mongoose.Types.ObjectId(empresaId) })
    }
    if (area) filtroEmpresas.push({ areas: area })

    const pipeline = [
      { $match: match },
      {
        $lookup: {
          from: 'affiliations',
          let: { empleado: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$empleadoId', '$$empleado'] },
                ...(filtroEmpresas.length > 0 ? { $and: filtroEmpresas } : {})
              }
            },
            {
              $lookup: {
                from: 'companies',
                localField: 'empresaId',
                foreignField: '_id',
                as: 'empresa'
              }
            },
            { $unwind: { path: '$empresa', preserveNullAndEmptyArrays: true } },
            {
              $project: {
                _id: 1,
                empresaId: 1,
                empresaNombre: '$empresa.nombre',
                areas: 1,
                dirigeAreas: 1,
                departamento: 1,
                condiciones: 1,
                tipoContrato: 1,
                fechaIngreso: 1,
                fechaTerminoContrato: 1,
                datosPendientes: 1,
                activo: 1,
                motivoBaja: 1,
                fechaBaja: 1
              }
            }
          ],
          as: 'adscripciones'
        }
      }
    ]

    /*
     * Sin alcance global, sólo se ve a quien tiene al menos una adscripción
     * visible. Este $match va DESPUÉS del $lookup a propósito: es lo que hace
     * imposible ver a alguien de otra empresa.
     *
     * TODO: cuando existan `asignaciones`, sumar a los asignados a un proyecto de
     * una empresa visible (modelo-datos §8.1).
     */
    if (empresasVisibles !== null || empresaId || area) {
      pipeline.push({ $match: { 'adscripciones.0': { $exists: true } } })
    }

    // Jefe de área: además, que comparta área con él en alguna empresa suya.
    const restriccionAreas = this.#matchDeAreas(contexto)
    if (restriccionAreas) pipeline.push({ $match: restriccionAreas })

    pipeline.push(
      {
        $lookup: {
          from: 'categories',
          localField: 'categoriaId',
          foreignField: '_id',
          as: 'categoria'
        }
      },
      { $unwind: { path: '$categoria', preserveNullAndEmptyArrays: true } },
      ...this.#etapasDeOrden(orden),
      {
        // El orden se calcula sobre el total y DESPUÉS se corta la página.
        $facet: {
          total: [{ $count: 'valor' }],
          pagina: [
            { $skip: (pagina - 1) * porPagina },
            { $limit: porPagina },
            /*
             * El expediente se cruza DENTRO de la página: son 25 renglones, no
             * la colección entera.
             *
             * Se proyectan sólo los tres campos que necesita el avance. Nada de
             * archivos: en una agregación `select: false` no aplica y la clave
             * de almacenamiento se filtraría (D-27, D-41).
             */
            {
              $lookup: {
                from: 'records',
                let: { empleado: '$_id' },
                pipeline: [
                  { $match: { $expr: { $eq: ['$empleadoId', '$$empleado'] } } },
                  {
                    $project: {
                      'documentos.requerido': 1,
                      'documentos.estatus': 1,
                      'documentos.vigenciaHasta': 1
                    }
                  }
                ],
                as: 'expediente'
              }
            },
            { $unwind: { path: '$expediente', preserveNullAndEmptyArrays: true } }
          ]
        }
      }
    )

    const [resultado] = await Employee.aggregate(pipeline)
    const total = resultado?.total?.[0]?.valor || 0

    return {
      total,
      pagina,
      porPagina,
      empleados: (resultado?.pagina || []).map((doc) => this.#formatearRenglon(doc))
    }
  }

  /**
   * Un empleado por id, **dentro del alcance de quien pregunta**.
   * 404 si no existe o no es visible: un 403 confirmaría que existe.
   */
  async getById(id, contexto = {}) {
    const { empleados } = await this.list({ id, activo: 'todos' }, contexto)
    if (empleados.length === 0) throw AppError.notFound('El empleado no existe')
    return empleados[0]
  }

  /**
   * Alta de una persona **y su adscripción, en una sola transacción**.
   *
   * POR QUÉ EN TRANSACCIÓN: sin la adscripción, el empleado no pertenece a
   * ninguna empresa y por lo tanto **no es visible para nadie** — ni para quien
   * lo acaba de crear, porque el alcance se deriva de las adscripciones. El alta
   * en dos pasos deja basura invisible si el segundo falla, y obliga a la
   * interfaz a hacer rollback a mano. O se crean las dos cosas, o ninguna.
   *
   * QUIÉN PUEDE QUÉ (matriz corregida con Urbacames):
   *
   * | Quien pide | Tipo | Adscripción |
   * | --- | --- | --- |
   * | admin de plataforma | cualquiera | opcional (llena el catálogo compartido) |
   * | `rh_admin` | cualquiera | obligatoria, sólo sus empresas |
   * | `rh_consulta` | sólo `mano_de_obra` | obligatoria, sólo sus empresas |
   * | `jefe_area` | sólo `mano_de_obra` | obligatoria, sus empresas y **sus áreas** |
   */
  async create(datos, contexto = {}) {
    const { user } = contexto
    const acceso = user?.acceso

    /*
     * 1. El puesto, que es de donde sale el TIPO de la persona (D-59).
     *
     * Va primero porque el permiso depende del tipo: quién puede dar de alta a
     * quién se decide por `administrativo` / `mano_de_obra`, y eso ya lo dice la
     * categoría. Antes se capturaban los dos y había que comprobar que
     * coincidieran; ahora sólo hay una fuente.
     */
    const categoria = await categoryService.usable(datos.categoriaId)
    const tipo = categoria.tipo

    // 2. ¿Puede crear a alguien de este tipo?
    if (!canManageEmployeeType(acceso, tipo)) {
      throw AppError.forbidden(
        'Sólo un administrador de RH puede dar de alta personal administrativo'
      )
    }

    // 3. ¿Puede omitir la adscripción?
    //
    // DESVIACIÓN DELIBERADA de la propuesta del front, que la hacía opcional
    // también para `rh_admin`: quien crea sin adscribir produce una persona que
    // él mismo no puede ver ni editar. Sólo el administrador de plataforma —que
    // ve todo— puede dejarla para después. Ver D-33.
    const adscripcion = datos.adscripcion || null
    if (!adscripcion && !isPlatformAdmin(acceso)) {
      throw AppError.validation(
        'Indica la empresa a la que se adscribe: sin ella, la persona no pertenece a ninguna y nadie podría verla',
        [{ msg: 'La empresa es requerida', path: 'adscripcion.empresaId' }]
      )
    }

    if (adscripcion) await this.#validarAdscripcion(adscripcion, tipo, contexto)

    // 4. El número de trabajador es único en todo el grupo (D-54).
    await this.#assertNumeroLibre(datos.numeroEmpleado, null, contexto)

    // 5. Duplicados: es el riesgo real de un catálogo compartido con tres
    //    niveles capturando y CURP opcional.
    await this.#assertNoEsDuplicado(datos, contexto)

    // 6. Alta atómica.
    const sesion = await mongoose.startSession()
    let creado
    try {
      await sesion.withTransaction(async () => {
        ;[creado] = await Employee.create(
          [
            {
              nombre: datos.nombre,
              numeroEmpleado: datos.numeroEmpleado,
              curp: datos.curp || null,
              rfc: datos.rfc || null,
              nss: datos.nss || null,
              fechaNacimiento: datos.fechaNacimiento || null,
              email: datos.email || null,
              telefono: datos.telefono || null,
              categoriaId: datos.categoriaId,
              tipo
            }
          ],
          { session: sesion }
        )

        if (adscripcion) {
          await Affiliation.create(
            [
              {
                empresaId: adscripcion.empresaId,
                empleadoId: creado._id,
                areas: adscripcion.areas || [],
                tipoContrato: adscripcion.tipoContrato,
                fechaIngreso: adscripcion.fechaIngreso,
                fechaTerminoContrato: adscripcion.fechaTerminoContrato || null
              }
            ],
            { session: sesion }
          )
        }

        /*
         * Y su expediente, en la misma transacción (backend-spec §6.2). El
         * checklist sale de la unión de las plantillas de sus adscripciones, así
         * que se crea DESPUÉS de la adscripción para que ya la vea.
         */
        /*
         * `require` aquí y no arriba: `recordService` requiere a su vez a este
         * módulo (necesita `getById` para el alcance), y con los dos `require` en
         * el encabezado uno de los dos captura un objeto vacío según el orden de
         * carga. Pedirlo en el momento de usarlo rompe el ciclo.
         */
        const recordService = require('../records/recordService')
        await recordService.asegurarParaEmpleado(creado._id, { session: sesion })
      })
    } finally {
      await sesion.endSession()
    }

    // Se devuelve el renglón completo, igual que `GET /empleados`, para que la
    // interfaz lo inserte sin una segunda petición. Que esto no falle es además
    // la prueba de que la persona quedó visible para quien la creó.
    return this.getById(creado._id, contexto)
  }

  /**
   * Edita los datos de la PERSONA (backend-spec §6.2).
   *
   * Aquí no se toca nada que tenga su propio recurso:
   * - el acceso a la plataforma → `PATCH /empleados/:id/acceso`
   * - la baja del sistema → `PATCH /empleados/:id/estado`
   * - la relación laboral (empresa, contrato, áreas) → adscripciones
   *
   * Cambiar el `tipo` exige el mismo permiso que crear a alguien de ese tipo: si
   * no, un `jefe_area` podría dar de alta a un peón y luego "ascenderlo" a
   * administrativo, que es justo lo que la matriz le prohíbe.
   */
  async update(id, datos, contexto = {}) {
    // 404 si no existe o no es visible para quien pregunta.
    await this.getById(id, contexto)
    const empleado = await Employee.findById(id)
    const acceso = contexto.user?.acceso

    /*
     * Quien puede dar de alta a alguien de un tipo puede también editarlo. Se
     * mira el tipo ACTUAL de la persona: un `rh_consulta` corrige a un peón, no
     * a un administrativo.
     */
    if (!canManageEmployeeType(acceso, empleado.tipo)) {
      throw AppError.forbidden(
        'Sólo un administrador de RH puede editar personal administrativo'
      )
    }

    /*
     * El tipo ya no se manda: **cambiar de puesto es lo que cambia el tipo**
     * (D-59). Mover a alguien de «Peón» a «Auxiliar contable» lo convierte en
     * administrativo, y por eso exige el mismo permiso que crear uno.
     */
    let tipoFinal = empleado.tipo
    if (datos.categoriaId) {
      const categoria = await categoryService.usable(datos.categoriaId)
      tipoFinal = categoria.tipo
    }
    const cambiaTipo = tipoFinal !== empleado.tipo

    /*
     * Si mandaron `tipo`, tiene que ser el que sale del puesto. Mandar el actual
     * es lo que hace un formulario que devuelve el objeto completo y se ignora;
     * mandar OTRO es intentar cambiarlo sin cambiar el puesto, y eso sí se
     * rechaza diciendo por dónde va (D-59).
     */
    if (datos.tipo && datos.tipo !== tipoFinal) {
      throw AppError.validation(
        `El tipo se deriva del puesto: para dejarlo en "${datos.tipo}" manda la categoriaId que corresponda`,
        [{ msg: 'El tipo se deriva del puesto', path: 'categoriaId' }]
      )
    }

    if (cambiaTipo && !canManageEmployeeType(acceso, tipoFinal)) {
      throw AppError.forbidden(
        'Sólo un administrador de RH puede convertir a alguien en personal administrativo'
      )
    }

    // Pasar a administrativo exige que sus adscripciones tengan área: un
    // administrativo sin área no lo ve ningún jefe y rompe la invariante del
    // modelo (§5b.1).
    if (cambiaTipo && tipoFinal === 'administrativo') {
      const sinArea = await Affiliation.countDocuments({
        empleadoId: empleado._id,
        activo: true,
        $or: [{ areas: { $size: 0 } }, { areas: { $exists: false } }]
      })
      if (sinArea > 0) {
        throw new AppError(
          400,
          'Antes de convertirlo en administrativo, asígnale al menos un área en cada empresa donde esté adscrito'
        )
      }
    }

    // El número de trabajador es único en el grupo: corregirlo no puede pisar
    // el de otra persona (D-54).
    if (datos.numeroEmpleado && datos.numeroEmpleado !== empleado.numeroEmpleado) {
      await this.#assertNumeroLibre(datos.numeroEmpleado, empleado._id, contexto)
    }

    // La CURP es la identidad: si se completa o se corrige, no puede chocar.
    if (datos.curp) {
      const curp = String(datos.curp).toUpperCase()
      if (curp !== empleado.curp) {
        const otro = await Employee.findOne({ curp, _id: { $ne: empleado._id } })
        if (otro) {
          throw AppError.conflict(
            `Ya existe otra persona registrada con esa CURP: ${otro.nombre}`,
            {
              code: 'CURP_DUPLICADA',
              errors: [{ msg: 'Esa CURP ya está registrada', path: 'curp' }],
              data: { candidatos: await this.#resumirCandidatos([otro], contexto) }
            }
          )
        }
      }
    }

    /*
     * El nombre NO se revisa contra duplicados al editar, a diferencia del alta:
     * corregir "Roberto Aguilar" a "Roberto Aguilar Sosa" es lo normal, y
     * bloquearlo porque ya existe alguien así impediría justo la corrección que
     * se está haciendo. La identidad la cuida la CURP.
     */
    for (const campo of CAMPOS_EDITABLES) {
      if (datos[campo] === undefined) continue
      // Un opcional vacío es "sin valor", no cadena vacía.
      empleado[campo] = datos[campo] === '' ? null : datos[campo]
    }

    // Derivado, no capturado: va con la categoría (D-59).
    if (cambiaTipo) empleado.tipo = tipoFinal

    await empleado.save()
    return this.getById(empleado._id, contexto)
  }

  /**
   * Baja o reactivación **del sistema** (backend-spec §6.2).
   *
   * No borra: el expediente y el histórico se conservan. Distinta de la baja de
   * una adscripción, que es sólo dejar una empresa.
   *
   * **Sus máquinas pierden al trabajador, no la obra** (D-87): al que se va se
   * le quitan de las manos —no puede seguir apareciendo con una excavadora— pero
   * se quedan en la obra donde estaban, «sin trabajador», hasta que alguien las
   * reasigne o las devuelva. Va en la misma transacción que la baja.
   */
  async setEstado(id, { activo, motivo, fecha }, contexto = {}) {
    await this.getById(id, contexto)
    const empleado = await Employee.findById(id)
    const actor = contexto.user

    if (activo === false) {
      if (actor && empleado._id.equals(actor._id)) {
        throw new AppError(400, 'No puedes darte de baja a ti mismo')
      }
      if (empleado.acceso?.alcanceGlobal && empleado.acceso.activo) {
        await this.#assertQuedaOtroAdminGlobal(empleado._id)
      }
    }

    let maquinasLiberadas = []

    const sesion = await mongoose.startSession()
    try {
      await sesion.withTransaction(async () => {
        // Cada intento parte de cero: `withTransaction` puede reintentar.
        maquinasLiberadas = []

        if (activo === false) {
          empleado.activo = false
          empleado.motivoBaja = motivo
          empleado.fechaBaja = fecha || today()
          /*
           * Si tenía acceso, se desactiva en la misma operación. De todos modos
           * no podría entrar —`protect` comprueba que la persona esté activa—,
           * pero dejarlo marcado como activo haría que la pantalla de accesos
           * mintiera. La credencial NO se borra: reactivar y volver a darle
           * acceso no debería obligarlo a que le repongan la contraseña.
           */
          if (empleado.acceso) empleado.acceso.activo = false

          maquinasLiberadas = await machineAssignmentService.liberarDelTrabajador(
            {
              empleadoId: empleado._id,
              fecha: empleado.fechaBaja,
              motivo: 'baja_de_trabajador'
            },
            sesion
          )
        } else {
          empleado.activo = true
          // `pre('validate')` limpia motivoBaja y fechaBaja.
          // El acceso NO se reactiva solo: volver a dárselo es una decisión
          // aparte, con su propia ruta.
        }
        await empleado.save({ session: sesion })
      })
    } finally {
      await sesion.endSession()
    }

    /*
     * `renglon` aparte de `maquinasLiberadas`: el renglón del empleado tiene la
     * misma forma en el listado y aquí, y meterle un campo que sólo existe en la
     * baja lo haría derivar. Las máquinas son de esta operación, no de la
     * persona.
     */
    return {
      renglon: await this.getById(empleado._id, contexto),
      maquinasLiberadas
    }
  }

  /** El sistema nunca puede quedarse sin administrador de plataforma. */
  async #assertQuedaOtroAdminGlobal(idExcluido) {
    const otros = await Employee.countDocuments({
      _id: { $ne: idExcluido },
      activo: true,
      'acceso.alcanceGlobal': true,
      'acceso.activo': true
    })
    if (otros === 0) {
      throw new AppError(
        400,
        'Debe quedar al menos un administrador de plataforma activo. Asigna otro antes de continuar.'
      )
    }
  }

  /** Empresa dentro del alcance, áreas dentro de las suyas, y coherencia de tipo. */
  async #validarAdscripcion(adscripcion, tipoEmpleado, contexto) {
    const { user, empresasVisibles, areasPorEmpresa = {} } = contexto

    if (!empresaEsVisible({ empresasVisibles }, adscripcion.empresaId)) {
      // Fuera de alcance: 404, no 403.
      throw AppError.notFound('La empresa no existe')
    }

    const areas = adscripcion.areas || []

    // Que existan y estén activas en el catálogo (D-58).
    await areaService.assertUsables(areas, 'adscripcion.areas')

    // Un administrativo necesita al menos un área (modelo-datos §5b.1).
    if (tipoEmpleado === 'administrativo' && areas.length === 0) {
      throw AppError.validation('Un empleado administrativo necesita al menos un área', [
        { msg: 'Indica al menos un área', path: 'adscripcion.areas' }
      ])
    }

    if (!isLimitedToOwnArea(user?.acceso, CAPABILITIES.VIEW_EMPLOYEES)) return

    // Jefe de área: sólo puede dar de alta en SUS áreas de esa empresa, y tiene
    // que indicar al menos una — si no, crearía a alguien que no puede ver.
    const suyas = areasPorEmpresa[String(adscripcion.empresaId)] || []
    if (areas.length === 0) {
      throw AppError.validation(
        'Indica al menos un área: sin ella no podrías ver a la persona que estás dando de alta',
        [{ msg: 'Indica al menos un área', path: 'adscripcion.areas' }]
      )
    }
    const fuera = areas.filter((area) => !suyas.includes(area))
    if (fuera.length > 0) {
      throw AppError.forbidden(
        suyas.length > 0
          ? `Sólo puedes dar de alta en tus áreas: ${suyas.join(', ')}`
          : 'No tienes áreas asignadas en esa empresa'
      )
    }
  }

  /**
   * Duplicados (política acordada con el front):
   *
   * - **Con CURP**: si ya existe, `409` con el id de quien la tiene. No hay forma
   *   de forzarlo: la CURP es la identidad de la persona.
   * - **Sin CURP**: se busca por nombre normalizado (+ fecha de nacimiento si
   *   viene) y se devuelve `409` con los candidatos, en vez de crear a ciegas.
   *   Si de verdad es otra persona, la petición lo dice con
   *   `confirmarDuplicado: true`.
   */
  /**
   * El número de trabajador es único en TODO el grupo (D-54).
   *
   * Se revisa antes de la transacción, igual que la CURP, para responder `409`
   * con un mensaje legible en vez de dejar salir un `E11000` crudo.
   *
   * El nombre de quien ya lo tiene se dice **sólo si esa persona es visible**
   * para quien pregunta: el número es único en el grupo, así que el choque puede
   * venir de una empresa que este usuario no ve, y decir "lo tiene Fulano" sería
   * filtrar la nómina de otra empresa. Sin visibilidad se dice que está ocupado
   * y ya — suficiente para corregirlo, y es RH quien lo resuelve.
   *
   * @param {string} numero
   * @param {object|null} excluirId el propio empleado, al editar
   */
  async #assertNumeroLibre(numero, excluirId, contexto = {}) {
    if (!numero) return

    const filtro = { numeroEmpleado: numero }
    if (excluirId) filtro._id = { $ne: excluirId }
    const otro = await Employee.findOne(filtro)
    if (!otro) return

    const { empresasVisibles = null } = contexto
    const visible =
      empresasVisibles === null ||
      (await Affiliation.exists({
        empleadoId: otro._id,
        empresaId: {
          $in: empresasVisibles.map((id) => new mongoose.Types.ObjectId(id))
        }
      }))

    throw AppError.conflict(
      visible
        ? `El número de trabajador ${numero} ya lo tiene ${otro.nombre}`
        : `El número de trabajador ${numero} ya está en uso en el grupo`,
      {
        code: 'NUMERO_EMPLEADO_DUPLICADO',
        errors: [
          { msg: 'Ese número de trabajador ya está en uso', path: 'numeroEmpleado' }
        ]
      }
    )
  }

  async #assertNoEsDuplicado(datos, contexto) {
    if (datos.curp) {
      const existente = await Employee.findOne({ curp: datos.curp.toUpperCase() })
      if (existente) {
        throw AppError.conflict(
          `Ya existe una persona registrada con esa CURP: ${existente.nombre}`,
          {
            code: 'CURP_DUPLICADA',
            errors: [{ msg: 'Esa CURP ya está registrada', path: 'curp' }],
            data: { candidatos: await this.#resumirCandidatos([existente], contexto) }
          }
        )
      }
      return
    }

    if (datos.confirmarDuplicado) return

    const filtro = { nombreNormalizado: normalize(datos.nombre) }
    if (datos.fechaNacimiento) filtro.fechaNacimiento = datos.fechaNacimiento

    const candidatos = await Employee.find(filtro).limit(5)
    if (candidatos.length > 0) {
      throw AppError.conflict(
        'Puede que esta persona ya esté registrada. Revísala y, si es otra, vuelve a enviar con confirmarDuplicado.',
        {
          code: 'POSIBLE_DUPLICADO',
          data: { candidatos: await this.#resumirCandidatos(candidatos, contexto) }
        }
      )
    }
  }

  /**
   * Resumen mínimo de un posible duplicado.
   *
   * NO se listan las empresas de esa persona: el catálogo es compartido, pero
   * dónde más trabaja alguien no es información de otra empresa. Sí se dice
   * `yaEstaEnTuEmpresa`, que es lo único que la interfaz necesita para elegir
   * entre «ya la tienes» y «existe en el grupo, ¿la adscribo?».
   */
  async #resumirCandidatos(empleados, { empresasVisibles = null } = {}) {
    const ids = empleados.map((e) => e._id)
    const suyas = await Affiliation.find({
      empleadoId: { $in: ids },
      activo: true,
      ...(empresasVisibles !== null
        ? {
            empresaId: {
              $in: empresasVisibles.map((id) => new mongoose.Types.ObjectId(id))
            }
          }
        : {})
    }).select('empleadoId')

    const enMisEmpresas = new Set(suyas.map((a) => a.empleadoId.toString()))

    return empleados.map((e) => ({
      _id: e._id.toString(),
      nombre: e.nombre,
      curp: e.curp ?? null,
      fechaNacimiento: e.fechaNacimiento ?? null,
      tipo: e.tipo,
      activo: e.activo,
      yaEstaEnTuEmpresa: enMisEmpresas.has(e._id.toString())
    }))
  }

  /**
   * Etapas de `$sort` según el orden pedido.
   *
   * Desde D-54 `numeroEmpleado` es de la persona y hay UN valor por renglón, así
   * que ordenar por él es un `$sort` directo — la tabla general se ordena por
   * número sin acotar a una empresa (D-53), sin colapsar nada.
   *
   * El único cuidado es el campo auxiliar `sinNumero`: quien no lo tiene va al
   * final en los DOS sentidos. Sin él, `numero_asc` los pondría arriba —los
   * nulos son lo más chico en Mongo— y la tabla abriría con renglones vacíos.
   */
  #etapasDeOrden(orden) {
    if (orden !== 'numero_asc' && orden !== 'numero_desc') {
      return [{ $sort: { nombreNormalizado: orden === 'nombre_desc' ? -1 : 1, _id: 1 } }]
    }

    return [
      {
        $addFields: { sinNumero: { $cond: [{ $eq: ['$numeroEmpleado', null] }, 1, 0] } }
      },
      {
        $sort: {
          sinNumero: 1,
          numeroEmpleado: orden === 'numero_desc' ? -1 : 1,
          _id: 1
        }
      }
    ]
  }

  /** Restricción por áreas del jefe de área, empresa por empresa. */
  #matchDeAreas(contexto) {
    const { user, empresasVisibles, areasPorEmpresa = {} } = contexto
    if (!user) return null
    const areas = areasVisibles({ user, areasPorEmpresa, empresasVisibles }, null)
    // `areasVisibles` devuelve null cuando el nivel no está limitado por área.
    if (areas === null) return null

    const clausulas = Object.entries(areasPorEmpresa)
      .filter(([, suyas]) => (suyas || []).length > 0)
      .map(([empresa, suyas]) => ({
        adscripciones: {
          $elemMatch: {
            empresaId: new mongoose.Types.ObjectId(empresa),
            areas: { $in: suyas }
          }
        }
      }))

    // Un jefe de área sin áreas asignadas no ve nada, en vez de verlo todo.
    return clausulas.length > 0 ? { $or: clausulas } : { _id: null }
  }

  /** Forma definitiva del renglón del contrato (backend-spec §6.2). */
  #formatearRenglon(doc) {
    const empleado = Employee.hydrate(doc).toJSON()
    return {
      empleado,
      categoriaNombre: doc.categoria?.nombre ?? null,
      adscripciones: (doc.adscripciones || []).map((a) => ({
        _id: a._id.toString(),
        empresaId: a.empresaId.toString(),
        empresaNombre: a.empresaNombre ?? null,
        areas: a.areas || [],
        dirigeAreas: a.dirigeAreas || [],
        /*
         * El resto de lo que trae la adscripción, para que el renglón diga lo
         * mismo que `/empresas/:id/adscripciones` (D-62). `departamento` lo
         * llena el archivo de nómina en todas las filas y no se veía por ningún
         * lado; `datosPendientes` es cómo RH sabe qué le falta capturar.
         *
         * `nomina` NO: sigue sin exponerse hasta que se decida quién puede ver
         * salario y cuenta bancaria (D-46).
         */
        departamento: a.departamento ?? null,
        // Condiciones laborales del archivo; no confundir con `nomina`, que
        // sigue sin exponerse (D-63).
        condiciones: a.condiciones || {},
        tipoContrato: a.tipoContrato,
        fechaIngreso: a.fechaIngreso,
        fechaTerminoContrato: a.fechaTerminoContrato ?? null,
        datosPendientes: a.datosPendientes || [],
        activo: a.activo,
        motivoBaja: a.motivoBaja ?? null,
        fechaBaja: a.fechaBaja ?? null
      })),
      // Pendiente hasta que el listado cruce proyectos; la forma es la definitiva.
      asignaciones: [],
      /*
       * El porcentaje se deriva al leer, como en el expediente mismo (D-04): un
       * documento vencido baja el avance sin que nadie escriba en la base.
       * `null` sólo si no tiene expediente, que no debería pasar desde D-41.
       */
      avanceExpediente: doc.expediente
        ? computeProgress(doc.expediente.documentos || []).porcentaje
        : null,
      expedienteId: doc.expediente ? doc.expediente._id.toString() : null
    }
  }
}

module.exports = new EmployeeService()
module.exports.CAMPOS_EDITABLES = CAMPOS_EDITABLES
