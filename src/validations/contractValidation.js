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

exports.contractIdValidation = [
  param('id').isMongoId().withMessage('El contrato indicado no es válido')
]

exports.updateContractValidation = [
  param('id').isMongoId().withMessage('El contrato indicado no es válido'),
  body().custom((cuerpo) => {
    const campos = Object.keys(cuerpo || {})
    if (campos.length === 0) throw new Error('No hay nada que actualizar')

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
  fecha('fechaRegistro', 'La fecha de registro'),
  fecha('vigenciaHasta', 'La vigencia', { obligatoria: false })
]

exports.CAMPOS_EDITABLES = CAMPOS_EDITABLES
