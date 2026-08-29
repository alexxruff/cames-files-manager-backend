const mongoose = require('mongoose')
const { DOCUMENT_TYPES } = require('../../../constants')
const { normalize } = require('../../../utils/text')

/**
 * Empresa: la entidad raíz del grupo (modelo-datos §5.1).
 *
 * Es el ancla organizativa —sus áreas, sus proyectos, su gente— y **no contiene**
 * a los empleados ni a los clientes: esos son catálogos compartidos que se le
 * vinculan (`adscripciones`, `carteras`).
 *
 * Cambia poco y se lee mucho: buena candidata a caché más adelante.
 */
/**
 * Un registro patronal de la empresa (D-65).
 *
 * `numero` es el dato; el `_id` es lo que referencia el proyecto. Se dan de baja
 * con `activo`, nunca se borran: un proyecto puede seguir apuntando a uno que ya
 * no se usa para obras nuevas.
 */
const employerRegistrationSchema = new mongoose.Schema({
  numero: {
    type: String,
    required: [true, 'El número de registro patronal es requerido'],
    trim: true,
    uppercase: true,
    minlength: [3, 'El registro patronal debe tener al menos 3 caracteres'],
    maxlength: [30, 'El registro patronal no puede exceder 30 caracteres']
  },
  /** Para distinguirlos cuando son varios: el municipio, la clase de riesgo… */
  descripcion: {
    type: String,
    trim: true,
    default: null,
    maxlength: [120, 'La descripción no puede exceder 120 caracteres']
  },
  activo: { type: Boolean, default: true }
})

const companySchema = new mongoose.Schema(
  {
    nombre: {
      type: String,
      required: [true, 'El nombre de la empresa es requerido'],
      trim: true,
      maxlength: [120, 'El nombre no puede exceder 120 caracteres']
    },
    rfc: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      // RFC de persona moral: 12 caracteres. Se admite el de 13 por si alguna
      // empresa del grupo estuviera a nombre de una persona física.
      match: [/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, 'El RFC no tiene un formato válido']
    },

    /**
     * Registros patronales ante el IMSS. **Uno o varios** (D-64, D-65).
     *
     * Varios porque una empresa puede tener registro por entidad o por clase de
     * riesgo, y el archivo de nómina ya trae uno **por persona**
     * (`adscripciones.condiciones.registroPatronal`): con un solo campo no habría
     * dónde guardar los demás.
     *
     * ─── Por qué son subdocumentos y no cadenas ─────────────────────────────
     * Nacieron como `[String]` (D-64), cuando sólo había que guardarlos. En
     * cuanto el proyecto tiene que **apuntar a uno** eso deja de servir: no se
     * puede referenciar una posición de un arreglo de cadenas, y corregir un
     * dígito rompería la referencia en silencio. Con `_id` propio la referencia
     * sobrevive a que se corrija el número.
     *
     * No es colección aparte porque no tienen vida fuera de su empresa y la
     * empresa ya se carga donde hacen falta. El `_id` de un subdocumento es un
     * ObjectId real y único, así que `projects.registroPatronalId` se puede
     * indexar igual; lo único que se pierde es `populate`, que aquí no hace falta.
     *
     * No se exige ninguno: las empresas que ya existen no lo tienen.
     */
    registrosPatronales: { type: [employerRegistrationSchema], default: [] },

    // Preparados para el día que cada empresa quiera verse distinta.
    branding: {
      nombreComercial: { type: String, default: null },
      logoUrl: { type: String, default: null },
      colorPrimario: { type: String, default: null }
    },
    configuracion: {
      /** Si vienen, pisan los valores globales del entorno. */
      diasAlertaVencimiento: { type: Number, min: 1, max: 365, default: null },
      diasAlertaProyecto: { type: Number, min: 1, max: 90, default: null },
      documentosSensibles: {
        type: [{ type: String, enum: DOCUMENT_TYPES }],
        default: null
      }
    },

    activo: { type: Boolean, default: true },

    /** Interno: unicidad y búsqueda sin acentos. No se expone. */
    nombreNormalizado: { type: String, select: false, default: '' }
  },
  {
    timestamps: true,
    collection: 'companies',
    toJSON: {
      versionKey: false,
      transform(doc, ret) {
        return {
          _id: ret._id.toString(),
          nombre: ret.nombre,
          rfc: ret.rfc ?? null,
          /*
           * Se descartan los que no tengan número (D-68).
           *
           * No es defensa teórica: en una base a medio migrar de D-64 —donde
           * esto era `[String]`— Mongoose intenta convertir la cadena en
           * subdocumento, no sabe dónde ponerla, y produce uno **sin `numero`**.
           * Emitirlo rompía al front, que espera `numero: string` por contrato.
           *
           * El dato no se pierde: sigue en el documento crudo y lo recupera
           * `npm run migrate:registros-patronales`.
           */
          registrosPatronales: (ret.registrosPatronales || [])
            .filter((r) => r && r.numero)
            .map((r) => ({
              _id: r._id.toString(),
              numero: r.numero,
              descripcion: r.descripcion ?? null,
              activo: r.activo
            })),
          branding: {
            nombreComercial: ret.branding?.nombreComercial ?? null,
            logoUrl: ret.branding?.logoUrl ?? null,
            colorPrimario: ret.branding?.colorPrimario ?? null
          },
          configuracion: {
            diasAlertaVencimiento: ret.configuracion?.diasAlertaVencimiento ?? null,
            diasAlertaProyecto: ret.configuracion?.diasAlertaProyecto ?? null,
            documentosSensibles: ret.configuracion?.documentosSensibles ?? null
          },
          activo: ret.activo,
          createdAt: ret.createdAt,
          updatedAt: ret.updatedAt
        }
      }
    }
  }
)

