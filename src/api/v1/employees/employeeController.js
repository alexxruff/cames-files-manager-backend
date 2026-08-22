const employeeService = require('./employeeService')
const accessService = require('./accessService')
const { ok, created, noContent } = require('../../../utils/response')
const { empresaFiltro } = require('../../../middlewares/scopeMiddleware')

/**
 * HTTP del catálogo de empleados y de sus accesos.
 *
 * El acceso es un sub-recurso: `/empleados/:id/acceso`. Antes de tocarlo se
 * comprueba que el empleado sea **visible** para quien pide, con el mismo 404 que
 * cualquier otra lectura fuera de alcance.
 */
class EmployeeController {
  #contexto(req) {
    return {
      user: req.user,
      empresasVisibles: req.empresasVisibles,
      areasPorEmpresa: req.areasPorEmpresa
    }
  }

  /** GET /empleados */
  list = async (req, res) => {
    // Valida que la empresa pedida esté dentro del alcance (404 si no).
    if (req.query.empresaId) empresaFiltro(req, req.query.empresaId)

    const resultado = await employeeService.list(
      {
        busqueda: req.query.busqueda,
        empresaId: req.query.empresaId,
        area: req.query.area,
        tipo: req.query.tipo,
        soloConAcceso: req.query.soloConAcceso === 'true',
        incluirInactivos: req.query.incluirInactivos === 'true',
        orden: req.query.orden,
        pagina: req.query.pagina,
        porPagina: req.query.porPagina
      },
      this.#contexto(req)
    )

    return ok(res, resultado)
  }

  /** GET /empleados/:id */
  getById = async (req, res) => {
    const renglon = await employeeService.getById(req.params.id, this.#contexto(req))
    return ok(res, { empleado: renglon })
  }

  /** POST /empleados — persona + adscripción en una transacción */
  create = async (req, res) => {
    const renglon = await employeeService.create(req.body, this.#contexto(req))

    req.log.info('Empleado creado', {
      empleadoId: renglon.empleado._id,
      tipo: renglon.empleado.tipo,
      empresas: renglon.adscripciones.map((a) => a.empresaId)
    })

    return created(res, { empleado: renglon }, 'Empleado dado de alta correctamente')
  }

  /** PATCH /empleados/:id — datos de la persona */
  update = async (req, res) => {
    const renglon = await employeeService.update(
      req.params.id,
      req.body,
      this.#contexto(req)
    )

    req.log.info('Empleado actualizado', {
      empleadoId: renglon.empleado._id,
      campos: Object.keys(req.body)
    })

    return ok(res, { empleado: renglon }, 'Empleado actualizado correctamente')
  }

  /** PATCH /empleados/:id/estado — baja o reactivación del sistema */
  setEstado = async (req, res) => {
    const renglon = await employeeService.setEstado(
      req.params.id,
      { activo: req.body.activo, motivo: req.body.motivo, fecha: req.body.fecha },
      this.#contexto(req)
    )

    req.log.info(req.body.activo ? 'Empleado reactivado' : 'Empleado dado de baja', {
      empleadoId: renglon.empleado._id,
      motivo: req.body.motivo || null
    })

    return ok(
      res,
      { empleado: renglon },
      req.body.activo
        ? 'Empleado reactivado. Si necesita entrar a la plataforma, vuelve a darle acceso.'
        : 'Empleado dado de baja. Su expediente y su historial se conservan.'
    )
  }

  /**
   * POST /empleados/:id/acceso
   *
   * Devuelve el **RenglonEmpleado**, igual que el alta y la edición: así
   * `data.empleado` significa siempre lo mismo y la interfaz puede reemplazar el
   * renglón de la tabla sin una segunda petición.
   */
  grantAccess = async (req, res) => {
    await employeeService.getById(req.params.id, this.#contexto(req))
    const empleado = await accessService.grant(req.params.id, req.body, {
      actor: req.user
    })

    req.log.info('Acceso concedido', {
      empleadoId: empleado._id.toString(),
      nivelAcceso: empleado.acceso.nivelAcceso,
      alcanceGlobal: empleado.acceso.alcanceGlobal
    })

    const renglon = await employeeService.getById(empleado._id, this.#contexto(req))
    return created(res, { empleado: renglon }, 'Acceso concedido correctamente')
  }

  /** PATCH /empleados/:id/acceso */
  updateAccess = async (req, res) => {
    await employeeService.getById(req.params.id, this.#contexto(req))
    const empleado = await accessService.update(req.params.id, req.body, {
      actor: req.user
    })

    req.log.info('Acceso actualizado', { empleadoId: empleado._id.toString() })

    const renglon = await employeeService.getById(empleado._id, this.#contexto(req))
    return ok(res, { empleado: renglon }, 'Acceso actualizado correctamente')
  }

  /** DELETE /empleados/:id/acceso → 204 */
  revokeAccess = async (req, res) => {
    await employeeService.getById(req.params.id, this.#contexto(req))
    await accessService.revoke(req.params.id, { actor: req.user })

    req.log.info('Acceso retirado', { empleadoId: req.params.id })
    return noContent(res)
  }

  /** POST /empleados/:id/acceso/restablecer-password */
  resetPassword = async (req, res) => {
    await employeeService.getById(req.params.id, this.#contexto(req))
    const empleado = await accessService.resetPassword(req.params.id, req.body)

    req.log.info('Contraseña restablecida por un administrador', {
      empleadoId: empleado._id.toString(),
      porEmpleadoId: req.user._id.toString()
    })

    const renglon = await employeeService.getById(empleado._id, this.#contexto(req))
    return ok(
      res,
      { empleado: renglon },
      'Contraseña restablecida. Sus sesiones se cerraron.'
    )
  }
}

module.exports = new EmployeeController()
