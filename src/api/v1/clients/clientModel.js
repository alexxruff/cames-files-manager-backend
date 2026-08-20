const mongoose = require('mongoose')
const { DOCUMENT_TYPES } = require('../../../constants')

/**
 * Cliente (spec 6.1). FASE 2: la colección se crea desde ahora aunque quede
 * vacía, para que el `clienteId` de las demás colecciones tenga a qué apuntar
 * y activar el multi-cliente no exija migrar datos.
 *
 * `clienteId: null` en cualquier otra colección significa "pertenece a
 * Urbacames" (la casa). No existe un "cliente Urbacames" en esta colección: un
 * cliente ficticio habría que sembrarlo, referenciarlo en cada alta y tratarlo
 * distinto en los permisos.
 *
 * No hay rutas todavía: `GET/POST/PATCH /clientes` están reservadas en el spec
 * 9.8 y no se implementan en fase 1.
 */
const clientSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true, trim: true, maxlength: 120 },
    rfc: { type: String, trim: true, uppercase: true, maxlength: 13 },

    contactoNombre: { type: String, trim: true, default: null },
    contactoEmail: { type: String, trim: true, lowercase: true, default: null },
    contactoTelefono: { type: String, trim: true, default: null },

    // Declarados desde ya: agregarlos después obligaría a migrar.
    branding: {
      nombreComercial: { type: String, default: null },
      logoUrl: { type: String, default: null },
      colorPrimario: { type: String, default: null }
    },
    configuracion: {
      /** Si viene, pisa el `DIAS_ALERTA_VENCIMIENTO` global. */
      diasAlertaVencimiento: { type: Number, min: 1, max: 365, default: null },
      /** Si viene, pisa la lista global de documentos sensibles. */
      documentosSensibles: {
        type: [{ type: String, enum: DOCUMENT_TYPES }],
        default: null
      }
    },

    activo: { type: Boolean, default: true }
  },
  {
    timestamps: true,
    collection: 'clients',
    toJSON: {
      versionKey: false,
      transform(doc, ret) {
        ret._id = ret._id.toString()
        return ret
      }
    }
  }
)

clientSchema.index({ activo: 1, nombre: 1 })

module.exports = mongoose.model('Client', clientSchema)
