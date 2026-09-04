const Role = require('./roleModel')
const Employee = require('../employees/employeeModel')
const { AppError } = require('../../../middlewares/errorHandler')
const { normalize } = require('../../../utils/text')
const {
  PERMISSION_KEYS,
  PERMISSION_BY_KEY,
  missingRequirements
} = require('../../../utils/permissions')

/**
 * Roles: el negocio de armar un perfil (D-93).
 *
 * Tres reglas que no están en el esquema porque no son de forma, son de sentido:
 *
 * 1. **Un rol incoherente no se guarda.** Marcar «modificar máquinas» sin «ver
 *    máquinas» es un error de captura, y se atrapa aquí, al capturar. Las rutas
 *    no lo comprueban: cada una pide la casilla que le toca y el resto no le
 *    incumbe.
 * 2. **Un rol de sistema no se borra ni se renombra**, pero SÍ se le pueden
 *    cambiar los permisos: son el punto de partida, no una jaula.
 * 3. **Un rol que alguien está usando no se borra.** Primero hay que mover a esa
 *    gente, y el error dice cuántos son para que se sepa el tamaño del trabajo.
 */
class RoleService {
  /** Los roles del grupo. Sin alcance: hoy todos son del grupo (`empresaId: null`). */
  async list({ incluirInactivos = false, busqueda } = {}) {
    const filtro = {}
    if (!incluirInactivos) filtro.activo = true
    if (busqueda) filtro.nombreNormalizado = { $regex: normalize(busqueda) }

    const roles = await Role.find(filtro).sort({ nombre: 1 })

    /*
     * Cuánta gente tiene cada uno, en UNA consulta: la pantalla lo necesita para
     * avisar antes de que alguien intente borrar uno en uso, y pedirlo rol por
     * rol serían tantas consultas como roles.
     */
    const conteos = await Employee.aggregate([
      { $match: { 'acceso.rolId': { $ne: null } } },
      { $group: { _id: '$acceso.rolId', total: { $sum: 1 } } }
    ])
    const porRol = Object.fromEntries(conteos.map((c) => [String(c._id), c.total]))

    return {
      roles: roles.map((rol) => ({
        ...rol.toJSON(),
        personas: porRol[rol._id.toString()] || 0
      }))
    }
  }

  async getById(id) {
    const rol = await Role.findById(id)
    if (!rol) throw new AppError(404, 'Ese rol no existe')
    return rol
  }

  async create(datos) {
    const permisos = this.#validarPermisos(datos.permisos)
    await this.#assertNombreLibre(datos.nombre)

    const rol = await Role.create({
      nombre: datos.nombre,
      descripcion: datos.descripcion ?? null,
      permisos,
      // Hoy siempre del grupo. El campo existe para el día que deje de serlo.
      empresaId: null,
      esSistema: false,
      soloSusAreas: Boolean(datos.soloSusAreas)
    })

    return rol
  }

  async update(id, datos) {
    const rol = await this.getById(id)

    if (datos.nombre !== undefined) {
      /*
       * Se compara contra `normalize(rol.nombre)` y NO contra
       * `rol.nombreNormalizado`, que va `select: false` y por lo tanto no está
       * cargado aquí: con él, mandar el mismo nombre de un rol de sistema —que
       * es lo que hace un formulario que devuelve el objeto entero— habría dado
       * 400 por comparar contra `undefined`.
       */
      if (rol.esSistema && normalize(datos.nombre) !== normalize(rol.nombre)) {
        throw new AppError(
          400,
          'Los roles del sistema no se pueden renombrar. Duplícalo para armar uno propio.'
        )
      }
      await this.#assertNombreLibre(datos.nombre, rol._id)
      rol.nombre = datos.nombre
    }

    if (datos.descripcion !== undefined) rol.descripcion = datos.descripcion || null
    if (datos.soloSusAreas !== undefined) rol.soloSusAreas = Boolean(datos.soloSusAreas)

    if (datos.permisos !== undefined) {
      /*
       * `todosLosPermisos` no se toca desde aquí: el rol que lo lleva es el del
       * administrador de plataforma, y marcarle o desmarcarle casillas no cambia
       * nada. Editarle los permisos es un gesto sin efecto, no un error, así que
       * se acepta y se guarda la lista — pero la bandera manda.
       */
      rol.permisos = this.#validarPermisos(datos.permisos)
    }

    if (datos.activo !== undefined) {
      if (rol.esSistema && datos.activo === false) {
        throw new AppError(400, 'Los roles del sistema no se pueden dar de baja')
      }
      rol.activo = datos.activo
    }

    await rol.save()
    return rol
  }

  /**
   * Borrado de verdad, no baja lógica: un rol sin gente no deja historia que
   * respetar —a diferencia de un tipo de incidencia, que las viejas siguen
   * citando—. Los de sistema no se borran, y uno en uso tampoco.
   */
  async remove(id) {
    const rol = await this.getById(id)

    if (rol.esSistema) {
      throw new AppError(400, 'Los roles del sistema no se pueden eliminar')
    }

    const personas = await Employee.countDocuments({ 'acceso.rolId': rol._id })
    if (personas > 0) {
      throw new AppError(
        409,
        personas === 1
          ? 'Hay 1 persona con este rol. Cámbiale el rol antes de eliminarlo.'
          : `Hay ${personas} personas con este rol. Cámbiales el rol antes de eliminarlo.`,
        { code: 'ROL_EN_USO', data: { personas } }
      )
    }

    await rol.deleteOne()
  }

  /**
   * Valida la lista de casillas: que existan, que no se repitan, y que ninguna
   * marcada dependa de otra sin marcar.
   */
  #validarPermisos(permisos) {
    const claves = [...new Set(permisos || [])]

    const inventadas = claves.filter((c) => !PERMISSION_KEYS.includes(c))
    if (inventadas.length > 0) {
      throw new AppError(400, `Ese permiso no existe: ${inventadas[0]}`)
    }

    const faltantes = missingRequirements(claves)
    if (faltantes.length > 0) {
      const { clave, requiere } = faltantes[0]
      throw new AppError(
        400,
        `«${PERMISSION_BY_KEY[clave].etiqueta}» necesita también «${PERMISSION_BY_KEY[requiere].etiqueta}»`,
        {
          code: 'PERMISO_REQUERIDO',
          data: { faltantes }
        }
      )
    }

    return claves
  }

  async #assertNombreLibre(nombre, exceptoId = null) {
    const filtro = { nombreNormalizado: normalize(nombre), empresaId: null }
    if (exceptoId) filtro._id = { $ne: exceptoId }

    if (await Role.exists(filtro)) {
      throw new AppError(409, 'Ya existe un rol con ese nombre', {
        code: 'ROL_DUPLICADO'
      })
    }
  }
}

module.exports = new RoleService()
