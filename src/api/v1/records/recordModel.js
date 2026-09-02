const mongoose = require('mongoose')
const {
  DOCUMENT_TYPES,
  STORED_DOCUMENT_STATUSES,
  VERSION_STATUSES
} = require('../../../constants')
const { isCalendarDate } = require('../../../utils/dates')
const { idAString, idsAString } = require('../../../utils/ids')
const { esPrevisualizable } = require('../../../utils/fileTypes')

/**
 * Expediente (modelo-datos §5.6). **Uno por empleado**, con el checklist
 * embebido.
 *
 * Es de la PERSONA, no de su empleo: alguien que trabaja para dos empresas del
 * grupo tiene un solo expediente, y su checklist es la **unión** de lo que exigen
 * las plantillas de sus adscripciones (§6.2). Su INE es su INE en las dos.
 *
 * Por qué el checklist va embebido y no en su propia colección: son 12
 * documentos con unas pocas versiones, siempre se leen y se escriben completos, y
 * nunca se consulta un documento fuera de su expediente.
 */

const validadorFecha = {
  validator: (v) => v === null || isCalendarDate(v),
  message: 'La fecha debe tener el formato AAAA-MM-DD y ser una fecha real'
}

const archivoSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true }, // el original, para mostrar
    mime: { type: String, required: true },
    tamanoBytes: { type: Number, required: true },
    /** El NOMBRE de quien subió, no sólo su id: es histórico y debe seguir legible. */
    subidoPor: { type: String, required: true },
    subidoPorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    subidoEn: { type: Date, required: true },
    /**
     * Ubicación real en el almacenamiento. **Interna: nunca se expone.** Quien
     * quiera abrir el archivo pasa por la ruta que emite una URL firmada.
     */
    claveAlmacenamiento: { type: String, required: true, select: false }
  },
  { _id: false }
)

const versionSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true, min: 1 },
    archivo: { type: archivoSchema, required: true },
    estatus: { type: String, enum: VERSION_STATUSES, required: true },
    vigenciaHasta: { type: String, default: null, validate: validadorFecha },
    revisadoPor: { type: String, default: null },
    revisadoEn: { type: Date, default: null },
    motivoRechazo: { type: String, default: null },
    /** Cuándo la sustituyó una versión posterior. */
    reemplazadaEn: { type: Date, default: null }
  },
  { _id: false }
)

const documentoSchema = new mongoose.Schema(
  {
    tipo: { type: String, enum: DOCUMENT_TYPES, required: true },
    requerido: { type: Boolean, required: true },
    /** Sólo los cuatro persistibles: `expiring` y `expired` se derivan al leer. */
    estatus: { type: String, enum: STORED_DOCUMENT_STATUSES, required: true },

    vigenciaMeses: { type: Number, default: null },
    vigenciaHasta: { type: String, default: null, validate: validadorFecha },

    /** Copia de la versión vigente, para no recorrer el historial al listar. */
    archivo: { type: archivoSchema, default: null },
    motivoRechazo: { type: String, default: null },
    revisadoPor: { type: String, default: null },
    revisadoEn: { type: Date, default: null },

    /** De la MÁS RECIENTE a la más antigua: `versiones[0]` es la vigente. */
    versiones: { type: [versionSchema], default: [] }
  },
  { _id: false }
)

const recordSchema = new mongoose.Schema(
  {
    empleadoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      unique: true
    },

    /** Plantillas de las que salió el checklist; varias si tiene varias empresas. */
    plantillas: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ChecklistTemplate' }],

    documentos: { type: [documentoSchema], default: [] }
  },
  {
    timestamps: true,
    collection: 'records',
    toJSON: {
      versionKey: false,
      transform(doc, ret) {
        return {
          _id: ret._id.toString(),
          empleadoId: idAString(ret.empleadoId),
          plantillas: idsAString(ret.plantillas),
          documentos: (ret.documentos || []).map(documentoAJson),
          createdAt: ret.createdAt,
          updatedAt: ret.updatedAt
        }
      }
    }
  }
)

/** El archivo se expone SIN su clave de almacenamiento. */
function archivoAJson(archivo) {
  if (!archivo) return null
  return {
    nombre: archivo.nombre,
    mime: archivo.mime,
    tamanoBytes: archivo.tamanoBytes,
    // Desde D-78 se aceptan Word, Excel y CSV, que el navegador NO abre: la
    // interfaz necesita saberlo para ofrecer descargar en vez de un visor.
    previsualizable: esPrevisualizable(archivo.mime),
    subidoPor: archivo.subidoPor,
    subidoEn: archivo.subidoEn
  }
}

function documentoAJson(documento) {
  return {
    tipo: documento.tipo,
    requerido: documento.requerido,
    estatus: documento.estatus,
    vigenciaMeses: documento.vigenciaMeses ?? null,
    vigenciaHasta: documento.vigenciaHasta ?? null,
    archivo: archivoAJson(documento.archivo),
    motivoRechazo: documento.motivoRechazo ?? null,
    revisadoPor: documento.revisadoPor ?? null,
    revisadoEn: documento.revisadoEn ?? null,
    versiones: (documento.versiones || []).map((v) => ({
      version: v.version,
      archivo: archivoAJson(v.archivo),
      estatus: v.estatus,
      vigenciaHasta: v.vigenciaHasta ?? null,
      revisadoPor: v.revisadoPor ?? null,
      revisadoEn: v.revisadoEn ?? null,
      motivoRechazo: v.motivoRechazo ?? null,
      reemplazadaEn: v.reemplazadaEn ?? null
    }))
  }
}

// ─── Índices (modelo-datos §7) ────────────────────────────────────────────────
// `empleadoId` ya es único por la definición del campo.
recordSchema.index({ 'documentos.vigenciaHasta': 1 }) // job diario de vigencias
recordSchema.index({ 'documentos.estatus': 1 }) // métricas y alertas

/** El documento de un tipo dentro de este expediente. */
recordSchema.methods.documento = function documento(tipo) {
  return this.documentos.find((d) => d.tipo === tipo) || null
}

module.exports = mongoose.model('Record', recordSchema)
module.exports.documentoAJson = documentoAJson
module.exports.archivoAJson = archivoAJson
