const mongoose = require('mongoose')
const { normalize } = require('../../../utils/text')

/**
 * Área de la organización — catálogo administrable (D-58).
 *
 * Era un enum fijo en `constants/areas.js`. Se volvió colección porque la
 * columna `Departamento` del archivo de nómina trae obras concretas (`Axis
 * Zapopan`, `Axis 3`) y no áreas: cada una obligaba a editar el código y
 * desplegar. Ahora entran solas como **temporales** y se dan de baja cuando la
 * obra termina.
 *
 * ─── `clave` y `nombre` ──────────────────────────────────────────────────────
 * `clave` es el valor del CONTRATO: es lo que se guarda en `adscripciones.areas`,
 * lo que viaja en `req.areasPorEmpresa` y lo que compara el front. `nombre` es lo
 * que se muestra. Se separan porque el nombre se puede corregir —«Costos y
 * Presupuestos» a «Costos»— sin reescribir cada adscripción que lo tenga.
 *
 * La clave es **inmutable**: cambiarla dejaría huérfanas a las adscripciones que
 * la guardan. Renombrar cambia `nombre`, nunca `clave`.
 *
 * ─── Global, no por empresa ──────────────────────────────────────────────────
 * Igual que las categorías (D-32) y por lo mismo: el empleado es global y puede
 * estar adscrito a dos empresas; un catálogo por empresa haría ambigua el área
 * de quien está en las dos. Lo que sí es por empresa son las áreas QUE TIENE
 * ASIGNADAS en cada adscripción.
 */
const areaSchema = new mongoose.Schema(
  {
    /** Valor del contrato. Inmutable: las adscripciones lo guardan. */
    clave: {
      type: String,
      required: [true, 'La clave del área es requerida'],
      trim: true,
      lowercase: true,
      immutable: true,
      match: [/^[a-z0-9_]+$/, 'La clave sólo admite minúsculas, números y guion bajo']
    },

    nombre: {
      type: String,
      required: [true, 'El nombre del área es requerido'],
      trim: true,
      maxlength: [80, 'El nombre no puede exceder 80 caracteres']
    },

    /** Las nueve sembradas. No se pueden dar de baja ni renombrar a otra cosa. */
    esBase: { type: Boolean, default: false },

    /**
     * La creó el importador desde la columna `Departamento` porque no coincidía
     * con ninguna área conocida: casi siempre una obra.
     *
     * Es lo que decide **quién puede darla de baja**: las temporales las cierra
     * RH (`rh_admin` y `rh_consulta`) cuando la obra termina, sin molestar al
     * administrador de plataforma. Las demás son suyas.
     */
    temporal: { type: Boolean, default: false },

    /** De baja ≠ borrada: se conserva y se puede reactivar. */
    activa: { type: Boolean, default: true },

    /** Interno: para que el archivo encuentre «Recursos Humanos» y «RECURSOS HUMANOS». */
    nombreNormalizado: { type: String, select: false, default: '' }
  },
  {
    timestamps: true,
    collection: 'areas',
    toJSON: {
      versionKey: false,
      transform(doc, ret) {
        return {
          _id: ret._id.toString(),
          clave: ret.clave,
          nombre: ret.nombre,
          esBase: ret.esBase,
          temporal: ret.temporal,
          activa: ret.activa,
          createdAt: ret.createdAt,
          updatedAt: ret.updatedAt
        }
      }
    }
  }
)

/*
 * Dos únicos, y los dos hacen falta: la `clave` es la identidad del contrato, y
 * el nombre normalizado es lo que evita que el archivo cree «Axis Zapopan» y
 * «AXIS ZAPOPAN» como áreas distintas al re-importarlo.
 */
areaSchema.index({ clave: 1 }, { unique: true })
areaSchema.index({ nombreNormalizado: 1 }, { unique: true })
areaSchema.index({ activa: 1, temporal: 1 })

areaSchema.pre('validate', function normalizarNombre(next) {
  if (this.nombre) this.nombreNormalizado = normalize(this.nombre)
  next()
})

module.exports = mongoose.model('Area', areaSchema)
