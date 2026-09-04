const mongoose = require('mongoose')
const { isCalendarDate, isBefore } = require('../../../utils/dates')
const { idAString } = require('../../../utils/ids')
const attachmentSchema = require('../../../models/attachmentSchema')
const { attachmentToJson } = require('../../../utils/attachments')
const { MONTO_MAXIMO_CONTRATO } = require('../../../constants')

/**
 * Contrato de un proyecto, con su SIROC embebido (D-70, plan §C4).
 *
 * **Contrato y fase son la misma entidad** (G1): cada fase de una obra tiene
 * exactamente un contrato, y un proyecto de un solo contrato no tiene fases.
 * Dos entidades 1:1 obligatorias son una sola con dos nombres, y por eso son dos
 * campos de un mismo documento: `nombre` el del contrato y `fase` su etiqueta de
 * obra ('Fase 1', 'Cimentación'), los dos opcionales (D-75).
 *
 * **Colección propia y no subdocumento del proyecto** porque crecen sin tope, se
 * agregan con el tiempo y hay que consultarlos solos. Es el mismo criterio que
 * separa `assignments` (colección) de `aplazamientos` (embebido).
 *
 * **El SIROC va embebido**: es 1:1 con el contrato y no tiene ciclo de vida
 * propio. Una colección para una relación 1:1 sin vida propia sería duplicar
 * entidad. Si algún día necesita historial, se gradúa entonces.
 */

const validadorFecha = (etiqueta) => ({
  validator: (v) => v === null || isCalendarDate(v),
  message: `${etiqueta} debe tener el formato AAAA-MM-DD y ser una fecha real`
})

const campoMonto = (etiqueta, { requerido = false } = {}) => ({
  type: Number,
  ...(requerido ? { required: [true, `${etiqueta} es requerido`] } : { default: null }),
  min: [0, `${etiqueta} no puede ser negativo`],
  max: [MONTO_MAXIMO_CONTRATO, `${etiqueta} no puede exceder ${MONTO_MAXIMO_CONTRATO}`]
})

/**
 * Una renovación del aviso ante el IMSS (D-76).
 *
 * El SIROC se actualiza cada dos meses **conservando el mismo número**, así que
 * esto no es un SIROC nuevo: es la fecha en que se refrendó el que ya hay. Se
 * guarda porque es un hecho —alguien fue y lo actualizó ese día—, no un derivado:
 * cuántas faltan y si urge la siguiente se calculan al leer (regla #6).
 */
const sirocRenovacionSchema = new mongoose.Schema(
  {
    fecha: {
      type: String,
      required: [true, 'La fecha del reporte bimestral es requerida'],
      validate: validadorFecha('La fecha del reporte bimestral')
    },
    /** Folio del acuse, quién fue, lo que haga falta recordar. */
    nota: {
      type: String,
      default: null,
      trim: true,
      maxlength: [200, 'La nota no puede exceder 200 caracteres']
    },

    /**
     * Lo que se reportó ese bimestre, en pesos (D-91). **No es el monto del
     * contrato**: aquél es el total de la obra y éste la cifra de dos meses, y
     * conviven sin mirarse. Opcional por la misma razón que el acuse (D-80): del
     * IMSS se vuelve con la fecha y el papel con la cifra llega después, así que
     * `null` es «todavía no se capturó» y **no se confunde con `0`**, que sería
     * un bimestre que alguien reportó en ceros.
     */
    monto: campoMonto('El monto del reporte bimestral'),

    /**
     * A qué bimestre corresponde, **tal como lo teclea quien captura** (D-91):
     * '3', '2026-3', 'mayo-junio'. Texto y no número a propósito —cada quien lo
     * nombra distinto y el papel no obliga a una forma—, así que siempre sale
     * como cadena o `null`, aunque llegue un número en el JSON.
     */
    bimestre: {
      type: String,
      default: null,
      trim: true,
      maxlength: [40, 'El bimestre no puede exceder 40 caracteres']
    },

    /**
     * El acuse de ESTA renovación (D-80). Opcional, y **propio de cada una**: el
     * papel que sale del IMSS al refrendar no es el del aviso original, y es el
     * historial completo lo que se enseña si algún día lo revisan.
     */
    archivo: { type: attachmentSchema, default: null }
  },
  {
    /*
     * SIN `_id`, como nació (D-76). Ponérselo ahora obligaría a migrar las
     * renovaciones ya capturadas —y mientras tanto Mongoose les inventaría uno
     * distinto en cada lectura—, así que cada una se direcciona por su índice.
     * Es estable: el arreglo sólo crece y sólo se quita la última.
     */
    _id: false
  }
)

/**
 * El aviso de obra ante el IMSS. `numero` es **único en todo el sistema** (G4):
 * no se repite entre empresas, ni entre clientes, ni entre proyectos.
 */
