const { body, param, query } = require('express-validator')
const { isCalendarDate } = require('../utils/dates')
const { subidaIdOpcional } = require('./uploadValidation')
const { MONTO_MAXIMO_CONTRATO } = require('../constants')

/**
 * Contratos y SIROC (D-70).
 *
 * `numero` NO se valida en ninguna parte porque **no llega del cliente**: es una
 * secuencia dentro del proyecto y la asigna el servidor.
 */

const fecha = (campo, etiqueta, { obligatoria = true } = {}) => {
  const regla = body(campo)
  return (obligatoria ? regla : regla.optional({ values: 'null' })).custom((valor) => {
    if (valor === null) return true
    if (!isCalendarDate(valor)) {
      throw new Error(`${etiqueta} debe tener el formato AAAA-MM-DD`)
    }
    return true
  })
}

/**
 * El monto en pesos, IVA incluido (D-90). Llega como número en JSON y como
 * cadena en `multipart`, así que se convierte antes de mirarlo. `0` es una cifra
 * válida —alguien la tecleó— y por eso `exists` no usa `falsy`: lo que no se
 * acepta es que falte.
 */
const monto = (etiqueta) =>
  body('monto')
    .exists({ values: 'null' })
    .withMessage(`${etiqueta} es requerido`)
    .bail()
    .customSanitizer((v) => (v === '' ? null : Number(v)))
    .custom((valor) => {
      if (!Number.isFinite(valor)) {
        throw new Error(`${etiqueta} debe ser un número en pesos`)
      }
      if (valor < 0) throw new Error(`${etiqueta} no puede ser negativo`)
      if (valor > MONTO_MAXIMO_CONTRATO) {
        throw new Error(`${etiqueta} no puede exceder ${MONTO_MAXIMO_CONTRATO}`)
      }
      return true
    })

/**
 * `nombre` y `fase` se validan igual: opcionales, se recortan, y el vacío es una
 * forma legítima de decir «no tiene» — el servicio lo guarda como `null`.
 */
const etiqueta = (campo, mensajeLargo) =>
  body(campo)
    .optional({ values: 'null' })
    .customSanitizer((v) => (typeof v === 'string' ? v.trim() : v))
    .custom((valor) => {
      if (valor === null || valor === undefined || valor === '') return true
      if (String(valor).length > 120) throw new Error(mensajeLargo)
      return true
    })

const nombreContrato = () =>
  etiqueta('nombre', 'El nombre no puede exceder 120 caracteres')
const faseContrato = () => etiqueta('fase', 'La fase no puede exceder 120 caracteres')

exports.listContractsValidation = [
  param('id').isMongoId().withMessage('El proyecto indicado no es válido'),
  query('incluirInactivos')
    .optional()
    .isIn(['true', 'false'])
    .withMessage('incluirInactivos debe ser true o false')
]

exports.createContractValidation = [
  param('id').isMongoId().withMessage('El proyecto indicado no es válido'),
  nombreContrato(),
  faseContrato(),
  fecha('fechaInicio', 'La fecha de inicio'),
  fecha('fechaFin', 'La fecha de fin'),
  monto('El monto del contrato'),
  subidaIdOpcional
]

/**
 * Pedir un enlace fresco al contrato escaneado (D-81). Sólo el id y la bandera
 * de descarga: no hay cuerpo.
 */
exports.contractFileValidation = [
  param('id').isMongoId().withMessage('El contrato indicado no es válido'),
  query('descargar')
    .optional()
    .isBoolean()
    .withMessage('descargar debe ser verdadero o falso')
]

exports.contractIdValidation = [
  param('id').isMongoId().withMessage('El contrato indicado no es válido')
]

/**
 * Subir el contrato escaneado (D-90). El archivo es **obligatorio**: es lo único
 * que hace esta ruta, que es lo que quedó del `PATCH` que se fue.
 */
