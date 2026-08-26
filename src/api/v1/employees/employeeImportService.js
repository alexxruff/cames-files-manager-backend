const mongoose = require('mongoose')
const Employee = require('./employeeModel')
const Affiliation = require('../affiliations/affiliationModel')
const Company = require('../companies/companyModel')
const Category = require('../categories/categoryModel')
const affiliationService = require('../affiliations/affiliationService')
const { AppError } = require('../../../middlewares/errorHandler')
const { normalize } = require('../../../utils/text')
const { today } = require('../../../utils/dates')
const { leerHoja } = require('../../../utils/spreadsheet')
const { empresaEsVisible } = require('../../../middlewares/scopeMiddleware')
const {
  COLUMNAS_REQUERIDAS,
  META_EMPRESA,
  META_RFC,
  mapearFila,
  columnasFaltantes,
  areasDesdeDepartamento
} = require('../../../utils/domain/employeeImport')

/**
 * Importación de colaboradores desde el archivo de nómina (D-46).
 *
 * Dos entradas, **el mismo análisis**: `previsualizar` no escribe nada y
 * `importar` aplica. Que compartan `#analizar` es lo que garantiza que lo que se
 * ve antes de aplicar sea exactamente lo que va a pasar.
 *
 * ─── Por qué no hay estado intermedio ────────────────────────────────────────
 * El archivo se manda las dos veces. Con 34 KB no vale la pena una colección de
 * importaciones pendientes que además habría que limpiar, y guardarla sería un
 * segundo lugar del que se pueden filtrar CURP, NSS, salarios y cuentas
 * bancarias de 145 personas. El archivo se procesa en memoria y **no se guarda**:
 * ni a R2 ni a disco.
 *
 * ─── Quién gana cuando el archivo y la base no coinciden ─────────────────────
 * No es una sola regla, son dos, y la diferencia es deliberada:
 *
 * - **La persona (`employees`): el archivo sólo RELLENA lo que está vacío.**
 *   Nunca pisa un dato que ya está capturado. Si RH corrigió un nombre o un
 *   teléfono en la plataforma, volver a subir el export de nómina —que sigue
 *   trayendo el valor viejo— no debe deshacer la corrección.
 * - **La relación laboral (`affiliations`): el archivo MANDA** en número de
 *   empleado, departamento, tipo de contrato, fecha de ingreso, alta/baja y
 *   nómina. Para eso es la fuente: es el sistema de nómina el que sabe cuánto
 *   gana alguien y con qué contrato está.
 *
 * Dos excepciones dentro de la adscripción: `areas`, que sólo se rellena si está
 * vacía —el archivo no trae áreas, se deducen del departamento, y una curada a
 * mano vale más que una deducida—, y `fechaTerminoContrato`, que el archivo no
 * trae y por lo tanto no puede pisar.
 *
 * El **puesto** tampoco se cambia al re-importar: mover el `tipo` de una persona
 * arrastra la validación de áreas y la coherencia con la categoría, así que un
 * cambio de puesto en el archivo se **reporta** en la previsualización y se
 * aplica a mano. Ver D-46.
 */

/** Tope de filas. Muy por encima de las 145 reales; es un freno, no un límite. */
const MAX_FILAS = 5000

/** Tope de renglones de detalle en la respuesta, para no devolver un megabyte. */
const MAX_DETALLE = 500

const MOTIVO_BAJA = 'Baja registrada en el archivo de nómina importado'

/**
 * Campos de la persona que el archivo puede rellenar si están vacíos.
 *
 * `numeroEmpleado` está aquí y NO entre los autoritativos, aunque el archivo de
 * nómina sea su origen (D-54): es la tercera llave de reconocimiento y desde que
 * se puede corregir a mano (`PATCH /empleados/:id`), pisarlo en cada
 * re-importación desharía esa corrección y cambiaría la identidad con la que el
 * importador reconoce a la persona.
 */