const sirocSchema = new mongoose.Schema(
  {
    numero: {
      type: String,
      required: [true, 'El número de SIROC es requerido'],
      trim: true,
      uppercase: true,
      minlength: [3, 'El número de SIROC debe tener al menos 3 caracteres'],
      maxlength: [40, 'El número de SIROC no puede exceder 40 caracteres']
    },
    /**
     * El único dato de fecha que se captura del aviso (D-76). **No hay fecha
     * final**: el aviso vale dos meses contados desde aquí —o desde la última
     * actualización—, y esa vigencia se deriva al leer, en `seguimientoSiroc`.
     * Cuando además se guardaba, quien capturaba tecleaba ahí la fecha de fin del
     * contrato y el aviso terminaba diciendo una cosa y la pantalla otra.
     */
    fechaRegistro: {
      type: String,
      required: [true, 'La fecha de registro del SIROC es requerida'],
      validate: validadorFecha('La fecha de registro')
    },

    /**
     * Las renovaciones de este mismo aviso, en orden (D-76). Vacío mientras el
     * SIROC original siga dentro de sus dos meses.
     */
    actualizaciones: { type: [sirocRenovacionSchema], default: [] },

    /**
     * El aviso escaneado (D-80). Opcional: el SIROC se puede capturar en cuanto
     * se tiene el número, y el papel llegar después. Corregir el aviso con
     * `PUT /siroc` **no lo tira**; sólo lo reemplaza mandar uno nuevo.
     */
    archivo: { type: attachmentSchema, default: null }
  },
  { _id: false }
)

/**
 * Una modificación del contrato (D-90).
 *
 * **No es un refrendo del SIROC**: aquélla es una cita con el IMSS cada dos
 * meses; ésta la provoca algo de afuera —el cliente aplazó la obra, cambió el
 * precio, se anexaron requerimientos— y trae **términos nuevos**: fechas y
 * monto. Desde que se registra, lo que vale es lo de aquí, y lo que había queda
 * en la historia.
 *
 * `fechaAcuerdo` es **cuándo se pactó**, que casi nunca es hoy: el convenio se
 * firma y se captura días después. `archivo` es el convenio escaneado, opcional
 * al capturarlo por la misma razón que el acuse del reporte bimestral (D-80) —el
 * papel llega tarde— y se adjunta luego por su propia ruta.
 */
const modificacionSchema = new mongoose.Schema(
  {
    fechaAcuerdo: {
      type: String,
      required: [true, 'La fecha del acuerdo es requerida'],
      validate: validadorFecha('La fecha del acuerdo')
    },
    motivo: {
      type: String,
      default: null,
      trim: true,
      maxlength: [300, 'El motivo no puede exceder 300 caracteres']
    },
    fechaInicio: {
      type: String,
      required: [true, 'La fecha de inicio es requerida'],
      validate: validadorFecha('La fecha de inicio')
    },
    fechaFin: {
      type: String,
      required: [true, 'La fecha de fin es requerida'],
      validate: validadorFecha('La fecha de fin')
    },
    monto: campoMonto('El monto de la modificación', { requerido: true }),
    archivo: { type: attachmentSchema, default: null }
  },
  {
    /*
     * SIN `_id`, como las renovaciones del SIROC y por lo mismo: cada una se
     * direcciona por su índice, y es estable porque el arreglo sólo crece y sólo
     * se quita la última.
     */
    _id: false
  }
)

/**
 * Los términos con los que NACIÓ el contrato (D-90).
 *
 * `null` mientras nadie lo modifique, que es el caso normal: un contrato que se
 * cumple como se pactó no tiene historia. Se llena con la fotografía de lo que
 * había la primera vez que se registra una modificación, y se vacía si se
 * deshace la última.
 *
 * Su papel escaneado NO se copia aquí: sigue siendo `contrato.archivo`, que es
 * el del contrato original. Cada modificación trae el suyo.
 */
const terminosOriginalesSchema = new mongoose.Schema(
  {
    fechaInicio: {
      type: String,
      required: [true, 'La fecha de inicio original es requerida'],
      validate: validadorFecha('La fecha de inicio original')
    },
    fechaFin: {
      type: String,
      required: [true, 'La fecha de fin original es requerida'],
      validate: validadorFecha('La fecha de fin original')
    },
    /** Anulable: los contratos capturados antes del monto no tenían ninguno. */
    monto: campoMonto('El monto original')
  },
  { _id: false }
)

/**
 * La línea del tiempo del contrato, derivada al leer (regla #6).
 *
 * `modificado: false` y `entradas: []` cuando no hubo modificaciones: un
 * contrato que se cumplió como se pactó **no tiene historia que mostrar**, y lo
 * dice él, para que la pantalla no tenga que deducirlo de un arreglo vacío.
 *
 * La última entrada es la vigente, y sus valores son los mismos que los campos
 * del contrato: no hay dos versiones de la verdad, hay una y su pasado.
 */
