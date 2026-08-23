const { randomUUID } = require('node:crypto')
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
const env = require('../config/env')
const logger = require('../utils/logger')

/**
 * Almacenamiento de los documentos del expediente (backend-spec §7).
 *
 * Toma la estructura del `r2Service` de `talentlink-backend` —mismo cliente S3
 * contra Cloudflare R2, mismas URLs firmadas— con cuatro cambios:
 *
 * 1. La configuración sale de `config/env`, validada al arrancar, en vez de
 *    leerse de `process.env` en cada llamada.
 * 2. La convención de claves es la del spec y **no incluye el nombre original**
 *    del archivo: un nombre controlado por el usuario dentro de una ruta es un
 *    riesgo de path traversal. El nombre va en `archivo.nombre`, para mostrar.
 * 3. Un driver **`memoria`** para desarrollar y probar sin credenciales de R2.
 *    En producción es `r2`; con `memoria` los archivos se pierden al reiniciar.
 * 4. El bucket es distinto al de talentlink: son datos personales de otra
 *    empresa y no comparten almacenamiento.
 *
 * El bucket es **privado**: nunca se expone una URL pública. Cada apertura pasa
 * por `urlDeDescarga`, que firma por 10 minutos.
 */

const enMemoria = new Map()
let clienteS3 = null

function driver() {
  // Sin credenciales no se puede hablar con R2: se cae a memoria en vez de
  // fallar en la primera subida. `advertirSiNoHayBucket` es lo que hace que eso
  // no pase en silencio.
  if (env.STORAGE_DRIVER === 'r2' && !estaConfigurado()) return 'memoria'
  return env.STORAGE_DRIVER
}

/**
 * Se llama al arrancar. Un backend de expedientes guardando en memoria pierde
 * los archivos al reiniciar, así que el caso «pedí R2 y no hay credenciales»
 * tiene que gritar: es un error de configuración, no un modo de operación.
 */
function advertirSiNoHayBucket() {
  const efectivo = driver()

  if (env.STORAGE_DRIVER === 'r2' && efectivo === 'memoria') {
    logger.warn(
      'ATENCIÓN: faltan credenciales de R2. Los documentos se guardan EN MEMORIA ' +
        'y se PIERDEN al reiniciar. Configura R2_ACCOUNT_ID, R2_BUCKET, ' +
        'R2_ACCESS_KEY_ID y R2_SECRET_ACCESS_KEY, o pon STORAGE_DRIVER=memoria ' +
        'si es a propósito.',
      { driverPedido: env.STORAGE_DRIVER, driverEfectivo: efectivo }
    )
    return
  }

  logger.info('Almacenamiento de documentos listo', {
    driver: efectivo,
    bucket: efectivo === 'r2' ? env.R2_BUCKET : null
  })
}

function estaConfigurado() {
  return Boolean(
    env.R2_ACCOUNT_ID && env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY
  )
}

function cliente() {
  if (!clienteS3) {
    clienteS3 = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY
      }
    })
  }
  return clienteS3
}

/**
 * Clave de almacenamiento (spec §7):
 * `expedientes/{empleadoId}/{tipoDocumento}/v{version}-{uuid}.{ext}`
 *
 * Hace obvio a quién pertenece cada archivo y permite borrar todo lo de una
 * persona con un prefijo. El `uuid` evita colisiones si se reintenta una subida.
 */
function construirClave({ empleadoId, tipo, version, extension }) {
  const ext = String(extension || 'bin')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
  const ruta = `expedientes/${empleadoId}/${tipo}/v${version}-${randomUUID()}.${ext}`
  // `R2_PREFIX` es la carpeta dentro del bucket cuando el bucket se comparte
  // con otro proyecto. La clave que se guarda en la base ya la incluye, así que
  // los archivos viejos siguen encontrándose si el prefijo cambia después.
  return env.R2_PREFIX ? `${env.R2_PREFIX}/${ruta}` : ruta
}

/** Sube el contenido y devuelve la clave con la que quedó guardado. */
async function subir({ buffer, clave, contentType }) {
  if (!buffer || !clave) {
    throw new Error('subir: buffer y clave son requeridos')
  }

  if (driver() === 'memoria') {
    enMemoria.set(clave, { buffer, contentType })
    logger.debug('Documento guardado en memoria', { clave, bytes: buffer.length })
    return clave
  }

  await cliente().send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: clave,
      Body: buffer,
      ContentType: contentType
    })
  )
  logger.info('Documento subido a R2', { clave, bytes: buffer.length })
  return clave
}

/**
 * URL firmada de corta vida para abrir el archivo.
 *
 * @param {string} clave
 * @param {object} [opciones]
 * @param {string} [opciones.nombreArchivo] Nombre con el que se descarga.
 * @param {number} [opciones.ttlSegundos]
 * @param {boolean} [opciones.descargar] `attachment` en vez de `inline`.
 */
async function urlDeDescarga(clave, opciones = {}) {
  if (!clave) return null
  const ttlSegundos = opciones.ttlSegundos || env.R2_SIGNED_URL_TTL

  if (driver() === 'memoria') {
    // Sin R2 no hay nada que firmar. Se devuelve una URL simulada para que el
    // flujo se pueda ejercitar en desarrollo y en pruebas.
    return `memoria://${clave}?expiraEn=${ttlSegundos}`
  }

  const disposicion = opciones.nombreArchivo
    ? `${opciones.descargar ? 'attachment' : 'inline'}; filename="${encodeURIComponent(opciones.nombreArchivo)}"`
    : undefined

  return getSignedUrl(
    cliente(),
    new GetObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: clave,
      ResponseContentDisposition: disposicion
    }),
    { expiresIn: ttlSegundos }
  )
}

/**
 * Borra un objeto. **Las versiones de un documento no se borran** (el versionado
 * es el requisito de trazabilidad): esto existe para limpiar una subida que
 * falló a medias, no para el flujo normal.
 */
async function borrar(clave) {
  if (!clave) return

  if (driver() === 'memoria') {
    enMemoria.delete(clave)
    return
  }

  try {
    await cliente().send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: clave }))
    logger.info('Documento eliminado del almacenamiento', { clave })
  } catch (error) {
    // No se bloquea la operación de negocio si el borrado remoto falla.
    logger.error('No se pudo eliminar el documento del almacenamiento', {
      clave,
      error: error.message
    })
  }
}

/** Sólo para pruebas y desarrollo: qué hay guardado en el driver de memoria. */
function contenidoEnMemoria(clave) {
  return enMemoria.get(clave) || null
}

function limpiarMemoria() {
  enMemoria.clear()
}

module.exports = {
  driver,
  estaConfigurado,
  construirClave,
  subir,
  urlDeDescarga,
  borrar,
  contenidoEnMemoria,
  limpiarMemoria,
  advertirSiNoHayBucket
}
