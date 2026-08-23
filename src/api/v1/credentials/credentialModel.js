const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const { idAString } = require('../../../utils/ids')

/**
 * Credencial: el material secreto de un acceso. Uno a uno con `Employee`.
 *
 * ─── Por qué es una colección aparte y no un subdocumento ────────────────────
 * El documento del empleado se lee en agregaciones y `$lookup` por todo el
 * sistema, y **las agregaciones ignoran el `select: false` de Mongoose** (también
 * lo ignora un `.select('acceso')` sobre el padre). Está comprobado en
 * `tests/unitarias/credentialIsolation.test.js`: con el hash embebido, un
 * `$lookup` desde `adscripciones` devuelve el bcrypt de cada persona con acceso.
 *
 * Aislarlo en su propia colección hace que la protección sea **estructural**: no
 * hay proyección que se pueda olvidar, porque el secreto no está en el documento
 * que se agrega. Ver D-27.
 *
 * Aquí también viven las piezas que un login de verdad necesita y que irían
 * acumulándose en el empleado: recuperación de contraseña, bloqueo por intentos
 * fallidos y la marca del último acceso.
 *
 * La marca `passwordActualizadaEn` es la excepción y vive en `empleados.acceso`:
 * no es un secreto y se consulta en CADA petición autenticada para invalidar
 * tokens viejos, así que sacarla de aquí deja el camino caliente en una sola
 * consulta.
 */

const BCRYPT_COST = 12

const credentialSchema = new mongoose.Schema(
  {
    empleadoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      unique: true
    },

    /** Se llama `passwordHash`, no `password`: el nombre evita confusiones. */
    passwordHash: { type: String, required: true, select: false },

    // Declarados desde ya; se llenan cuando se implemente el flujo.
    resetToken: { type: String, default: null, select: false },
    resetExpiraEn: { type: Date, default: null },
    intentosFallidos: { type: Number, default: 0 },
    bloqueadaHasta: { type: Date, default: null },

    ultimoAccesoEn: { type: Date, default: null }
  },
  {
    timestamps: true,
    collection: 'credentials',
    toJSON: {
      versionKey: false,
      /*
       * Cinturón y tirantes: aunque alguien lea el documento con
       * `.select('+passwordHash')` y lo serialice por error, esto nunca expone
       * material secreto.
       */
      transform(doc, ret) {
        return {
          _id: ret._id.toString(),
          empleadoId: idAString(ret.empleadoId),
          ultimoAccesoEn: ret.ultimoAccesoEn ?? null,
          intentosFallidos: ret.intentosFallidos,
          bloqueadaHasta: ret.bloqueadaHasta ?? null,
          createdAt: ret.createdAt,
          updatedAt: ret.updatedAt
        }
      }
    }
  }
)

/** Hashea una contraseña en claro. Único lugar del proyecto que lo hace. */
credentialSchema.statics.hashPassword = function hashPassword(password) {
  return bcrypt.hash(String(password), BCRYPT_COST)
}

credentialSchema.methods.comparePassword = function comparePassword(candidata) {
  if (!this.passwordHash) {
    throw new Error(
      'comparePassword requiere leer la credencial con .select("+passwordHash")'
    )
  }
  return bcrypt.compare(String(candidata), this.passwordHash)
}

module.exports = mongoose.model('Credential', credentialSchema)
