const mongoose = require('mongoose')
const { normalize } = require('../../../utils/text')

/**
 * Tipo de incidencia de maquinaria — catálogo **compartido del grupo** (D-88).
 *
 * Del grupo y no de cada empresa, como clientes, categorías y áreas: «falla
 * hidráulica» es lo mismo en Maquinaria CAMES que en Urbanizadora, y un catálogo
 * por empresa obligaría a alimentar la misma lista dos veces para que después
 * los reportes no puedan sumarse.
 *
 * Sólo un nombre, a propósito: la incidencia lleva la descripción libre, y este
 * catálogo existe para poder AGRUPAR —cuántas fallas hidráulicas van este mes—,
 * no para describir. Si algún día hace falta color o gravedad, entran como
 * campos nuevos sin rehacer nada.
 *
 * **Un tipo dado de baja no desaparece de las incidencias viejas.** Se referencia
 * por id: dejar de ofrecerlo en el desplegable no borra lo ya capturado, y
 * renombrarlo corrige el nombre en toda la historia, que es justo lo que se
 * espera de una corrección.
 */
const incidentTypeSchema = new mongoose.Schema(
  {
    nombre: {
      type: String,
      required: [true, 'El nombre del tipo de incidencia es requerido'],
      trim: true,
      maxlength: [80, 'El nombre no puede exceder 80 caracteres']
    },
    /** La unicidad se decide aquí: «Falla Hidráulica» y «falla hidraulica» son uno. */
    nombreNormalizado: { type: String, select: false, default: '' },

    /** Los sembrados. No se pueden dar de baja, como las áreas y categorías base. */
    esBase: { type: Boolean, default: false },
    activo: { type: Boolean, default: true }
  },
  {
    timestamps: true,
    collection: 'incident_types',
    toJSON: {
      versionKey: false,
      transform(doc, ret) {
        return {
          _id: ret._id.toString(),
          nombre: ret.nombre,
          esBase: ret.esBase,
          activo: ret.activo,
          createdAt: ret.createdAt,
          updatedAt: ret.updatedAt
        }
      }
    }
  }
)

incidentTypeSchema.index({ nombreNormalizado: 1 }, { unique: true })
incidentTypeSchema.index({ activo: 1, nombre: 1 })

incidentTypeSchema.pre('validate', function normalizarNombre(next) {
  if (this.nombre) this.nombreNormalizado = normalize(this.nombre)
  next()
})

module.exports = mongoose.model('IncidentType', incidentTypeSchema)
