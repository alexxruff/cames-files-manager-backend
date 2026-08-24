const { body, param } = require('express-validator')
const { DOCUMENT_TYPES } = require('../constants')
const { isCalendarDate } = require('../utils/dates')

exports.recordIdValidation = [
  param('id').isMongoId().withMessage('El expediente indicado no es válido')
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
