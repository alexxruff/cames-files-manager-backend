const Affiliation = require('../affiliations/affiliationModel')
const Role = require('../roles/roleModel')
const { permissionsOf } = require('../../../utils/permissions')
// Se requiere aunque no se use directamente: `populate('empresaId')` resuelve el
// modelo por nombre y sin esto lanza MissingSchemaError.
require('../companies/companyModel')

/**
 * Construye el `AuthUser` que el front espera (backend-spec §6.1).
 *
 * Mapea los nombres del dominio a los del contrato de sesión, que el front ya
 * usa en inglés: `nombre → name`, `activo → active`. El correo es el **de
 * acceso**, no el de contacto de la persona.
 *
 * `empresas[]` son las adscripciones ACTIVAS con su nombre y las áreas que la
 * persona tiene en cada una: es lo que el front necesita para saber qué empresas
 * mostrar y, para un jefe de área, en qué áreas manda.
 *
 * `permisos` es lo que trae quien entró, **ya resuelto** (D-93): su rol más sus
 * excepciones, con el efecto del alcance global aplicado. Va aquí para que la
 * pantalla apague su menú con lo que dice el servidor y deje de mantener su
 * propia copia de la matriz — hoy son dos listas que ya difieren en un caso.
 */
async function construirAuthUser(empleado, { ultimoAccesoEn = null } = {}) {
  const adscripciones = await Affiliation.find({
    empleadoId: empleado._id,
    activo: true
  })
    .populate({ path: 'empresaId', select: 'nombre activo' })
    .select('empresaId areas')

  /*
   * El rol puede venir ya poblado (`protect`) o no (el login, que busca por
   * correo). Se resuelve aquí para que `permisos` diga lo mismo por los dos
   * caminos: sin esto, quien acaba de iniciar sesión recibiría los permisos de su
   * `nivelAcceso` y en la siguiente petición los de su rol.
   */
  const acceso = empleado.acceso
  if (acceso?.rolId && !Array.isArray(acceso.rolId?.permisos)) {
    acceso.rolId = await Role.findById(acceso.rolId).select(
      'nombre permisos todosLosPermisos soloSusAreas activo'
    )
  }
  const rol = acceso?.rolId

  const empresas = adscripciones
    // Una empresa desactivada no debe aparecer como si se pudiera trabajar en ella.
    .filter((a) => a.empresaId && a.empresaId.activo)
    .map((a) => ({
      _id: a.empresaId._id.toString(),
      nombre: a.empresaId.nombre,
      areas: a.areas || []
    }))

  return {
    _id: empleado._id.toString(),
    name: empleado.nombre,
    email: empleado.acceso?.email ?? null,
    nivelAcceso: empleado.acceso?.nivelAcceso ?? null,
    alcanceGlobal: Boolean(empleado.acceso?.alcanceGlobal),
    /*
     * `true` = la contraseña la puso otra persona y el sistema está bloqueado
     * hasta que la cambie (D-49). Va en el `AuthUser` para que el front pueda
     * mandarlo a la pantalla de cambio en cuanto inicia sesión, sin esperar a
     * que le rebote un 403 en la primera pantalla que abra.
     */
    passwordTemporal: Boolean(empleado.acceso?.passwordTemporal),
    rol: rol ? { _id: rol._id.toString(), nombre: rol.nombre } : null,
    /*
     * Sólo las claves: de dónde le viene cada una es la pregunta de la ficha de
     * la persona, no de la sesión propia, y va en `GET /empleados/:id/acceso`.
     */
    permisos: permissionsOf(acceso).map(({ clave }) => clave),
    empresas,
    active: Boolean(empleado.activo && empleado.acceso?.activo),
    ultimoAccesoEn: ultimoAccesoEn ? ultimoAccesoEn.toISOString() : null,
    createdAt: empleado.createdAt,
    updatedAt: empleado.updatedAt
  }
}

module.exports = { construirAuthUser }
