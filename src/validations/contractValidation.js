const { body, param, query } = require('express-validator')
const { isCalendarDate } = require('../utils/dates')

/**
 * Contratos y SIROC (D-70).
 *
 * `numero` NO se valida en ninguna parte porque **no llega del cliente**: es una
 * secuencia dentro del proyecto y la asigna el servidor.
 */

const CAMPOS_EDITABLES = ['nombre', 'fase', 'fechaInicio', 'fechaFin']

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
  fecha('fechaFin', 'La fecha de fin')
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

exports.updateContractValidation = [
  param('id').isMongoId().withMessage('El contrato indicado no es válido'),
  body().custom((cuerpo, { req }) => {
    const campos = Object.keys(cuerpo || {})
    /*
     * Un `multipart` con SÓLO el archivo no trae campos, y es una petición
     * legítima: así se le adjunta el papel a un contrato ya capturado (D-81).
     */
    if (campos.length === 0 && !req.file) throw new Error('No hay nada que actualizar')

    const invalidos = campos.filter((c) => !CAMPOS_EDITABLES.includes(c))
    if (invalidos.length > 0) {
      const pistas = {
        siroc: 'usa PUT /contratos/:id/siroc',
        estado: 'usa POST /contratos/:id/finalizar o /reabrir',
        activo: 'usa PATCH /contratos/:id/estado',
        numero: 'el número lo asigna el servidor y no se cambia',
        proyectoId: 'un contrato no cambia de proyecto'
      }
      const detalle = invalidos
        .map((c) => (pistas[c] ? `${c} (${pistas[c]})` : c))
        .join(', ')
      throw new Error(`Estos campos no se pueden actualizar aquí: ${detalle}`)
    }
    return true
  }),
  nombreContrato(),
  faseContrato(),
  fecha('fechaInicio', 'La fecha de inicio', { obligatoria: false }),
  fecha('fechaFin', 'La fecha de fin', { obligatoria: false })
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
  fecha('fechaRegistro', 'La fecha de registro')
  /*
   * NO se pide fecha final (D-76). El aviso vale dos meses desde el registro —o
   * desde la última actualización— y esa vigencia se deriva, así que capturarla
   * sólo servía para contradecirla. `vigenciaHasta` se sigue aceptando en el
   * cuerpo y se ignora, para que el front pueda quitar el campo de su formulario
   * sin quedarse sin registrar SIROCs mientras tanto.
   */
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
      (c) => !['fecha', 'nota'].includes(c)
    )
    if (invalidos.length > 0) {
      const pistas = {
        numero: 'actualizar el SIROC conserva el mismo número',
        fechaRegistro: 'usa PUT /contratos/:id/siroc para corregir el registro',
        vigenciaHasta:
          'el SIROC no tiene fecha final: vence dos meses después de esta actualización'
      }
      const detalle = invalidos
        .map((c) => (pistas[c] ? `${c} (${pistas[c]})` : c))
        .join(', ')
      throw new Error(`Estos campos no se pueden enviar aquí: ${detalle}`)
    }
    return true
  }),
  fecha('fecha', 'La fecha de la actualización', { obligatoria: false }),
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
    .withMessage('La actualización indicada no es válida')
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
    .withMessage('La actualización indicada no es válida')
    .toInt(),
  body().custom((_cuerpo, { req }) => {
    if (!req.file) throw new Error('Envía el archivo en el campo "archivo"')
    return true
  })
]

exports.CAMPOS_EDITABLES = CAMPOS_EDITABLES
