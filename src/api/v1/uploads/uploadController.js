const uploadService = require('./uploadService')
const { created } = require('../../../utils/response')

/** HTTP de los permisos de subida directa (D-83). */
class UploadController {
  #contexto(req) {
    return {
      user: req.user,
      empresasVisibles: req.empresasVisibles,
      areasPorEmpresa: req.areasPorEmpresa,
      /*
       * Los módulos apagados viajan con el alcance (D-95): esta ruta no lleva
       * `requireCapability` —la casilla depende del destino— así que el recorte
       * lo hace el servicio, cuando ya sabe a dónde va el archivo.
       */
      modulosApagadosPorEmpresa: req.modulosApagadosPorEmpresa,
      todasLasEmpresas: req.todasLasEmpresas
    }
  }

  /** POST /subidas */
  crear = async (req, res) => {
    const datos = await uploadService.crear(
      {
        destino: req.body.destino,
        referencia: req.body.referencia,
        nombre: req.body.nombre,
        mime: req.body.mime,
        tamanoBytes: req.body.tamanoBytes
      },
      this.#contexto(req)
    )

    req.log.info('Permiso de subida emitido', {
      subidaId: datos.subida._id,
      destino: req.body.destino,
      tamanoBytes: req.body.tamanoBytes
    })

    return created(
      res,
      datos,
      'Sube el archivo a esa URL y confírmalo en la ruta del documento'
    )
  }
}

module.exports = new UploadController()
