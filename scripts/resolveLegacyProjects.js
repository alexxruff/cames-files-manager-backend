/**
 * Proyectos anteriores a D-69, que no tienen registro patronal ni de obra.
 *
 *   node scripts/resolveLegacyProjects.js                 # sólo reporta
 *   node scripts/resolveLegacyProjects.js --rellenar      # les pone el primero activo
 *   node scripts/resolveLegacyProjects.js --borrar        # los elimina
 *
 * **Por omisión no escribe nada**: reporta qué proyectos están incompletos y qué
 * opciones tiene cada uno. Elegir es del cliente, no del script.
 *
 * Estos proyectos **siguen funcionando** aunque les falten los campos: la
 * obligatoriedad se aplica sólo a los NUEVOS (`required` como función de
 * `isNew`), justo para no invalidar lo que ya está guardado. O sea que esto no
 * corre prisa; sirve para dejar la base coherente cuando se decida.
 *
 * `--rellenar` toma el **primer registro activo** de la empresa y del cliente de
 * cada proyecto. Es una elección arbitraria y sólo tiene sentido con datos de
 * prueba; con proyectos reales hay que asignarlos a mano, porque de eso depende
 * a qué obra pertenece cada uno.
 *
 * `--borrar` elimina el proyecto **y sus asignaciones**. Es destructivo y no
 * tiene vuelta atrás.
 */
const logger = require('../src/utils/logger')
const { connect, disconnect } = require('../src/config/database')
const Project = require('../src/api/v1/projects/projectModel')
const Company = require('../src/api/v1/companies/companyModel')
const Client = require('../src/api/v1/clients/clientModel')
const Assignment = require('../src/api/v1/assignments/assignmentModel')

const argumentos = process.argv.slice(2)
const RELLENAR = argumentos.includes('--rellenar')
const BORRAR = argumentos.includes('--borrar')

async function main() {
  await connect()

  if (RELLENAR && BORRAR) {
    logger.error('Elige una: --rellenar o --borrar, no las dos')
    return disconnect()
  }

  const incompletos = await Project.find({
    $or: [{ registroPatronalId: null }, { registroObraId: null }]
  })

  logger.info(`Proyectos incompletos: ${incompletos.length}`, {
    modo: RELLENAR ? 'rellenar' : BORRAR ? 'borrar' : 'sólo reportar'
  })

  if (incompletos.length === 0) {
    logger.info('Nada que resolver: todos los proyectos están completos')
    return disconnect()
  }

  const empresas = new Map()
  const clientes = new Map()

  for (const proyecto of incompletos) {
    const clave = String(proyecto.empresaId)
    if (!empresas.has(clave)) {
      empresas.set(
        clave,
        await Company.findById(proyecto.empresaId).select('nombre registrosPatronales')
      )
    }
    const claveCliente = String(proyecto.clienteId)
    if (!clientes.has(claveCliente)) {
      clientes.set(
        claveCliente,
        await Client.findById(proyecto.clienteId).select('nombre registrosObra')
      )
    }

    const empresa = empresas.get(clave)
    const cliente = clientes.get(claveCliente)
    const rp = (empresa?.registrosPatronales || []).find((r) => r.activo)
    const ro = (cliente?.registrosObra || []).find((r) => r.activo)
    const asignaciones = await Assignment.countDocuments({ proyectoId: proyecto._id })

    logger.info(`  · ${proyecto.nombre}`, {
      estado: proyecto.estado,
      empresa: empresa?.nombre,
      cliente: cliente?.nombre,
      asignaciones,
      leFalta: [
        proyecto.registroPatronalId ? null : 'registroPatronal',
        proyecto.registroObraId ? null : 'registroObra'
      ].filter(Boolean),
      candidatos: {
        registroPatronal: rp ? rp.numero : '(la empresa no tiene ninguno activo)',
        registroObra: ro ? ro.numero : '(el cliente no tiene ninguno activo)'
      }
    })

    if (BORRAR) {
      await Assignment.deleteMany({ proyectoId: proyecto._id })
      await Project.deleteOne({ _id: proyecto._id })
      logger.warn(`    borrado, con ${asignaciones} asignación(es)`)
      continue
    }

    if (!RELLENAR) continue

    if (!rp || !ro) {
      logger.warn('    NO se rellena: falta un registro activo. Créalo primero.')
      continue
    }

    /*
     * `updateOne` y no `save()`: el documento en memoria no trae los campos y
     * `save()` dispararía la validación completa sobre un documento que puede
     * tener otras cosas viejas. Aquí sólo se ponen los dos que faltan.
     */
    await Project.updateOne(
      { _id: proyecto._id },
      {
        $set: {
          registroPatronalId: proyecto.registroPatronalId || rp._id,
          registroObraId: proyecto.registroObraId || ro._id
        }
      }
    )
    logger.info(`    rellenado con ${rp.numero} y ${ro.numero}`)
  }

  if (!RELLENAR && !BORRAR) {
    logger.warn(
      'No se escribió nada. Vuelve a correrlo con --rellenar (les pone el primer ' +
        'registro activo) o con --borrar (los elimina, junto con sus asignaciones).'
    )
  }

  await disconnect()
}

main().catch(async (error) => {
  logger.error('Falló al resolver los proyectos', {
    error: error.message,
    stack: error.stack
  })
  await disconnect().catch(() => {})
  process.exit(1)
})
