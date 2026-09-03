const mongoose = require('mongoose')
const { isCalendarDate, isBefore } = require('../../../utils/dates')
const { idAString } = require('../../../utils/ids')
const { MACHINE_RELEASE_REASONS } = require('../../../constants')

/**
 * Tramo de máquina: dónde está una máquina y quién la tiene, desde cuándo y
 * hasta cuándo (D-87).
 *
 * **La obra y el trabajador viven en el mismo documento, y el trabajador es
 * anulable.** Eso es lo que permite que la máquina pierda a la persona sin
 * salirse de la obra: cuando al operador lo dan de baja o sale de la obra, el
 * tramo se cierra y se abre otro en LA MISMA obra con `empleadoId: null`. Una
 * máquina no se teletransporta al patio porque su operador ya no esté; sólo una
 * devolución a mano la saca de ahí.
 *
 * Tres estados posibles de una máquina, y los tres se leen de aquí:
 *
 * | Estado                        | Cómo se ve                                  |
 * | ----------------------------- | ------------------------------------------- |
 * | En el patio, disponible       | sin tramo `activo`                          |
 * | En una obra, con trabajador   | tramo `activo` con `empleadoId`             |
 * | En una obra, sin trabajador   | tramo `activo` con `empleadoId: null`       |
 *
 * Cerrar **no borra**: la historia de la máquina —quién la usó, en qué obra y
 * cuánto tiempo— es la cadena de tramos, y los días se calculan al leer
 * (`utils/domain/machineTime`), nunca se guardan.
 */
const machineAssignmentSchema = new mongoose.Schema(
  {
    maquinaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Machine',
      required: [true, 'La máquina es requerida']
    },

    /**
     * La empresa de la máquina, copiada aquí a propósito: el alcance de las
     * máquinas de un trabajador —que puede estar adscrito a varias empresas— se
     * decide con esto sin tener que cruzar la máquina en cada consulta.
     */
    empresaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: [true, 'La empresa es requerida']
    },

    /** La obra. Nunca se captura: sale de la asignación del trabajador. */
    proyectoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: [true, 'El proyecto es requerido']
    },

    /** `null` = en la obra, sin trabajador. Ver el encabezado. */
    empleadoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      default: null
    },

    /**
     * La asignación del trabajador de la que este tramo tomó la obra. Es la
     * trazabilidad de «la máquina va donde va la persona», y queda en `null` en
     * los tramos sin trabajador.
     */
    asignacionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Assignment',
      default: null
    },

    fechaAsignacion: {
      type: String,
      required: [true, 'La fecha de asignación es requerida'],
      validate: {
        validator: (v) => isCalendarDate(v),
        message: 'La fecha de asignación debe tener el formato AAAA-MM-DD'
      }
    },
    fechaDevolucion: {
      type: String,
      default: null,
      validate: {
        validator: (v) => v === null || isCalendarDate(v),
        message: 'La fecha de devolución debe tener el formato AAAA-MM-DD'
      }
    },

    /** Por qué se cerró. Sólo en los tramos cerrados. */
    motivoCierre: {
      type: String,
      // Sin `null` en la lista: el validador de enum de Mongoose no corre sobre
      // un valor nulo, y meterlo ensuciaría el esqueleto con un valor vacío.
      enum: {
        values: [...MACHINE_RELEASE_REASONS],
        message: 'El motivo de cierre no es válido'
      },
      default: null
    },

    activo: { type: Boolean, default: true }
  },
  {
    timestamps: true,
    collection: 'machine_assignments',
    toJSON: {
      versionKey: false,
      transform(doc, ret) {
        return {
          _id: ret._id.toString(),
          // `idAString` y no `.toString()`: estos campos llegan populados en
          // casi todas las consultas de aquí.
          maquinaId: idAString(ret.maquinaId),
          empresaId: idAString(ret.empresaId),
          proyectoId: idAString(ret.proyectoId),
          empleadoId: idAString(ret.empleadoId),
          asignacionId: idAString(ret.asignacionId),
          fechaAsignacion: ret.fechaAsignacion,
          fechaDevolucion: ret.fechaDevolucion ?? null,
          motivoCierre: ret.motivoCierre ?? null,
          activo: ret.activo,
          createdAt: ret.createdAt,
          updatedAt: ret.updatedAt
        }
      }
    }
  }
)

/*
 * Índice PARCIAL sobre los tramos vigentes: **una máquina está con una sola
 * persona, en una sola obra, a la vez**. Es la regla del negocio impuesta por la
 * base, no sólo por el servicio, y a la vez permite el histórico —muchos tramos
 * cerrados de la misma máquina—, que un `unique` simple bloquearía.
 */
machineAssignmentSchema.index(
  { maquinaId: 1 },
  { unique: true, partialFilterExpression: { activo: true } }
)
// La historia de una máquina, de lo más reciente a lo más viejo.
machineAssignmentSchema.index({ maquinaId: 1, fechaAsignacion: -1 })
// Las máquinas que tiene un trabajador, y las que hay en una obra.
machineAssignmentSchema.index({ empleadoId: 1, activo: 1 })
machineAssignmentSchema.index({ proyectoId: 1, activo: 1 })

machineAssignmentSchema.pre('validate', function forzarInvariantes(next) {
  if (
    this.fechaDevolucion &&
    isCalendarDate(this.fechaDevolucion) &&
    isCalendarDate(this.fechaAsignacion) &&
    isBefore(this.fechaDevolucion, this.fechaAsignacion)
  ) {
    this.invalidate(
      'fechaDevolucion',
      'La fecha de devolución no puede ser anterior a la de asignación'
    )
  }

  // Un tramo cerrado dice cuándo y por qué: sin eso no se puede reconstruir
  // dónde estuvo la máquina ni por qué dejó de estar ahí.
  if (!this.activo && !this.fechaDevolucion) {
    this.invalidate('fechaDevolucion', 'Indica la fecha de devolución')
  }
  if (!this.activo && !this.motivoCierre) {
    this.invalidate('motivoCierre', 'Indica el motivo del cierre')
  }
  // Y uno vigente no puede traerlos: sería un tramo cerrado disfrazado.
  if (this.activo && (this.fechaDevolucion || this.motivoCierre)) {
    this.invalidate('activo', 'Un tramo vigente no lleva devolución ni motivo de cierre')
  }

  next()
})

module.exports = mongoose.model('MachineAssignment', machineAssignmentSchema)
