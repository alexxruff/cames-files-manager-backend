const { body, param } = require('express-validator')
const { PATRON_FECHA } = require('../utils/dates')

/**
 * Asignación de maquinaria (D-87).
 *
 * `proyectoId` es opcional **a propósito**: la obra sale de la asignación del
 * trabajador y sólo hace falta decirla cuando la persona está en más de una. Lo
 * que llega aquí sólo desempata; el servicio comprueba que sea de verdad una de
 * sus obras.
 */

const fecha = (regla, campo) =>
  regla
    .optional()
    .matches(PATRON_FECHA)
    .withMessage(`${campo} debe tener el formato AAAA-MM-DD`)

exports.asignarMaquinaValidation = [
  param('id').isMongoId().withMessage('La máquina indicada no es válida'),
  body('empleadoId')
    .notEmpty()
    .withMessage('El empleado es requerido')
    .bail()
    .isMongoId()
    .withMessage('El empleado indicado no es válido'),
  body('proyectoId').optional().isMongoId().withMessage('La obra indicada no es válida'),
  fecha(body('fechaAsignacion'), 'La fecha de asignación')
]

exports.devolverMaquinaValidation = [
  param('id').isMongoId().withMessage('La máquina indicada no es válida'),
  fecha(body('fechaDevolucion'), 'La fecha de devolución')
]

exports.machineHistoryValidation = [
  param('id').isMongoId().withMessage('La máquina indicada no es válida')
]

exports.machinesByProjectValidation = [
  param('id').isMongoId().withMessage('El proyecto indicado no es válido')
]

exports.machinesByEmployeeValidation = [
  param('id').isMongoId().withMessage('El empleado indicado no es válido')
]
