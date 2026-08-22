const mongoose = require('mongoose')
const { EMPLOYEE_TYPES } = require('../../../constants')
const { normalize } = require('../../../utils/text')

/**
 * Categoría (puesto) — catálogo compartido (modelo-datos §5.4).
 *
 * Global y no por empresa: el empleado es global y lleva una `categoriaId`; con
 * un catálogo por empresa, alguien adscrito a dos tendría un puesto ambiguo.
 *
 * `tipo` NO está en modelo-datos §5.4: lo pidió el front para poblar el
 * desplegable del alta según el tipo de persona que se está capturando
 * (`GET /categorias?tipo=mano_de_obra`). "Auxiliar contable" no es un puesto de
 * obra y ofrecerlo ahí sólo genera capturas mal hechas. Ver D-32.
 */
const categorySchema = new mongoose.Schema(
  {
    nombre: {
      type: String,
      required: [true, 'El nombre de la categoría es requerido'],
      trim: true,
      maxlength: [80, 'El nombre no puede exceder 80 caracteres']
    },
    /** Para qué tipo de persona aplica este puesto. */
    tipo: {
      type: String,
      enum: { values: EMPLOYEE_TYPES, message: 'Selecciona un tipo válido' },
      required: [true, 'El tipo de la categoría es requerido']
    },

    /** Las sembradas no se pueden desactivar. */
    esBase: { type: Boolean, default: false },
    activo: { type: Boolean, default: true },

    nombreNormalizado: { type: String, select: false, default: '' }
  },
  {
    timestamps: true,
    collection: 'categories',
    toJSON: {
      versionKey: false,
      transform(doc, ret) {
        return {
          _id: ret._id.toString(),
          nombre: ret.nombre,
          tipo: ret.tipo,
          esBase: ret.esBase,
          activo: ret.activo,
          createdAt: ret.createdAt,
          updatedAt: ret.updatedAt
        }
      }
    }
  }
)

// Unicidad sobre el normalizado: "Residente de Obra" y "residente de obra" son
// la misma categoría. Es lo que hace posible el POST idempotente por nombre.
categorySchema.index({ nombreNormalizado: 1 }, { unique: true })
categorySchema.index({ tipo: 1, activo: 1 })

categorySchema.pre('validate', function normalizarNombre(next) {
  if (this.nombre) this.nombreNormalizado = normalize(this.nombre)
  next()
})

module.exports = mongoose.model('Category', categorySchema)
