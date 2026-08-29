const { body, param, query } = require('express-validator')
const { isCalendarDate } = require('../utils/dates')

const ESTADOS = ['en_curso', 'finalizado']

/** Campos que `PATCH /proyectos/:id` acepta. `fechaFinEstimada` NO: va por /aplazar. */
const CAMPOS_EDITABLES = [
  'nombre',
  'clienteId',
  'fechaInicio',
  'categorias',
  'registroPatronalId',
  'registroObraId'
]

const fechaObligatoria = (campo, etiqueta) =>
  body(campo).custom((valor) => {
    if (!isCalendarDate(valor)) {
      throw new Error(`${etiqueta} debe tener el formato AAAA-MM-DD`)
    }
    return true
  })

const reglaCategorias = body('categorias')
  .isArray({ min: 1 })
  .withMessage('Habilita al menos una categoría en el proyecto')
  .bail()
  .custom((categorias) => {
    const malos = categorias.filter((c) => !/^[a-f\d]{24}$/i.test(String(c)))
    if (malos.length > 0) throw new Error('Alguna categoría no es válida')
    return true
  })

exports.listProjectsValidation = [
  query('empresaId')
    .optional()
    .isMongoId()
    .withMessage('La empresa indicada no es válida'),
  query('clienteId')
    .optional()
    .isMongoId()
    .withMessage('El cliente indicado no es válido'),
  query('estado')
    .optional()
    .isIn(ESTADOS)
    .withMessage('El estado debe ser en_curso o finalizado'),
  query('busqueda').optional().trim().isLength({ max: 160 }),
  query('pagina')
    .optional()
    .isInt({ min: 1 })
    .withMessage('La página debe ser 1 o mayor'),
  query('porPagina')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('porPagina debe estar entre 1 y 100')
]

exports.projectIdValidation = [
  param('id').isMongoId().withMessage('El proyecto indicado no es válido')
]

exports.createProjectValidation = [
  body('empresaId').isMongoId().withMessage('Selecciona una empresa válida'),
  body('clienteId').isMongoId().withMessage('Selecciona un cliente válido'),
  body('nombre')
    .trim()
    .notEmpty()
    .withMessage('El nombre del proyecto es requerido')
    .bail()
    .isLength({ min: 3, max: 160 })
    .withMessage('El nombre debe tener entre 3 y 160 caracteres'),
  fechaObligatoria('fechaInicio', 'La fecha de inicio'),
  fechaObligatoria('fechaFinEstimada', 'La fecha de fin estimada'),
  reglaCategorias,
  /*
   * Obligatorios desde D-69. Que EXISTAN y pertenezcan a la empresa y al cliente
   * correctos se comprueba en el servicio, que es donde se puede consultar la
   * base y dar un mensaje útil.
   */
  body('registroPatronalId')
    .exists({ values: 'falsy' })
    .withMessage('El registro patronal es requerido')
    .bail()
    .isMongoId()
    .withMessage('El registro patronal indicado no es válido'),
  body('registroObraId')
    .exists({ values: 'falsy' })
    .withMessage('El registro de obra es requerido')
    .bail()
    .isMongoId()
    .withMessage('El registro de obra indicado no es válido')
]

exports.updateProjectValidation = [
  param('id').isMongoId().withMessage('El proyecto indicado no es válido'),
  body().custom((cuerpo) => {
    const campos = Object.keys(cuerpo || {})
    if (campos.length === 0) throw new Error('No hay nada que actualizar')

    const invalidos = campos.filter((c) => !CAMPOS_EDITABLES.includes(c))
    if (invalidos.length > 0) {
      const pistas = {
        // La fecha de cierre es auditoría: sólo se mueve con motivo y queda en
        // el historial. Por eso se rechaza aquí en vez de aceptarla en silencio.
        fechaFinEstimada: 'usa POST /proyectos/:id/aplazar, que exige motivo',
        fechaFinReal: 'usa POST /proyectos/:id/finalizar',
        estado: 'usa POST /proyectos/:id/finalizar o /reabrir',
        empresaId: 'un proyecto no cambia de empresa',
        aplazamientos: 'es el historial: sólo lo escribe /aplazar'
      }
      const detalle = invalidos
        .map((c) => (pistas[c] ? `${c} (${pistas[c]})` : c))
        .join(', ')
      throw new Error(`Estos campos no se pueden actualizar aquí: ${detalle}`)
    }
    return true
  }),
  body('nombre')
    .optional()
    .trim()
    .isLength({ min: 3, max: 160 })
    .withMessage('El nombre debe tener entre 3 y 160 caracteres'),
  body('clienteId').optional().isMongoId().withMessage('Selecciona un cliente válido'),
  /*
   * Se pueden CAMBIAR por otro, pero **no vaciar** (D-69): un proyecto sin
   * registro patronal o sin registro de obra ya no es un estado válido, y
   * permitir `null` aquí sería la puerta de atrás para volver a crearlo.
   */
  body('registroPatronalId')
    .optional()
    .isMongoId()
    .withMessage('El registro patronal indicado no es válido'),
  body('registroObraId')
    .optional()
    .isMongoId()
    .withMessage('El registro de obra indicado no es válido'),
  body('fechaInicio')
    .optional()
    .custom((valor) => {
      if (!isCalendarDate(valor)) {
        throw new Error('La fecha de inicio debe tener el formato AAAA-MM-DD')
      }
      return true
    }),
  body('categorias')
    .optional()
    .custom((categorias) => {
      if (!Array.isArray(categorias) || categorias.length === 0) {
        throw new Error('Habilita al menos una categoría en el proyecto')
      }
      if (categorias.some((c) => !/^[a-f\d]{24}$/i.test(String(c)))) {
        throw new Error('Alguna categoría no es válida')
      }
      return true
    })
]

exports.postponeValidation = [
  param('id').isMongoId().withMessage('El proyecto indicado no es válido'),
  fechaObligatoria('fechaNueva', 'La fecha nueva'),
  body('motivo')
    .trim()
    .notEmpty()
    .withMessage('Indica el motivo del aplazamiento')
    .bail()
    .isLength({ min: 10, max: 300 })
    .withMessage('El motivo debe tener entre 10 y 300 caracteres')
]

exports.finishValidation = [
  param('id').isMongoId().withMessage('El proyecto indicado no es válido'),
  fechaObligatoria('fechaFinReal', 'La fecha de cierre')
]

exports.cloneCategoriesValidation = [
  param('id').isMongoId().withMessage('El proyecto indicado no es válido'),
  body('origenId').isMongoId().withMessage('Selecciona el proyecto de origen')
]

exports.ESTADOS = ESTADOS
exports.CAMPOS_EDITABLES = CAMPOS_EDITABLES
