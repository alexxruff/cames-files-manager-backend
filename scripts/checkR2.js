/**
 * Comprueba que las credenciales de R2 del `.env` sirven (`npm run r2:check`).
 *
 * Hace el ciclo completo con un objeto de prueba —escribir, firmar, leer,
 * borrar— porque un token de sólo lectura pasa la conexión y falla en la primera
 * subida real, que es el peor momento para enterarse.
 *
 * No deja basura: borra el objeto al terminar, incluso si algo falla en medio.
 */
const env = require('../src/config/env')
const storage = require('../src/services/storageService')

const CLAVE = `${env.R2_PREFIX ? env.R2_PREFIX + '/' : ''}_prueba-de-configuracion.txt`

function paso(numero, texto, detalle = '') {
  console.log(`${numero}. ${texto}${detalle ? ' — ' + detalle : ''}`)
}

async function main() {
  console.log(`\nCuenta : ${env.R2_ACCOUNT_ID || '(vacío)'}`)
  console.log(`Bucket : ${env.R2_BUCKET || '(vacío)'}`)
  console.log(`Carpeta: ${env.R2_PREFIX || '(raíz del bucket)'}`)
  console.log(`Driver : ${storage.driver()}\n`)

  if (!storage.estaConfigurado()) {
    console.error(
      'Faltan variables. Necesitas R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID y\n' +
        'R2_SECRET_ACCESS_KEY en el .env. Las dos llaves salen de Cloudflare →\n' +
        'R2 → Administrar tokens de API → Crear token de API, con permiso\n' +
        '"Objeto de lectura y escritura".'
    )
    process.exit(1)
  }

  try {
    await storage.subir({
      buffer: Buffer.from('prueba de configuracion'),
      clave: CLAVE,
      contentType: 'text/plain'
    })
    paso(1, 'Escribir en el bucket', 'OK')

    const url = await storage.urlDeDescarga(CLAVE, { ttlSegundos: 60 })
    const res = await fetch(url)
    paso(2, 'Leer con URL firmada', `HTTP ${res.status}`)
    if (res.status !== 200) throw new Error(`la URL firmada respondió ${res.status}`)
  } finally {
    await storage.borrar(CLAVE)
    paso(3, 'Borrar el objeto de prueba', 'OK')
  }

  console.log('\nR2 quedó configurado: los expedientes ya se guardan en el bucket.\n')
}

main().catch((error) => {
  console.error(`\nFALLÓ: ${error.name || 'Error'} — ${error.message}`)
  console.error(
    '\nLo que suele ser:\n' +
      '  AccessDenied / 403  el token no tiene "Objeto de lectura y escritura", o\n' +
      '                      está limitado a otro bucket (revisa que incluya\n' +
      `                      "${env.R2_BUCKET}")\n` +
      '  NoSuchBucket        R2_BUCKET mal escrito\n' +
      '  InvalidAccessKeyId  R2_ACCESS_KEY_ID mal copiado\n' +
      '  SignatureDoesNot…   R2_SECRET_ACCESS_KEY mal copiado\n' +
      '  ENOTFOUND           R2_ACCOUNT_ID mal copiado (es el subdominio del\n' +
      '                      endpoint S3, no el id del bucket)\n'
  )
  process.exit(1)
})
