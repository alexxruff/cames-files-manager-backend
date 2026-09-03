const Upload = require('./uploadModel')
const recordService = require('../records/recordService')
const contractService = require('../contracts/contractService')
const clientService = require('../clients/clientService')
const projectService = require('../projects/projectService')
const storage = require('../../../services/storageService')
const env = require('../../../config/env')
const { AppError } = require('../../../middlewares/errorHandler')
const { can, CAPABILITIES } = require('../../../utils/permissions')

/**
 * Permisos de subida directa (D-83).
 *
 * Emite la URL firmada con la que el navegador sube el archivo **a R2, sin pasar
 * por aquí**. Lo único que hace este servicio es decidir si esa persona puede
 * adjuntar ese archivo a ese recurso; el archivo lo registra después la ruta de
 * siempre, con `subidaId` en el cuerpo.
 *
 * Las tres cosas que sostienen que esto no abra un agujero:
 *
 * 1. **Se comprueban capacidad y alcance ANTES de firmar**, con las mismas
 *    reglas de la ruta que confirmará —incluido el 404 de siempre cuando el
 *    recurso es de otra empresa—. Sin permiso no hay URL.
 * 2. **La URL sirve para una sola clave, un solo método y unos minutos**, y el
 *    tamaño va firmado: no permite leer, ni listar, ni escribir en otro sitio,
 *    ni subir algo más grande que el tope.
 * 3. **El archivo aterriza en `pendientes/` y no existe para el sistema** hasta
 *    que se confirma y se comprueba su contenido. Lo que nadie confirma no se ve
 *    en ninguna parte y lo barre la limpieza.
 */

/**
 * Qué exige cada destino: la capacidad, los ids obligatorios, y cómo se
 * comprueba que el recurso existe y es visible para quien pide.
 *
 * Cada comprobación reutiliza el servicio dueño del recurso, así que el alcance
 * se decide en un solo sitio: si mañana cambia ahí, cambia aquí.
 */
const DESTINOS = {
  expediente: {
    capacidad: CAPABILITIES.UPLOAD_DOCUMENTS,
    ids: ['expedienteId', 'tipoDocumento'],
    comprobar: (ref, contexto) => recordService.porId(ref.expedienteId, contexto)
  },
  contrato: {
    capacidad: CAPABILITIES.MANAGE_PROJECTS,
    /*
     * Uno u otro, no los dos: el contrato NUEVO todavía no existe cuando se pide
     * el permiso —el papel viaja en el alta—, así que ahí el dueño es el
     * proyecto. Al reemplazarlo, el dueño es el contrato.
     */
    ids: [],
    comprobar: (ref, contexto) =>
      ref.contratoId
        ? contractService.assertVisible(ref.contratoId, contexto)
        : projectService.getById(ref.proyectoId, contexto)
  },
  'siroc-aviso': {
    capacidad: CAPABILITIES.MANAGE_PROJECTS,
    ids: ['contratoId'],
    comprobar: (ref, contexto) => contractService.assertVisible(ref.contratoId, contexto)
  },
  'siroc-actualizacion': {
    capacidad: CAPABILITIES.MANAGE_PROJECTS,
    ids: ['contratoId'],
    comprobar: (ref, contexto) => contractService.assertVisible(ref.contratoId, contexto)
  },
  'registro-obra': {
    capacidad: CAPABILITIES.MANAGE_CLIENTS,
    ids: ['clienteId'],
    comprobar: (ref, contexto) => clientService.getById(ref.clienteId, contexto)
  }
}

class UploadService {
  /** POST /subidas */
  async crear(datos, contexto = {}) {
    const destino = DESTINOS[datos.destino]
    if (!destino) {
      throw AppError.validation('Ese destino de subida no existe', [
        { msg: 'Destino no válido', path: 'destino' }
      ])
    }

    if (!can(contexto.user?.acceso, destino.capacidad)) {
      throw AppError.forbidden('No tienes permiso para adjuntar archivos aquí')
    }

    const referencia = this.#referenciaDe(datos)
    for (const id of destino.ids) {
      if (!referencia[id]) {
        throw AppError.validation(`Falta ${id} para este destino`, [
          { msg: 'Falta un dato del destino', path: id }
        ])
      }
    }
    if (
      datos.destino === 'contrato' &&
      !referencia.contratoId &&
      !referencia.proyectoId
    ) {
      throw AppError.validation('Indica el proyecto o el contrato del archivo', [
        { msg: 'Falta el proyecto o el contrato', path: 'referencia' }
      ])
    }

    if (datos.tamanoBytes > env.MAX_UPLOAD_BYTES) {
      const mb = Math.round(env.MAX_UPLOAD_BYTES / (1024 * 1024))
      throw new AppError(413, `El archivo pasa de ${mb} MB. Comprímelo o divídelo.`)
    }

    /*
     * El 404 por alcance sale de aquí: si el recurso no es visible, el servicio
     * dueño lanza «no existe» y nunca se firma nada. Es la misma respuesta que
     * daría la ruta que iba a confirmar, y a propósito: pedir el permiso no
     * puede revelar lo que la confirmación escondería.
     */
    await destino.comprobar(referencia, contexto)

    const subida = new Upload({
      destino: datos.destino,
      referencia,
      nombre: datos.nombre,
      mime: datos.mime || null,
      tamanoBytes: datos.tamanoBytes,
      expiraEn: new Date(Date.now() + env.R2_UPLOAD_URL_TTL * 1000),
      solicitadaPor: contexto.user?.nombre || 'Sistema',
      solicitadaPorId: contexto.user?._id
    })
    subida.claveTemporal = storage.construirClaveTemporal(subida._id)
    await subida.save()

    const url = await storage.urlDeSubida(subida.claveTemporal, {
      // El tipo declarado se firma junto con el tamaño, así que la petición del
      // navegador tiene que mandar exactamente estos dos. Lo que de verdad es el
      // archivo se comprueba al confirmar, por su contenido.
      contentType: datos.mime || 'application/octet-stream',
      contentLength: datos.tamanoBytes
    })

    return {
      subida: {
        _id: subida._id.toString(),
        url,
        metodo: 'PUT',
        encabezados: {
          'Content-Type': datos.mime || 'application/octet-stream',
          'Content-Length': String(datos.tamanoBytes)
        },
        expiraEn: subida.expiraEn.toISOString()
      }
    }
  }

  /** Sólo los ids que el destino puede usar; nada más entra a la base. */
  #referenciaDe(datos) {
    const { referencia = {} } = datos
    return {
      expedienteId: referencia.expedienteId || null,
      tipoDocumento: referencia.tipoDocumento || null,
      proyectoId: referencia.proyectoId || null,
      contratoId: referencia.contratoId || null,
      clienteId: referencia.clienteId || null,
      registroObraId: referencia.registroObraId || null
    }
  }
}

module.exports = new UploadService()
