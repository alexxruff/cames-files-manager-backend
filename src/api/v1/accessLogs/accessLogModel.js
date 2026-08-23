const mongoose = require('mongoose')
const { AUDIT_ACTIONS, DOCUMENT_TYPES } = require('../../../constants')
const { idAString } = require('../../../utils/ids')

/**
 * Bitácora de accesos a documentos (modelo-datos §5.8).
 *
 * **Es un requisito legal, no un extra**: un expediente laboral contiene INE,
 * CURP, NSS y examen médico, que son datos personales sensibles bajo la LFPDPPP.
 * Hay que poder responder quién abrió qué y cuándo.
 *
 * Se escribe en **cada emisión de URL firmada** y en cada exportación de reporte.
 * Nunca se borra ni se edita: sólo se agrega.
 */
const accessLogSchema = new mongoose.Schema(
  {
    empleadoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true
    },
    /** El NOMBRE de quien consultó, para que el registro siga legible. */
    usuarioNombre: { type: String, required: true },

    accion: { type: String, enum: AUDIT_ACTIONS, required: true },

    /** Sobre qué expediente y documento. Nulos en una exportación de reporte. */
    expedienteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Record',
      default: null
    },
    sujetoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      default: null
    },
    sujetoNombre: { type: String, default: null },
    tipoDocumento: { type: String, enum: [...DOCUMENT_TYPES, null], default: null },
    version: { type: Number, default: null },

    ip: { type: String, default: null },
    userAgent: { type: String, default: null }
  },
  {
    timestamps: true,
    collection: 'access_logs',
    toJSON: {
      versionKey: false,
      transform(doc, ret) {
        return {
          _id: ret._id.toString(),
          empleadoId: idAString(ret.empleadoId),
          usuarioNombre: ret.usuarioNombre,
          accion: ret.accion,
          expedienteId: idAString(ret.expedienteId),
          sujetoId: idAString(ret.sujetoId),
          sujetoNombre: ret.sujetoNombre ?? null,
          tipoDocumento: ret.tipoDocumento ?? null,
          version: ret.version ?? null,
          ip: ret.ip ?? null,
          createdAt: ret.createdAt
        }
      }
    }
  }
)

accessLogSchema.index({ expedienteId: 1, createdAt: -1 })
accessLogSchema.index({ empleadoId: 1, createdAt: -1 })

module.exports = mongoose.model('AccessLog', accessLogSchema)
