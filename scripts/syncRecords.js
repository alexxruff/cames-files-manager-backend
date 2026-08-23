/**
 * Crea y re-sincroniza el expediente de todos los empleados
 * (`npm run db:expedientes`).
 *
 * Hace falta para las personas que se dieron de alta ANTES de que existiera el
 * módulo de expedientes: no tienen `records`, así que el renglón de la tabla de
 * empleados sale sin avance hasta que alguien abre su expediente.
 *
 * También arregla los expedientes que nacieron con el checklist vacío porque las
 * plantillas no se pudieron resolver (ver D-42).
 *
 * Es idempotente y NO borra nada: `syncChecklist` conserva los documentos ya
 * entregados, incluso los que dejaron de ser requeridos.
 */
const logger = require('../src/utils/logger')
const { connect, disconnect } = require('../src/config/database')
require('../src/models')
const Employee = require('../src/api/v1/employees/employeeModel')
const recordService = require('../src/api/v1/records/recordService')

async function main() {
  await connect()

  const empleados = await Employee.find({}).select('_id nombre')
  const fallidos = []
  let vacios = 0

  for (const empleado of empleados) {
    try {
      const expediente = await recordService.sincronizar(empleado._id)
      if (expediente.documentos.length === 0) {
        vacios += 1
        logger.warn('Expediente sin checklist: no se resolvió ninguna plantilla', {
          empleado: empleado.nombre
        })
      }
    } catch (error) {
      fallidos.push({ empleado: empleado.nombre, error: error.message })
    }
  }

  logger.info('Expedientes sincronizados', {
    empleados: empleados.length,
    sinChecklist: vacios,
    fallidos: fallidos.length
  })

  for (const fallido of fallidos) {
    logger.error('No se pudo sincronizar un expediente', fallido)
  }

  await disconnect()
}

main().catch(async (error) => {
  logger.error('No se pudieron sincronizar los expedientes', { error: error.message })
  await disconnect().catch(() => {})
  process.exit(1)
})
