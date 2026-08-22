const mongoose = require('mongoose')
const { AREAS, CONTRACT_TYPES, isTemporaryContract } = require('../../../constants')
const { isCalendarDate, isAfter } = require('../../../utils/dates')

/**
 * Adscripción: el vínculo empresa ↔ empleado (modelo-datos §5b.1).
 *
 * **Aquí vive la relación laboral**, no en el empleado: contrato, fecha de
 * ingreso, áreas dentro de esa empresa y su propia baja. Una persona puede ser
 * administrativa indeterminada en una empresa y de obra determinada en otra.
 *
 * Es también la pieza de la que depende TODO el alcance: lo que un usuario ve se
 * deriva de sus adscripciones activas (modelo-datos §8.1).
 */
const affiliationSchema = new mongoose.Schema(
  {
    empresaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: [true, 'La empresa es requerida']
    },
    empleadoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'El empleado es requerido']
    },

    /** Áreas DENTRO de esta empresa. Un administrativo necesita al menos una. */
    areas: {
      type: [{ type: String, enum: { values: AREAS, message: 'Área no válida' } }],
      default: []
    },

    tipoContrato: {
      type: String,
      enum: { values: CONTRACT_TYPES, message: 'Selecciona un tipo de contrato válido' },
      required: [true, 'El tipo de contrato es requerido']
    },
    fechaIngreso: {
      type: String,
      required: [true, 'La fecha de ingreso es requerida'],
      validate: {
        validator: (v) => isCalendarDate(v),
        message: 'La fecha de ingreso debe tener el formato AAAA-MM-DD'
      }
    },
    fechaTerminoContrato: {
      type: String,
      default: null,
      validate: {
        validator: (v) => v === null || isCalendarDate(v),
        message: 'La fecha de término debe tener el formato AAAA-MM-DD'
      }
    },

    /** Baja de ESTA empresa. No implica baja del sistema ni borra su expediente. */
    activo: { type: Boolean, default: true },
    motivoBaja: { type: String, trim: true, default: null },
    fechaBaja: {
      type: String,
      default: null,
      validate: {
        validator: (v) => v === null || isCalendarDate(v),
        message: 'La fecha de baja debe tener el formato AAAA-MM-DD'
      }
    }
  },
  {
    timestamps: true,
    collection: 'affiliations',
    toJSON: {
      versionKey: false,
      transform(doc, ret) {
        return {
          _id: ret._id.toString(),
          empresaId: ret.empresaId ? ret.empresaId.toString() : null,
          empleadoId: ret.empleadoId ? ret.empleadoId.toString() : null,
          areas: ret.areas || [],
          tipoContrato: ret.tipoContrato,
          fechaIngreso: ret.fechaIngreso,
          fechaTerminoContrato: ret.fechaTerminoContrato ?? null,
          activo: ret.activo,
          motivoBaja: ret.motivoBaja ?? null,
          fechaBaja: ret.fechaBaja ?? null,
          createdAt: ret.createdAt,
          updatedAt: ret.updatedAt
        }
      }
    }
  }
)

// ─── Índices (modelo-datos §7) ────────────────────────────────────────────────
// Única por par: si alguien vuelve a la misma empresa, se REACTIVA la adscripción
// existente; no se crea otra.
affiliationSchema.index({ empresaId: 1, empleadoId: 1 }, { unique: true })
affiliationSchema.index({ empresaId: 1, activo: 1, areas: 1 })
affiliationSchema.index({ empleadoId: 1, activo: 1 })

affiliationSchema.pre('validate', function forzarInvariantes(next) {
  if (isTemporaryContract(this.tipoContrato)) {
    if (!this.fechaTerminoContrato) {
      this.invalidate(
        'fechaTerminoContrato',
        'Un contrato temporal necesita fecha de término'
      )
    } else if (
      isCalendarDate(this.fechaTerminoContrato) &&
      isCalendarDate(this.fechaIngreso) &&
      !isAfter(this.fechaTerminoContrato, this.fechaIngreso)
    ) {
      this.invalidate(
        'fechaTerminoContrato',
        'La fecha de término debe ser posterior a la fecha de ingreso'
      )
    }
  } else if (this.fechaTerminoContrato) {
    this.fechaTerminoContrato = null
  }

  if (!this.activo && !this.motivoBaja) {
    this.invalidate('motivoBaja', 'Indica el motivo de la baja')
  }
  if (this.activo) {
    this.motivoBaja = null
    this.fechaBaja = null
  }

  next()
})

module.exports = mongoose.model('Affiliation', affiliationSchema)
