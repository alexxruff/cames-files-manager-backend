const mongoose = require('mongoose')
const Employee = require('./employeeModel')
const Affiliation = require('../affiliations/affiliationModel')
const Company = require('../companies/companyModel')
const Category = require('../categories/categoryModel')
const affiliationService = require('../affiliations/affiliationService')
const areaService = require('../areas/areaService')
const Area = require('../areas/areaModel')
const { claveDesdeNombre } = require('../areas/areaService')
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
  columnasFaltantes
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

/**
 * Los tres campos donde el archivo y una edición manual pueden chocar (D-57).
 *
 * No son todos los que escribe el importador: `departamento` y `nomina` no
 * tienen ruta para editarse a mano, y `areas` sólo se rellena si está vacía. Sin
 * choque posible no hay nada que preguntar.
 */
const CAMPOS_EN_DISPUTA = Object.freeze([
  'estatus',
  'tipoContrato',
  'fechaIngreso',
  'areas'
])

/** Nombre mostrable de cada campo, para los avisos y los conflictos. */
const ETIQUETAS = Object.freeze({
  estatus: 'el estatus',
  tipoContrato: 'el tipo de contrato',
  fechaIngreso: 'la fecha de ingreso',
  areas: 'el área',
  nombre: 'el nombre',
  numeroEmpleado: 'el número de trabajador',
  curp: 'la CURP',
  rfc: 'el RFC',
  nss: 'el NSS',
  fechaNacimiento: 'la fecha de nacimiento',
  email: 'el correo',
  telefono: 'el teléfono'
})

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
    await this.#crearAreasFaltantes(analisis)
    await this.#aplicar(analisis, contexto)

    return this.#respuesta(analisis, true)
  }

  // ─── Análisis ──────────────────────────────────────────────────────────────

  /**
   * Lee el archivo, lo compara contra la base y clasifica cada fila. **No
   * escribe nada.**
   */
  async #analizar(buffer, opciones, contexto) {
    const { empresaId } = opciones
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

    // El puesto ya resuelto puede traer el tipo del catálogo en vez del
    // deducido, y manda el catálogo.
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
      }
    }

    /*
     * El área de cada fila, contra el catálogo (D-58). Va ANTES de clasificar:
     * `areas` es uno de los campos que se comparan con lo que ya está guardado.
     */
    const areas = await this.#resolverAreas(filas, avisosGenerales)

    await this.#clasificar(filas, empresa, opciones)

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
      areas,
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

  /**
   * La columna `Departamento` → el área de la adscripción, contra el catálogo
   * (D-58).
   *
   * Antes esto era un mapa fijo en el código y lo que no estaba en el mapa caía
   * a un área inventada (`obra` / `administracion`) que no decía nada del
   * archivo: 53 de las 145 filas de Urbacames traen aquí una obra —`Axis
   * Zapopan`, `Axis 3`— y todas acababan en la misma área. Ahora cada
   * departamento **es** un área:
   *
   * - Si ya existe una con ese nombre (o con esa clave), se usa.
   * - Si no, se crea como **temporal** y la fila lo avisa. Es el mismo trato que
   *   ya reciben los puestos (D-46): el dato viene del archivo, no es una
   *   decisión de catálogo, y rechazar la fila por un departamento nuevo dejaría
   *   la importación inservible.
   * - Si existe pero está **dada de baja**, se reactiva y se avisa: RH la cerró
   *   porque la obra terminó, y el archivo dice que hay gente ahí otra vez. Sin
   *   esto quedaría gente asignada a un área que ningún desplegable ofrece.
   *
   * Una fila SIN departamento se queda **sin área**, y se marca en
   * `datosPendientes`. Antes se le inventaba una; ahora se dice que falta, que es
   * lo que permite listar después a quién hay que asignársela.
   *
   * Se resuelve una vez por departamento distinto, no una por fila: el archivo
   * de Urbacames tiene 145 filas y una docena de departamentos.
   */
  async #resolverAreas(filas, avisosGenerales = []) {
    const areas = new Map()

    for (const fila of filas) {
      if (fila.errores.length > 0) continue

      const texto = fila.departamento
      if (!texto) {
        if (!fila.adscripcion.datosPendientes.includes('areas')) {
          fila.adscripcion.datosPendientes.push('areas')
        }
        fila.avisos.push(
          'La fila no trae departamento: la persona queda sin área hasta que se le asigne'
        )
        continue
      }

      const clave = normalize(texto)
      const yaVista = areas.get(clave)
      if (yaVista) {
        yaVista.filas += 1
        fila.adscripcion.areas = [yaVista.claveArea]
        continue
      }

      areas.set(clave, {
        clave,
        nombre: String(texto).trim(),
        // La que tendría si hay que crearla; se confirma abajo con el catálogo.
        claveArea: claveDesdeNombre(texto),
        filas: 1,
        existe: false,
        temporal: true,
        reactivar: false
      })
      fila.adscripcion.areas = [areas.get(clave).claveArea]
    }

    if (areas.size === 0) return areas

    /*
     * Una sola consulta para todos los departamentos distintos. Se busca por
     * nombre normalizado Y por clave, para que «Recursos Humanos», «RECURSOS
     * HUMANOS» y `recursos_humanos` caigan todos en la misma área.
     */
    const claves = [...areas.keys()]
    const existentes = await Area.find({
      $or: [
        { nombreNormalizado: { $in: claves } },
        {
          clave: {
            $in: [...new Set([...claves, ...[...areas.values()].map((a) => a.claveArea)])]
          }
        }
      ]
    }).select('+nombreNormalizado')

    for (const area of existentes) {
      const encontrada =
        areas.get(area.nombreNormalizado) ||
        [...areas.values()].find(
          (a) => a.claveArea === area.clave || a.clave === area.clave
        )
      if (!encontrada) continue

      encontrada.claveArea = area.clave
      encontrada.nombre = area.nombre
      encontrada.existe = true
      encontrada.temporal = area.temporal
      encontrada.reactivar = !area.activa
    }

    // Ya con la clave definitiva del catálogo, se reescriben las filas.
    for (const fila of filas) {
      if (fila.errores.length > 0 || !fila.departamento) continue
      const resuelta = areas.get(normalize(fila.departamento))
      if (!resuelta) continue
      fila.adscripcion.areas = [resuelta.claveArea]
      this.#avisarDelArea(fila, resuelta)
    }

    /*
     * Y un aviso general con las temporales del archivo: es lo que reemplaza al
     * aviso por renglón. Se dice una vez, con la lista, que es como se revisa.
     */
    const temporales = [...areas.values()].filter((a) => a.temporal || !a.existe)
    if (temporales.length > 0) {
      avisosGenerales.push(
        `El archivo usa ${temporales.length} ${temporales.length === 1 ? 'área temporal' : 'áreas temporales'} (${temporales
          .map((a) => a.nombre)
          .join(', ')}): dales de baja cuando la obra termine.`
      )
    }

    return areas
  }

  /** El aviso que le toca a la fila según cómo se resolvió su área. */
  #avisarDelArea(fila, resuelta) {
    /*
     * Sólo cuando el área es NUEVA. Repetir «es un área temporal» en cada
     * renglón y en cada importación no informa de nada: al segundo mes serían
     * 145 avisos que nadie lee. Que un área sea temporal se ve en el catálogo
     * (`GET /areas?temporal=true`) y, por archivo, en el aviso general.
     */
    if (!resuelta.existe) {
      fila.avisos.push(
        `"${resuelta.nombre}" no es un área conocida: se dará de alta como área TEMPORAL. Dala de baja cuando la obra termine.`
      )
    }

    if (resuelta.reactivar) {
      fila.avisos.push(
        `El área "${resuelta.nombre}" está dada de baja y el archivo trae gente en ella: se reactivará`
      )
    }
  }

  /**
   * Crea las áreas temporales que falten y reactiva las que el archivo revive.
   *
   * Va aquí y **no en el análisis**, igual que las categorías y por la misma
   * razón: `previsualizar` comparte el análisis y no debe escribir nada (D-46).
   */
  async #crearAreasFaltantes(analisis) {
    for (const resuelta of analisis.areas.values()) {
      if (resuelta.existe) {
        if (!resuelta.reactivar) continue
        await Area.updateOne({ clave: resuelta.claveArea }, { $set: { activa: true } })
        resuelta.reactivada = true
        resuelta.reactivar = false
        continue
      }

      const { area } = await areaService.resolverDesdeTexto(resuelta.nombre)
      resuelta.claveArea = area.clave
      resuelta.existe = true
      resuelta.temporal = area.temporal
      resuelta.creada = true
    }

    // Las filas apuntan al área por su clave; hasta aquí podía ser la tentativa.
    for (const fila of analisis.filas) {
      if (fila.errores.length > 0 || !fila.departamento) continue
      const resuelta = analisis.areas.get(normalize(fila.departamento))
      if (resuelta) fila.adscripcion.areas = [resuelta.claveArea]
    }
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
  async #clasificar(filas, empresa, opciones = {}) {
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
      '+nomina +payrollSnapshot'
    )
    const adscripcionPorEmpleado = new Map(
      adscripciones.map((a) => [a.empleadoId.toString(), a])
    )

    /*
     * A quién se le pidió explícitamente que gane el archivo. Viene de la
     * previsualización, donde el usuario vio el conflicto y eligió.
     */
    const forzadas = new Set((opciones.forzarArchivoPara || []).map(String))

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
      // Lo que hace falta para decidir la baja o el alta del sistema, sin
      // arrastrar el documento entero hasta la respuesta.
      fila.personaActiva = empleado.activo
      fila.personaMotivoBaja = empleado.motivoBaja ?? null
      fila.diferenciasPersona = this.#diferenciasDePersona(fila, empleado)

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

      /*
       * Qué del archivo choca con un cambio hecho a mano (D-57). Lo que quede en
       * conflicto NO se aplica —gana la plataforma— salvo que esta persona venga
       * en `forzarArchivoPara`.
       */
      fila.conflictos = this.#conflictos(fila, adscripcion, empresa, forzadas)
      const enConflicto = new Set(fila.conflictos.map((c) => c.campo))
      fila.camposEnConflicto = [...enConflicto]

      fila.cambiosAdscripcion = this.#cambiosDeAdscripcion(fila, adscripcion, enConflicto)

      /*
       * `quedaActivaEnLaEmpresa` es lo que va a quedar, que no es lo mismo que lo
       * que dice el archivo: si el estatus está en conflicto, se conserva el de
       * la plataforma. Lo usa `#marcarEstadoDeLaPersona` para no dar de baja del
       * sistema a alguien cuya baja acabamos de decidir NO aplicar.
       */
      const cambiaEstatus =
        fila.adscripcion.activo !== adscripcion.activo && !enConflicto.has('estatus')
      fila.quedaActivaEnLaEmpresa = enConflicto.has('estatus')
        ? adscripcion.activo
        : fila.adscripcion.activo

      if (cambiaEstatus) {
        fila.avisos.push(
          `El estatus cambió: estaba de ${adscripcion.activo ? 'alta' : 'baja'} en ` +
            `${empresa.nombre} y el archivo la trae como "${fila.estatus}"`
        )
      }

      if (cambiaEstatus && fila.adscripcion.activo) fila.accion = 'reactivar'
      else if (cambiaEstatus && !fila.adscripcion.activo) fila.accion = 'dar_de_baja'
      else if (fila.cambiosPersona.length + fila.cambiosAdscripcion.length > 0) {
        fila.accion = 'actualizar'
      } else fila.accion = 'sin_cambios'
    }

    await this.#marcarEstadoDeLaPersona(validas, empresa)
  }

  /**
   * Quién queda dado de baja **del sistema** y quién vuelve, según el `Estatus`
   * del archivo (D-55).
   *
   * La baja de la columna `Estatus` es de ESTA empresa, y por eso se aplica a la
   * adscripción. Pero una persona a la que no le queda **ninguna** adscripción
   * activa ya no trabaja en el grupo, y dejarla marcada como activa la escondía
   * de los dos filtros de `GET /empleados`: fuera de los activos —no tiene
   * empresa vigente— y fuera de las bajas —la persona figuraba activa—.
   *
   * Sólo cuenta lo que pasa en OTRAS empresas: la adscripción de ésta la decide
   * el archivo que se está importando.
   *
   * La vuelta es deliberadamente más estrecha: se reactiva **sólo si la baja la
   * había puesto una importación**. Una baja capturada a mano —un despido— no la
   * deshace un archivo de nómina; para esa se conserva el aviso de siempre.
   */
  async #marcarEstadoDeLaPersona(filas, empresa) {
    const conPersona = filas.filter((f) => f.empleadoId && f.errores.length === 0)
    if (conPersona.length === 0) return

    const otras = await Affiliation.find({
      empleadoId: { $in: conPersona.map((f) => f.empleadoId) },
      activo: true,
      empresaId: { $ne: empresa._id }
    }).select('empleadoId')
    const sigueEnOtraEmpresa = new Set(otras.map((a) => a.empleadoId.toString()))

    for (const fila of conPersona) {
      const enOtra = sigueEnOtraEmpresa.has(fila.empleadoId.toString())

      /*
       * Si el estatus quedó en conflicto, lo que manda es la plataforma y este
       * renglón NO decide nada sobre la persona (D-57): dar de baja del sistema
       * a alguien cuya baja acabamos de decidir no aplicar sería tomar por la
       * puerta de atrás la decisión que se acaba de dejar en manos del usuario.
       */
      const quedaActiva = fila.quedaActivaEnLaEmpresa ?? fila.adscripcion.activo
      if (quedaActiva !== fila.adscripcion.activo) continue

      if (!quedaActiva) {
        if (fila.personaActiva && !enOtra) {
          fila.bajaDelSistema = true
          fila.avisos.push(
            'Se da de baja DEL SISTEMA: con ésta no le queda ninguna empresa activa'
          )
        } else if (fila.personaActiva && enOtra) {
          fila.avisos.push(
            'Sigue activa en el sistema: tiene otra empresa del grupo vigente'
          )
        }
      } else if (!fila.personaActiva) {
        if (fila.personaMotivoBaja === MOTIVO_BAJA) {
          fila.reactivarDelSistema = true
          fila.avisos.push(
            'Se reactiva EN EL SISTEMA: la baja anterior también la había puesto una importación'
          )
        } else {
          fila.avisos.push(
            'Esta persona está dada de baja DEL SISTEMA y la baja se capturó a mano: la importación NO la reactiva, sólo actualiza su adscripción'
          )
        }
      }

      /*
       * Que el resumen y la previsualización no digan "sin cambios" cuando el
       * estado de la persona sí cambia.
       *
       * Va en `cambiosDeEstado` y NO en `cambiosPersona`: esa segunda lista es la
       * de campos que `#rellenarPersona` COPIA del archivo, y `activo` no es un
       * campo del archivo. Meterlo ahí hacía `empleado.activo = undefined`, que
       * la invariante del modelo rechazaba pidiendo el motivo de la baja.
       */
      if (fila.bajaDelSistema || fila.reactivarDelSistema) {
        fila.cambiosDeEstado = ['activo']
        if (fila.accion === 'sin_cambios') fila.accion = 'actualizar'
      }
    }
  }

  /**
   * Lo que el archivo cambiaría **pisando un cambio hecho a mano** (D-57).
   *
   * Tres valores por campo, y los tres hacen falta:
   *
   * - `base`   — lo que trajo el archivo ANTERIOR (`payrollSnapshot`).
   * - `actual` — lo que está hoy en la plataforma.
   * - `nuevo`  — lo que trae el archivo que se está subiendo.
   *
   * `actual !== base` significa que alguien lo cambió a mano después de la última
   * importación. Si además el archivo trae algo distinto de lo que está, hay que
   * decidir: sin la comparación contra `base` no se puede distinguir de una
   * novedad legítima del archivo.
   *
   * **Gana la plataforma**, que es lo que no se puede recuperar: el archivo se
   * vuelve a subir, un dato corregido a mano no se recupera solo. Para que gane
   * el archivo hay que pedirlo por persona en `forzarArchivoPara`.
   *
   * Sin `payrollSnapshot` —adscripciones anteriores a D-57 o creadas a mano— no
   * hay contra qué comparar y **manda el archivo, como siempre**: inventar un
   * conflicto donde no se sabe sería peor que no detectarlo.
   */
  #conflictos(fila, adscripcion, empresa, forzadas) {
    const base = adscripcion.payrollSnapshot
    if (!base || !base.importedAt) return []
    if (forzadas.has(String(adscripcion.empleadoId))) return []

    const comparables = {
      estatus: {
        base: base.active,
        actual: adscripcion.activo,
        nuevo: fila.adscripcion.activo,
        texto: (v) => (v ? 'alta' : 'baja'),
        // La fecha de la baja es un dato real; para el alta no hay equivalente.
        cambiadoEn: adscripcion.activo ? null : (adscripcion.fechaBaja ?? null)
      },
      tipoContrato: {
        base: base.contractType,
        actual: adscripcion.tipoContrato,
        nuevo: fila.adscripcion.tipoContrato,
        texto: (v) => v,
        cambiadoEn: null
      },
      fechaIngreso: {
        base: base.hireDate,
        actual: adscripcion.fechaIngreso,
        nuevo: fila.adscripcion.fechaIngreso,
        texto: (v) => v,
        cambiadoEn: null
      },
      /*
       * El área también, desde D-58: el archivo la reasigna a partir de la
       * columna `Departamento` —es lo que corrige las áreas del modelo
       * anterior—, pero una curada a mano no se pisa sin preguntar.
       *
       * Se comparan como texto ordenado: `['obra','taller']` y
       * `['taller','obra']` son la misma asignación.
       */
      areas: {
        base: (base.areas || []).length > 0 ? [...base.areas].sort().join(', ') : null,
        actual: [...(adscripcion.areas || [])].sort().join(', '),
        nuevo: [...(fila.adscripcion.areas || [])].sort().join(', '),
        texto: (v) => v || '(sin área)',
        cambiadoEn: null
      }
    }

    const conflictos = []
    for (const campo of CAMPOS_EN_DISPUTA) {
      const { base: previo, actual, nuevo, texto, cambiadoEn } = comparables[campo]
      // Sin valor previo registrado no hay forma de saber quién cambió qué.
      if (previo === null || previo === undefined) continue
      if (nuevo === null || nuevo === undefined) continue

      const cambiadoAMano = String(actual) !== String(previo)
      const archivoDifiere = String(nuevo) !== String(actual)
      if (!cambiadoAMano || !archivoDifiere) continue

      conflictos.push({
        campo,
        enElArchivo: texto(nuevo),
        enLaPlataforma: texto(actual),
        enLaImportacionAnterior: texto(previo),
        cambiadoEn,
        // Mostrable tal cual: es el texto que va a leer quien decide.
        mensaje:
          `El archivo dice que ${ETIQUETAS[campo]} es "${texto(nuevo)}", pero en la ` +
          `plataforma se cambió a "${texto(actual)}"${cambiadoEn ? ` el ${cambiadoEn}` : ''}` +
          ` (${empresa.nombre}). Se conserva lo de la plataforma; para que gane el ` +
          `archivo, vuelve a enviarlo con esta persona en forzarArchivoPara.`
      })
    }

    return conflictos
  }

  /**
   * Datos de la PERSONA en los que el archivo y la plataforma no coinciden
   * (D-57).
   *
   * No son conflictos: estos campos **nunca** se pisan (D-46, el archivo sólo
   * rellena lo vacío), así que no hay nada que decidir. Se reportan porque hasta
   * ahora se callaban: quien revisa la importación no tenía forma de enterarse
   * de que el archivo trae una CURP o un teléfono distintos del capturado.
   */
  #diferenciasDePersona(fila, empleado) {
    const diferencias = []
    for (const campo of CAMPOS_PERSONA_RELLENABLES) {
      const delArchivo = fila.persona[campo]
      if (delArchivo === null || delArchivo === undefined || delArchivo === '') continue

      const actual = empleado[campo]
      // Vacío se rellena, no difiere: eso ya lo reporta `cambiosPersona`.
      if (actual === null || actual === undefined || actual === '') continue
      if (String(actual) === String(delArchivo)) continue

      diferencias.push({
        campo,
        enElArchivo: delArchivo,
        enLaPlataforma: actual,
        mensaje:
          `El archivo trae ${ETIQUETAS[campo] || campo} "${delArchivo}" y en la ` +
          `plataforma está "${actual}": se conserva lo de la plataforma`
      })
    }
    return diferencias
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
  #cambiosDeAdscripcion(fila, adscripcion, enConflicto = new Set()) {
    const cambios = []

    /*
     * El `Estatus` primero, porque es el cambio que más se revisa al re-subir el
     * archivo (D-56). No sale de `CAMPOS_ADSCRIPCION_AUTORITATIVOS` —ahí sólo van
     * los campos que se escriben con una asignación— porque el alta y la baja
     * pasan por `affiliationService.setEstado`, que además cierra las
     * asignaciones abiertas. Sin esto, un renglón que sólo cambia de alta a baja
     * llegaba al front con `cambios: []`.
     */
    if (fila.adscripcion.activo !== adscripcion.activo && !enConflicto.has('estatus')) {
      cambios.push('estatus')
    }

    for (const campo of CAMPOS_ADSCRIPCION_AUTORITATIVOS) {
      if (enConflicto.has(campo)) continue
      const nuevo = fila.adscripcion[campo]
      if (nuevo === null || nuevo === undefined) continue
      if (String(adscripcion[campo] ?? '') !== String(nuevo)) cambios.push(campo)
    }

    const areasDelArchivo = [...(fila.adscripcion.areas || [])].sort().join(', ')
    const areasGuardadas = [...(adscripcion.areas || [])].sort().join(', ')
    if (
      !enConflicto.has('areas') &&
      areasDelArchivo &&
      areasDelArchivo !== areasGuardadas
    ) {
      cambios.push('areas')
    }

    const difiere = (guardado, delArchivo) =>
      Object.entries(delArchivo || {}).some(
        ([campo, valor]) =>
          valor !== null &&
          valor !== undefined &&
          String((guardado || {})[campo] ?? '') !== String(valor)
      )

    // Los dos grupos por separado: uno se muestra y el otro no (D-63).
    if (difiere(adscripcion.condiciones, fila.adscripcion.condiciones)) {
      cambios.push('condiciones')
    }
    if (difiere(adscripcion.nomina, fila.adscripcion.nomina)) cambios.push('nomina')

    return cambios
  }

  // ─── Aplicación ────────────────────────────────────────────────────────────

  async #aplicar(analisis, contexto) {
    for (const fila of analisis.filas) {
      if (fila.errores.length > 0 || !fila.accion) continue
      // Antes del switch: `crear` y `adscribir` lo asignan al vuelo.
      const yaTeniaAdscripcion = Boolean(fila.adscripcionId)
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
        await this.#aplicarEstadoDeLaPersona(fila, contexto)
        /*
         * El registro de lo que dijo el archivo se refresca SIEMPRE, incluso en
         * las filas `sin_cambios`: es lo que arranca el historial en las
         * adscripciones que ya existían antes de D-57, y sin él nunca podrían
         * detectar un cambio manual.
         */
        if (yaTeniaAdscripcion) await this.#refrescarSnapshot(fila)
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
        /*
         * Si el archivo la trae en `Baja`, la persona NACE dada de baja del
         * sistema (D-55). Su única adscripción es la que este mismo renglón crea
         * y viene cerrada, así que dejarla activa la volvía invisible: no salía
         * entre los activos —no tiene adscripción vigente— ni entre las bajas
         * —la persona figuraba activa—.
         */
        const [empleado] = await Employee.create(
          [
            {
              ...fila.persona,
              categoriaId: fila.categoriaId,
              ...(fila.adscripcion.activo
                ? {}
                : { activo: false, motivoBaja: MOTIVO_BAJA, fechaBaja: today() })
            }
          ],
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

  /**
   * Baja o alta **del sistema**, cuando el `Estatus` del archivo lo implica
   * (D-55). Lo marcó `#marcarEstadoDeLaPersona`; aquí sólo se ejecuta.
   *
   * Se delega en `employeeService.setEstado` en vez de escribir el documento a
   * mano, para heredar lo que ya cuida esa ruta: desactiva el acceso a la
   * plataforma en la misma transacción y **se niega a dejar al sistema sin
   * administrador global**. Si por eso falla, la fila cae en error con su motivo
   * y las demás siguen — que es justo lo que debe pasar.
   */
  async #aplicarEstadoDeLaPersona(fila, contexto) {
    if (!fila.bajaDelSistema && !fila.reactivarDelSistema) return

    /*
     * `require` aquí y no arriba: `employeeService` no requiere a este módulo,
     * pero sí a `recordService`, que sí lo hace. Pedirlo en el momento de usarlo
     * evita depender del orden de carga.
     */
    const employeeService = require('./employeeService')
    await employeeService.setEstado(
      fila.empleadoId,
      fila.bajaDelSistema
        ? { activo: false, motivo: MOTIVO_BAJA, fecha: today() }
        : { activo: true },
      contexto
    )
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

    // Lo que está en conflicto con un cambio manual NO se pisa (D-57).
    const enConflicto = new Set(fila.camposEnConflicto || [])
    for (const campo of CAMPOS_ADSCRIPCION_AUTORITATIVOS) {
      if (enConflicto.has(campo)) continue
      const nuevo = fila.adscripcion[campo]
      if (nuevo !== null && nuevo !== undefined) adscripcion[campo] = nuevo
    }

    /*
     * Las áreas las manda el archivo desde D-58 —es lo que reasigna a quien
     * quedó con un área del modelo anterior—, pero pasan por el mismo candado
     * que los demás campos en disputa: si alguien la curó a mano, es conflicto y
     * no se pisa. Una fila sin departamento no trae área y no borra la que hay.
     */
    if (!enConflicto.has('areas') && (fila.adscripcion.areas || []).length > 0) {
      adscripcion.areas = fila.adscripcion.areas
    }

    for (const [campo, valor] of Object.entries(fila.adscripcion.condiciones)) {
      if (valor !== null && valor !== undefined) adscripcion.condiciones[campo] = valor
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
      payrollSnapshot: this.#snapshot(fila),
      ...(activo ? {} : { motivoBaja: MOTIVO_BAJA, fechaBaja: today() })
    }
  }

  /**
   * Lo que dijo ESTE archivo, para poder compararlo con el siguiente (D-57).
   *
   * Guarda lo que trae el archivo, **no lo que quedó aplicado**: si un conflicto
   * se resolvió a favor de la plataforma, el archivo sigue diciendo lo suyo y la
   * próxima importación tiene que volver a preguntarlo. Guardar lo aplicado
   * borraría la discrepancia y la haría desaparecer en silencio.
   */
  /** Deja constancia de lo que dijo este archivo en una adscripción que ya existía. */
  async #refrescarSnapshot(fila) {
    if (!fila.adscripcionId) return
    await Affiliation.updateOne(
      { _id: fila.adscripcionId },
      { $set: { payrollSnapshot: this.#snapshot(fila) } }
    )
  }

  #snapshot(fila) {
    return {
      active: fila.adscripcion.activo,
      contractType: fila.adscripcion.tipoContrato ?? null,
      hireDate: fila.adscripcion.fechaIngreso ?? null,
      areas: fila.adscripcion.areas || [],
      importedAt: new Date()
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

    /*
     * Áreas que el archivo da de alta como TEMPORALES, casi siempre una obra
     * (D-58). Misma forma que `categoriasNuevas` y por lo mismo: hay que poder
     * verlas antes de aplicar, y después saber cuáles se crearon de verdad.
     */
    const areasNuevas = [...analisis.areas.values()]
      .filter((a) => (aplicado ? a.creada : !a.existe))
      .map((a) => ({ nombre: a.nombre, clave: a.claveArea, filas: a.filas }))

    const areasReactivadas = [...analisis.areas.values()]
      .filter((a) => (aplicado ? a.reactivada : a.reactivar))
      .map((a) => ({ nombre: a.nombre, clave: a.claveArea, filas: a.filas }))

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
        /*
         * Filas que necesitan una decisión: el archivo pisaría un cambio hecho a
         * mano (D-57). No se aplicaron; se conservó lo de la plataforma.
         */
        conConflicto: validas.filter((f) => (f.conflictos || []).length > 0).length,
        conError: conError.length
      },
      categoriasNuevas,
      areasNuevas,
      areasReactivadas,
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
        cambios: [
          ...(f.cambiosPersona || []),
          ...(f.cambiosDeEstado || []),
          ...(f.cambiosAdscripcion || [])
        ],
        /*
         * Lo que NO se aplicó porque choca con un cambio manual, y lo que
         * difiere pero nunca se pisa (D-57). Los dos son arreglos vacíos en el
         * caso normal, así que no estorban.
         */
        conflictos: f.conflictos || [],
        diferencias: f.diferenciasPersona || [],
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
