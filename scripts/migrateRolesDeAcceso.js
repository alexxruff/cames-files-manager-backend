/**
 * Migración: cada persona con acceso pasa a tener un ROL (D-93).
 *
 *   node scripts/migrateRolesDeAcceso.js --dry-run
 *   node scripts/migrateRolesDeAcceso.js
 *
 * **No es urgente, y ése es el punto.** Quien no tenga rol sigue resolviéndose
 * por su `nivelAcceso` contra la matriz de siempre, así que el despliegue no
 * depende de esto y nadie se queda sin permisos si tarda. Lo que la migración
 * consigue es que a partir de ahí los permisos de todos salgan del **mismo**
 * sitio —su rol—, y que editarlo desde la pantalla les sirva de algo.
 *
 * Qué hace: a cada empleado con acceso le pone el rol de sistema que corresponde
 * a su `nivelAcceso` —Administrador de RH, Consulta de RH o Jefe de área—, que
 * son los que se siembran en el arranque derivándolos de esa misma matriz. O sea,
 * deja a todos exactamente como estaban.
 *
 * Es idempotente y **no toca a quien ya tenga `rolId`**: si alguien ya recibió un
 * rol a mano —el contador, el auxiliar—, volver a correr esto no se lo pisa. Por
 * eso se puede correr las veces que haga falta sin pensarlo.
 */
const logger = require('../src/utils/logger')
const { connect, disconnect } = require('../src/config/database')
const Employee = require('../src/api/v1/employees/employeeModel')
const Role = require('../src/api/v1/roles/roleModel')
const { ensureSystemRoles, ROLES_DE_SISTEMA } = require('../src/services/seedRoles')
const { ACCESS_LEVEL_LABELS } = require('../src/constants')

const DRY_RUN = process.argv.slice(2).includes('--dry-run')

async function main() {
  await connect()

  /*
   * Los roles tienen que existir para poder apuntarles, y en una base donde el
   * servidor nunca arrancó con D-93 todavía no están.
   *
   * **En `--dry-run` no se siembran**: sembrar es escribir, y un ensayo que
   * escribe no es un ensayo. Se reporta que faltan y se sigue con lo demás
   * usando los que haya.
   */
  let porNivel = {}

  if (DRY_RUN) {
    const existentes = await Role.find({ esSistema: true, empresaId: null })
    porNivel = Object.fromEntries(
      ROLES_DE_SISTEMA.map((r) => [
        r.nivelAcceso,
        existentes.find((e) => e.nombre === ACCESS_LEVEL_LABELS[r.nivelAcceso])
      ]).filter(([, rol]) => rol)
    )

    const faltan = ROLES_DE_SISTEMA.map((r) => r.nivelAcceso).filter((n) => !porNivel[n])
    if (faltan.length > 0) {
      logger.info(
        'Los roles de sistema todavía no existen: la corrida de verdad los creará ' +
          '(o los crea el propio arranque del servidor)',
        { faltan }
      )
    }
  } else {
    const sembrados = await ensureSystemRoles()
    porNivel = sembrados.porNivel
    if (sembrados.creados.length > 0) {
      logger.info('Roles de sistema creados por la migración', {
        creados: sembrados.creados
      })
    }
  }

  const pendientes = await Employee.find({
    acceso: { $ne: null },
    $or: [{ 'acceso.rolId': null }, { 'acceso.rolId': { $exists: false } }]
  }).select('nombre acceso.email acceso.nivelAcceso')

  logger.info(`Accesos sin rol: ${pendientes.length}`, { dryRun: DRY_RUN })
  if (pendientes.length === 0) {
    logger.info('Nada que migrar: todos los accesos ya tienen rol')
    return disconnect()
  }

  const resumen = []
  const sinRol = []

  for (const empleado of pendientes) {
    const rol = porNivel[empleado.acceso.nivelAcceso]

    /*
     * Un nivel que no tiene rol de sistema no debería existir —el esquema lo
     * valida con un enum—, pero si aparece se REPORTA y se deja como está: es
     * mejor un acceso que sigue resolviéndose por la matriz que uno apuntando a
     * un rol equivocado.
     */
    if (!rol) {
      sinRol.push({ nombre: empleado.nombre, nivel: empleado.acceso.nivelAcceso })
      continue
    }

    resumen.push({
      nombre: empleado.nombre,
      correo: empleado.acceso.email,
      rol: rol.nombre
    })

    if (!DRY_RUN) {
      /*
       * `updateOne` y no `empleado.save()`, y no es una preferencia de estilo.
       *
       * Guardar el documento dispara `pre('validate')` ENTERO, y aquí se leen los
       * empleados con `.select(...)`: los campos que no se piden llegan
       * `undefined`, así que `activo` se lee como baja y la invariante exige un
       * `motivoBaja` que nadie quitó. Esta migración toca UN campo y no tiene por
       * qué revalidar a la persona completa — y menos por campos que ni siquiera
       * cargó.
       */
      await Employee.updateOne(
        { _id: empleado._id },
        { $set: { 'acceso.rolId': rol._id } }
      )
    }
  }

  // En seco se dice en FUTURO: «Roles asignados» con `dryRun: true` se lee como
  // que ya está hecho, y el ensayo existe justo para que nadie lo crea.
  logger.info(DRY_RUN ? 'Roles que se asignarían' : 'Roles asignados', {
    accesos: resumen.length,
    dryRun: DRY_RUN
  })
  for (const r of resumen) {
    logger.info(`  · ${r.nombre} (${r.correo}) ${DRY_RUN ? '⇢' : '→'} ${r.rol}`)
  }

  if (DRY_RUN) {
    logger.info(
      'Ensayo: no se escribió nada. Corre `npm run migrate:roles` para aplicarlo.'
    )
  }

  if (sinRol.length > 0) {
    logger.warn(
      DRY_RUN
        ? 'En el ensayo no hay rol al que apuntarlos todavía. Al correrla de ' +
            'verdad se crean primero y estos quedan asignados.'
        : 'Estos accesos se quedaron SIN rol porque su nivel no tiene uno de ' +
            'sistema. Siguen funcionando por la matriz; asígnales rol a mano.',
      { accesos: sinRol.length, detalle: sinRol.slice(0, 10) }
    )
  }

  await disconnect()
}

main().catch(async (error) => {
  logger.error('La migración de roles falló', {
    error: error.message,
    stack: error.stack
  })
  await disconnect().catch(() => {})
  process.exit(1)
})
