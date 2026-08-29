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
/**
 * Un registro de obra del cliente (D-66).
 *
 * Simétrico al registro patronal de la empresa (D-65) y por las mismas razones:
 * `numero` es el dato, el `_id` es lo que referencia el proyecto, y se dan de
 * baja con `activo` en vez de borrarse.
 *
 * **No confundirlo con el registro patronal.** El patronal pertenece a la
 * EMPRESA y da el contexto patronal del proyecto; éste pertenece al CLIENTE y es
 * el origen funcional de los SIROC. Son ramas distintas del modelo.
 */
const constructionRegistrationSchema = new mongoose.Schema({
  numero: {
    type: String,
    required: [true, 'El número de registro de obra es requerido'],
    trim: true,
    uppercase: true,
    minlength: [3, 'El registro de obra debe tener al menos 3 caracteres'],
    maxlength: [30, 'El registro de obra no puede exceder 30 caracteres']
  },
  /** Para distinguirlos cuando son varios: la obra, su ubicación… */
  descripcion: {
    type: String,
    trim: true,
    default: null,
    maxlength: [120, 'La descripción no puede exceder 120 caracteres']
  },
  activo: { type: Boolean, default: true }
})

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

    /**
     * Registros de obra del cliente. **Uno o varios** (D-66).
     *
     * Un proyecto elige exactamente uno de aquí, y de él cuelgan los SIROC de
     * sus contratos. No se exige ninguno: los clientes que ya existen no los
     * tienen y obligarlo dejaría inválido lo que ya está guardado.
     */
    registrosObra: { type: [constructionRegistrationSchema], default: [] },

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
          // Mismo blindaje que en empresas (D-68), por simetría: un registro sin
          // número no es un registro, y el contrato promete `numero: string`.
          registrosObra: (ret.registrosObra || [])
            .filter((r) => r && r.numero)
            .map((r) => ({
              _id: r._id.toString(),
              numero: r.numero,
              descripcion: r.descripcion ?? null,
              activo: r.activo
            })),
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
/*
 * El número no se repite DENTRO del cliente (D-66). En el modelo y no en el
 * servicio, para que valga por cualquier camino. Entre clientes distintos no se
 * bloquea, mismo criterio que los registros patronales.
 */
clientSchema.pre('validate', function registrosObraSinRepetir(next) {
  const numeros = (this.registrosObra || []).map((r) =>
    String(r.numero || '')
      .trim()
      .toUpperCase()
  )
  const repetido = numeros.find((n, i) => n && numeros.indexOf(n) !== i)
  if (repetido) {
    this.invalidate(
      'registrosObra',
      `El registro de obra ${repetido} ya está en este cliente`
    )
  }
  next()
})

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
