const mongoose = require('mongoose')
const { isCalendarDate, isAfter } = require('../../../utils/dates')
const { normalize } = require('../../../utils/text')
const { idAString, idsAString } = require('../../../utils/ids')

/**
 * Proyecto (modelo-datos §5.5). **La única entidad que sí pertenece a una
 * empresa**, y no puede existir sin un cliente de su cartera.
 *
 * El esquema se dejó corto a propósito: van a llegar presupuesto, ubicación,
 * responsable y número de contrato, y los admite sin migrar nada.
 */

const validadorFecha = {
  validator: (v) => v === null || isCalendarDate(v),
  message: 'La fecha debe tener el formato AAAA-MM-DD y ser una fecha real'
}

/**
 * Un aplazamiento del cierre. **Es auditoría, no un adorno**: la fecha de fin
 * estimada sólo se mueve por aquí, con motivo y con quién lo hizo.
 */
const postponementSchema = new mongoose.Schema(
  {
    fechaAnterior: { type: String, required: true },
    fechaNueva: { type: String, required: true },
    motivo: { type: String, required: true, minlength: 10 },
    /** El NOMBRE, para que el histórico siga legible si la persona se va. */
    registradoPor: { type: String, required: true },
    registradoPorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    registradoEn: { type: Date, required: true }
  },
  { _id: false }
)

const projectSchema = new mongoose.Schema(
  {
    empresaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: [true, 'La empresa es requerida']
    },
    clienteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      required: [true, 'El cliente es requerido']
    },

    /**
     * El registro patronal de la EMPRESA con el que opera este proyecto (D-67).
     *
     * Apunta al `_id` de un subdocumento de `companies.registrosPatronales`. Por
     * eso ese subdocumento tiene identidad propia (D-65): así corregir el número
     * no rompe esta referencia.
     *
     * **Opcional por ahora**: los proyectos que ya existen no lo tienen y
     * exigirlo los dejaría inválidos. Se vuelve obligatorio en la fase 4, cuando
     * estén poblados.
     */
    registroPatronalId: { type: mongoose.Schema.Types.ObjectId, default: null },

    /**
     * El registro de obra del CLIENTE. Uno solo por proyecto (D-67).
     *
     * Apunta a `clients.registrosObra._id` (D-66). **Es el origen funcional de
     * los SIROC**: cada contrato del proyecto tendrá el suyo, y todos cuelgan de
     * esta obra. No confundir con el registro patronal, que es de la empresa y
     * no tiene nada que ver con el SIROC.
     *
     * Opcional por ahora, por lo mismo que el anterior.
     */
    registroObraId: { type: mongoose.Schema.Types.ObjectId, default: null },

    nombre: {
      type: String,
      required: [true, 'El nombre del proyecto es requerido'],
      trim: true,
      maxlength: [160, 'El nombre no puede exceder 160 caracteres']
    },

    fechaInicio: {
      type: String,
      required: [true, 'La fecha de inicio es requerida'],
      validate: validadorFecha
    },
    fechaFinEstimada: {
      type: String,
      required: [true, 'La fecha de fin estimada es requerida'],
      validate: validadorFecha
    },
    fechaFinReal: { type: String, default: null, validate: validadorFecha },

    estado: {
      type: String,
      enum: { values: ['en_curso', 'finalizado'], message: 'Estado no válido' },
      default: 'en_curso'
    },

    /** Subconjunto del catálogo global habilitado en este proyecto. */
    categorias: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],

    /** De la más reciente a la más antigua. */
    aplazamientos: { type: [postponementSchema], default: [] },

    /** Interno: nombre único por empresa y búsqueda sin acentos. */
    nombreNormalizado: { type: String, select: false, default: '' }
  },
  {
    timestamps: true,
    collection: 'projects',
    toJSON: {
      versionKey: false,
      transform(doc, ret) {
        return {
          _id: ret._id.toString(),
          empresaId: idAString(ret.empresaId),
          clienteId: idAString(ret.clienteId),
          registroPatronalId: idAString(ret.registroPatronalId),
          registroObraId: idAString(ret.registroObraId),
          nombre: ret.nombre,
          fechaInicio: ret.fechaInicio,
          fechaFinEstimada: ret.fechaFinEstimada,
          fechaFinReal: ret.fechaFinReal ?? null,
          estado: ret.estado,
          categorias: idsAString(ret.categorias),
          aplazamientos: (ret.aplazamientos || []).map((a) => ({
            fechaAnterior: a.fechaAnterior,
            fechaNueva: a.fechaNueva,
            motivo: a.motivo,
            registradoPor: a.registradoPor,
            registradoEn: a.registradoEn
          })),
          createdAt: ret.createdAt,
          updatedAt: ret.updatedAt
        }
      }
    }
  }
)

// ─── Índices (modelo-datos §7) ────────────────────────────────────────────────
projectSchema.index({ empresaId: 1, estado: 1 })
// Para responder «¿qué proyectos usan este registro?» antes de darlo de baja.
projectSchema.index({ registroPatronalId: 1 })
projectSchema.index({ registroObraId: 1 })
projectSchema.index({ clienteId: 1 })
projectSchema.index({ empresaId: 1, fechaFinEstimada: 1 }) // job de cierres próximos
// Nombre único DENTRO de la empresa: dos empresas del grupo pueden tener cada
// una su "Torre Andares".
projectSchema.index({ empresaId: 1, nombreNormalizado: 1 }, { unique: true })

projectSchema.pre('validate', function forzarInvariantes(next) {
  if (this.nombre) this.nombreNormalizado = normalize(this.nombre)

  if (
    isCalendarDate(this.fechaInicio) &&
    isCalendarDate(this.fechaFinEstimada) &&
    !isAfter(this.fechaFinEstimada, this.fechaInicio)
  ) {
    this.invalidate(
      'fechaFinEstimada',
      'La fecha de fin estimada debe ser posterior a la de inicio'
    )
  }

  if (!this.categorias || this.categorias.length === 0) {
    // Sin categorías habilitadas no se puede asignar a nadie: el proyecto
    // nacería inservible.
    this.invalidate('categorias', 'Habilita al menos una categoría en el proyecto')
  }

  next()
})

module.exports = mongoose.model('Project', projectSchema)
