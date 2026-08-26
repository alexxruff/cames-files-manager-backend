const mongoose = require('mongoose')
const { AREAS, CONTRACT_TYPES, isTemporaryContract } = require('../../../constants')
const { isCalendarDate, isAfter } = require('../../../utils/dates')
const { idAString } = require('../../../utils/ids')

/**
 * Datos de nómina de ESTA relación laboral (D-46).
 *
 * Van en la adscripción y no en la persona porque son de su relación con **esa**
 * empresa: quien está en dos empresas del grupo tiene dos salarios, dos
 * registros patronales y puede tener dos cuentas.
 *
 * ─── NO SE SERIALIZA ─────────────────────────────────────────────────────────
 * Salario, SBC y número de cuenta son datos personales **sensibles** (LFPDPPP).
 * Se guardan porque el archivo de nómina los trae y sirven para no volver a
 * capturarlos, pero **ninguna respuesta de la API los devuelve hoy**: el
 * `toJSON` de la adscripción los omite y el campo va con `select: false`, las
 * dos cosas a propósito (la lección de D-27 es que `select: false` solo no basta,
 * porque las agregaciones lo ignoran).
 *
 * Exponerlos exige decidir antes **quién puede verlos** —hoy cualquiera que vea
 * la adscripción los vería, incluido `jefe_area` en sus áreas—, y esa decisión
 * está abierta en `ESTADO.md`. Cuando se tome, se expone con su capacidad propia
 * y su registro en la bitácora, como los documentos sensibles.
 */
const payrollSchema = new mongoose.Schema(
  {
    salarioDiario: { type: Number, min: 0, default: null },
    sbcParteFija: { type: Number, min: 0, default: null },
    sbcParteVariable: { type: Number, min: 0, default: null },
    sbcTopeUMA: { type: Number, min: 0, default: null },
    baseCotizacion: { type: String, trim: true, default: null },
    zonaSalario: { type: String, trim: true, default: null },
    tipoPrestacion: { type: String, trim: true, default: null },
    periodicidadPago: { type: String, trim: true, default: null },
    turno: { type: String, trim: true, default: null },
    tipoRegimen: { type: String, trim: true, default: null },
    registroPatronal: { type: String, trim: true, default: null },
    teletrabajador: { type: Boolean, default: false },
    banco: { type: String, trim: true, default: null },
    sucursal: { type: String, trim: true, default: null },
    cuenta: { type: String, trim: true, default: null }
  },
  { _id: false }
)

/**
 * Datos que el importador dejó sin capturar y que relajan una invariante hasta
 * que alguien los complete. Hoy sólo uno: ver `datosPendientes` más abajo.
 */
const DATOS_PENDIENTES = Object.freeze(['fechaTerminoContrato'])

/**
 * Adscripción: el vínculo empresa ↔ empleado (modelo-datos §5b.1).
 *
 * **Aquí vive la relación laboral**, no en el empleado: contrato, fecha de
 * ingreso, áreas dentro de esa empresa y su propia baja. Una persona puede ser
 * administrativa indeterminada en una empresa y de obra determinada en otra.
 *
 * Es también la pieza de la que depende TODO el alcance: lo que un usuario ve se
 * deriva de sus adscripciones activas (modelo-datos §8.1).
 */
