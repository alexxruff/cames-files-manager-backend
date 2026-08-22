const logger = require('../utils/logger')
const ChecklistTemplate = require('../api/v1/checklistTemplates/checklistTemplateModel')
const { BASE_TEMPLATES } = require('../api/v1/checklistTemplates/baseTemplates')

/**
 * Siembra las plantillas base (spec 6.5).
 *
 * Idempotente **por `clave`**: si la plantilla ya existe NO se toca. Es
 * deliberado — un `rh_admin` puede editar una plantilla base desde la pantalla de
 * configuración, y volver a sembrar no debe deshacer su trabajo en el siguiente
 * reinicio.
 *
 * Corre al arrancar (y a mano con `npm run seed:plantillas`) porque sin
 * plantillas no se puede generar ningún checklist: un expediente nuevo se queda
 * sin documentos.
 */
async function ensureBaseChecklistTemplates() {
  const claves = BASE_TEMPLATES.map((p) => p.clave)
  const existentes = await ChecklistTemplate.find({
    clave: { $in: claves },
    clienteId: null
  }).select('clave')

  const yaEstan = new Set(existentes.map((p) => p.clave))
  const faltantes = BASE_TEMPLATES.filter((p) => !yaEstan.has(p.clave))

  if (faltantes.length === 0) {
    logger.debug('Plantillas base ya sembradas', { total: yaEstan.size })
    return { creadas: 0, existentes: yaEstan.size, fallidas: [] }
  }

  /*
   * Una por una y no `create(faltantes)`: con el arreglo, si una plantilla falla
   * las demás se insertan igual pero la excepción tapa cuál fue. Pasó de verdad
   * —un índice viejo en la base hacía fallar sólo la de obra— y el log decía
   * únicamente que "no se pudieron sembrar las plantillas".
   */
  const creadas = []
  const fallidas = []

  for (const plantilla of faltantes) {
    try {
      const creada = await ChecklistTemplate.create(plantilla)
      creadas.push(creada.clave)
    } catch (error) {
      fallidas.push({ clave: plantilla.clave, error: error.message })
    }
  }

  if (creadas.length > 0) {
    logger.info('Plantillas base sembradas', { creadas, conservadas: [...yaEstan] })
  }

  if (fallidas.length > 0) {
    for (const fallida of fallidas) {
      logger.error('No se pudo sembrar una plantilla base', fallida)
    }
    logger.error(
      'Sin todas las plantillas base, los expedientes de esos contratos nacerán ' +
        'con el checklist equivocado. Si el error habla de índices, corre ' +
        '`npm run db:indices`.'
    )
  }

  return { creadas: creadas.length, existentes: yaEstan.size, fallidas }
}

module.exports = { ensureBaseChecklistTemplates }
