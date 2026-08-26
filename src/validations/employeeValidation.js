const { body, param, query } = require('express-validator')
const { ACCESS_LEVELS, AREAS, CONTRACT_TYPES, EMPLOYEE_TYPES } = require('../constants')
const { isCalendarDate } = require('../utils/dates')

const PATRON_PASSWORD = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[!@#$%^&*]).*$/

const flagOpcional = (campo) =>
  query(campo)
    .optional()
    .isIn(['true', 'false'])
    .withMessage(`${campo} debe ser true o false`)

exports.listEmployeesValidation = [
  query('busqueda')
    .optional()
    .trim()
    .isLength({ max: 120 })
    .withMessage('La búsqueda no puede exceder 120 caracteres'),
  query('empresaId')
    .optional()
    .isMongoId()
    .withMessage('La empresa indicada no es válida'),
  query('area').optional().isIn(AREAS).withMessage('Selecciona un área válida'),
  query('tipo').optional().isIn(EMPLOYEE_TYPES).withMessage('Selecciona un tipo válido'),
  query('categoriaId')
    .optional()
    .isMongoId()
    .withMessage('Selecciona una categoría válida'),
  flagOpcional('soloConAcceso'),
  query('activo')
    .optional()
    .isIn(['true', 'false', 'todos'])
    .withMessage('activo debe ser true, false o todos'),
  query('orden')
    .optional()
    .isIn(['nombre_asc', 'nombre_desc', 'numero_asc', 'numero_desc'])
    .withMessage('El orden debe ser nombre_asc, nombre_desc, numero_asc o numero_desc'),
  query('pagina')
    .optional()
    .isInt({ min: 1 })
    .withMessage('La página debe ser 1 o mayor'),
  query('porPagina')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('porPagina debe estar entre 1 y 100')
]

/** Formato de CURP. La validación de unicidad es del servicio. */
const PATRON_CURP = /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/

const fechaCalendario = (campo, etiqueta) =>
  body(campo)
    .optional({ values: 'falsy' })
    .custom((valor) => {
      if (!isCalendarDate(valor)) {
        throw new Error(`${etiqueta} debe tener el formato AAAA-MM-DD`)
      }
      return true
    })

exports.createEmployeeValidation = [
  body('nombre')
    .trim()
    .notEmpty()
    .withMessage('El nombre es requerido')
    .bail()
    .isLength({ min: 3, max: 120 })
    .withMessage('El nombre debe tener entre 3 y 120 caracteres'),

  body('tipo')
    .isIn(EMPLOYEE_TYPES)
    .withMessage('El tipo debe ser administrativo o mano_de_obra'),

  body('categoriaId').isMongoId().withMessage('Selecciona una categoría válida'),

  /**
   * Se pide SIEMPRE, con o sin empresa (D-54). Antes colgaba de `adscripcion` y
   * por eso el alta sin empresa —la del administrador de plataforma— era la
   * única que no lo capturaba; ahora es de la persona y no depende de nadie.
   */
  body('numeroEmpleado')
    .trim()
    .notEmpty()
    .withMessage('El número de trabajador es requerido')
    .bail()
    .isLength({ max: 30 })
    .withMessage('El número de trabajador no puede exceder 30 caracteres'),

  body('curp')
    .optional({ values: 'falsy' })
    .trim()
    .toUpperCase()
    .matches(PATRON_CURP)
    .withMessage('La CURP no tiene un formato válido'),

  body('rfc')
    .optional({ values: 'falsy' })
    .trim()
    .toUpperCase()
    .isLength({ max: 13 })
    .withMessage('El RFC no puede exceder 13 caracteres'),
  body('nss')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 11 })
    .withMessage('El NSS no puede exceder 11 caracteres'),
  fechaCalendario('fechaNacimiento', 'La fecha de nacimiento'),
  body('email')
    .optional({ values: 'falsy' })
    .trim()
    .isEmail()
    .withMessage('Escribe un correo válido')
    .normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false }),
  body('telefono')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 20 })
    .withMessage('El teléfono no puede exceder 20 caracteres'),

  /** Sólo el administrador de plataforma puede omitirla; lo verifica el servicio. */
  body('adscripcion')
    .optional()
    .isObject()
    .withMessage('La adscripción debe ser un objeto'),
  body('adscripcion.empresaId')
    .if(body('adscripcion').exists())
    .isMongoId()
    .withMessage('Selecciona una empresa válida'),
  body('adscripcion.tipoContrato')
    .if(body('adscripcion').exists())
    .isIn(CONTRACT_TYPES)
    .withMessage('Selecciona un tipo de contrato válido'),
  body('adscripcion.fechaIngreso')
    .if(body('adscripcion').exists())
    .custom((valor) => {
      if (!isCalendarDate(valor)) {
        throw new Error('La fecha de ingreso debe tener el formato AAAA-MM-DD')
      }
      return true
    }),
  fechaCalendario('adscripcion.fechaTerminoContrato', 'La fecha de término'),
  body('adscripcion.areas')
    .optional()
    .isArray()
    .withMessage('Las áreas deben ser una lista')
    .bail()
    .custom((areas) => {
      const invalidas = (areas || []).filter((a) => !AREAS.includes(a))
      if (invalidas.length > 0) {
        throw new Error(`Áreas no válidas: ${invalidas.join(', ')}`)
      }
      return true
    }),

  /** Confirma que un posible duplicado por nombre es otra persona. */
  body('confirmarDuplicado')
    .optional()
    .isBoolean()
    .withMessage('confirmarDuplicado debe ser verdadero o falso')
]

