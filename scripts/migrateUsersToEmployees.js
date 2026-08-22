/**
 * Migración: colección `app_users` (modelo viejo) → `employees` + `credentials`
 * + `affiliations` (modelo nuevo).
 *
 *   node scripts/migrateUsersToEmployees.js --dry-run
 *   node scripts/migrateUsersToEmployees.js --empresa "Urbacames Edificación"
 *   node scripts/migrateUsersToEmployees.js --admin-global admin@urbacames.com
 *
 * Qué hace por cada usuario:
 *   1. Crea el **empleado** con su acceso (`nivelAcceso`, `activo`).
 *   2. Crea su **credencial** copiando el hash de bcrypt **tal cual**: nadie
 *      tiene que restablecer su contraseña (mismo coste 12 en los dos modelos).
 *   3. Crea su **adscripción** a la empresa indicada, con las áreas que tuviera.
 *
 * Es **idempotente**: si ya existe un empleado con ese correo de acceso, lo omite.
 * No borra `app_users`: se conserva hasta que la migración esté verificada.
 *
 * SUPUESTOS, porque el modelo viejo no guardaba esos datos y la adscripción los
 * exige. Quedan registrados en el resumen para que se corrijan a mano después:
 *   · `tipoContrato: 'indeterminado'`
 *   · `fechaIngreso`: la fecha en que se creó el usuario
 *   · `tipo: 'administrativo'` (quien entraba a la plataforma era personal de RH)
 */
const mongoose = require('mongoose')
const logger = require('../src/utils/logger')
const { connect, disconnect } = require('../src/config/database')
const Employee = require('../src/api/v1/employees/employeeModel')
const Credential = require('../src/api/v1/credentials/credentialModel')
const Company = require('../src/api/v1/companies/companyModel')
const Category = require('../src/api/v1/categories/categoryModel')
const Affiliation = require('../src/api/v1/affiliations/affiliationModel')

const argumentos = process.argv.slice(2)
const bandera = (nombre, porDefecto = null) => {
  const i = argumentos.indexOf(`--${nombre}`)
  return i >= 0 && argumentos[i + 1] ? argumentos[i + 1] : porDefecto
}

const DRY_RUN = argumentos.includes('--dry-run')
const EMPRESA = bandera('empresa', 'Urbacames')
const CATEGORIA = bandera('categoria', 'Administración')
const ADMIN_GLOBAL = (bandera('admin-global') || '').toLowerCase()

const aFechaCalendario = (fecha) =>
  (fecha instanceof Date ? fecha : new Date()).toISOString().slice(0, 10)

async function main() {
  await connect()

  const usuarios = await mongoose.connection.db.collection('app_users').find({}).toArray()

  logger.info(`Usuarios encontrados en app_users: ${usuarios.length}`, {
    empresa: EMPRESA,
    dryRun: DRY_RUN
  })

  if (usuarios.length === 0) {
    logger.info('Nada que migrar')
    return disconnect()
  }

  const resumen = { migrados: [], omitidos: [], fallidos: [] }

  // Empresa y categoría destino: se crean una vez si no existen.
  let empresa = await Company.findOne({ nombre: EMPRESA })
  let categoria = await Category.findOne({ nombre: CATEGORIA })

  if (!DRY_RUN) {
    if (!empresa) empresa = await Company.create({ nombre: EMPRESA })
    if (!categoria)
      categoria = await Category.create({
        nombre: CATEGORIA,
        tipo: 'administrativo',
        esBase: true
      })
  }

  for (const usuario of usuarios) {
    const correo = String(usuario.email || '').toLowerCase()

    try {
      if (!correo || !usuario.password) {
        resumen.omitidos.push({ correo, motivo: 'sin correo o sin contraseña' })
        continue
      }

      const yaExiste = await Employee.findOne({ 'acceso.email': correo })
      if (yaExiste) {
        resumen.omitidos.push({ correo, motivo: 'ya existe un empleado con ese acceso' })
        continue
      }

      const areas = usuario.area ? [usuario.area] : []
      const plan = {
        correo,
        nombre: usuario.name,
        nivelAcceso: usuario.nivelAcceso || 'rh_consulta',
        alcanceGlobal: correo === ADMIN_GLOBAL,
        activo: usuario.active !== false,
        areas,
        fechaIngreso: aFechaCalendario(usuario.createdAt)
      }

      if (DRY_RUN) {
        resumen.migrados.push(plan)
        continue
      }

      const sesion = await mongoose.startSession()
      try {
        await sesion.withTransaction(async () => {
          const [empleado] = await Employee.create(
            [
              {
                nombre: usuario.name,
                categoriaId: categoria._id,
                tipo: 'administrativo',
                email: correo,
                acceso: {
                  email: correo,
                  nivelAcceso: plan.nivelAcceso,
                  alcanceGlobal: plan.alcanceGlobal,
                  activo: plan.activo,
                  passwordActualizadaEn: null
                },
                activo: plan.activo,
                motivoBaja: plan.activo ? null : 'Migración del modelo anterior',
                createdAt: usuario.createdAt,
                updatedAt: usuario.updatedAt
              }
            ],
            { session: sesion }
          )

          // El hash se copia SIN volver a hashear.
          await Credential.create(
            [
              {
                empleadoId: empleado._id,
                passwordHash: usuario.password,
                ultimoAccesoEn: usuario.ultimoAccesoEn || null
              }
            ],
            { session: sesion }
          )

          await Affiliation.create(
            [
              {
                empresaId: empresa._id,
                empleadoId: empleado._id,
                areas,
                tipoContrato: 'indeterminado',
                fechaIngreso: plan.fechaIngreso,
                activo: plan.activo,
                motivoBaja: plan.activo ? null : 'Migración del modelo anterior',
                fechaBaja: plan.activo ? null : aFechaCalendario(new Date())
              }
            ],
            { session: sesion }
          )
        })
        resumen.migrados.push(plan)
      } finally {
        await sesion.endSession()
      }
    } catch (error) {
      resumen.fallidos.push({ correo, error: error.message })
    }
  }

  logger.info(
    DRY_RUN ? 'Plan de migración (no se escribió nada)' : 'Migración terminada',
    {
      migrados: resumen.migrados.length,
      omitidos: resumen.omitidos.length,
      fallidos: resumen.fallidos.length
    }
  )
  for (const m of resumen.migrados) {
    logger.info(
      `  · ${m.correo} → ${m.nivelAcceso}${m.alcanceGlobal ? ' (global)' : ''}`,
      {
        areas: m.areas,
        fechaIngresoSupuesta: m.fechaIngreso
      }
    )
  }
  for (const o of resumen.omitidos) logger.warn(`  · omitido ${o.correo}: ${o.motivo}`)
  for (const f of resumen.fallidos) logger.error(`  · falló ${f.correo}: ${f.error}`)

  if (!DRY_RUN && resumen.migrados.length > 0) {
    logger.warn(
      'Revisa los supuestos: tipoContrato indeterminado, fecha de ingreso tomada del ' +
        'alta del usuario y tipo administrativo. Corrígelos donde no apliquen. ' +
        '`app_users` NO se borró: hazlo cuando verifiques que todos pueden entrar.'
    )
  }

  await disconnect()
}

main().catch(async (error) => {
  logger.error('La migración falló', { error: error.message, stack: error.stack })
  await disconnect().catch(() => {})
  process.exit(1)
})
