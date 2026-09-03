const mongoose = require('mongoose')
const { isCalendarDate, isBefore } = require('../../../utils/dates')
const { idAString } = require('../../../utils/ids')

/**
 * Incidencia de una máquina: una falla, un golpe, un servicio (D-88).
 *
 * Cuatro datos y ninguno más: **de qué tipo** (del catálogo compartido), **qué
 * pasó** (texto libre), **cuándo pasó** y, si ya se atendió, **cuándo se
 * resolvió** con su nota. `fechaResolucion: null` es el estado «abierta»: no hay
 * bandera aparte que pueda contradecirlo.
 *
 * **Quién tenía la máquina y en qué obra NO se guarda aquí.** Se deriva al leer,
 * cruzando `fechaIncidencia` con los tramos de `machine_assignments` de esa
 * máquina (`utils/domain/machineIncidents`). Guardarlo sería teclear dos veces
 * lo mismo y, peor, mentiría en cuanto alguien corrigiera la historia: la regla
 * #6 del proyecto —nada derivado en la base— vale también aquí.
 *
 * `empresaId` sí se copia, y no es una excepción a lo anterior: es lo que decide
 * el ALCANCE sin tener que traer la máquina en cada consulta, igual que en los
 * tramos (D-87). Una máquina no cambia de empresa, así que no puede desfasarse.
 */
const machineIncidentSchema = new mongoose.Schema(
  {
    maquinaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Machine',
      required: [true, 'La máquina es requerida']
    },
    empresaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: [true, 'La empresa es requerida']
    },

    /**
     * El tipo, por referencia. Nunca copiado: renombrar el tipo corrige el
     * nombre en toda la historia, y darlo de baja no toca lo ya capturado.
     */
    tipoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'IncidentType',
      required: [true, 'El tipo de incidencia es requerido']
    },

    descripcion: {
      type: String,
      required: [true, 'La descripción de la incidencia es requerida'],
      trim: true,
      maxlength: [1000, 'La descripción no puede exceder 1000 caracteres']
    },

    /** Cuándo sucedió, que casi nunca es cuándo se capturó. */
    fechaIncidencia: {
      type: String,
      required: [true, 'La fecha de la incidencia es requerida'],
      validate: {
        validator: (v) => isCalendarDate(v),
        message: 'La fecha de la incidencia debe tener el formato AAAA-MM-DD'
      }
    },

    /** `null` = abierta. Es el único lugar donde se lee si sigue abierta. */
    fechaResolucion: {
      type: String,
      default: null,
      validate: {
        validator: (v) => v === null || isCalendarDate(v),
        message: 'La fecha de resolución debe tener el formato AAAA-MM-DD'
      }
    },
    notaResolucion: {
      type: String,
      default: null,
      trim: true,
      maxlength: [1000, 'La nota de resolución no puede exceder 1000 caracteres']
    }
  },
  {
    timestamps: true,
    collection: 'machine_incidents',
    toJSON: {
      versionKey: false,
      transform(doc, ret) {
        return {
          _id: ret._id.toString(),
          // `idAString`: `tipoId` llega populado en casi todas las consultas.
          maquinaId: idAString(ret.maquinaId),
          empresaId: idAString(ret.empresaId),
          tipoId: idAString(ret.tipoId),
          descripcion: ret.descripcion,
          fechaIncidencia: ret.fechaIncidencia,
          fechaResolucion: ret.fechaResolucion ?? null,
          notaResolucion: ret.notaResolucion ?? null,
          createdAt: ret.createdAt,
          updatedAt: ret.updatedAt
        }
      }
    }
  }
)

// La ficha de la máquina: sus incidencias de la más reciente a la más vieja.
// Sirve también al filtro de abiertas, que acota por `maquinaId` primero.
machineIncidentSchema.index({ maquinaId: 1, fechaIncidencia: -1 })
// Para saber si un tipo del catálogo se está usando antes de tocarlo.
machineIncidentSchema.index({ tipoId: 1 })

machineIncidentSchema.pre('validate', function forzarInvariantes(next) {
  // Resolver antes de que pasara es una fecha mal tecleada, no un dato válido.
  if (
    this.fechaResolucion &&
    isCalendarDate(this.fechaResolucion) &&
    isCalendarDate(this.fechaIncidencia) &&
    isBefore(this.fechaResolucion, this.fechaIncidencia)
  ) {
    this.invalidate(
      'fechaResolucion',
      'La fecha de resolución no puede ser anterior a la de la incidencia'
    )
  }

  // Una nota de resolución sin resolución no se sostiene: sería «qué se hizo»
  // de algo que sigue abierto.
  if (this.notaResolucion && !this.fechaResolucion) {
    this.invalidate('notaResolucion', 'Indica la fecha de resolución')
  }

  next()
})

module.exports = mongoose.model('MachineIncident', machineIncidentSchema)