const CAMPOS_PERSONA_RELLENABLES = Object.freeze([
  'numeroEmpleado',
  'curp',
  'rfc',
  'nss',
  'fechaNacimiento',
  'email',
  'telefono'
])

/** Campos de la adscripción en los que manda el archivo. */
const CAMPOS_ADSCRIPCION_AUTORITATIVOS = Object.freeze([
  'departamento',
  'tipoContrato',
  'fechaIngreso'
])

class EmployeeImportService {
  /** `POST /empleados/importar/previsualizar` — no escribe nada. */
  async previsualizar(buffer, opciones, contexto = {}) {
    const analisis = await this.#analizar(buffer, opciones, contexto)
    return this.#respuesta(analisis, false)
  }

  /**
   * `POST /empleados/importar` — aplica.
   *
   * Cada persona se crea en **su propia transacción** (persona + adscripción +
   * expediente, igual que `POST /empleados`), no todas en una: así una fila que
   * falle no tumba las otras 144, y el resumen puede decir con precisión qué
   * pasó con cada una.
   */
  async importar(buffer, opciones, contexto = {}) {
    const analisis = await this.#analizar(buffer, opciones, contexto)

    if (analisis.rfcCoincide === false && !opciones.confirmarRfcDistinto) {
      throw AppError.conflict(
        `El archivo es de "${analisis.archivo.empresa || 'otra empresa'}" (RFC ${analisis.archivo.rfc}) y lo estás importando a "${analisis.empresa.nombre}" (RFC ${analisis.empresa.rfc}). Si es correcto, vuelve a enviar con confirmarRfcDistinto.`,
        {
          code: 'RFC_DISTINTO',
          data: this.#respuesta(analisis, false)
        }
      )
    }

    await this.#crearCategoriasFaltantes(analisis)
    await this.#aplicar(analisis, contexto)

    return this.#respuesta(analisis, true)
  }

  // ─── Análisis ──────────────────────────────────────────────────────────────

  /**
   * Lee el archivo, lo compara contra la base y clasifica cada fila. **No
   * escribe nada.**
   */
  async #analizar(buffer, { empresaId }, contexto) {
    const empresa = await this.#empresaDestino(empresaId, contexto)

    const hoja = await leerHoja(buffer, {
      columnasEsperadas: COLUMNAS_REQUERIDAS,
      maxFilas: MAX_FILAS
    })

    const faltantes = columnasFaltantes(hoja.columnas)
    if (faltantes.length > 0) {
      throw AppError.validation(
        `El archivo no tiene estas columnas: ${faltantes.join(', ')}`,
        faltantes.map((c) => ({ msg: `Falta la columna "${c}"`, path: 'archivo' }))
      )
    }

    const filas = hoja.filas.map((fila) => mapearFila(fila))
    this.#marcarDuplicadosDelArchivo(filas)

    const puestos = await this.#resolverPuestos(filas)
    const avisosGenerales = []

    // El tipo de la persona depende del puesto, y el puesto ya resuelto puede
    // traer el tipo del catálogo en vez del deducido: hay que re-derivar las
    // áreas con el tipo definitivo antes de comparar contra la base.
    for (const fila of filas) {
      if (fila.errores.length > 0) continue
      const puesto = puestos.get(normalize(fila.puesto || ''))
      if (!puesto) continue

      /*
       * Una categoría DESACTIVADA es una decisión: «este puesto ya no se usa».
       * Y `categoryService.setEstado` sólo permite desactivar la que nadie tiene,
       * así que no es un descuido. Asignarle 60 personas en silencio desharía esa
       * decisión sin que nadie se enterara: la fila se rechaza y el mensaje dice
       * qué hacer.
       */
      if (puesto.existe && puesto.activa === false) {
        fila.errores.push(
          `El puesto "${puesto.nombre}" está desactivado en el catálogo. Reactívalo antes de importar a quien lo tiene.`
        )
        continue
      }

      fila.categoriaId = puesto.categoriaId
      if (puesto.tipo !== fila.persona.tipo) {
        fila.avisos.push(
          `El puesto "${puesto.nombre}" ya existe en el catálogo como ${puesto.tipo}: se respeta el catálogo`
        )
        fila.persona.tipo = puesto.tipo
        fila.adscripcion.areas = areasDesdeDepartamento(
          fila.departamento,
          puesto.tipo
        ).areas
      }
    }

