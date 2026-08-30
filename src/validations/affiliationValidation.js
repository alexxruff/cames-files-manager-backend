const { body, param, query } = require('express-validator')
const { CONTRACT_TYPES } = require('../constants')
const { isCalendarDate } = require('../utils/dates')

/** Campos de la adscripción que se pueden mandar en el alta y en el `PATCH`. */
const CAMPOS_ADSCRIPCION = [
  'areas',
  'tipoContrato',
  'fechaIngreso',
  'fechaTerminoContrato',
  // El vínculo con el catálogo de la empresa (D-72). `null` lo desvincula.
  'registroPatronalId'
]

/**
 * `registroPatronalId` — id, o `null` para desvincular.
 *
 * Se acepta `null` explícito porque hay que poder deshacer un vínculo mal puesto;
 * que **sea** de esa empresa y esté activo lo valida el servicio, que es quien
 * puede consultarla.
 */
const reglaRegistroPatronal = body('registroPatronalId')
  .optional({ nullable: true })
  .custom((valor) => {
    if (valor === null || valor === '') return true
    if (!/^[0-9a-fA-F]{24}$/.test(String(valor))) {
      throw new Error('El registro patronal indicado no es válido')
    }
    return true
  })

const fechaCalendario = (campo, etiqueta) =>
  body(campo)
    .optional({ values: 'falsy' })
    .custom((valor) => {
      if (!isCalendarDate(valor)) {
        throw new Error(`${etiqueta} debe tener el formato AAAA-MM-DD`)
      }
      return true
    })

/*
 * `areas` es opcional a nivel HTTP en los dos casos: la regla de negocio —un
 * administrativo necesita al menos una— depende del `tipo` de la persona, que
 * la validación no conoce; la aplica el servicio.
 */
const reglasAreas = body('areas')
  .optional()
  .isArray()
  .withMessage('areas debe ser una lista')
  .bail()
  .custom((areas) => {
    // Sólo el formato; el catálogo lo valida el servicio (D-58).
    const invalidas = (areas || []).filter((a) => !/^[a-z0-9_]+$/.test(String(a)))
    if (invalidas.length > 0) throw new Error(`Áreas no válidas: ${invalidas.join(', ')}`)
    return true
  })

exports.listAffiliationsValidation = [
  param('id').isMongoId().withMessage('La empresa indicada no es válida'),
  query('activo')
    .optional()
    .isIn(['true', 'false', 'todos'])
    .withMessage('activo debe ser true, false o todos'),
  query('area')
    .optional()
    .matches(/^[a-z0-9_]+$/)
    .withMessage('Selecciona un área válida'),
  /*
   * El filtro por `tipo` se fue en D-59: el desplegable de la tabla lo
   * reemplazan las áreas, y el tipo dejó de capturarse —lo dice el puesto—.
   * Sigue en la respuesta por si se quiere mostrar.
   */
  query('categoriaId')
    .optional()
    .isMongoId()
    .withMessage('Selecciona una categoría válida'),
  query('orden')
    .optional()
    .isIn(['numero_asc', 'numero_desc'])
    .withMessage('El orden debe ser numero_asc o numero_desc')
]

exports.addAffiliationValidation = [
  param('id').isMongoId().withMessage('La empresa indicada no es válida'),
  body('empleadoId').isMongoId().withMessage('Selecciona un empleado válido'),
  body('tipoContrato')
    .isIn(CONTRACT_TYPES)
    .withMessage('Selecciona un tipo de contrato válido'),
  body('fechaIngreso').custom((valor) => {
    if (!isCalendarDate(valor)) {
      throw new Error('La fecha de ingreso debe tener el formato AAAA-MM-DD')
    }
    return true
  }),
  fechaCalendario('fechaTerminoContrato', 'La fecha de término'),
  reglasAreas,
  reglaRegistroPatronal
]

exports.updateAffiliationValidation = [
  param('id').isMongoId().withMessage('La adscripción indicada no es válida'),
  body().custom((cuerpo) => {
    const campos = Object.keys(cuerpo || {})
    if (campos.length === 0) throw new Error('No hay nada que actualizar')
    const invalidos = campos.filter((c) => !CAMPOS_ADSCRIPCION.includes(c))
    if (invalidos.length > 0) {
      const pistas = {
        empresaId:
          'no se puede cambiar la empresa de una adscripción; da de baja esta y crea otra',
        empleadoId: 'no se puede cambiar la persona de una adscripción',
        activo: 'PATCH /adscripciones/:id/estado'
      }
      const detalle = invalidos
        .map((c) => (pistas[c] ? `${c} (${pistas[c]})` : c))
        .join(', ')
      throw new Error(`Estos campos no se pueden actualizar aquí: ${detalle}`)
    }
    return true
  }),
  body('tipoContrato')
    .optional()
    .isIn(CONTRACT_TYPES)
    .withMessage('Selecciona un tipo de contrato válido'),
  fechaCalendario('fechaIngreso', 'La fecha de ingreso'),
  fechaCalendario('fechaTerminoContrato', 'La fecha de término'),
  reglasAreas,
  reglaRegistroPatronal
]

/**
 * `PATCH /adscripciones/:id/jefaturas` — las áreas que dirige (D-60).
 *
 * Se manda la lista COMPLETA, no un "agrega" ni un "quita": mandar `[]` es
 * quitarle la jefatura. Es lo que hace que la pantalla de configuración pueda
 * guardar lo que muestra sin llevar la cuenta de qué cambió.
 */
exports.affiliationJefaturasValidation = [
  param('id').isMongoId().withMessage('La adscripción indicada no es válida'),
  body('dirigeAreas')
    .isArray()
    .withMessage('dirigeAreas debe ser una lista de áreas')
    .bail()
    .custom((areas) => {
      const invalidas = (areas || []).filter((a) => !/^[a-z0-9_]+$/.test(String(a)))
      if (invalidas.length > 0) {
        throw new Error(`Áreas no válidas: ${invalidas.join(', ')}`)
      }
      return true
    })
]

exports.affiliationEstadoValidation = [
  param('id').isMongoId().withMessage('La adscripción indicada no es válida'),
  body('activo').isBoolean().withMessage('activo debe ser verdadero o falso'),
  // El motivo sólo es obligatorio al dar de baja; reactivar no lo necesita.
  body('motivo')
    .if(body('activo').equals('false'))
    .trim()
    .isLength({ min: 10 })
    .withMessage('El motivo de la baja debe tener al menos 10 caracteres')
]
