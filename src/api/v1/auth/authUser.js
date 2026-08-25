const Affiliation = require('../affiliations/affiliationModel')
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
 */
async function construirAuthUser(empleado, { ultimoAccesoEn = null } = {}) {
  const adscripciones = await Affiliation.find({
    empleadoId: empleado._id,
    activo: true
  })
    .populate({ path: 'empresaId', select: 'nombre activo' })
    .select('empresaId areas')

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
    empresas,
    active: Boolean(empleado.activo && empleado.acceso?.activo),
    ultimoAccesoEn: ultimoAccesoEn ? ultimoAccesoEn.toISOString() : null,
    createdAt: empleado.createdAt,
    updatedAt: empleado.updatedAt
  }
}

module.exports = { construirAuthUser }
