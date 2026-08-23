/**
 * Configuración validada del entorno.
 *
 * Mejora sobre `talentlink-backend`, donde cada módulo leía `process.env`
 * directamente: una variable mal escrita o ausente sólo se notaba al fallar en
 * caliente (p. ej. `JWT_EXPIRES_IN` en el .env contra `JWT_EXPIRE` en el
 * código). Aquí el proceso no arranca si el entorno está incompleto, y el resto
 * del código lee un objeto congelado en vez de `process.env`.
 */
require('dotenv').config()
const { z } = require('zod')

const booleanFromString = (porDefecto) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(porDefecto)
    .transform((v) => v === 'true' || v === '1')

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),

  // Base de datos. La DB es propia de este proyecto: nunca la de talentlink.
  MONGODB_URI: z.string().min(1, 'MONGODB_URI es obligatoria'),
  MONGODB_DB_NAME: z.string().min(1).default('cames_expedientes'),

  // Sesión. 12 h como el front espera (spec 8).
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  JWT_EXPIRES_IN: z.string().default('12h'),

  // CORS: lista separada por comas. Sin comodines en producción.
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:5174')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    ),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
  LOG_TO_FILE: booleanFromString('false'),

  RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

  // Umbral global de aviso de vencimiento (spec 7.3). Pisable por cliente en
  // fase 2 vía `cliente.configuracion.diasAlertaVencimiento`.
  DIAS_ALERTA_VENCIMIENTO: z.coerce.number().int().min(1).max(365).default(30),

  // Zona horaria de negocio: las fechas de calendario se interpretan aquí.
  TIMEZONE: z.string().default('America/Mexico_City'),

  // ─── Almacenamiento de archivos (Cloudflare R2) ───────────────────────────
  // El bucket es PRIVADO y distinto al de talentlink: nunca se expone una URL
  // pública, cada apertura pasa por una URL firmada de corta vida.
  //
  // `memoria` guarda los archivos en el proceso: sirve para desarrollar y probar
  // sin credenciales, y se pierde al reiniciar. En producción, `r2`.
  STORAGE_DRIVER: z.enum(['r2', 'memoria']).default('r2'),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  /*
   * Carpeta dentro del bucket, sin barras al inicio ni al final: el bucket se
   * comparte con otros proyectos (como `humenta-cv/cvs` en talentlink). Vacío =
   * la raíz del bucket.
   */
  R2_PREFIX: z
    .string()
    .default('')
    .transform((valor) => valor.replace(/^\/+|\/+$/g, '')),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  /** Vida de la URL firmada, en segundos. 10 minutos por defecto (spec §7). */
  R2_SIGNED_URL_TTL: z.coerce.number().int().positive().default(600),

  /** Tamaño máximo de un documento del expediente. 10 MB (spec §6.5). */
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),

  // ─── Administrador inicial (bootstrap) ────────────────────────────────────
  // Se crea SOLO si la colección de usuarios está vacía, en la primera corrida.
  // Es la única forma de entrar a un sistema recién instalado: no hay registro
  // público. Ver src/services/bootstrapAdmin.js y docs/DECISIONES.md D-21.
  BOOTSTRAP_ADMIN_ENABLED: booleanFromString('true'),
  BOOTSTRAP_ADMIN_NAME: z.string().default('Alex Administrador'),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().default('alexxruff@yahoo.com'),
  // A propósito sin reglas de complejidad: es una credencial de arranque que se
  // cambia en el primer acceso. La API sí exige contraseñas fuertes.
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(1).default('1234'),

  // Semilla del primer administrador (`npm run seed:admin`).
  SEED_ADMIN_NAME: z.string().default('Administrador Urbacames'),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(8).optional()
})

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