function construirHistoria(ret) {
  const modificaciones = ret.modificaciones ?? []
  if (modificaciones.length === 0 || !ret.original) {
    return { modificado: false, entradas: [] }
  }

  const entradas = [
    {
      tipo: 'original',
      indice: null,
      fechaAcuerdo: null,
      motivo: null,
      fechaInicio: ret.original.fechaInicio,
      fechaFin: ret.original.fechaFin,
      monto: ret.original.monto ?? null,
      // Sin `url`: firmarla es asíncrono, y la agrega el servicio.
      archivo: attachmentToJson(ret.archivo),
      vigente: false
    },
    ...modificaciones.map((m, indice) => ({
      tipo: 'modificacion',
      indice,
      fechaAcuerdo: m.fechaAcuerdo,
      motivo: m.motivo ?? null,
      fechaInicio: m.fechaInicio,
      fechaFin: m.fechaFin,
      monto: m.monto ?? null,
      archivo: attachmentToJson(m.archivo),
      vigente: false
    }))
  ]

  entradas[entradas.length - 1].vigente = true
  return { modificado: true, entradas }
}

const contractSchema = new mongoose.Schema(
  {
    proyectoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: [true, 'El proyecto es requerido']
    },

    /**
     * Orden dentro del proyecto: 1, 2, 3… **Lo asigna el servidor**, no llega del
     * cliente: es una secuencia, y dejar que la mande quien captura sólo produce
     * huecos y choques contra el índice único.
     */
    numero: {
      type: Number,
      required: [true, 'El número de contrato es requerido'],
      min: [1, 'El número de contrato empieza en 1']
    },

    /** Nombre del contrato. Opcional: un proyecto de un contrato no lo necesita. */
    nombre: {
      type: String,
      default: null,
      trim: true,
      maxlength: [120, 'El nombre no puede exceder 120 caracteres']
    },

    /**
     * Etiqueta de la fase ('Fase 1', 'Cimentación'), el alias con el que la obra
     * llama a este contrato. Opcional y **aparte de `nombre`** (D-75): contrato y
     * fase siguen siendo la misma entidad, pero en obra se nombran distinto y
     * meter los dos nombres en un solo campo obligaba a elegir cuál se pierde.
     */
    fase: {
      type: String,
      default: null,
      trim: true,
      maxlength: [120, 'La fase no puede exceder 120 caracteres']
    },

    fechaInicio: {
      type: String,
      required: [true, 'La fecha de inicio es requerida'],
      validate: validadorFecha('La fecha de inicio')
    },
    fechaFin: {
      type: String,
      required: [true, 'La fecha de fin es requerida'],
      validate: validadorFecha('La fecha de fin')
    },

    /**
     * El total del contrato en pesos, **IVA incluido** (D-90). Un solo número: no
     * se desglosa subtotal ni impuesto, porque lo que se firma y lo que se cobra
     * es la cifra completa.
     *
     * **Sin `required` a propósito**, aunque el alta lo exija: los contratos
     * capturados antes de que el monto existiera no lo tienen, y un `required`
     * aquí haría fallar cualquier `save()` sobre ellos —registrar su SIROC,
     * finalizarlos— por un dato que nadie les pidió. `null` es «no se capturó», y
     * se distingue de `0`.
     */
    monto: campoMonto('El monto'),

    /**
     * Los términos con los que nació, `null` mientras nadie lo modifique (D-90).
     * Ver `terminosOriginalesSchema`.
     */
    original: { type: terminosOriginalesSchema, default: null },

    /**
     * Las modificaciones, en orden (D-90). **Las fechas y el monto de arriba son
     * siempre los VIGENTES** —los de la última modificación, o los del alta si no
     * hay ninguna—, y por eso el techo del SIROC (D-84), el expediente (D-77) y
     * los candados del proyecto (G3) no se enteran de que esto existe: siguen
     * leyendo los mismos campos de siempre.
     */
    modificaciones: { type: [modificacionSchema], default: [] },

    /** `null` hasta que se registre. Se pone y se corrige por `PUT .../siroc`. */
    siroc: { type: sirocSchema, default: null },

    /**
     * El contrato firmado, escaneado (D-81). Opcional y **reemplazable**: se
     * puede capturar el contrato en cuanto se conocen las fechas y adjuntar el
     * papel después, con el mismo `PATCH` de siempre. No se versiona (D-79): es
     * una copia del documento que respalda al registro, no un expediente.
     */
    archivo: { type: attachmentSchema, default: null },

    estado: {
      type: String,
      enum: { values: ['en_curso', 'finalizado'], message: 'Estado no válido' },
      default: 'en_curso'
    },

    /**
     * La baja, que **no es lo mismo que `estado`**: `finalizado` es un contrato
     * que terminó bien; `activo: false` es uno que se capturó por error o se
     * canceló. Se mueven por rutas distintas a propósito — ver D-70.
     */
    activo: { type: Boolean, default: true }
  },
  {
    timestamps: true,
    collection: 'contracts',
    toJSON: {
      versionKey: false,
      transform(doc, ret) {
        return {
          _id: ret._id.toString(),
          proyectoId: idAString(ret.proyectoId),
          numero: ret.numero,
          nombre: ret.nombre ?? null,
          fase: ret.fase ?? null,
          fechaInicio: ret.fechaInicio,
          fechaFin: ret.fechaFin,
          // Los VIGENTES. El pasado va en `historia` (D-90).
          monto: ret.monto ?? null,
          historia: construirHistoria(ret),
          siroc: ret.siroc
            ? {
                numero: ret.siroc.numero,
                fechaRegistro: ret.siroc.fechaRegistro,
                actualizaciones: (ret.siroc.actualizaciones ?? []).map((a) => ({
                  fecha: a.fecha,
                  nota: a.nota ?? null,
                  // `null` y no `0` en los reportes de antes de D-91: nadie los
                  // capturó, y una cifra inventada es peor que ninguna.
                  monto: a.monto ?? null,
                  bimestre: a.bimestre ?? null,
                  // Sin `url`: firmarla es asíncrono, y la agrega el servicio.
                  archivo: attachmentToJson(a.archivo)
                })),
                archivo: attachmentToJson(ret.siroc.archivo)
              }
            : null,
          // Sin `url`: firmarla es asíncrono, y la agrega el servicio.
          archivo: attachmentToJson(ret.archivo),
          estado: ret.estado,
          activo: ret.activo,
          createdAt: ret.createdAt,
          updatedAt: ret.updatedAt
        }
      }
    }
  }
)

