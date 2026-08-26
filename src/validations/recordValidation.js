const { body, param, query } = require('express-validator')
const { DOCUMENT_TYPES, EMPLOYEE_TYPES, RECORD_STATUSES } = require('../constants')
const { isCalendarDate } = require('../utils/dates')

exports.recordIdValidation = [
  param('id').isMongoId().withMessage('El expediente indicado no es válido')
]

/** GET /expedientes — mismos filtros que /empleados (D-45), más `estatus`. */
exports.listRecordsValidation = [
  query('busqueda')
    .optional()
    .trim()
    .isLength({ max: 120 })
    .withMessage('La búsqueda no puede exceder 120 caracteres'),
  query('empresaId')
    .optional()
    .isMongoId()
    .withMessage('La empresa indicada no es válida'),
  query('area')
    .optional()
    .matches(/^[a-z0-9_]+$/)
    .withMessage('Selecciona un área válida'),
  query('tipo').optional().isIn(EMPLOYEE_TYPES).withMessage('Selecciona un tipo válido'),
  query('estatus')
    .optional()
    .isIn(RECORD_STATUSES)
    .withMessage(`estatus debe ser uno de: ${RECORD_STATUSES.join(', ')}`),
  query('activo')
    .optional()
    .isIn(['true', 'false', 'todos'])
    .withMessage('activo debe ser true, false o todos'),
  query('orden')
    .optional()
    .isIn(['nombre_asc', 'nombre_desc'])
    .withMessage('El orden debe ser nombre_asc o nombre_desc'),
  query('pagina')
    .optional()
    .isInt({ min: 1 })
    .withMessage('La página debe ser 1 o mayor'),
  query('porPagina')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('porPagina debe estar entre 1 y 100')
]

exports.uploadDocumentValidation = [
  param('id').isMongoId().withMessage('El expediente indicado no es válido'),
  param('tipo')
    .isIn(DOCUMENT_TYPES)
    .withMessage('Ese tipo de documento no existe en el checklist'),
  /*
   * `vigenciaHasta` llega como campo de texto del multipart. Si el documento
   * caduca y no viene, el servicio la deriva o responde 400: la regla depende del
   * tipo de documento y de los contratos de la persona, así que no cabe aquí.
   */
  body('vigenciaHasta')
    .optional({ values: 'falsy' })
    .custom((valor) => {
      if (!isCalendarDate(valor)) {
        throw new Error('La vigencia debe tener el formato AAAA-MM-DD')
      }
      return true
    })
]

exports.reviewDocumentValidation = [
  param('id').isMongoId().withMessage('El expediente indicado no es válido'),
  param('tipo')
    .isIn(DOCUMENT_TYPES)
    .withMessage('Ese tipo de documento no existe en el checklist'),
  body('aprobado').isBoolean().withMessage('Indica si se aprueba: true o false'),
  /*
   * `motivo` sólo aplica al rechazo. Con `aprobado: true` no se exige, aunque
   * venga: no tiene sentido guardar un motivo en un documento validado.
   */
  body('motivo')
    .if(body('aprobado').equals('false'))
    .trim()
    .isLength({ min: 10 })
    .withMessage('El motivo del rechazo debe tener al menos 10 caracteres')
]

exports.documentVersionValidation = [
  param('id').isMongoId().withMessage('El expediente indicado no es válido'),
  param('tipo')
    .isIn(DOCUMENT_TYPES)
    .withMessage('Ese tipo de documento no existe en el checklist'),
  param('version').isInt({ min: 1 }).withMessage('La versión debe ser 1 o mayor')
]
