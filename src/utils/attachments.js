const { esPrevisualizable, extensionDeMime } = require('./fileTypes')

/**
 * Adjuntos administrativos: el archivo que acompaña a un dato del catálogo
 * —hoy el registro de obra del cliente (D-79)—.
 *
 * NO son los documentos del expediente: aquéllos se versionan, se revisan y
 * dejan bitácora porque son datos personales; éstos son una sola copia del
 * papel que respalda un número, y reemplazarla es lo normal.
 *
 * Este archivo es PURO: sabe qué forma tiene un adjunto en el contrato y cómo
 * se llama al descargarlo. Firmar la URL es del `storageService`.
 */

/**
 * La forma del adjunto en el contrato, **sin su clave de almacenamiento**.
 *
 * La clave nunca sale: con ella y las credenciales se llega al objeto sin pasar
 * por los permisos. `url` la agrega quien pueda firmarla (es asíncrono).
 */
function attachmentToJson(archivo) {
  if (!archivo || !archivo.claveAlmacenamiento) return null

  return {
    nombre: archivo.nombre,
    mime: archivo.mime,
    tamanoBytes: archivo.tamanoBytes,
    subidoPor: archivo.subidoPor ?? null,
    subidoEn: archivo.subidoEn,
    // Para que la interfaz sepa si ofrecer un visor o sólo descargar (D-78).
    previsualizable: esPrevisualizable(archivo.mime)
  }
}

/**
 * Con qué nombre se guarda el archivo al descargarlo.
 *
 * **El del dato, no el del archivo original** (decisión del cliente en la tarea
 * #13): el registro de obra `RO-4471` se descarga como `RO-4471.pdf` y no como
 * `escaneo (2) final_v3.pdf`, que es lo que suele traer el original. Se limpia
 * lo que no puede ir en un nombre de archivo.
 */
function nombreDeDescarga(base, mime) {
  const limpio = String(base || 'archivo')
    .trim()
    .replace(/[/\\:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 60)

  return `${limpio || 'archivo'}.${extensionDeMime(mime)}`
}

module.exports = { attachmentToJson, nombreDeDescarga }
