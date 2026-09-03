const mongoose = require('mongoose')
const attachmentSchema = require('../../../models/attachmentSchema')
const { attachmentToJson } = require('../../../utils/attachments')
const { idAString } = require('../../../utils/ids')
const { normalize } = require('../../../utils/text')

/**
 * Máquina: una unidad del catálogo de **maquinaria y equipo de trabajo** de una
 * empresa (D-86).
 *
 * Es de la empresa, no del grupo: la excavadora de Maquinaria CAMES no está en
 * el patio de Urbanizadora, y el identificador con el que cada empresa conoce a
 * sus máquinas —número económico, placa, serie— sólo tiene sentido dentro de
 * ella. Por eso `empresaId` es obligatorio y la unicidad es **por empresa**.
 *
 * Tres datos, a propósito: identificador, modelo e imagen. Marca, tipo, serie y
 * los papeles de la máquina entran después si hacen falta, como campos nuevos,
 * sin rehacer nada. Dónde está y quién la tiene NO vive aquí: es la asignación
 * (tarea #31), que se resuelve al leer.
 */
const machineSchema = new mongoose.Schema(
  {
    empresaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: [true, 'La empresa es requerida']
    },

    /**
     * Con qué número la conoce la empresa. Lo teclea quien la da de alta y se
     * conserva tal cual; la unicidad se decide sobre la forma normalizada, así
     * que `eco-12` y `ECO 12` son la misma máquina.
     */
    identificador: {
      type: String,
      required: [true, 'El identificador de la máquina es requerido'],
      trim: true,
      maxlength: [60, 'El identificador no puede exceder 60 caracteres']
    },
    identificadorNormalizado: { type: String, select: false, default: '' },

    modelo: {
      type: String,
      required: [true, 'El modelo de la máquina es requerido'],
      trim: true,
      maxlength: [120, 'El modelo no puede exceder 120 caracteres']
    },
    /** Para que «camion» encuentre «Camión»: la búsqueda va contra esto. */
    modeloNormalizado: { type: String, select: false, default: '' },

    /**
     * La foto de la máquina. Opcional y **reemplazable** (D-79): una sola, y
     * poner otra borra la anterior. Sólo se aceptan imágenes: es para verla,
     * no un papel que la respalde.
     */
    imagen: { type: attachmentSchema, default: null },

    /** La baja. Una máquina de baja no se asigna y no se lista salvo que se pida. */
    activo: { type: Boolean, default: true }
  },
  {
    timestamps: true,
    collection: 'machines',
    toJSON: {
      versionKey: false,
      transform(doc, ret) {
        return {
          _id: ret._id.toString(),
          empresaId: idAString(ret.empresaId),
          identificador: ret.identificador,
          modelo: ret.modelo,
          // Sin `url`: firmarla es asíncrono, y la agrega el servicio.
          imagen: attachmentToJson(ret.imagen),
          activo: ret.activo,
          createdAt: ret.createdAt,
          updatedAt: ret.updatedAt
        }
      }
    }
  }
)

// Identificador único DENTRO de la empresa: dos empresas pueden tener cada una
// su «ECO-12».
machineSchema.index({ empresaId: 1, identificadorNormalizado: 1 }, { unique: true })
// El listado del catálogo: las vivas de una empresa, por identificador.
machineSchema.index({ empresaId: 1, activo: 1, identificador: 1 })

machineSchema.pre('validate', function forzarInvariantes(next) {
  if (this.identificador) this.identificadorNormalizado = normalize(this.identificador)
  if (this.modelo) this.modeloNormalizado = normalize(this.modelo)
  next()
})

module.exports = mongoose.model('Machine', machineSchema)