    await this.#clasificar(filas, empresa)

    const rfcArchivo = hoja.meta[META_RFC]
      ? String(hoja.meta[META_RFC]).toUpperCase()
      : null
    const nombreArchivo = hoja.meta[META_EMPRESA] || null
    const rfcCoincide =
      rfcArchivo && empresa.rfc ? rfcArchivo === empresa.rfc.toUpperCase() : null

    if (rfcCoincide === null) {
      avisosGenerales.push(
        empresa.rfc
          ? 'El archivo no trae el RFC de la empresa en su encabezado: no se pudo verificar que sea de esta empresa'
          : `La empresa "${empresa.nombre}" no tiene RFC capturado: no se pudo verificar que el archivo sea suyo`
      )
    }

    const pendientes = filas.filter(
      (f) => f.errores.length === 0 && f.adscripcion.datosPendientes.length > 0
    ).length
    if (pendientes > 0) {
      avisosGenerales.push(
        `${pendientes} ${pendientes === 1 ? 'persona entra' : 'personas entran'} con contrato temporal SIN fecha de término: el archivo no la trae. Hay que capturarla para que su contrato tenga vigencia.`
      )
    }

    return {
      empresa,
      archivo: {
        hoja: hoja.hoja,
        filaEncabezados: hoja.filaEncabezados,
        empresa: nombreArchivo,
        rfc: rfcArchivo,
        filas: filas.length
      },
      rfcCoincide,
      filas,
      puestos,
      avisosGenerales
    }
  }

  /** Empresa destino: dentro del alcance, existente y activa. 404 si no. */
  async #empresaDestino(empresaId, contexto) {
    if (!mongoose.isValidObjectId(empresaId)) {
      throw new AppError(400, 'La empresa indicada no es válida')
    }
    if (!empresaEsVisible({ empresasVisibles: contexto.empresasVisibles }, empresaId)) {
      // Fuera de alcance: 404, no 403.
      throw AppError.notFound('La empresa no existe')
    }
    const empresa = await Company.findById(empresaId)
    if (!empresa) throw AppError.notFound('La empresa no existe')
    if (!empresa.activo) {
      throw new AppError(
        400,
        'Esa empresa está dada de baja: no se le puede importar personal'
      )
    }
    return empresa
  }

  /**
   * CURP o número de empleado repetidos **dentro del mismo archivo**.
   *
   * Gana la primera aparición y las demás quedan como error. Sin esto, dos filas
   * con la misma CURP se convertirían en un `E11000` a medio importar, con la
   * mitad de las personas creadas y ningún mensaje útil.
   */
  #marcarDuplicadosDelArchivo(filas) {
    const vistas = new Map()
    const numeros = new Map()

    for (const fila of filas) {
      if (fila.errores.length > 0) continue

      const curp = fila.persona.curp
      if (curp) {
        if (vistas.has(curp)) {
          fila.errores.push(
            `La CURP ${curp} ya viene en la fila ${vistas.get(curp)} de este mismo archivo`
          )
          continue
        }
        vistas.set(curp, fila.fila)
      }

      const numero = fila.persona.numeroEmpleado
      if (numero) {
        if (numeros.has(numero)) {
          fila.errores.push(
            `El número de empleado ${numero} ya viene en la fila ${numeros.get(numero)} de este mismo archivo`
          )
          continue
        }
        numeros.set(numero, fila.fila)
      }
    }
  }

  /**
   * Puestos del archivo → categorías del catálogo.
   *
   * **La estandarización que se pidió ya la resuelve el modelo `Category`**: su
   * índice único va sobre `nombreNormalizado`, y `normalize()` quita acentos,
   * mayúsculas y espacios de más. Así `Peon`, `Peón`, `PEON` y `"Residente "`
   * (con el espacio que trae el archivo) colapsan solos a la misma categoría, y
   * la segunda importación reutiliza la que ya existe en vez de duplicarla.
   *
   * Si la categoría ya existe con **otro tipo**, manda el catálogo: es un dato
   * que alguien decidió, contra una deducción por palabras del puesto.
   */
  async #resolverPuestos(filas) {
    const puestos = new Map()

    for (const fila of filas) {
      if (fila.errores.length > 0 || !fila.puesto) continue
      const clave = normalize(fila.puesto)
      const actual = puestos.get(clave)
      if (actual) {
        actual.filas += 1
        continue
      }
      puestos.set(clave, {
        clave,
        nombre: fila.puesto,
        tipo: fila.persona.tipo,
        filas: 1,
        categoriaId: null,
        existe: false
      })
    }

    if (puestos.size === 0) return puestos

    const existentes = await Category.find({
      nombreNormalizado: { $in: [...puestos.keys()] }
    }).select('+nombreNormalizado')

    for (const categoria of existentes) {
      const puesto = puestos.get(categoria.nombreNormalizado)
      if (!puesto) continue
      puesto.categoriaId = categoria._id
      puesto.tipo = categoria.tipo
      puesto.nombre = categoria.nombre
      puesto.existe = true
      puesto.activa = categoria.activo
    }

    return puestos
  }

  /** Crea las categorías que faltan. Idempotente: si otro las creó, las relee. */
  async #crearCategoriasFaltantes(analisis) {
    for (const puesto of analisis.puestos.values()) {
      if (puesto.existe) continue
      try {
        const categoria = await Category.create({
          nombre: puesto.nombre,
          tipo: puesto.tipo
        })
        puesto.categoriaId = categoria._id
        puesto.existe = true
        puesto.creada = true
      } catch (error) {
        if (error.code !== 11000) throw error
        const categoria = await Category.findOne({ nombreNormalizado: puesto.clave })
        puesto.categoriaId = categoria._id
        puesto.tipo = categoria.tipo
        puesto.existe = true
      }
    }

    // Las filas apuntan a la categoría por id; hasta aquí podía ser null.
    for (const fila of analisis.filas) {
      if (fila.errores.length > 0 || !fila.puesto) continue
      const puesto = analisis.puestos.get(normalize(fila.puesto))
      if (puesto) fila.categoriaId = puesto.categoriaId
    }
  }

  /**
   * Decide qué va a pasar con cada fila.
   *
   * **Cómo se reconoce a alguien que ya existe**, en este orden: CURP → RFC →
   * número de trabajador. Los 145 del archivo traen CURP y RFC, así que el
   * tercero es sólo una red para cuando la CURP se capturó mal.
   *
   * Desde D-54 el número es de la persona y único en todo el grupo, así que esa
   * tercera llave ya no se busca "dentro de esta empresa" sino en el catálogo
   * completo: reconoce también a quien se importó primero en otra empresa del
   * grupo, que antes se duplicaba.
   */
  async #clasificar(filas, empresa) {
    const validas = filas.filter((f) => f.errores.length === 0)
    if (validas.length === 0) return

    const curps = [...new Set(validas.map((f) => f.persona.curp).filter(Boolean))]
    const rfcs = [...new Set(validas.map((f) => f.persona.rfc).filter(Boolean))]
    const numeros = [
      ...new Set(validas.map((f) => f.persona.numeroEmpleado).filter(Boolean))
    ]

    const porCurp = new Map()
    const porRfc = new Map()
    const porNumero = new Map()
    const encontrados = await Employee.find({
      $or: [
        { curp: { $in: curps } },
        { rfc: { $in: rfcs } },
        { numeroEmpleado: { $in: numeros } }
      ]
    })
    for (const empleado of encontrados) {
      if (empleado.curp) porCurp.set(empleado.curp, empleado)
      // El RFC no es único en `employees`: gana el primero y se avisa después.
      if (empleado.rfc && !porRfc.has(empleado.rfc)) porRfc.set(empleado.rfc, empleado)
      if (empleado.numeroEmpleado) porNumero.set(empleado.numeroEmpleado, empleado)
    }

    // Adscripciones de ESTA empresa, con la nómina, para poder comparar.
    const adscripciones = await Affiliation.find({ empresaId: empresa._id }).select(
      '+nomina'
    )
    const adscripcionPorEmpleado = new Map(
      adscripciones.map((a) => [a.empleadoId.toString(), a])
    )

    for (const fila of validas) {
      const porCurpFila = fila.persona.curp ? porCurp.get(fila.persona.curp) : null
      const porRfcFila = fila.persona.rfc ? porRfc.get(fila.persona.rfc) : null

      // La CURP y el RFC apuntan a dos personas distintas: no se adivina.
      if (porCurpFila && porRfcFila && !porCurpFila._id.equals(porRfcFila._id)) {
        fila.errores.push(
          `La CURP corresponde a "${porCurpFila.nombre}" y el RFC a "${porRfcFila.nombre}": revisa cuál es la persona correcta`
        )
        continue
      }

      const numero = fila.persona.numeroEmpleado
      const porNumeroFila = numero ? porNumero.get(numero) || null : null

      let empleado = porCurpFila || porRfcFila

      /*
       * El número ya es de otra persona. Sólo puede pasar cuando la CURP o el
       * RFC identificaron a alguien Y ese número lo tiene un tercero: como es
       * único en todo el grupo (D-54), importar la fila reventaría con un
       * `E11000` a medio camino. Se corta antes y se dice quién lo tiene.
       */
      if (empleado && porNumeroFila && !porNumeroFila._id.equals(empleado._id)) {
        fila.errores.push(
          `El número de trabajador ${numero} ya lo tiene "${porNumeroFila.nombre}", que es otra persona: corrígelo en el archivo o en el registro`
        )
        continue
      }

      if (!empleado && porNumeroFila) {
        empleado = porNumeroFila
        fila.avisos.push(
          `Se reconoció por número de trabajador (${numero}), no por CURP: revisa que sea la misma persona`
        )
      }

      if (!empleado) {
        fila.accion = 'crear'
        continue
      }

      fila.empleadoId = empleado._id
      fila.nombreEnBase = empleado.nombre
      fila.cambiosPersona = this.#cambiosDePersona(fila, empleado)

      if (!empleado.activo) {
        fila.avisos.push(
          'Esta persona está dada de baja DEL SISTEMA: la importación no la reactiva, sólo actualiza su adscripción'
        )
      }

      if (fila.categoriaId && !empleado.categoriaId.equals(fila.categoriaId)) {
        fila.avisos.push(
          `El puesto del archivo ("${fila.puesto}") no es el que tiene registrado: el importador NO cambia el puesto, hay que hacerlo desde el empleado`
        )
      }

      const adscripcion = adscripcionPorEmpleado.get(empleado._id.toString())
      if (!adscripcion) {
        fila.accion = 'adscribir'
        continue
      }

      fila.adscripcionId = adscripcion._id
      fila.cambiosAdscripcion = this.#cambiosDeAdscripcion(fila, adscripcion)

      if (fila.adscripcion.activo && !adscripcion.activo) fila.accion = 'reactivar'
      else if (!fila.adscripcion.activo && adscripcion.activo) fila.accion = 'dar_de_baja'
      else if (fila.cambiosPersona.length + fila.cambiosAdscripcion.length > 0) {
        fila.accion = 'actualizar'
      } else fila.accion = 'sin_cambios'
    }
  }

  /** Campos de la persona que están vacíos en la base y el archivo puede llenar. */
  #cambiosDePersona(fila, empleado) {
    const cambios = []
    for (const campo of CAMPOS_PERSONA_RELLENABLES) {
      const nuevo = fila.persona[campo]
      if (nuevo === null || nuevo === undefined) continue
      const actual = empleado[campo]
      if (actual === null || actual === undefined || actual === '') cambios.push(campo)
    }
    return cambios
  }

  /** Campos de la adscripción que el archivo va a cambiar. */
  #cambiosDeAdscripcion(fila, adscripcion) {
    const cambios = []

    for (const campo of CAMPOS_ADSCRIPCION_AUTORITATIVOS) {
      const nuevo = fila.adscripcion[campo]
      if (nuevo === null || nuevo === undefined) continue
      if (String(adscripcion[campo] ?? '') !== String(nuevo)) cambios.push(campo)
    }

    if ((adscripcion.areas || []).length === 0 && fila.adscripcion.areas.length > 0) {
      cambios.push('areas')
    }

    const nomina = adscripcion.nomina || {}
    const cambiaNomina = Object.entries(fila.adscripcion.nomina).some(
      ([campo, valor]) =>
        valor !== null &&
        valor !== undefined &&
        String(nomina[campo] ?? '') !== String(valor)
    )
    if (cambiaNomina) cambios.push('nomina')

    return cambios
  }

  // ─── Aplicación ────────────────────────────────────────────────────────────

  async #aplicar(analisis, contexto) {
    for (const fila of analisis.filas) {
      if (fila.errores.length > 0 || !fila.accion) continue
      try {
        switch (fila.accion) {
          case 'crear':
            await this.#crear(fila, analisis.empresa)
            break
          case 'adscribir':
            await this.#adscribir(fila, analisis.empresa)
            break
          case 'reactivar':
            await this.#reactivar(fila, contexto)
            break
          case 'dar_de_baja':
            await this.#darDeBaja(fila, contexto)
            break
          case 'actualizar':
            await this.#actualizar(fila)
            break
          default:
            break
        }
        fila.aplicada = true
      } catch (error) {
        /*
         * Una fila que falla al aplicar se reporta como error y las demás
         * siguen. Se informa lo que de verdad pasó: `aplicada` queda en falso y
         * el motivo va en la respuesta.
         */
        fila.errores.push(this.#motivoLegible(error))
        fila.accion = null
      }
    }
  }

  /**
   * Persona + adscripción + expediente, en una transacción — igual que
   * `POST /empleados`, y por la misma razón: sin la adscripción la persona no
   * pertenece a ninguna empresa y **no la ve nadie**, ni quien la importó.
   */
  async #crear(fila, empresa) {
    const sesion = await mongoose.startSession()
    try {
      await sesion.withTransaction(async () => {
        const [empleado] = await Employee.create(
          [{ ...fila.persona, categoriaId: fila.categoriaId }],
          { session: sesion }
        )
        fila.empleadoId = empleado._id

        const [adscripcion] = await Affiliation.create(
          [this.#datosAdscripcion(fila, empresa._id)],
          { session: sesion }
        )
        fila.adscripcionId = adscripcion._id

        const recordService = require('../records/recordService')
        await recordService.asegurarParaEmpleado(empleado._id, { session: sesion })
      })
    } finally {
      await sesion.endSession()
    }
  }

  /** Ya existe como persona, pero no en esta empresa: sólo se adscribe. */
  async #adscribir(fila, empresa) {
    const adscripcion = await Affiliation.create(
      this.#datosAdscripcion(fila, empresa._id)
    )
    fila.adscripcionId = adscripcion._id
    await this.#rellenarPersona(fila)
    await this.#resincronizar(fila.empleadoId)
  }

  /** Estaba de baja de esta empresa y el archivo la trae de alta o reingreso. */
  async #reactivar(fila, contexto) {
    await affiliationService.setEstado(fila.adscripcionId, { activo: true }, contexto)
    await this.#actualizar(fila)
  }

  /**
   * El archivo dice `Baja` y en la base está activa.
   *
   * Se delega en `affiliationService.setEstado`, que además cierra sus
   * asignaciones abiertas a proyectos de esa empresa (D-38): seguir "en obra" de
   * una empresa de la que ya no depende la dejaría ahí para siempre en los
   * reportes. Se da de baja **de esta empresa**, no del sistema: sus otras
   * adscripciones y su expediente no se tocan.
   */
  async #darDeBaja(fila, contexto) {
    await this.#actualizarAdscripcion(fila)
    await affiliationService.setEstado(
      fila.adscripcionId,
      { activo: false, motivo: MOTIVO_BAJA },
      contexto
    )
  }

  async #actualizar(fila) {
    await this.#rellenarPersona(fila)
    await this.#actualizarAdscripcion(fila)
  }

  /** Rellena en la persona SÓLO lo que está vacío. Nunca pisa lo capturado. */
  async #rellenarPersona(fila) {
    if (!fila.cambiosPersona || fila.cambiosPersona.length === 0) return
    const empleado = await Employee.findById(fila.empleadoId)
    if (!empleado) return
    for (const campo of fila.cambiosPersona) empleado[campo] = fila.persona[campo]
    await empleado.save()
  }

  /** En la adscripción manda el archivo, con las dos excepciones documentadas. */
  async #actualizarAdscripcion(fila) {
    if (!fila.adscripcionId) return
    const adscripcion = await Affiliation.findById(fila.adscripcionId).select('+nomina')
    if (!adscripcion) return

    for (const campo of CAMPOS_ADSCRIPCION_AUTORITATIVOS) {
      const nuevo = fila.adscripcion[campo]
      if (nuevo !== null && nuevo !== undefined) adscripcion[campo] = nuevo
    }

    // Las áreas sólo se rellenan: una curada a mano vale más que una deducida.
    if ((adscripcion.areas || []).length === 0) {
      adscripcion.areas = fila.adscripcion.areas
    }

    for (const [campo, valor] of Object.entries(fila.adscripcion.nomina)) {
      if (valor !== null && valor !== undefined) adscripcion.nomina[campo] = valor
    }

    /*
     * El pendiente sólo se AGREGA, nunca se quita aquí: si alguien ya capturó la
     * fecha de término a mano, el `pre('validate')` del modelo lo limpia solo, y
     * volver a marcarlo desharía ese trabajo.
     */
    if (
      fila.adscripcion.datosPendientes.includes('fechaTerminoContrato') &&
      !adscripcion.fechaTerminoContrato &&
      !adscripcion.datosPendientes.includes('fechaTerminoContrato')
    ) {
      adscripcion.datosPendientes.push('fechaTerminoContrato')
    }

    await adscripcion.save()
    await this.#resincronizar(adscripcion.empleadoId)
  }

  /** Los datos con los que nace una adscripción desde el archivo. */
  #datosAdscripcion(fila, empresaId) {
    const { activo, ...resto } = fila.adscripcion
    return {
      ...resto,
      empresaId,
      empleadoId: fila.empleadoId,
      activo,
      ...(activo ? {} : { motivoBaja: MOTIVO_BAJA, fechaBaja: today() })
    }
  }

  /*
   * `require` aquí y no arriba, por el mismo ciclo que documenta
   * `affiliationService`: `recordService` requiere a `employeeService`.
   */
  async #resincronizar(empleadoId) {
    const recordService = require('../records/recordService')
    await recordService.sincronizar(empleadoId)
  }

  /** Mensaje mostrable a partir de lo que reventó, sin filtrar internos. */
  #motivoLegible(error) {
    if (error instanceof AppError) return error.message
    if (error instanceof mongoose.Error.ValidationError) {
      return Object.values(error.errors)
        .map((e) => e.message)
        .join('; ')
    }
    if (error.code === 11000) {
      const campo = Object.keys(error.keyPattern || error.keyValue || {}).join(', ')
      return `Ya existe un registro con ese ${campo || 'valor'}`
    }
    return 'No se pudo importar esta fila'
  }

  // ─── Respuesta ─────────────────────────────────────────────────────────────

  /** La forma del contrato, idéntica en la previsualización y en la importación. */
  #respuesta(analisis, aplicado) {
    const { filas, empresa, archivo } = analisis
    const conError = filas.filter((f) => f.errores.length > 0)
    const validas = filas.filter((f) => f.errores.length === 0)
    const cuenta = (accion) => validas.filter((f) => f.accion === accion).length

    const nuevos = validas.filter((f) => f.accion === 'crear')
    const yaExisten = validas.filter((f) => f.accion && f.accion !== 'crear')

    const avisos = [...analisis.avisosGenerales]
    if (filas.length > MAX_DETALLE) {
      avisos.push(
        `El detalle se recortó a ${MAX_DETALLE} renglones por lista; los totales del resumen sí cuentan las ${filas.length} filas.`
      )
    }

    const categoriasNuevas = [...analisis.puestos.values()]
      .filter((p) => (aplicado ? p.creada : !p.existe))
      .map((p) => ({ nombre: p.nombre, tipo: p.tipo, filas: p.filas }))

    return {
      aplicado,
      archivo,
      empresa: {
        _id: empresa._id.toString(),
        nombre: empresa.nombre,
        rfc: empresa.rfc ?? null,
        rfcCoincide: analisis.rfcCoincide
      },
      resumen: {
        filas: filas.length,
        nuevos: nuevos.length,
        seAdscriben: cuenta('adscribir'),
        seReactivan: cuenta('reactivar'),
        seDanDeBaja: cuenta('dar_de_baja'),
        actualizan: cuenta('actualizar'),
        sinCambios: cuenta('sin_cambios'),
        yaExisten: yaExisten.length,
        conError: conError.length
      },
      categoriasNuevas,
      nuevos: nuevos.slice(0, MAX_DETALLE).map((f) => ({
        fila: f.fila,
        empleadoId: f.empleadoId ? f.empleadoId.toString() : null,
        nombre: f.persona.nombre,
        curp: f.persona.curp,
        numeroEmpleado: f.persona.numeroEmpleado,
        puesto: f.puesto,
        tipo: f.persona.tipo,
        estatus: f.estatus,
        areas: f.adscripcion.areas,
        departamento: f.departamento,
        avisos: f.avisos
      })),
      yaExisten: yaExisten.slice(0, MAX_DETALLE).map((f) => ({
        fila: f.fila,
        empleadoId: f.empleadoId ? f.empleadoId.toString() : null,
        nombre: f.nombreEnBase || f.persona.nombre,
        curp: f.persona.curp,
        numeroEmpleado: f.persona.numeroEmpleado,
        accion: f.accion,
        cambios: [...(f.cambiosPersona || []), ...(f.cambiosAdscripcion || [])],
        avisos: f.avisos
      })),
      conError: conError.slice(0, MAX_DETALLE).map((f) => ({
        fila: f.fila,
        nombre: f.persona.nombre || null,
        curp: f.persona.curp,
        motivo: f.errores[0],
        motivos: f.errores
      })),
      avisos
    }
  }
}

module.exports = new EmployeeImportService()
module.exports.MAX_FILAS = MAX_FILAS
module.exports.MOTIVO_BAJA = MOTIVO_BAJA
