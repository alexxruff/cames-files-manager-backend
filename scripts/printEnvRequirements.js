/**
 * Imprime, en un solo documento JSON, qué variables de entorno necesita este
 * backend (`npm run env:requisitos`).
 *
 * DESCRIBE, NO COMPRUEBA. No llama a dotenv, no lee `process.env`, no valida y
 * no termina con error en una corrida buena: contesta «qué hace falta», no «qué
 * falta aquí». Por eso lee `src/config/env.schema.js` —que no tiene efectos— y
 * nunca `src/config/env.js`, que sí valida y mataría el proceso.
 *
 * `hasDefault` y `default` importan tanto como `required`: quien consuma esto
 * necesita saber que STORAGE_DRIVER vale 'r2' aunque no aparezca en su
 * configuración. Con sólo `required` parecería que no hace nada.
 *
 * El valor por defecto que se reporta es el CRUDO, el que se escribiría en un
 * `.env`, antes de las transformaciones del esquema (CORS_ORIGINS sale como la
 * cadena separada por comas, no como el arreglo ya partido).
 */
const { schema } = require('../src/config/env.schema')

/**
 * Desenvuelve los envoltorios de zod hasta encontrar si el campo trae valor por
 * defecto y si es opcional. `.default().transform()` produce un ZodEffects por
 * fuera, así que quedarse en la capa de arriba no vería ningún default.
 */
function describir(nombre, tipo) {
  let actual = tipo
  let hasDefault = false
  let porDefecto = null
  let opcional = false

  for (;;) {
    const clase = actual?._def?.typeName

    if (clase === 'ZodDefault') {
      hasDefault = true
      porDefecto = actual._def.defaultValue()
      actual = actual._def.innerType
    } else if (clase === 'ZodOptional' || clase === 'ZodNullable') {
      opcional = true
      actual = actual._def.innerType
    } else if (clase === 'ZodEffects') {
      actual = actual._def.schema
    } else {
      break
    }
  }

  return {
    name: nombre,
    required: !hasDefault && !opcional,
    hasDefault,
    default: hasDefault ? porDefecto : null
  }
}

const requisitos = Object.entries(schema.shape).map(([nombre, tipo]) =>
  describir(nombre, tipo)
)

process.stdout.write(JSON.stringify(requisitos, null, 2) + '\n')
