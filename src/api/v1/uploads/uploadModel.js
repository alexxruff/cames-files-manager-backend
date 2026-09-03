const mongoose = require('mongoose')
const { idAString } = require('../../../utils/ids')
const { UPLOAD_TARGETS } = require('../../../constants')

/**
 * Permiso de subida directa al almacenamiento (D-83).
 *
 * El archivo ya no pasa por el servidor: el navegador lo sube a R2 con una URL
 * firmada y después avisa por la ruta del recurso de siempre. Este documento es
 * lo que hace que ese permiso sea **de un solo uso** —sin estado no hay forma de
 * garantizarlo—, y de paso deja rastro de quién pidió subir qué y a dónde.
 *
 * Vive poco: nace `pendiente`, pasa a `usada` cuando el adjunto queda
 * registrado, y si nadie la confirma caduca sola. `scripts/cleanOrphanUploads.js`
 * barre lo que quedó en el almacenamiento.
 *
 * **No es el archivo.** Aquí sólo está lo que el navegador DECLARÓ —nombre, tipo
 * y tamaño—, que no se cree hasta comprobarlo contra el objeto real al confirmar.
 */

/**
 * Los ids del recurso dueño del archivo. Se guardan los que su destino necesita
 * y **se comparan al confirmar**: un permiso pedido para un contrato no sirve
 * para otro, ni para un expediente.
 */
const referenceSchema = new mongoose.Schema(
  {
    expedienteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Record', default: null },
    /** Qué documento del checklist, cuando el destino es el expediente. */
    tipoDocumento: { type: String, default: null },
    proyectoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
    contratoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', default: null },
    clienteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },
    /** Un subdocumento de `clients.registrosObra`, cuando ya existe. */
    registroObraId: { type: mongoose.Schema.Types.ObjectId, default: null }
  },
  { _id: false }
)

const uploadSchema = new mongoose.Schema(
  {
    destino: {
      type: String,
      required: [true, 'El destino es requerido'],
      enum: { values: UPLOAD_TARGETS, message: 'Destino no válido' }
    },
    referencia: { type: referenceSchema, default: () => ({}) },

    /** Dónde aterriza mientras nadie la confirma: `pendientes/{id}`. */
    claveTemporal: { type: String, required: true },

    /*
     * Lo DECLARADO por quien pide subir. El nombre se conserva para mostrarlo
     * —es el único sitio donde vive, porque la clave nunca lo incluye—; el
     * tamaño se firma en la URL, así que subir otra cosa invalida la firma; y el
     * tipo se vuelve a comprobar por contenido antes de registrar nada.
     */
    nombre: { type: String, required: [true, 'El nombre del archivo es requerido'] },
    mime: { type: String, default: null },
    tamanoBytes: {
      type: Number,
      required: [true, 'El tamaño del archivo es requerido'],
      min: [1, 'El archivo está vacío']
    },

    estado: {
      type: String,
      enum: { values: ['pendiente', 'usada'], message: 'Estado no válido' },
      default: 'pendiente'
    },
    expiraEn: { type: Date, required: true },
    usadaEn: { type: Date, default: null },

    /** El NOMBRE de quien la pidió, no sólo el id: es histórico, como todo. */
    solicitadaPor: { type: String, required: true },
    solicitadaPorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }
  },
  {
    timestamps: true,
    collection: 'uploads',
    toJSON: {
      versionKey: false,
      transform(doc, ret) {
        return {
          _id: ret._id.toString(),
          destino: ret.destino,
          nombre: ret.nombre,
          tamanoBytes: ret.tamanoBytes,
          estado: ret.estado,
          expiraEn: ret.expiraEn,
          createdAt: ret.createdAt,
          solicitadaPorId: idAString(ret.solicitadaPorId)
        }
      }
    }
  }
)

/*
 * Lo único que se consulta de esta colección: qué permisos ya caducaron, para
 * barrer lo que dejaron en el almacenamiento. Por `expiraEn` a secas y no
 * compuesto con `estado`, porque la limpieza mira **todos** los vencidos: de los
 * `pendiente` borra permiso y archivo, y de los `usada` sólo el temporal que
 * haya sobrevivido a un movimiento a medias.
 */
uploadSchema.index({ expiraEn: 1 })

module.exports = mongoose.model('Upload', uploadSchema)
