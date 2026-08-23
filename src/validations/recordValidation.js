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

exports.documentVersionValidation = [
  param('id').isMongoId().withMessage('El expediente indicado no es válido'),
  param('tipo')
    .isIn(DOCUMENT_TYPES)
    .withMessage('Ese tipo de documento no existe en el checklist'),
  param('version').isInt({ min: 1 }).withMessage('La versión debe ser 1 o mayor')
]
