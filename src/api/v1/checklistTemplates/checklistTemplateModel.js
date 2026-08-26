const mongoose = require('mongoose')
const { CONTRACT_TYPES, DOCUMENT_TYPES } = require('../../../constants')
const { idAString } = require('../../../utils/ids')

/**
 * Plantilla de checklist: qué documentos exige cada tipo de expediente
 * (spec 6.5).
 *
 * `clave` no está en el spec y se agregó a propósito: la resolución de plantilla
 * necesita una red de seguridad estable (`plantilla-general`) y el sembrado
 * necesita ser idempotente. Con `_id` de Mongo no hay identificador predecible
 * entre ambientes; con `clave` sí. Ver D-24.
 */

const rowSchema = new mongoose.Schema(
  {
    tipo: {
      type: String,
      enum: { values: DOCUMENT_TYPES, message: 'Tipo de documento no válido' },
      required: true
    },
    requerido: { type: Boolean, required: true },
    /** Meses de vigencia. Sólo tiene sentido en documentos que caducan. */
    vigenciaMeses: { type: Number, min: 1, max: 60, default: null }
  },
  { _id: false }
)

const checklistTemplateSchema = new mongoose.Schema(
  {
    clave: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
      match: [/^[a-z0-9-]+$/, 'La clave sólo admite minúsculas, números y guiones']
    },

    nombre: { type: String, required: [true, 'El nombre es requerido'], trim: true },
    descripcion: { type: String, default: '' },

    tiposContrato: {
      type: [{ type: String, enum: CONTRACT_TYPES }],
      required: true
    },
    /** `null` = aplica a todas las áreas. Una lista la vuelve más específica. */
    // Sin `enum`: el catálogo de áreas es una colección desde D-58.
    areas: { type: [{ type: String, trim: true }], default: null },

    documentos: { type: [rowSchema], required: true },

    /** Las plantillas base vienen sembradas y no se pueden borrar. */
    esBase: { type: Boolean, default: false },

    /**
     * `null` = plantilla global, aplica a todas las empresas. Con empresa, es más
     * específica y gana en la resolución (modelo-datos §6.2).
     */
    empresaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      default: null
    },

    activo: { type: Boolean, default: true }
  },
  {
    timestamps: true,
    collection: 'checklist_templates',
    toJSON: {
      versionKey: false,
      transform(doc, ret) {
        return {
          _id: ret._id.toString(),
          clave: ret.clave ?? null,
          nombre: ret.nombre,
          descripcion: ret.descripcion ?? '',
          tiposContrato: ret.tiposContrato,
          areas: ret.areas && ret.areas.length > 0 ? ret.areas : null,
          documentos: (ret.documentos || []).map((d) => ({
            tipo: d.tipo,
            requerido: d.requerido,
            vigenciaMeses: d.vigenciaMeses ?? null
          })),
          esBase: ret.esBase,
          activo: ret.activo,
          empresaId: idAString(ret.empresaId),
          createdAt: ret.createdAt,
          updatedAt: ret.updatedAt
        }
      }
    }
  }
)

/*
 * Resolución de plantilla.
 *
 * DESVIACIÓN DEL SPEC 6.7, obligada: allí se sugiere
 * `{ empresaId: 1, tiposContrato: 1, areas: 1 }`, pero MongoDB no puede indexar
 * dos arreglos en el mismo índice compuesto ("cannot index parallel arrays"), y
 * `tiposContrato` y `areas` son los dos arreglos. Se indexa por tipo de contrato,
 * que es el filtro que descarta más, y el área se resuelve en memoria: son un
 * puñado de plantillas y `resolveTemplate` ya recibe la lista completa. Ver D-26.
 */
checklistTemplateSchema.index({ empresaId: 1, tiposContrato: 1 })
checklistTemplateSchema.index(
  { empresaId: 1, clave: 1 },
  { unique: true, partialFilterExpression: { clave: { $type: 'string' } } }
)

checklistTemplateSchema.pre('validate', function validarDocumentos(next) {
  if (!this.tiposContrato || this.tiposContrato.length === 0) {
    this.invalidate('tiposContrato', 'Indica al menos un tipo de contrato')
  }

  if (!this.documentos || this.documentos.length === 0) {
    this.invalidate('documentos', 'La plantilla necesita al menos un documento')
  } else if (!this.documentos.some((d) => d.requerido)) {
    // Sin requeridos, todo expediente nacería completo y el semáforo mentiría.
    this.invalidate('documentos', 'La plantilla necesita al menos un documento requerido')
  }

  // Una lista de áreas vacía significa "todas", igual que null.
  if (Array.isArray(this.areas) && this.areas.length === 0) this.areas = null

  next()
})

module.exports = mongoose.model('ChecklistTemplate', checklistTemplateSchema)