const affiliationSchema = new mongoose.Schema(
  {
    empresaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: [true, 'La empresa es requerida']
    },
    empleadoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'El empleado es requerido']
    },

    /** Áreas DENTRO de esta empresa. Un administrativo necesita al menos una. */
    areas: {
      type: [{ type: String, enum: { values: AREAS, message: 'Área no válida' } }],
      default: []
    },

    tipoContrato: {
      type: String,
      enum: { values: CONTRACT_TYPES, message: 'Selecciona un tipo de contrato válido' },
      required: [true, 'El tipo de contrato es requerido']
    },
    fechaIngreso: {
      type: String,
      required: [true, 'La fecha de ingreso es requerida'],
      validate: {
        validator: (v) => isCalendarDate(v),
        message: 'La fecha de ingreso debe tener el formato AAAA-MM-DD'
      }
    },
    fechaTerminoContrato: {
      type: String,
      default: null,
      validate: {
        validator: (v) => v === null || isCalendarDate(v),
        message: 'La fecha de término debe tener el formato AAAA-MM-DD'
      }
    },

    /**
     * El departamento **tal como lo dice la nómina**, sin traducir.
     *
     * No es lo mismo que `areas`: en el archivo de Urbacames, 53 de 145 filas
     * traen aquí una obra (`Axis Zapopan`, `Plenares`) y no un área. Traducirlas
     * a un área sería inventar el dato; guardar el original conserva la única
     * información real de dónde está la persona, y `areas` cae al valor por
     * defecto de su tipo. Ver D-46.
     */
    departamento: { type: String, trim: true, default: null },

    /** Datos de nómina. NO se serializan: ver el comentario de `payrollSchema`. */
    nomina: { type: payrollSchema, default: () => ({}), select: false },

    /**
     * Lo que trajo el **último archivo de nómina importado**, para poder
     * distinguir «el archivo cambió» de «lo cambiaron a mano» (D-57).
     *
     * Sin esto, al re-importar no hay forma de saberlo: si el archivo dice
     * `Alta` y en la plataforma está de baja, puede ser que el archivo traiga
     * novedad o que alguien la haya dado de baja a mano y el archivo siga
     * repitiendo lo de siempre. Comparar contra este registro lo resuelve:
     * lo que difiere de aquí es cambio del ARCHIVO; lo que difiere entre aquí y
     * el documento es cambio A MANO.
     *
     * Sólo guarda los tres campos donde el archivo y una edición manual pueden
     * chocar de verdad: el resto o no lo escribe el importador, o no tiene ruta
     * para editarse a mano.
     *
     * En inglés y **sin serializar** porque es contabilidad interna del
     * importador, no parte del contrato.
     */
    payrollSnapshot: {
      type: new mongoose.Schema(
        {
          active: { type: Boolean, default: null },
          contractType: { type: String, default: null },
          hireDate: { type: String, default: null },
          importedAt: { type: Date, default: null }
        },
        { _id: false }
      ),
      default: null,
      select: false
    },

    /**
     * Invariantes relajadas a propósito, con nombre y por campo.
     *
     * Existe por un caso concreto: el archivo de nómina **no trae fecha de
     * término**, y 99 de las 145 personas tienen contrato temporal, que nuestro
     * modelo la exige (de ahí sale la vigencia del documento `contrato`, D-41).
     * O se rechazaban 99 de 145, o se dejaba pasar sin fecha. Se deja pasar,
     * pero **marcado**: mientras `'fechaTerminoContrato'` esté en esta lista, la
     * validación omite ESA regla y sólo ésa.
     *
     * Dos candados para que no sea una puerta trasera:
     * 1. No está en la lista blanca de `updateAffiliationValidation`, así que no
     *    se puede poner desde `PATCH /adscripciones/:id`. Sólo lo escribe el
     *    importador.
     * 2. En cuanto alguien captura la fecha, se sale sola de la lista
     *    (`affiliationService.update`).
     */
    datosPendientes: {
      type: [
        {
          type: String,
          enum: { values: DATOS_PENDIENTES, message: 'Dato pendiente no válido' }
        }
      ],
      default: []
    },

    /** Baja de ESTA empresa. No implica baja del sistema ni borra su expediente. */
    activo: { type: Boolean, default: true },
    motivoBaja: { type: String, trim: true, default: null },
    fechaBaja: {
      type: String,
      default: null,
      validate: {
        validator: (v) => v === null || isCalendarDate(v),
        message: 'La fecha de baja debe tener el formato AAAA-MM-DD'
      }
    }
  },
  {
    timestamps: true,
    collection: 'affiliations',
    toJSON: {
      versionKey: false,
      transform(doc, ret) {
        return {
          _id: ret._id.toString(),
          empresaId: idAString(ret.empresaId),
          empleadoId: idAString(ret.empleadoId),
          areas: ret.areas || [],
          departamento: ret.departamento ?? null,
          tipoContrato: ret.tipoContrato,
          fechaIngreso: ret.fechaIngreso,
          fechaTerminoContrato: ret.fechaTerminoContrato ?? null,
          datosPendientes: ret.datosPendientes || [],
          // `nomina` NO se serializa: datos sensibles, ver payrollSchema.
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
// Única por par: si alguien vuelve a la misma empresa, se REACTIVA la adscripción
// existente; no se crea otra.
affiliationSchema.index({ empresaId: 1, empleadoId: 1 }, { unique: true })
affiliationSchema.index({ empresaId: 1, activo: 1, areas: 1 })
affiliationSchema.index({ empleadoId: 1, activo: 1 })
/*
 * El número de empleado YA NO VIVE AQUÍ: es de la persona y único en todo el
 * grupo (D-54). El índice `(empresaId, numeroEmpleado)` se fue con él;
 * `npm run db:indices` lo borra.
 */

affiliationSchema.pre('validate', function forzarInvariantes(next) {
  // El importador puede dejar la fecha de término pendiente (D-46); esa es la
  // ÚNICA regla que se omite, y sólo mientras esté marcada.
  const terminoPendiente = (this.datosPendientes || []).includes('fechaTerminoContrato')

  if (isTemporaryContract(this.tipoContrato)) {
    if (!this.fechaTerminoContrato) {
      if (!terminoPendiente) {
        this.invalidate(
          'fechaTerminoContrato',
          'Un contrato temporal necesita fecha de término'
        )
      }
    } else if (
      isCalendarDate(this.fechaTerminoContrato) &&
      isCalendarDate(this.fechaIngreso) &&
      !isAfter(this.fechaTerminoContrato, this.fechaIngreso)
    ) {
      this.invalidate(
        'fechaTerminoContrato',
        'La fecha de término debe ser posterior a la fecha de ingreso'
      )
    }
  } else if (this.fechaTerminoContrato) {
    this.fechaTerminoContrato = null
  }

  /*
   * Un pendiente deja de estar pendiente en cuanto se llena, y se limpia AQUÍ y
   * no en el servicio a propósito: así vale para cualquier camino que escriba la
   * adscripción —el `PATCH`, la re-importación o un script— y no sólo para el
   * que se acordó de quitarlo.
   */
  if (
    (this.fechaTerminoContrato || !isTemporaryContract(this.tipoContrato)) &&
    terminoPendiente
  ) {
    this.datosPendientes = this.datosPendientes.filter(
      (dato) => dato !== 'fechaTerminoContrato'
    )
  }

  if (!this.activo && !this.motivoBaja) {
    this.invalidate('motivoBaja', 'Indica el motivo de la baja')
  }
  if (this.activo) {
    this.motivoBaja = null
    this.fechaBaja = null
  }

  next()
})

const Affiliation = mongoose.model('Affiliation', affiliationSchema)

module.exports = Affiliation
module.exports.DATOS_PENDIENTES = DATOS_PENDIENTES
