const mongoose = require('mongoose')
const { normalize } = require('../../../utils/text')
const { PERMISSION_KEYS } = require('../../../utils/permissions')

/**
 * Un rol: un nombre y las casillas de permisos que trae marcadas (D-93).
 *
 * Antes los roles eran **tres valores cerrados en el código** —`rh_admin`,
 * `rh_consulta`, `jefe_area`— y su tabla de permisos vivía en un archivo del
 * servidor. Agregar «contador» era tocar código y desplegar. Ahora son datos, y
 * los tres de siempre siguen existiendo como **roles de sistema**: se siembran al
 * arrancar derivándolos de esa misma matriz, así que nacen diciendo exactamente
 * lo que decían.
 *
 * # Lo que NO lleva, y por qué
 *
 * **No hay lista de permisos negados.** Un rol dice lo que puede, y la persona
 * puede tener excepciones que **sólo agregan** (`acceso.permisosExtra`). Sin
 * «el rol menos algo», la pregunta «¿por qué ve esto?» siempre tiene respuesta:
 * o su rol, o una excepción suya. Con negaciones habría que explicar además por
 * qué NO ve algo, y esa cadena no termina.
 *
 * # Las dos banderas que no son casillas
 *
 * - `todosLosPermisos` — alcanza también **los permisos que se agreguen
 *   después**, sin volver a marcarlos. Es lo que hace el rol del administrador
 *   de plataforma: si mañana existe un módulo económico, ya lo tiene. Marcarle
 *   41 casillas y olvidar la 42 es exactamente el error que esto evita.
 * - `soloSusAreas` — el rol ve sólo las áreas que la persona dirige en cada
 *   empresa. Antes era el valor `'own_area'` de la matriz, y era del jefe de
 *   área, no de un permiso suyo: `isLimitedToOwnArea` se consultaba en todo el
 *   código con una sola capacidad. Qué casillas se pueden acotar lo dice el
 *   catálogo (`acotableAAreas`), no cada rol.
 */
const roleSchema = new mongoose.Schema(
  {
    nombre: {
      type: String,
      required: [true, 'El nombre del rol es requerido'],
      trim: true,
      minlength: [3, 'El nombre debe tener al menos 3 caracteres'],
      maxlength: [60, 'El nombre no puede exceder 60 caracteres']
    },
    /** La unicidad se decide aquí: «Contador» y «contador» son uno. */
    nombreNormalizado: { type: String, select: false, default: '' },

    descripcion: {
      type: String,
      trim: true,
      maxlength: [240, 'La descripción no puede exceder 240 caracteres'],
      default: null
    },

    /**
     * Las claves del catálogo, sin repetir. Se validan contra `PERMISSION_KEYS`
     * para que una clave mal escrita no se guarde como un permiso que nadie
     * tiene y nadie encuentra.
     */
    permisos: {
      type: [String],
      default: [],
      validate: {
        validator: (claves) => claves.every((c) => PERMISSION_KEYS.includes(c)),
        message: 'Hay permisos que no existen en el catálogo'
      }
    },

    /**
     * De quién es el rol. **Hoy siempre `null`**, que significa «del grupo»:
     * los cuatro perfiles que se pidieron son los mismos en las cuatro empresas.
     * El campo existe desde ahora para que el día que una empresa necesite un rol
     * propio no haya que migrar a nadie — sólo dejar de mandar `null`.
     */
    empresaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      default: null
    },

    /** Los tres sembrados. No se borran ni se renombran. */
    esSistema: { type: Boolean, default: false },
    todosLosPermisos: { type: Boolean, default: false },
    soloSusAreas: { type: Boolean, default: false },
    activo: { type: Boolean, default: true }
  },
  {
    timestamps: true,
    collection: 'roles',
    toJSON: {
      versionKey: false,
      transform(doc, ret) {
        return {
          _id: ret._id.toString(),
          nombre: ret.nombre,
          descripcion: ret.descripcion ?? null,
          permisos: ret.permisos || [],
          empresaId: ret.empresaId ? ret.empresaId.toString() : null,
          esSistema: Boolean(ret.esSistema),
          todosLosPermisos: Boolean(ret.todosLosPermisos),
          soloSusAreas: Boolean(ret.soloSusAreas),
          activo: Boolean(ret.activo),
          createdAt: ret.createdAt,
          updatedAt: ret.updatedAt
        }
      }
    }
  }
)

/*
 * Único por nombre DENTRO de su dueño: el día que existan roles de empresa, dos
 * empresas podrán tener su propio «Contador» sin chocar, y el del grupo sigue
 * siendo uno solo.
 */
roleSchema.index({ nombreNormalizado: 1, empresaId: 1 }, { unique: true })
roleSchema.index({ activo: 1, nombre: 1 })

roleSchema.pre('validate', function normalizarNombre(next) {
  if (this.nombre) this.nombreNormalizado = normalize(this.nombre)
  next()
})

module.exports = mongoose.model('Role', roleSchema)