contractSchema.index({ proyectoId: 1, numero: 1 }, { unique: true })
contractSchema.index({ proyectoId: 1, estado: 1 })

/*
 * SIROC único GLOBAL (G4). Parcial y por `$type: 'string'`, no `sparse`: el
 * contrato nace sin SIROC y `siroc` queda en `null`, así que el campo puede
 * existir valiendo nulo. `sparse` indexaría esos nulos y el segundo contrato sin
 * SIROC chocaría con el primero — la misma trampa que en el resto del modelo.
 */
contractSchema.index(
  { 'siroc.numero': 1 },
  { unique: true, partialFilterExpression: { 'siroc.numero': { $type: 'string' } } }
)

contractSchema.pre('validate', function forzarInvariantes(next) {
  if (
    isCalendarDate(this.fechaInicio) &&
    isCalendarDate(this.fechaFin) &&
    isBefore(this.fechaFin, this.fechaInicio)
  ) {
    this.invalidate('fechaFin', 'La fecha de fin no puede ser anterior a la de inicio')
  }

  /*
   * Cada modificación es un contrato en pequeño y se le exige lo mismo (D-90):
   * su fecha de fin no puede quedar antes de su inicio. Se comprueba aquí y no
   * sólo en el servicio porque el arreglo también lo tocan el deshacer y, algún
   * día, una migración.
   */
  for (const [indice, modificacion] of (this.modificaciones ?? []).entries()) {
    if (!isCalendarDate(modificacion?.fechaInicio)) continue
    if (!isCalendarDate(modificacion?.fechaFin)) continue

    if (isBefore(modificacion.fechaFin, modificacion.fechaInicio)) {
      this.invalidate(
        `modificaciones.${indice}.fechaFin`,
        'La fecha de fin no puede ser anterior a la de inicio'
      )
    }
  }

  /*
   * Las renovaciones van en orden y ninguna es anterior al registro del aviso
   * (D-76). Una fecha suelta hacia atrás desplazaría la ventana vigente y el
   * contrato empezaría a pedir actualizaciones que ya se hicieron.
   */
  const renovaciones = this.siroc?.actualizaciones ?? []
  let anterior = this.siroc?.fechaRegistro ?? null

  for (const [indice, renovacion] of renovaciones.entries()) {
    if (!isCalendarDate(renovacion?.fecha)) continue

    if (anterior && isBefore(renovacion.fecha, anterior)) {
      this.invalidate(
        `siroc.actualizaciones.${indice}.fecha`,
        indice === 0
          ? 'El reporte bimestral no puede ser anterior al registro del SIROC'
          : 'Los reportes bimestrales del SIROC deben ir en orden de fecha'
      )
    }
    anterior = renovacion.fecha
  }

  next()
})

module.exports = mongoose.model('Contract', contractSchema)
