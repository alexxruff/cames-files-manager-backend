const mongoose = require('mongoose')
const { isCalendarDate, isBefore } = require('../../../utils/dates')
const { idAString } = require('../../../utils/ids')
const attachmentSchema = require('../../../models/attachmentSchema')
const { attachmentToJson } = require('../../../utils/attachments')

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
          siroc: ret.siroc
            ? {
                numero: ret.siroc.numero,
                fechaRegistro: ret.siroc.fechaRegistro,
                actualizaciones: (ret.siroc.actualizaciones ?? []).map((a) => ({
                  fecha: a.fecha,
                  nota: a.nota ?? null,
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
