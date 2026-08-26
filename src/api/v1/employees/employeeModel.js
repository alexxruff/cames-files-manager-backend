const mongoose = require('mongoose')
const { ACCESS_LEVELS, EMPLOYEE_TYPES } = require('../../../constants')
const { normalize } = require('../../../utils/text')
const { isCalendarDate } = require('../../../utils/dates')
const { idAString } = require('../../../utils/ids')

/**
 * Empleado: LA PERSONA. Catálogo compartido (modelo-datos §5.2).
 *
 * No lleva `empresaId`, ni contrato, ni áreas: todo eso es la relación laboral y
 * vive en `adscripciones`. Una persona puede estar en varias empresas del grupo
 * con condiciones distintas, y tiene UN solo expediente.
 *
 * ─── El subdocumento `acceso` ────────────────────────────────────────────────
 * Ausente (`null`) en la mayoría: casi nadie entra a la plataforma. Cuando
 * existe, guarda **quién es y qué puede hacer**, nunca el secreto:
 * `passwordHash` y compañía viven en la colección `credentials`.
 *
 * POR QUÉ SEPARADO: este documento se lee en agregaciones y `$lookup` por todas
 * partes (el listado de empleados es `adscripciones.aggregate($lookup empleados)`),
 * y las agregaciones **ignoran** el `select: false` de Mongoose — está
 * comprobado. Con el hash aquí, bastaría olvidar un `$unset` una vez para
 * publicar credenciales al navegador. Ver D-27.
 */
const accessSchema = new mongoose.Schema(
  {
    /** Identidad de login. Puede diferir del correo de contacto de la persona. */
    email: {
      type: String,
      required: [true, 'El correo de acceso es requerido'],
      lowercase: true,
      trim: true
    },
    nivelAcceso: {
      type: String,
      enum: { values: ACCESS_LEVELS, message: 'Selecciona un nivel de acceso válido' },
      required: [true, 'El nivel de acceso es requerido']
    },
    /** Administrador de plataforma: ve todas las empresas y los catálogos. */
    alcanceGlobal: { type: Boolean, default: false },
    /** Se puede quitar el acceso sin dar de baja a la persona. */
    activo: { type: Boolean, default: true },

    /**
     * Cuándo se cambió la contraseña por última vez. NO es un secreto, y vive
     * aquí a propósito: permite invalidar los JWT emitidos antes del cambio sin
     * leer la credencial en cada petición (`protect` se queda en una consulta).
     */
    passwordActualizadaEn: { type: Date, default: null },

    /**
     * La contraseña la puso otra persona y hay que cambiarla antes de usar el
     * sistema (D-49).
     *
     * Se marca cuando un administrador da acceso o repone la contraseña, y en el
     * administrador inicial del bootstrap —que nace con la contraseña de arranque
     * y era justo el agujero que quedaba abierto (D-21)—. Se limpia sola en
     * `POST /auth/cambiar-password`.
     *
     * VIVE AQUÍ Y NO EN `credentials`, por lo mismo que `passwordActualizadaEn`:
     * **no es material secreto** y se consulta en CADA petición autenticada para
     * bloquear el paso, así que sacarla de aquí obligaría a `protect` a hacer una
     * segunda consulta en el camino caliente.
     */
    passwordTemporal: { type: Boolean, default: false }
  },
  { _id: false }
)