/** Campos que `PATCH /empleados/:id` acepta. Cualquier otro → 400. */
const CAMPOS_EDITABLES = [
  'nombre',
  'numeroEmpleado',
  'curp',
  'rfc',
  'nss',
  'fechaNacimiento',
  'email',
  'telefono',
  'categoriaId',
  'tipo'
]

exports.updateEmployeeValidation = [
  param('id').isMongoId().withMessage('El empleado indicado no es válido'),
  body().custom((cuerpo) => {
    const campos = Object.keys(cuerpo || {})
    if (campos.length === 0) throw new Error('No hay nada que actualizar')

    const invalidos = campos.filter((c) => !CAMPOS_EDITABLES.includes(c))
    if (invalidos.length > 0) {
      // Se dice a dónde van los campos que no se editan aquí, para no obligar a
      // revisar la documentación.
      const pistas = {
        acceso: 'PATCH /empleados/:id/acceso',
        activo: 'PATCH /empleados/:id/estado',
        motivoBaja: 'PATCH /empleados/:id/estado',
        fechaBaja: 'PATCH /empleados/:id/estado',
        adscripcion: 'las adscripciones tienen su propio recurso',
        adscripciones: 'las adscripciones tienen su propio recurso'
      }
      const detalle = invalidos
        .map((c) => (pistas[c] ? `${c} (usa ${pistas[c]})` : c))
        .join(', ')
      throw new Error(`Estos campos no se pueden actualizar aquí: ${detalle}`)
    }
    return true
  }),
  body('nombre')
    .optional()
    .trim()
    .isLength({ min: 3, max: 120 })
    .withMessage('El nombre debe tener entre 3 y 120 caracteres'),
  /**
   * Editable (D-54), y a diferencia de los demás opcionales NO acepta `null`:
   * el alta lo exige, así que vaciarlo dejaría a alguien en un estado que el
   * alta no permite crear. Para corregir un número se manda el nuevo.
   */
  body('numeroEmpleado')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('El número de trabajador es requerido')
    .bail()
    .isLength({ max: 30 })
    .withMessage('El número de trabajador no puede exceder 30 caracteres'),
  body('tipo')
    .optional()
    .isIn(EMPLOYEE_TYPES)
    .withMessage('El tipo debe ser administrativo o mano_de_obra'),
  body('categoriaId')
    .optional()
    .isMongoId()
    .withMessage('Selecciona una categoría válida'),
  body('curp')
    .optional({ values: 'null' })
    .trim()
    .toUpperCase()
    .matches(PATRON_CURP)
    .withMessage('La CURP no tiene un formato válido'),
  body('rfc')
    .optional({ values: 'null' })
    .trim()
    .toUpperCase()
    .isLength({ max: 13 })
    .withMessage('El RFC no puede exceder 13 caracteres'),
  body('nss')
    .optional({ values: 'null' })
    .trim()
    .isLength({ max: 11 })
    .withMessage('El NSS no puede exceder 11 caracteres'),
  fechaCalendario('fechaNacimiento', 'La fecha de nacimiento'),
  body('email')
    .optional({ values: 'null' })
    .trim()
    .isEmail()
    .withMessage('Escribe un correo válido')
    .normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false }),
  body('telefono')
    .optional({ values: 'null' })
    .trim()
    .isLength({ max: 20 })
    .withMessage('El teléfono no puede exceder 20 caracteres')
]

