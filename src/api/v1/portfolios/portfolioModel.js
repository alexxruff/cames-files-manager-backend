const mongoose = require('mongoose')
const { idAString } = require('../../../utils/ids')

/**
 * Cartera: el vínculo empresa ↔ cliente (modelo-datos §5b.2).
 *
 * Qué clientes del catálogo global usa cada empresa. Existe y no se deduce de
 * los proyectos por tres razones:
 *
 * 1. Hay que poder registrar un cliente en la empresa **antes** de tener un
 *    proyecto con él — y crear un proyecto exige cliente en cartera, así que si
 *    no, el flujo no cierra.
 * 2. La relación tiene datos propios: el contacto puede ser distinto por empresa.
 * 3. Un `distinct` sobre proyectos para pintar un selector es una consulta cara
 *    que se repite en cada pantalla.
 */
const portfolioSchema = new mongoose.Schema(
  {
    empresaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: [true, 'La empresa es requerida']
    },
    clienteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      required: [true, 'El cliente es requerido']
    },

    /** Datos de la relación, que pueden diferir de los del catálogo. */
    contactoNombre: { type: String, trim: true, default: null },
    contactoEmail: { type: String, lowercase: true, trim: true, default: null },
    contactoTelefono: { type: String, trim: true, default: null },
    notas: { type: String, trim: true, default: null, maxlength: 500 },

    activo: { type: Boolean, default: true }
  },
  {
    timestamps: true,
    collection: 'portfolios',
    toJSON: {
      versionKey: false,
      transform(doc, ret) {
        return {
          _id: ret._id.toString(),
          empresaId: idAString(ret.empresaId),
          clienteId: idAString(ret.clienteId),
          contactoNombre: ret.contactoNombre ?? null,
          contactoEmail: ret.contactoEmail ?? null,
          contactoTelefono: ret.contactoTelefono ?? null,
          notas: ret.notas ?? null,
          activo: ret.activo,
          createdAt: ret.createdAt,
          updatedAt: ret.updatedAt
        }
      }
    }
  }
)

// Un cliente sólo puede estar una vez en la cartera de una empresa. Si se saca y
// se vuelve a meter, se REACTIVA el vínculo existente.
portfolioSchema.index({ empresaId: 1, clienteId: 1 }, { unique: true })
portfolioSchema.index({ empresaId: 1, activo: 1 })

module.exports = mongoose.model('Portfolio', portfolioSchema)