exports.contractFileUploadValidation = [
  param('id').isMongoId().withMessage('El contrato indicado no es válido'),
  body().custom((cuerpo, { req }) => {
    if (!req.file && !cuerpo?.subidaId) {
      throw new Error('Envía el archivo en el campo "archivo", o su `subidaId`')
    }
    return true
  }),
  subidaIdOpcional
]

/**
 * Registrar una modificación del contrato (D-90).
 *
 * Las tres cosas que se repactan —fechas y monto— son **obligatorias**: una
 * modificación es el nuevo estado completo de lo pactado, no un parche de un
 * campo. `fechaAcuerdo` es opcional y sin ella se asume hoy; `motivo` también.
 */
exports.contractModificacionValidation = [
  param('id').isMongoId().withMessage('El contrato indicado no es válido'),
  body().custom((cuerpo) => {
    const permitidos = [
      'fechaInicio',
      'fechaFin',
      'monto',
      'motivo',
      'fechaAcuerdo',
      // `subidaId` no es un dato de la modificación: dice dónde está su convenio.
      'subidaId'
    ]
    const invalidos = Object.keys(cuerpo || {}).filter((c) => !permitidos.includes(c))
    if (invalidos.length > 0) {
      const pistas = {
        nombre:
          'el nombre y la fase no se modifican: elimina el contrato y captúralo de nuevo',
        fase: 'el nombre y la fase no se modifican: elimina el contrato y captúralo de nuevo',
        numero: 'el número lo asigna el servidor y no se cambia',
        siroc: 'usa PUT /contratos/:id/siroc'
      }
      const detalle = invalidos
        .map((c) => (pistas[c] ? `${c} (${pistas[c]})` : c))
        .join(', ')
      throw new Error(`Estos campos no se pueden enviar aquí: ${detalle}`)
    }
    return true
  }),
  fecha('fechaInicio', 'La fecha de inicio'),
  fecha('fechaFin', 'La fecha de fin'),
  monto('El monto de la modificación'),
  fecha('fechaAcuerdo', 'La fecha del acuerdo', { obligatoria: false }),
  body('motivo')
    .optional({ values: 'null' })
    .customSanitizer((v) => (typeof v === 'string' ? v.trim() : v))
    .custom((valor) => {
      if (valor === null || valor === undefined || valor === '') return true
      if (String(valor).length > 300) {
        throw new Error('El motivo no puede exceder 300 caracteres')
      }
      return true
    }),
  subidaIdOpcional
]

/**
 * El convenio de una modificación concreta. Se direcciona por **posición**,
 * igual que el acuse de un reporte bimestral.
 */
exports.contractModificacionFileValidation = [
  param('id').isMongoId().withMessage('El contrato indicado no es válido'),
  param('indice')
    .isInt({ min: 0 })
    .withMessage('La modificación indicada no es válida')
    .toInt(),
  query('descargar')
    .optional()
    .isBoolean()
    .withMessage('descargar debe ser verdadero o falso')
]

/** Adjuntarle el convenio a una modificación ya capturada. El archivo manda. */
exports.contractModificacionFileUploadValidation = [
  param('id').isMongoId().withMessage('El contrato indicado no es válido'),
  param('indice')
    .isInt({ min: 0 })
    .withMessage('La modificación indicada no es válida')
    .toInt(),
  body().custom((cuerpo, { req }) => {
    if (!req.file && !cuerpo?.subidaId) {
      throw new Error('Envía el archivo en el campo "archivo", o su `subidaId`')
    }
    return true
  }),
  subidaIdOpcional
]

exports.contractEstadoValidation = [
  param('id').isMongoId().withMessage('El contrato indicado no es válido'),
  body('activo').isBoolean().withMessage('activo debe ser verdadero o falso')
]

