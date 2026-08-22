const mongoose = require('mongoose')
const { normalize } = require('../../../utils/text')

/**
 * Cliente — catálogo compartido (modelo-datos §5.3).
 *
 * NO pertenece a ninguna empresa: es el mismo cliente para todo el grupo. Qué
 * empresa lo usa se registra en `carteras` (empresa ↔ cliente), y los datos de
 * contacto que difieren por empresa viven ahí, no aquí.
 *
 * El branding y la configuración que este modelo tenía antes se mudaron a
 * `empresas`: el cliente ya no es el eje multi-inquilino.
 */
const clientSchema = new mongoose.Schema(
  {
    nombre: {
      type: String,
      required: [true, 'El nombre del cliente es requerido'],
      trim: true,
      maxlength: [160, 'El nombre no puede exceder 160 caracteres']
    },
    rfc: {
      type: String,
      uppercase: true,
      trim: true,
      default: null,
      // Persona moral (12) o física (13).
      match: [/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, 'El RFC no tiene un formato válido']
    },

    contactoNombre: { type: String, trim: true, default: null },
    contactoEmail: { type: String, lowercase: true, trim: true, default: null },
    contactoTelefono: { type: String, trim: true, default: null },

    activo: { type: Boolean, default: true },

    nombreNormalizado: { type: String, select: false, default: '' }
  },
  {
    timestamps: true,
    collection: 'clients',
    toJSON: {
      versionKey: false,
      transform(doc, ret) {
        return {
          _id: ret._id.toString(),
          nombre: ret.nombre,
          rfc: ret.rfc ?? null,
          contactoNombre: ret.contactoNombre ?? null,
          contactoEmail: ret.contactoEmail ?? null,
          contactoTelefono: ret.contactoTelefono ?? null,
          activo: ret.activo,
          createdAt: ret.createdAt,
          updatedAt: ret.updatedAt
        }
      }
    }
  }
)

// Único GLOBALMENTE y por nombre normalizado: tener dos veces al mismo cliente
// rompe el propósito del catálogo compartido.
clientSchema.index({ nombreNormalizado: 1 }, { unique: true })
clientSchema.index({ activo: 1 })
/*
 * RFC único cuando viene. Parcial y no `sparse`: con `default: null` el campo
 * existe en el documento, así que un índice disperso no lo omitiría y dos
 * clientes sin RFC colisionarían.
 */
clientSchema.index(
  { rfc: 1 },
  { unique: true, partialFilterExpression: { rfc: { $type: 'string' } } }
)

clientSchema.pre('validate', function normalizarNombre(next) {
  if (this.nombre) this.nombreNormalizado = normalize(this.nombre)
  next()
})

clientSchema.pre(['findOneAndUpdate', 'updateOne'], function normalizarEnUpdate(next) {
  const update = this.getUpdate() || {}
  const nombre = update.nombre ?? update.$set?.nombre
  if (nombre) {
    this.setUpdate({
      ...update,
      $set: { ...(update.$set || {}), nombreNormalizado: normalize(nombre) }
    })
  }
  next()
})

module.exports = mongoose.model('Client', clientSchema)
