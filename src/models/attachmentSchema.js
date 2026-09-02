const mongoose = require('mongoose')

/**
 * Adjunto administrativo: **un** archivo colgado de un dato del catálogo
 * (D-79). Hoy lo usa el registro de obra del cliente; las tareas del SIROC y
 * del contrato reutilizan este mismo esquema.
 *
 * Se distingue del archivo de un documento del expediente en dos cosas, y las
 * dos son a propósito:
 *
 * 1. **No se versiona.** Reemplazarlo es la operación normal —el papel que
 *    respalda un número se vuelve a escanear— y el objeto anterior se borra de
 *    R2. El expediente sí versiona porque es un registro de auditoría.
 * 2. **`claveAlmacenamiento` NO va `select: false`.** En el expediente sí, pero
 *    ahí se pide explícitamente en cada lectura que vaya a guardar (D-41). Un
 *    cliente se guarda entero cada vez que se toca cualquiera de sus registros,
 *    así que un campo no cargado se escribiría vacío y el archivo quedaría
 *    inalcanzable. Lo que impide que la clave se filtre es el `toJSON`, que
 *    enumera campos uno por uno y nunca la incluye.
 */
const attachmentSchema = new mongoose.Schema(
  {
    /** El nombre original, para mostrar. NO es con el que se descarga (D-78). */
    nombre: { type: String, required: true },
    mime: { type: String, required: true },
    tamanoBytes: { type: Number, required: true },
    /** El NOMBRE de quien lo subió, no sólo el id: es histórico. */
    subidoPor: { type: String, default: null },
    subidoPorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    subidoEn: { type: Date, default: Date.now },
    claveAlmacenamiento: { type: String, required: true }
  },
  { _id: false }
)

module.exports = attachmentSchema
