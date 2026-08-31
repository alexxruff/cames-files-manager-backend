/**
 * Imprime el esqueleto real del backend (`npm run esqueleto`).
 *
 * Contesta, sin leer un solo documento, qué colecciones y campos existen hoy,
 * qué índices únicos los protegen y qué rutas responde el servidor. Sale del
 * CÓDIGO: los esquemas de Mongoose y el stack de Express, las mismas fuentes que
 * usa el servidor de verdad.
 *
 * NO SE CONECTA A NADA. Requerir modelos y router no abre conexión —`connect()`
 * sólo se llama desde `src/server.js`—, así que esto corre en un segundo y
 * funciona sin Mongo levantado.
 *
 * NO NECESITA EL .env DE VERDAD. `src/config/env.js` mata el proceso si el
 * entorno está incompleto, y el router arrastra ese módulo. Por eso se fijan
 * valores de relleno ANTES de requerir nada, igual que `tests/helpers/env.js`:
 * son placeholders para que la validación pase, no configuración real, y no
 * cambian ni un campo de la salida. Se fijan sin condición para que el resultado
 * sea el mismo en cualquier máquina, con .env o sin él.
 *
 * Uso:
 *   npm run esqueleto              → JSON (lo que consume otra herramienta)
 *   npm run esqueleto -- --texto   → legible para una persona
 */
process.env.NODE_ENV = 'test' // silencia el logger y evita el formato de producción
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017'
process.env.MONGODB_DB_NAME = 'cames_expedientes'
process.env.JWT_SECRET = 'relleno-para-validar-el-entorno-1234567890-abcd'
process.env.LOG_TO_FILE = 'false'
// Sin R2: el extractor no toca almacenamiento y así no exige credenciales.
process.env.STORAGE_DRIVER = 'memoria'
process.env.R2_ACCOUNT_ID = ''
process.env.R2_BUCKET = ''
process.env.R2_PREFIX = ''
process.env.R2_ACCESS_KEY_ID = ''
process.env.R2_SECRET_ACCESS_KEY = ''

const modelos = require('../src/models')
const router = require('../src/api/v1/routes')
const { buildSkeleton, renderText } = require('../src/utils/schemaSkeleton')

const comoTexto = process.argv.slice(2).some((arg) => arg === '--texto' || arg === '-t')

const esqueleto = buildSkeleton({ modelos, router, prefijo: '/api/v1' })

process.stdout.write(
  (comoTexto ? renderText(esqueleto) : JSON.stringify(esqueleto, null, 2)) + '\n'
)
