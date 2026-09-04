const express = require('express')
const machineController = require('./machineController')
const machineAssignmentController = require('../machineAssignments/machineAssignmentController')
const machineIncidentController = require('../machineIncidents/machineIncidentController')
const asyncHandler = require('../../../utils/asyncHandler')
const validateRequest = require('../../../middlewares/validateRequest')
const { protect, requireCapability } = require('../../../middlewares/authMiddleware')
const { applyScope } = require('../../../middlewares/scopeMiddleware')
const { recibirArchivo } = require('../../../middlewares/uploadMiddleware')
const { requirePasswordDefinitiva } = require('../../../middlewares/passwordMiddleware')
const { CAPABILITIES } = require('../../../utils/permissions')
const {
  machineIdValidation,
  machineImageValidation,
  updateMachineValidation,
  machineEstadoValidation
} = require('../../../validations/machineValidation')
const {
  asignarMaquinaValidation,
  devolverMaquinaValidation,
  machineHistoryValidation
} = require('../../../validations/machineAssignmentValidation')
const {
  listIncidentsValidation,
  createIncidentValidation
} = require('../../../validations/machineIncidentValidation')

/**
 * `/maquinas/:id` — operar sobre una máquina concreta (D-86).
 *
 * El alta y el listado viven bajo la empresa (`/empresas/:id/maquinas`), porque
 * el catálogo es de ella; lo demás opera sobre la máquina, que ya se identifica
 * sola. Mismo reparto que contratos y asignaciones.
 *
 * Cuatro casillas propias desde D-92: la maquinaria dejó de colgar de
 * `MANAGE_PROJECTS` —quien podía editar una obra podía dar de alta máquinas— y
 * de leerse con sólo tener sesión. Ver, administrar el catálogo, entregarlas y
 * levantar incidencias se dan por separado: el contador ve la lista sin poder
 * levantar nada, y el auxiliar la maneja entera sin tocar la obra.
 */
const router = express.Router()

// `requirePasswordDefinitiva` va aquí y no en `protect`: ver D-49.
router.use(protect, requirePasswordDefinitiva, applyScope)

const verMaquinas = requireCapability(CAPABILITIES.VIEW_MACHINES)
const gestionarMaquinas = requireCapability(CAPABILITIES.MANAGE_MACHINES)
const asignarMaquinas = requireCapability(CAPABILITIES.ASSIGN_MACHINES)
const verIncidencias = requireCapability(CAPABILITIES.VIEW_MACHINE_INCIDENTS)
const gestionarIncidencias = requireCapability(CAPABILITIES.MANAGE_MACHINE_INCIDENTS)

router.get(
  '/:id',
  verMaquinas,
  machineIdValidation,
  validateRequest,
  asyncHandler(machineController.getById)
)

/*
 * `recibirArchivo` va antes de las validaciones porque es multer quien llena
 * `req.body` cuando la petición viene como `multipart` (D-80). Sigue aceptando
 * el mismo JSON sin archivo.
 */
router.patch(
  '/:id',
  gestionarMaquinas,
  recibirArchivo,
  updateMachineValidation,
  validateRequest,
  asyncHandler(machineController.update)
)

router.patch(
  '/:id/estado',
  gestionarMaquinas,
  machineEstadoValidation,
  validateRequest,
  asyncHandler(machineController.setEstado)
)

/*
 * Abrir la foto. No pide más que ver la máquina —quien la ve puede ver su
 * imagen—, y existe porque la URL que viaja en cada respuesta caduca a
 * los 10 minutos.
 */
router.get(
  '/:id/imagen',
  verMaquinas,
  machineImageValidation,
  validateRequest,
  asyncHandler(machineController.urlImagen)
)

/*
 * ─── La máquina en la obra (D-87) ───────────────────────────────────────────
 *
 * `asignacion` es singular porque **sólo hay una vigente**: asignarla otra vez
 * la reasigna, no acumula. La obra NO se captura —sale de la asignación del
 * trabajador—, así que el cuerpo lleva a la persona y, sólo si está en varias
 * obras, en cuál va.
 *
 * La devolución es lo único que la saca de la obra sin llevarla a otra; el
 * historial es de lectura, como el resto de la ficha.
 */
router.post(
  '/:id/asignacion',
  asignarMaquinas,
  asignarMaquinaValidation,
  validateRequest,
  asyncHandler(machineAssignmentController.asignar)
)

router.post(
  '/:id/devolucion',
  asignarMaquinas,
  devolverMaquinaValidation,
  validateRequest,
  asyncHandler(machineAssignmentController.devolver)
)

router.get(
  '/:id/historial',
  verMaquinas,
  machineHistoryValidation,
  validateRequest,
  asyncHandler(machineAssignmentController.historial)
)

/*
 * ─── Las incidencias de la máquina (D-88) ───────────────────────────────────
 *
 * Se levantan aquí, bajo la máquina, porque son de ella; resolverlas es
 * `POST /incidencias/:id/resolucion`, que opera sobre la incidencia.
 *
 * El cuerpo NO lleva trabajador ni obra: eso se deriva de la historia de
 * asignaciones con la fecha en que sucedió.
 */
router.post(
  '/:id/incidencias',
  gestionarIncidencias,
  createIncidentValidation,
  validateRequest,
  asyncHandler(machineIncidentController.create)
)

router.get(
  '/:id/incidencias',
  verIncidencias,
  listIncidentsValidation,
  validateRequest,
  asyncHandler(machineIncidentController.list)
)

module.exports = router
