const mongoose = require('mongoose')
const { isCalendarDate, isBefore } = require('../../../utils/dates')
const { idAString } = require('../../../utils/ids')

/**
 * Asignación: el vínculo proyecto ↔ empleado (modelo-datos §5b.3).
 *
 * Quitar a alguien **no borra**: se cierra con `fechaSalida` y `activo: false`.
 * Hay que poder responder quién estaba en la obra el día de un accidente.
 */
const assignmentSchema = new mongoose.Schema(
  {
    proyectoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: [true, 'El proyecto es requerido']
    },
    empleadoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'El empleado es requerido']
    },

    /** Su rol EN ESTE proyecto. Puede diferir de su categoría base. */
    categoriaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'La categoría es requerida']
    },

    fechaAsignacion: {
      type: String,
      required: [true, 'La fecha de asignación es requerida'],
      validate: {
        validator: (v) => isCalendarDate(v),
        message: 'La fecha de asignación debe tener el formato AAAA-MM-DD'
      }
    },
    fechaSalida: {
      type: String,
      default: null,
      validate: {
        validator: (v) => v === null || isCalendarDate(v),
        message: 'La fecha de salida debe tener el formato AAAA-MM-DD'
      }
    },

    activo: { type: Boolean, default: true }
  },
  {
    timestamps: true,
    collection: 'assignments',
    toJSON: {
      versionKey: false,
      transform(doc, ret) {
        return {
          _id: ret._id.toString(),
          // `idAString` y no `.toString()`: estos campos llegan populados en
          // varias consultas, y ahí `.toString()` daría "[object Object]".
          proyectoId: idAString(ret.proyectoId),
          empleadoId: idAString(ret.empleadoId),
          categoriaId: idAString(ret.categoriaId),
          fechaAsignacion: ret.fechaAsignacion,
          fechaSalida: ret.fechaSalida ?? null,
          activo: ret.activo,
          createdAt: ret.createdAt,
          updatedAt: ret.updatedAt
        }
      }
    }
  }
)

/*
 * Índice PARCIAL sobre las activas, y ahí está la parte fina: permite el
 * histórico —varias asignaciones cerradas del mismo par— e impide el duplicado
 * activo. Un `unique` simple bloquearía la reincorporación de alguien que ya
 * estuvo en esa obra.
 */
assignmentSchema.index(
  { proyectoId: 1, empleadoId: 1 },
  { unique: true, partialFilterExpression: { activo: true } }
)
assignmentSchema.index({ proyectoId: 1, activo: 1 })
assignmentSchema.index({ empleadoId: 1, activo: 1 })

assignmentSchema.pre('validate', function forzarInvariantes(next) {
  if (
    this.fechaSalida &&
    isCalendarDate(this.fechaSalida) &&
    isCalendarDate(this.fechaAsignacion) &&
    isBefore(this.fechaSalida, this.fechaAsignacion)
  ) {
    this.invalidate(
      'fechaSalida',
      'La fecha de salida no puede ser anterior a la de asignación'
    )
  }

  // Cerrar una asignación exige fecha de salida: sin ella no se puede responder
  // quién estaba en la obra en una fecha dada.
  if (!this.activo && !this.fechaSalida) {
    this.invalidate('fechaSalida', 'Indica la fecha de salida')
  }

  next()
})

module.exports = mongoose.model('Assignment', assignmentSchema)
