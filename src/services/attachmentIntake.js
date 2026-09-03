const Upload = require('../api/v1/uploads/uploadModel')
const storage = require('./storageService')
const env = require('../config/env')
const logger = require('../utils/logger')
const { AppError } = require('../middlewares/errorHandler')
const { detectarTipo, mensajeTipoNoPermitido } = require('../utils/fileTypes')

/**
 * De dónde viene un adjunto (D-83).
 *
 * Hay dos caminos y el resto del código no debería notar la diferencia:
 *
 * 1. **`multipart`**, el de siempre: el archivo llega en memoria y de aquí sube
 *    al almacenamiento.
 * 2. **Subida directa**: el navegador ya lo puso en R2 con una URL firmada y
 *    sólo manda `subidaId`. El servidor nunca ve los bytes... salvo los primeros
 *    cuatro kilobytes, que sí pide, porque **la validación por contenido no se
 *    negocia**: sin ella el tipo lo decidiría el nombre del archivo, que lo
 *    controla quien sube.
 *
 * Los dos devuelven la misma **entrada**: tipo real, tamaño, nombre y un
 * `guardarEn(clave)` que la deja en su sitio definitivo. Así `recordService`,
 * `clientService` y `contractService` conservan su lógica —versiones, vigencias,
 * el SIROC— sin enterarse de por dónde llegó el papel.
 *
 * El orden es el mismo de siempre: **al almacenamiento primero, a la base
 * después**. Si la base falla, quien llama borra lo que se acaba de guardar.
 */

/** Lo que hace falta leer para reconocer una firma de archivo. */
const BYTES_DE_FIRMA = 4096

/**
 * Qué tipos admite el destino, cuando no son todos.
 *
 * Los adjuntos administrativos aceptan todo lo de D-78 —PDF, imágenes y
 * Office—, pero la foto de una máquina (D-86) es para verla: un PDF ahí no es
 * un adjunto raro, es un error. `soloImagenes` lo rechaza con 415 **después** de
 * reconocer el tipo, así que el mensaje distingue «no sé qué es esto» de «sé
 * que es un PDF y aquí no va».
 */
function comprobarClase(tipoReal, { soloImagenes = false } = {}) {
  if (soloImagenes && !tipoReal.mime.startsWith('image/')) {
    throw new AppError(
      415,
      `La imagen debe ser JPG, PNG o WEBP; llegó un ${tipoReal.etiqueta}`
    )
  }
}

/**
 * El archivo que llegó por `multipart`, con el buffer en la mano.
 *
 * @param {{buffer: Buffer, nombreOriginal?: string}} archivo
 * @param {object} [esperado] `{ soloImagenes }`
 */
function desdeBuffer(archivo, esperado = {}) {
  const tipoReal = detectarTipo(archivo.buffer, archivo.nombreOriginal)
  if (!tipoReal) throw new AppError(415, mensajeTipoNoPermitido(archivo.buffer))
  comprobarClase(tipoReal, esperado)

  return {
    origen: 'multipart',
    nombreOriginal: archivo.nombreOriginal || null,
    tipoReal,
    tamanoBytes: archivo.buffer.length,
    async guardarEn(clave) {
      await storage.subir({
        buffer: archivo.buffer,
        clave,
        contentType: tipoReal.mime
      })
      return clave
    }
  }
}

/**
 * El archivo que el navegador ya subió, reclamando su permiso.
 *
 * Comprueba, en este orden: que el permiso exista, que sea de este destino y de
 * este recurso, que siga vivo y sin usar, que el objeto **de verdad esté** en el
 * almacenamiento, que pese lo que dijo que iba a pesar, y que su contenido sea
 * de un tipo permitido. Cualquiera de esas cosas falla y no se registra nada.
 *
 * @param {string} subidaId
 * @param {object} esperado `{ destino, referencia, soloImagenes }` — de dónde se
 *   está llamando y qué admite
 */
