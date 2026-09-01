const mongoose = require('mongoose')
const { isCalendarDate, isBefore } = require('../../../utils/dates')
const { idAString } = require('../../../utils/ids')

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
    fechaRegistro: {
      type: String,
      required: [true, 'La fecha de registro del SIROC es requerida'],
      validate: validadorFecha('La fecha de registro')
    },
    /** Cuándo vence el aviso. Puede no conocerse al registrarlo. */
    vigenciaHasta: {
      type: String,
      default: null,
      validate: validadorFecha('La vigencia')
    }
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
                vigenciaHasta: ret.siroc.vigenciaHasta ?? null
              }
            : null,
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

  if (
    this.siroc?.vigenciaHasta &&
    isCalendarDate(this.siroc.vigenciaHasta) &&
    isCalendarDate(this.siroc.fechaRegistro) &&
    isBefore(this.siroc.vigenciaHasta, this.siroc.fechaRegistro)
  ) {
    this.invalidate(
      'siroc.vigenciaHasta',
      'La vigencia del SIROC no puede ser anterior a su fecha de registro'
    )
  }

  next()
})

module.exports = mongoose.model('Contract', contractSchema)
