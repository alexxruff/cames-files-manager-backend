const { query } = require('express-validator')
const { ALERT_TYPES, ALERT_ORIGINS, AREAS } = require('../constants')

/**
 * Validación de `GET /alertas`.
 *
 * Todo es opcional: sin filtros, la bandeja completa de lo que quien pregunta
 * puede ver. `tipo` y `origen` se validan contra los enums del contrato para que
 * un filtro mal escrito responda `400` en vez de devolver una lista vacía y
 * parecer que no hay pendientes.
 */
exports.listAlertsValidation = [
  query('tipo')
    .optional()
    .isIn(ALERT_TYPES)
    .withMessage(`tipo debe ser uno de: ${ALERT_TYPES.join(', ')}`),

  query('origen')
    .optional()
    .isIn(ALERT_ORIGINS)
    .withMessage(`origen debe ser uno de: ${ALERT_ORIGINS.join(', ')}`),

  query('empresaId')
    .optional()
    .isMongoId()
    .withMessage('La empresa indicada no es válida'),

  query('empleadoId')
    .optional()
    .isMongoId()
    .withMessage('El empleado indicado no es válido'),

  query('area').optional().isIn(AREAS).withMessage('Selecciona un área válida'),

  // Permite abrir la ventana de cumpleaños desde la interfaz («próximos 30
  // días») sin cambiar la configuración del servidor.
  query('diasCumpleanos')
    .optional()
    .isInt({ min: 0, max: 60 })
    .withMessage('diasCumpleanos debe ser un número entre 0 y 60'),

  /*
   * `empleado` por defecto: un renglón por persona. `ninguno` devuelve la lista
   * plana, que es lo que sirve para el detalle de UNA persona (D-48).
   */
  query('agrupar')
    .optional()
    .isIn(['empleado', 'ninguno'])
    .withMessage('agrupar debe ser empleado o ninguno'),

  query('pagina')
    .optional()
    .isInt({ min: 1 })
    .withMessage('pagina debe ser un número mayor o igual a 1'),

  query('porPagina')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('porPagina debe ser un número entre 1 y 100')
]
