/**
 * Configuración validada del entorno.
 *
 * Mejora sobre `talentlink-backend`, donde cada módulo leía `process.env`
 * directamente: una variable mal escrita o ausente sólo se notaba al fallar en
 * caliente (p. ej. `JWT_EXPIRES_IN` en el .env contra `JWT_EXPIRE` en el
 * código). Aquí el proceso no arranca si el entorno está incompleto, y el resto
 * del código lee un objeto congelado en vez de `process.env`.
 *
 * La FORMA de lo que se exige vive aparte, en `env.schema.js`, y ese módulo no
 * tiene efectos: se puede leer el requisito sin dispararlo. Todo lo que sí tiene
 * efecto —dotenv, validar, terminar el proceso— se queda aquí.
 */
require('dotenv').config()
const { schema } = require('./env.schema')

const resultado = schema.safeParse(process.env)

if (!resultado.success) {
  const detalle = resultado.error.issues
    .map((i) => `  · ${i.path.join('.')}: ${i.message}`)
    .join('\n')
  // Sin logger: esto ocurre antes de que exista logger y debe ser ruidoso.
  console.error(`\n🔴 Configuración de entorno inválida:\n${detalle}\n`)
  console.error('Revisa tu .env contra .env.example y vuelve a intentar.\n')
  process.exit(1)
}

const env = Object.freeze({
  ...resultado.data,
  isProduction: resultado.data.NODE_ENV === 'production',
  isTest: resultado.data.NODE_ENV === 'test',
  isDevelopment: resultado.data.NODE_ENV === 'development'
})

module.exports = env
