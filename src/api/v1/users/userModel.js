const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const { ACCESS_LEVELS, SCOPES, AREAS, accessLevelToRole } = require('../../../constants')
const { normalize } = require('../../../utils/text')

/**
 * Usuario de la plataforma (spec 6.2).
 *
 * NO confundir con `Employee` (colaborador): un colaborador es alguien de quien
 * se guarda expediente y normalmente NO tiene acceso al sistema.
 *
 * COLECCIÓN NUEVA: `app_users`. No se reutiliza la colección `users` del
 * backend prestado. El nombre explícito garantiza el aislamiento incluso si
 * alguien apuntara `MONGODB_DB_NAME` a la base equivocada.
 */

const BCRYPT_COST = 12

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'El nombre es requerido'],
      trim: true,
      minlength: [2, 'El nombre debe tener al menos 2 caracteres'],
      maxlength: [50, 'El nombre no puede exceder 50 caracteres']
    },

    email: {
      type: String,
      required: [true, 'El correo es requerido'],
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 120
    },

    password: {
      type: String,
      required: [true, 'La contraseña es requerida'],
      minlength: [8, 'La contraseña debe tener al menos 8 caracteres'],
      select: false
    },

    /**
     * Nivel de acceso del flujo (spec 5 y 8). Sustituye al `role: user|admin`
     * del backend prestado, que se sigue exponiendo derivado por compatibilidad.
     */
    nivelAcceso: {
      type: String,
      enum: {
        values: ACCESS_LEVELS,
        message: 'El nivel de acceso seleccionado no es válido'
      },
      required: [true, 'El nivel de acceso es requerido'],
      default: 'rh_consulta'
    },

    /** Obligatoria y sólo válida para `jefe_area`. Ver invariantes abajo. */
    area: {
      type: String,
      enum: {
        values: [...AREAS, null],
        message: 'El área seleccionada no es válida'
      },
      default: null
    },

    // ─── Eje multi-cliente (spec 4) ─────────────────────────────────────────
    alcance: {
      type: String,
      enum: { values: SCOPES, message: 'El alcance indicado no es válido' },
      default: 'interno'
    },
    /** `null` = personal de Urbacames (la casa). */
    clienteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      default: null
    },

    active: { type: Boolean, default: true },

    ultimoAccesoEn: { type: Date, default: null },

    /** Interno: búsqueda insensible a acentos. No se expone (spec 6.7). */
    nameNormalized: { type: String, select: false, default: '' }
  },
  {
    timestamps: true,
    collection: 'app_users',
    toJSON: {
      versionKey: false,
      transform(doc, ret) {
        // Forma exacta del `AuthUser` que el front espera (spec 9.1).
        return {
          _id: ret._id.toString(),
          name: ret.name,
          email: ret.email,
          // Compatibilidad durante la transición: el front todavía lee `role`.
          role: accessLevelToRole(ret.nivelAcceso),
          nivelAcceso: ret.nivelAcceso,
          area: ret.area ?? null,
          alcance: ret.alcance,
          clienteId: ret.clienteId ? ret.clienteId.toString() : null,
          active: ret.active,
          ultimoAccesoEn: ret.ultimoAccesoEn ?? null,
          createdAt: ret.createdAt,
          updatedAt: ret.updatedAt
        }
      }
    }
  }
)

// ─── Índices (spec 6.7) ───────────────────────────────────────────────────────
// `email` ya queda indexado y único por la definición del campo.
userSchema.index({ clienteId: 1, active: 1 })
userSchema.index({ nivelAcceso: 1, active: 1 })

// ─── Invariantes del modelo (spec 6.2) ────────────────────────────────────────
userSchema.pre('validate', function forzarInvariantes(next) {
  if (this.nivelAcceso === 'jefe_area') {
    if (!this.area) {
      this.invalidate('area', 'Un jefe de área necesita un área asignada')
    }
  } else if (this.area !== null && this.area !== undefined) {
    // No es un error del usuario: se normaliza en silencio.
    this.area = null
  }

  if (this.alcance === 'cliente') {
    if (!this.clienteId) {
      this.invalidate(
        'clienteId',
        'Un usuario de cliente necesita el cliente al que pertenece'
      )
    }
  } else if (this.clienteId) {
    this.clienteId = null
  }

  next()
})

userSchema.pre('save', function normalizarNombre(next) {
  if (this.isModified('name')) {
    this.nameNormalized = normalize(this.name)
  }
  next()
})

userSchema.pre('save', async function hashearPassword(next) {
  if (!this.isModified('password')) return next()
  this.password = await bcrypt.hash(this.password, BCRYPT_COST)
  return next()
})

/**
 * Mantiene `nameNormalized` al día en las actualizaciones por query
 * (`findByIdAndUpdate`), donde los hooks de documento no corren.
 */
userSchema.pre(['findOneAndUpdate', 'updateOne'], function normalizarEnUpdate(next) {
  const update = this.getUpdate() || {}
  const nuevoNombre = update.name ?? update.$set?.name
  if (nuevoNombre) {
    this.setUpdate({
      ...update,
      $set: { ...(update.$set || {}), nameNormalized: normalize(nuevoNombre) }
    })
  }
  next()
})

userSchema.methods.comparePassword = function comparePassword(candidata) {
  if (!this.password) {
    throw new Error(
      'comparePassword requiere que el documento se haya leído con .select("+password")'
    )
  }
  return bcrypt.compare(candidata, this.password)
}

module.exports = mongoose.model('User', userSchema)
