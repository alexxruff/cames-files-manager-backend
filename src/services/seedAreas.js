const Area = require('../api/v1/areas/areaModel')
const Affiliation = require('../api/v1/affiliations/affiliationModel')
const logger = require('../utils/logger')
const { AREAS_BASE, AREAS_HEREDADAS } = require('../constants')

/**
 * Siembra el catálogo de áreas (D-58). Idempotente: se corre en cada arranque.
 *
 * Dos pasos, y el segundo es el que hace segura la transición:
 *
 * 1. **Las nueve base.** Se crean si faltan. Si ya existen no se tocan: alguien
 *    pudo renombrarlas, y un arranque no debería deshacer eso.
 *
 * 2. **Las heredadas que TENGAN GENTE.** El modelo anterior traía otras áreas
 *    (`obra`, `administracion`, `proyectos`…) que la lista nueva no incluye. No
 *    se mapean a mano: **las corrige el archivo de nómina** al re-importarlo
 *    (decisión del cliente). Mientras tanto entran al catálogo como NO base y
 *    **activas**, para que nadie pierda su área ni un jefe de área deje de ver a
 *    su gente. Cuando el archivo termine de reasignarlas se quedan sin nadie y
 *    RH puede darlas de baja.
 *
 *    Sólo las que estén en uso: en una base nueva no aparece ninguna.
 */
async function ensureBaseAreas() {
  const creadas = []

  for (const { clave, nombre } of AREAS_BASE) {
    const existente = await Area.findOne({ clave })
    if (existente) continue
    await Area.create({ clave, nombre, esBase: true, temporal: false })
    creadas.push(clave)
  }

  const heredadas = []
  for (const { clave, nombre } of AREAS_HEREDADAS) {
    if (await Area.exists({ clave })) continue
    // `areas` es un arreglo: esto pregunta si alguna adscripción la contiene.
    if (!(await Affiliation.exists({ areas: clave }))) continue

    await Area.create({ clave, nombre, esBase: false, temporal: false })
    heredadas.push(clave)
  }

  if (creadas.length > 0 || heredadas.length > 0) {
    logger.info('Catálogo de áreas sembrado', {
      base: creadas,
      heredadasEnUso: heredadas
    })
  }

  return { creadas, heredadas }
}

module.exports = { ensureBaseAreas }