/*
 * Unicidad sobre el nombre NORMALIZADO, no sobre el original: si no, "Urbacames
 * Edificación" y "urbacames edificacion" convivirían y nadie sabría cuál usar.
 */
/*
 * Sin repetidos dentro de la misma empresa. Va en el modelo y no en el servicio
 * para que valga por cualquier camino —alta, edición o un script— y no sólo por
 * la ruta que se acuerde de limpiarlos.
 */
/*
 * El número no se repite DENTRO de la empresa (D-65). Va en el modelo y no en el
 * servicio para que valga por cualquier camino —alta, edición o un script— y no
 * sólo por la ruta que se acuerde de comprobarlo.
 *
 * Entre empresas distintas NO se bloquea: no hay evidencia de que sea imposible
 * y un índice equivocado frenaría trabajo real.
 */
companySchema.pre('validate', function registrosSinRepetir(next) {
  const numeros = (this.registrosPatronales || []).map((r) =>
    String(r.numero || '')
      .trim()
      .toUpperCase()
  )
  const repetido = numeros.find((n, i) => n && numeros.indexOf(n) !== i)
  if (repetido) {
    this.invalidate(
      'registrosPatronales',
      `El registro patronal ${repetido} ya está en esta empresa`
    )
  }
  next()
})

companySchema.index({ nombreNormalizado: 1 }, { unique: true })
companySchema.index({ activo: 1 })
/*
 * RFC único cuando viene. Parcial y no `sparse` porque con `default: null` el
 * campo existe en el documento y un índice disperso no lo omitiría: dos empresas
 * sin RFC colisionarían.
 */
companySchema.index(
  { rfc: 1 },
  { unique: true, partialFilterExpression: { rfc: { $type: 'string' } } }
)

companySchema.pre('validate', function normalizarNombre(next) {
  if (this.nombre) this.nombreNormalizado = normalize(this.nombre)
  next()
})

companySchema.pre(['findOneAndUpdate', 'updateOne'], function normalizarEnUpdate(next) {
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

module.exports = mongoose.model('Company', companySchema)