exports.setSirocValidation = [
  param('id').isMongoId().withMessage('El contrato indicado no es válido'),
  body('numero')
    .exists({ values: 'falsy' })
    .withMessage('El número de SIROC es requerido')
    .bail()
    .trim()
    .isLength({ min: 3, max: 40 })
    .withMessage('El número de SIROC debe tener entre 3 y 40 caracteres'),
  fecha('fechaRegistro', 'La fecha de registro'),
  /*
   * NO se pide fecha final (D-76). El aviso vale dos meses desde el registro —o
   * desde la última actualización— y esa vigencia se deriva, así que capturarla
   * sólo servía para contradecirla. `vigenciaHasta` se sigue aceptando en el
   * cuerpo y se ignora, para que el front pueda quitar el campo de su formulario
   * sin quedarse sin registrar SIROCs mientras tanto.
   */
  subidaIdOpcional
]

/**
 * Registrar una renovación del aviso (D-76). `fecha` es opcional: sin ella se
 * asume hoy, que es como se captura al volver del IMSS. El número NO se acepta
 * aquí: actualizar el SIROC conserva el mismo, y dejar mandarlo invitaría a
 * cambiarlo por error.
 */
exports.sirocRenovacionValidation = [
  param('id').isMongoId().withMessage('El contrato indicado no es válido'),
  body().custom((cuerpo) => {
    const invalidos = Object.keys(cuerpo || {}).filter(
      // `subidaId` no es un dato de la renovación: dice dónde está su acuse.
      (c) => !['fecha', 'nota', 'subidaId'].includes(c)
    )
    if (invalidos.length > 0) {
      const pistas = {
        numero: 'reportar el SIROC conserva el mismo número',
        fechaRegistro: 'usa PUT /contratos/:id/siroc para corregir el registro',
        vigenciaHasta:
          'el SIROC no tiene fecha final: vence dos meses después de este reporte'
      }
      const detalle = invalidos
        .map((c) => (pistas[c] ? `${c} (${pistas[c]})` : c))
        .join(', ')
      throw new Error(`Estos campos no se pueden enviar aquí: ${detalle}`)
    }
    return true
  }),
  fecha('fecha', 'La fecha del reporte bimestral', { obligatoria: false }),
  body('nota')
    .optional({ values: 'null' })
    .customSanitizer((v) => (typeof v === 'string' ? v.trim() : v))
    .custom((valor) => {
      if (valor === null || valor === undefined || valor === '') return true
      if (String(valor).length > 200) {
        throw new Error('La nota no puede exceder 200 caracteres')
      }
      return true
    })
]

/**
 * Pedir un enlace fresco al papel del aviso (D-80). Sólo el id y la bandera de
 * descarga: no hay cuerpo.
 */
exports.sirocFileValidation = [
  param('id').isMongoId().withMessage('El contrato indicado no es válido'),
  query('descargar')
    .optional()
    .isBoolean()
    .withMessage('descargar debe ser verdadero o falso')
]

/**
 * El acuse de una renovación concreta. Se direcciona por **posición** porque las
 * renovaciones no tienen `_id` (D-76), y el arreglo va en orden.
 */
exports.sirocUpdateFileValidation = [
  param('id').isMongoId().withMessage('El contrato indicado no es válido'),
  param('indice')
    .isInt({ min: 0 })
    .withMessage('El reporte bimestral indicado no es válido')
    .toInt(),
  query('descargar')
    .optional()
    .isBoolean()
    .withMessage('descargar debe ser verdadero o falso')
]

/**
 * Ponerle el acuse a una renovación ya capturada. El archivo es **obligatorio**
 * aquí —es lo único que hace esta ruta—, al revés que al capturarla.
 */
exports.sirocUpdateFileUploadValidation = [
  param('id').isMongoId().withMessage('El contrato indicado no es válido'),
  param('indice')
    .isInt({ min: 0 })
    .withMessage('El reporte bimestral indicado no es válido')
    .toInt(),
  body().custom((cuerpo, { req }) => {
    if (!req.file && !cuerpo?.subidaId) {
      throw new Error('Envía el archivo en el campo "archivo", o su `subidaId`')
    }
    return true
  }),
  subidaIdOpcional
]