async function desdeSubida(subidaId, { destino, referencia = {}, soloImagenes } = {}) {
  const subida = await Upload.findById(subidaId).catch(() => null)
  if (!subida || subida.destino !== destino || !coincide(subida.referencia, referencia)) {
    /*
     * El mismo mensaje para «no existe» y «no es de este recurso»: quien tiene
     * un id ajeno no debería poder distinguir una cosa de la otra probando.
     */
    throw AppError.validation('Ese permiso de subida no sirve para este archivo', [
      { msg: 'Permiso de subida no válido', path: 'subidaId' }
    ])
  }

  if (subida.estado === 'usada') {
    throw AppError.validation('Ese permiso de subida ya se usó. Pide uno nuevo.', [
      { msg: 'El permiso ya se usó', path: 'subidaId' }
    ])
  }

  if (subida.expiraEn.getTime() < Date.now()) {
    throw AppError.validation('El permiso de subida caducó. Vuelve a intentarlo.', [
      { msg: 'El permiso caducó', path: 'subidaId' }
    ])
  }

  const cabecera = await storage.cabecera(subida.claveTemporal)
  if (!cabecera) {
    throw AppError.validation(
      'El archivo no llegó al almacenamiento. Vuelve a subirlo.',
      [{ msg: 'No hay archivo que registrar', path: 'subidaId' }]
    )
  }

  if (cabecera.tamanoBytes > env.MAX_UPLOAD_BYTES) {
    const mb = Math.round(env.MAX_UPLOAD_BYTES / (1024 * 1024))
    throw new AppError(413, `El archivo pasa de ${mb} MB. Comprímelo o divídelo.`)
  }

  /*
   * El tamaño va firmado en la URL, así que llegar aquí con otro debería ser
   * imposible. Se comprueba igual: es la diferencia entre creerle al cliente y
   * mirar lo que hay.
   */
  if (cabecera.tamanoBytes !== subida.tamanoBytes) {
    logger.warn('El archivo subido no coincide con el anunciado', {
      subidaId: String(subida._id),
      anunciado: subida.tamanoBytes,
      real: cabecera.tamanoBytes
    })
    throw AppError.validation('El archivo subido no es el que se anunció.', [
      { msg: 'El archivo no coincide con el permiso', path: 'subidaId' }
    ])
  }

  const firma = await storage.leerRango(subida.claveTemporal, BYTES_DE_FIRMA)
  const tipoReal = detectarTipo(firma, subida.nombre)
  try {
    if (!tipoReal) throw new AppError(415, mensajeTipoNoPermitido(firma))
    comprobarClase(tipoReal, { soloImagenes })
  } catch (error) {
    // Lo que no es de un tipo permitido no se queda ahí ocupando sitio.
    await storage.borrar(subida.claveTemporal)
    await Upload.deleteOne({ _id: subida._id })
    throw error
  }

  return {
    origen: 'directa',
    nombreOriginal: subida.nombre,
    tipoReal,
    tamanoBytes: cabecera.tamanoBytes,
    async guardarEn(clave) {
      await storage.mover(subida.claveTemporal, clave, { contentType: tipoReal.mime })
      subida.estado = 'usada'
      subida.usadaEn = new Date()
      await subida.save()
      return clave
    }
  }
}

/**
 * La entrada del adjunto, venga por donde venga. `null` si no viene ninguno —el
 * que llama decide si eso es un error, porque en unas rutas el archivo es
 * obligatorio y en otras no.
 *
 * @param {object} datos el cuerpo de la petición ya validado
 * @param {object} esperado `{ destino, referencia, soloImagenes }`
 */
async function resolver(datos = {}, esperado = {}) {
  if (datos.archivo?.buffer?.length) return desdeBuffer(datos.archivo, esperado)
  if (datos.subidaId) return desdeSubida(datos.subidaId, esperado)
  return null
}

/** Los ids que el permiso guardó tienen que ser los del recurso que confirma. */
function coincide(referencia, esperada) {
  return Object.entries(esperada).every(([clave, valor]) => {
    if (valor === undefined || valor === null) return true
    return String(referencia?.[clave] ?? '') === String(valor)
  })
}

module.exports = { resolver, desdeBuffer, desdeSubida, BYTES_DE_FIRMA }
