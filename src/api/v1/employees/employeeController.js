const employeeService = require('./employeeService')
const accessService = require('./accessService')
const employeeImportService = require('./employeeImportService')
const { ok, created, noContent } = require('../../../utils/response')
const { empresaFiltro } = require('../../../middlewares/scopeMiddleware')
const { AppError } = require('../../../middlewares/errorHandler')
const { CAMPO } = require('../../../middlewares/uploadMiddleware')
const { aListaDeIds } = require('../../../validations/employeeImportValidation')

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
        categoriaId: req.query.categoriaId,
        soloConAcceso: req.query.soloConAcceso === 'true',
        activo: req.query.activo,
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

  // ─── Importación desde .xlsx (D-46) ──────────────────────────────────────

  /** El archivo, o un 400 que dice cómo mandarlo. */
  #archivo(req) {
    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      throw AppError.validation(`Adjunta el archivo de nómina en el campo "${CAMPO}"`, [
        { msg: 'El archivo es requerido', path: CAMPO }
      ])
    }
    return req.file.buffer
  }

  /** En `multipart` todo llega como cadena: `'true'` es verdadero. */
  #esVerdadero(valor) {
    return valor === true || ['true', '1', 'on'].includes(String(valor).toLowerCase())
  }

  /** POST /empleados/importar/previsualizar — no escribe nada */
  previewImport = async (req, res) => {
    const resultado = await employeeImportService.previsualizar(
      this.#archivo(req),
      {
        empresaId: req.body.empresaId,
        // Se acepta también aquí para poder ver el efecto de la decisión ANTES
        // de aplicarla (D-57).
        forzarArchivoPara: aListaDeIds(req.body.forzarArchivoPara)
      },
      this.#contexto(req)
    )

    req.log.info('Importación previsualizada', {
      empresaId: req.body.empresaId,
      filas: resultado.resumen.filas,
      nuevos: resultado.resumen.nuevos,
      conConflicto: resultado.resumen.conConflicto,
      conError: resultado.resumen.conError,
      // Qué catálogo tocaría: es lo que se revisa antes de aplicar (D-58).
      categoriasNuevas: resultado.categoriasNuevas.length,
      areasNuevas: resultado.areasNuevas.map((a) => a.clave),
      areasReactivadas: resultado.areasReactivadas.map((a) => a.clave)
    })

    return ok(res, resultado)
  }

  /** POST /empleados/importar — aplica */
  import = async (req, res) => {
    const resultado = await employeeImportService.importar(
      this.#archivo(req),
      {
        empresaId: req.body.empresaId,
        confirmarRfcDistinto: this.#esVerdadero(req.body.confirmarRfcDistinto),
        forzarArchivoPara: aListaDeIds(req.body.forzarArchivoPara)
      },
      this.#contexto(req)
    )

    const { resumen } = resultado
    req.log.info('Importación aplicada', {
      empresaId: req.body.empresaId,
      ...resumen,
      categoriasNuevas: resultado.categoriasNuevas.length,
      /*
       * Las claves, no la cuenta: cuando alguien pregunta "¿se crearon las
       * áreas?" —y es lo primero que se pregunta— un número no responde. Son
       * pocas y caben en la línea.
       */
      areasNuevas: resultado.areasNuevas.map((a) => a.clave),
      areasReactivadas: resultado.areasReactivadas.map((a) => a.clave)
    })

    return created(
      res,
      resultado,
      `${resumen.nuevos} ${resumen.nuevos === 1 ? 'persona nueva' : 'personas nuevas'}, ${resumen.yaExisten} ya ${resumen.yaExisten === 1 ? 'existía' : 'existían'} y ${resumen.conError} ${resumen.conError === 1 ? 'fila no se pudo importar' : 'filas no se pudieron importar'}`
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
