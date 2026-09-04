const { PERMISSIONS, PERMISSION_SECTIONS, can } = require('../../../utils/permissions')
const { ok } = require('../../../utils/response')

/**
 * HTTP del catálogo de permisos (D-92).
 *
 * Es un catálogo **estático**: sale del código, no de una colección, así que no
 * hay servicio ni modelo. Existe para que la pantalla que arma roles deje de
 * mantener su propia lista escrita a mano —hoy son dos listas que ya difieren en
 * un caso— y para que agrupe y avise sin adivinar a qué sección pertenece cada
 * casilla.
 */
class PermissionController {
  /**
   * GET /permisos
   *
   * Devuelve las casillas en el orden en que se pintan y las secciones que las
   * agrupan. `tengo` dice cuáles trae quien pregunta: la pantalla las necesita
   * para apagar lo que no puede tocar, y así no vuelve a deducirlas de una tabla
   * suya.
   */
  list = async (req, res) => {
    const acceso = req.user?.acceso

    return ok(res, {
      permisos: PERMISSIONS.map((permiso) => ({ ...permiso })),
      secciones: PERMISSION_SECTIONS.map((seccion) => ({ ...seccion })),
      tengo: PERMISSIONS.filter(({ clave }) => can(acceso, clave)).map(
        ({ clave }) => clave
      )
    })
  }
}

module.exports = new PermissionController()
