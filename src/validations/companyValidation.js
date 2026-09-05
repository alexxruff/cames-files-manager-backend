const { body, param, query } = require('express-validator')
const { MODULE_KEYS } = require('../utils/modules')

// RFC de persona moral (12) o física (13).
const PATRON_RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/

/**
 * Registros patronales en el ALTA de la empresa (D-65). Ya no son cadenas sino
 * objetos con número y descripción; el `_id` lo pone la base.
 */
const reglasRegistros = () =>
  body('registrosPatronales')
    .optional()
    .isArray()
    .withMessage('registrosPatronales debe ser una lista')
    .bail()
    .custom((lista) => {
      for (const r of lista || []) {
        const numero = r && typeof r === 'object' ? r.numero : r
        if (
          typeof numero !== 'string' ||
          numero.trim().length < 3 ||
          numero.trim().length > 30
        ) {
          throw new Error(
            'Cada registro patronal necesita un número de entre 3 y 30 caracteres'
          )
        }
      }
      return true
    })

const numeroRegistro = (obligatorio) => {
  const regla = body('numero')
  return (obligatorio ? regla : regla.optional())
    .trim()
    .isLength({ min: 3, max: 30 })
    .withMessage('El número debe tener entre 3 y 30 caracteres')
}

const descripcionRegistro = () =>
  body('descripcion')
    .optional({ values: 'null' })
    .trim()
    .isLength({ max: 120 })
    .withMessage('La descripción no puede exceder 120 caracteres')

exports.addEmployerRegistrationValidation = [
  param('id').isMongoId().withMessage('La empresa indicada no es válida'),
  numeroRegistro(true),
  descripcionRegistro()
]

exports.updateEmployerRegistrationValidation = [
  param('id').isMongoId().withMessage('La empresa indicada no es válida'),
  param('rpId').isMongoId().withMessage('El registro patronal indicado no es válido'),
  body().custom((cuerpo) => {
    if (Object.keys(cuerpo || {}).length === 0)
      throw new Error('No hay nada que actualizar')
    return true
  }),
  numeroRegistro(false),
  descripcionRegistro()
]

exports.employerRegistrationEstadoValidation = [
  param('id').isMongoId().withMessage('La empresa indicada no es válida'),
  param('rpId').isMongoId().withMessage('El registro patronal indicado no es válido'),
  body('activo').isBoolean().withMessage('activo debe ser verdadero o falso')
]

/**
 * Los módulos ACTIVOS que manda la pantalla (D-95). Es la lista completa, no un
 * cambio: lo que no venga y sea opcional queda apagado.
 *
 * Se validan contra el catálogo para que una clave inventada no se guarde en
 * silencio y deje una sección apagada que nadie sabe encender.
 */
const reglasModulos = (obligatorio) => {
  const regla = body('modulos')
  return (obligatorio ? regla : regla.optional())
    .isArray()
    .withMessage('modulos debe ser una lista')
    .bail()
    .custom((lista) => {
      const invalidos = (lista || []).filter((clave) => !MODULE_KEYS.includes(clave))
      if (invalidos.length > 0) {
        throw new Error(`Estos módulos no existen: ${invalidos.join(', ')}`)
      }
      return true
    })
}

exports.companyModulesValidation = [
  param('id').isMongoId().withMessage('La empresa indicada no es válida'),
  reglasModulos(true)
]

exports.listCompaniesValidation = [
  query('incluirInactivas')
    .optional()
    .isIn(['true', 'false'])
    .withMessage('incluirInactivas debe ser true o false'),
  query('busqueda')
    .optional()
    .trim()
    .isLength({ max: 120 })
    .withMessage('La búsqueda no puede exceder 120 caracteres')
]

exports.companyIdValidation = [
  param('id').isMongoId().withMessage('La empresa indicada no es válida')
]

exports.createCompanyValidation = [
  body('nombre')
    .trim()
    .notEmpty()
    .withMessage('El nombre de la empresa es requerido')
    .bail()
    .isLength({ min: 3, max: 120 })
    .withMessage('El nombre debe tener entre 3 y 120 caracteres'),
  body('rfc')
    .optional({ values: 'falsy' })
    .trim()
    .toUpperCase()
    .matches(PATRON_RFC)
    .withMessage('El RFC no tiene un formato válido'),
  body('activo').optional().isBoolean().withMessage('activo debe ser verdadero o falso'),
  reglasRegistros(),
  reglasModulos(false)
]

exports.updateCompanyValidation = [
  param('id').isMongoId().withMessage('La empresa indicada no es válida'),
  body().custom((cuerpo) => {
    const campos = Object.keys(cuerpo || {})
    if (campos.length === 0) throw new Error('No hay nada que actualizar')

    const permitidos = ['nombre', 'rfc', 'branding', 'configuracion']
    const invalidos = campos.filter((c) => !permitidos.includes(c))
    if (invalidos.length > 0) {
      const pistas = {
        activo: 'PATCH /empresas/:id/estado',
        // D-95: se encienden y apagan en su propia ruta.
        modulos: 'PATCH /empresas/:id/modulos',
        // D-65: dejaron de ser una lista de cadenas y tienen sus propias rutas.
        registrosPatronales: 'POST /empresas/:id/registros-patronales'
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
  body('rfc')
    .optional({ values: 'falsy' })
    .trim()
    .toUpperCase()
    .matches(PATRON_RFC)
    .withMessage('El RFC no tiene un formato válido')
]

exports.companyEstadoValidation = [
  param('id').isMongoId().withMessage('La empresa indicada no es válida'),
  body('activo').isBoolean().withMessage('activo debe ser verdadero o falso')
]

exports.PATRON_RFC = PATRON_RFC