const employeeSchema = new mongoose.Schema(
  {
    nombre: {
      type: String,
      required: [true, 'El nombre es requerido'],
      trim: true,
      minlength: [3, 'El nombre debe tener al menos 3 caracteres'],
      maxlength: [120, 'El nombre no puede exceder 120 caracteres']
    },

    /**
     * Clave natural de identidad. Ver D-28: se permite el alta provisional sin
     * CURP (personal de obra el primer día), con índice único parcial, y no se
     * puede validar el expediente de alguien sin ella.
     */
    curp: {
      type: String,
      uppercase: true,
      trim: true,
      default: null,
      match: [
        /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/,
        'La CURP no tiene un formato válido'
      ]
    },
    /**
     * Número de trabajador de la nómina — **de la PERSONA, único en el grupo**
     * (D-54).
     *
     * Vivía en la adscripción, único por empresa, porque el archivo de nómina se
     * importa empresa por empresa (D-46). Se movió aquí cuando se pidió poder
     * capturarlo al dar de alta a alguien que todavía no se adscribe a ninguna
     * empresa: sin empresa, un número único "por empresa" no tiene dónde vivir.
     *
     * `default: null` porque la migración y el importador pueden dejarlo vacío;
     * `POST /empleados` sí lo exige.
     */
    numeroEmpleado: { type: String, trim: true, maxlength: 30, default: null },

    rfc: { type: String, uppercase: true, trim: true, maxlength: 13, default: null },
    nss: { type: String, trim: true, maxlength: 11, default: null },

    fechaNacimiento: {
      type: String,
      default: null,
      validate: {
        validator: (v) => v === null || isCalendarDate(v),
        message: 'La fecha de nacimiento debe tener el formato AAAA-MM-DD'
      }
    },
    email: { type: String, lowercase: true, trim: true, default: null },
    telefono: { type: String, trim: true, default: null },

    /** Puesto base, del catálogo global. En un proyecto puede tener otro. */
    categoriaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'La categoría es requerida']
    },

    tipo: {
      type: String,
      enum: { values: EMPLOYEE_TYPES, message: 'Selecciona un tipo de empleado válido' },
      required: [true, 'El tipo de empleado es requerido']
    },

    /** Acceso a la plataforma. `null` = no entra al sistema. */
    acceso: { type: accessSchema, default: null },

    /** Baja del sistema completo. Distinta de la baja de una empresa. */
    activo: { type: Boolean, default: true },
    motivoBaja: { type: String, trim: true, default: null },
    fechaBaja: {
      type: String,
      default: null,
      validate: {
        validator: (v) => v === null || isCalendarDate(v),
        message: 'La fecha de baja debe tener el formato AAAA-MM-DD'
      }
    },

    /** Interno: búsqueda parcial insensible a acentos. No se expone. */
    nombreNormalizado: { type: String, select: false, default: '' }
  },
  {
    timestamps: true,
    collection: 'employees',
    toJSON: {
      versionKey: false,
      transform(doc, ret) {
        return {
          _id: ret._id.toString(),
          nombre: ret.nombre,
          numeroEmpleado: ret.numeroEmpleado ?? null,
          curp: ret.curp ?? null,
          rfc: ret.rfc ?? null,
          nss: ret.nss ?? null,
          fechaNacimiento: ret.fechaNacimiento ?? null,
          email: ret.email ?? null,
          telefono: ret.telefono ?? null,
          categoriaId: idAString(ret.categoriaId),
          tipo: ret.tipo,
          acceso: ret.acceso
            ? {
                email: ret.acceso.email,
                nivelAcceso: ret.acceso.nivelAcceso,
                alcanceGlobal: ret.acceso.alcanceGlobal,
                activo: ret.acceso.activo,
                passwordActualizadaEn: ret.acceso.passwordActualizadaEn ?? null,
                passwordTemporal: Boolean(ret.acceso.passwordTemporal)
              }
            : null,
          activo: ret.activo,
          motivoBaja: ret.motivoBaja ?? null,
          fechaBaja: ret.fechaBaja ?? null,
          createdAt: ret.createdAt,
          updatedAt: ret.updatedAt
        }
      }
    }
  }
)

// ─── Índices (modelo-datos §7) ────────────────────────────────────────────────
// Parciales, no `sparse`: con `default: null` el campo SÍ existe en el documento
// y un índice disperso no lo omitiría, así que dos empleados sin CURP chocarían.
employeeSchema.index(
  { curp: 1 },
  { unique: true, partialFilterExpression: { curp: { $type: 'string' } } }
)
employeeSchema.index(
  { numeroEmpleado: 1 },
  { unique: true, partialFilterExpression: { numeroEmpleado: { $type: 'string' } } }
)
employeeSchema.index(
  { 'acceso.email': 1 },
  { unique: true, partialFilterExpression: { 'acceso.email': { $type: 'string' } } }
)
employeeSchema.index({ nombreNormalizado: 1 })
employeeSchema.index({ activo: 1, tipo: 1 })

// ─── Invariantes ──────────────────────────────────────────────────────────────
employeeSchema.pre('validate', function forzarInvariantes(next) {
  // El alcance global es el administrador de plataforma, no un nivel aparte:
  // sólo tiene sentido sobre un rh_admin.
  if (this.acceso?.alcanceGlobal && this.acceso.nivelAcceso !== 'rh_admin') {
    this.invalidate(
      'acceso.alcanceGlobal',
      'El alcance global sólo se puede dar a un administrador de RH'
    )
  }

  if (!this.activo && !this.motivoBaja) {
    this.invalidate('motivoBaja', 'Indica el motivo de la baja')
  }
  if (this.activo) {
    this.motivoBaja = null
    this.fechaBaja = null
  }

  // Opcionales vacíos son "sin valor", no cadena vacía (regla del contrato).
  for (const campo of ['curp', 'rfc', 'nss', 'email', 'telefono']) {
    if (this[campo] === '') this[campo] = null
  }

  next()
})

employeeSchema.pre('save', function normalizarNombre(next) {
  if (this.isModified('nombre')) this.nombreNormalizado = normalize(this.nombre)
  next()
})

employeeSchema.pre(['findOneAndUpdate', 'updateOne'], function normalizarEnUpdate(next) {
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

/** ¿Esta persona puede iniciar sesión hoy? */
employeeSchema.methods.puedeIniciarSesion = function puedeIniciarSesion() {
  return Boolean(this.activo && this.acceso && this.acceso.activo)
}

/**
 * ¿Un token emitido en ese instante (milisegundos) sigue siendo válido?
 *
 * Cambiar la contraseña invalida las sesiones abiertas: con 12 h de vigencia, sin
 * esto un token robado seguiría sirviendo aunque la persona ya haya cambiado su
 * contraseña justo por eso.
 *
 * Se compara en milisegundos y sin holgura. Con la precisión de segundos del
 * `iat` estándar habría que tolerar un segundo, y en ese segundo los tokens que
 * se acaban de invalidar seguirían entrando.
 */
employeeSchema.methods.tokenSigueValido = function tokenSigueValido(msEmision) {
  const cambio = this.acceso?.passwordActualizadaEn
  if (!cambio) return true
  if (!msEmision) return false
  return msEmision >= cambio.getTime()
}

module.exports = mongoose.model('Employee', employeeSchema)