exports.employeeEstadoValidation = [
  param('id').isMongoId().withMessage('El empleado indicado no es válido'),
  body('activo').isBoolean().withMessage('activo debe ser verdadero o falso'),
  body('motivo')
    .if(body('activo').equals('false'))
    .trim()
    .notEmpty()
    .withMessage('Indica el motivo de la baja')
    .bail()
    .isLength({ min: 5, max: 200 })
    .withMessage('El motivo debe tener entre 5 y 200 caracteres'),
  fechaCalendario('fecha', 'La fecha de baja')
]

exports.employeeIdValidation = [
  param('id').isMongoId().withMessage('El empleado indicado no es válido')
]

const reglaPassword = (campo = 'password') =>
  body(campo)
    .notEmpty()
    .withMessage('La contraseña es requerida')
    .bail()
    .isLength({ min: 8 })
    .withMessage('La contraseña debe tener al menos 8 caracteres')
    .matches(PATRON_PASSWORD)
    .withMessage(
      'La contraseña necesita una mayúscula, una minúscula, un número y uno de estos símbolos: !@#$%^&*'
    )

/** Campos que acepta conceder o editar un acceso. */
const CAMPOS_ACCESO = ['email', 'password', 'nivelAcceso', 'alcanceGlobal', 'activo']

exports.grantAccessValidation = [
  param('id').isMongoId().withMessage('El empleado indicado no es válido'),
  body('email')
    .trim()
    .notEmpty()
    .withMessage('El correo de acceso es requerido')
    .bail()
    .isEmail()
    .withMessage('Escribe un correo válido')
    .normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false }),
  reglaPassword(),
  body('nivelAcceso')
    .isIn(ACCESS_LEVELS)
    .withMessage('Selecciona un nivel de acceso válido'),
  body('alcanceGlobal')
    .optional()
    .isBoolean()
    .withMessage('alcanceGlobal debe ser verdadero o falso')
    .custom((valor, { req }) => {
      // El alcance global es el administrador de plataforma: sólo sobre rh_admin.
      if (valor === true && req.body.nivelAcceso !== 'rh_admin') {
        throw new Error('El alcance global sólo se puede dar a un administrador de RH')
      }
      return true
    })
]

exports.updateAccessValidation = [
  param('id').isMongoId().withMessage('El empleado indicado no es válido'),
  body().custom((cuerpo) => {
    const campos = Object.keys(cuerpo || {})
    const invalidos = campos.filter((c) => !CAMPOS_ACCESO.includes(c) || c === 'password')
    if (invalidos.length > 0) {
      throw new Error(
        `Estos campos no se pueden actualizar aquí: ${invalidos.join(', ')}`
      )
    }
    if (campos.length === 0) throw new Error('No hay nada que actualizar')
    return true
  }),
  body('email')
    .optional()
    .trim()
    .isEmail()
    .withMessage('Escribe un correo válido')
    .normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false }),
  body('nivelAcceso')
    .optional()
    .isIn(ACCESS_LEVELS)
    .withMessage('Selecciona un nivel de acceso válido'),
  body('alcanceGlobal')
    .optional()
    .isBoolean()
    .withMessage('alcanceGlobal debe ser verdadero o falso'),
  body('activo').optional().isBoolean().withMessage('activo debe ser verdadero o falso')
]

exports.resetPasswordValidation = [
  param('id').isMongoId().withMessage('El empleado indicado no es válido'),
  reglaPassword()
]

exports.PATRON_PASSWORD = PATRON_PASSWORD
exports.PATRON_CURP = PATRON_CURP
exports.CAMPOS_EDITABLES = CAMPOS_EDITABLES
exports.CAMPOS_ACCESO = CAMPOS_ACCESO
