const mongoose = require('mongoose')
const Assignment = require('./assignmentModel')
const Project = require('../projects/projectModel')
const Employee = require('../employees/employeeModel')
const Affiliation = require('../affiliations/affiliationModel')
const { AppError } = require('../../../middlewares/errorHandler')
const {
  empresaEsVisible,
  areasVisibles
} = require('../../../middlewares/scopeMiddleware')
const { isBefore } = require('../../../utils/dates')

/**
 * Asignaciones — proyecto ↔ empleado (backend-spec §6.4, modelo-datos §5b.3).
 *
 * Tres reglas que el servidor impone:
 *
 * 1. El empleado necesita **adscripción activa a la empresa del proyecto**. No se
 *    pone en una obra de Empresa 1 a alguien que no trabaja para Empresa 1.
 * 2. Su categoría en el proyecto debe estar **habilitada en ese proyecto**.
 * 3. No se asigna a alguien dado de baja ni a un proyecto finalizado.
 *
 * Quitar a alguien **no borra**: cierra la asignación con `fechaSalida`. Hay que
 * poder responder quién estaba en la obra el día de un accidente.
 */
class AssignmentService {
  async listByProject(proyectoId, { activo } = {}, contexto = {}) {
    const proyecto = await this.#buscarProyectoVisible(proyectoId, contexto)

    const filtro = { proyectoId: proyecto._id }
    if (activo !== undefined) filtro.activo = activo

    const asignaciones = await Assignment.find(filtro)
      .sort({ activo: -1, fechaAsignacion: -1 })
      .populate({ path: 'empleadoId', select: 'nombre tipo activo' })
      .populate({ path: 'categoriaId', select: 'nombre' })

    return {
      asignaciones: asignaciones
        .filter((a) => a.empleadoId)
        .map((a) => ({
          ...a.toJSON(),
          empleadoNombre: a.empleadoId.nombre,
          empleadoTipo: a.empleadoId.tipo,
          categoriaNombre: a.categoriaId?.nombre ?? null
        }))
    }
  }

  /**
   * Quiénes se pueden asignar (modelo-datos §9.3): adscritos y activos en la
   * empresa del proyecto, con una categoría habilitada en él, y que no estén ya
   * asignados. Es el selector de la pantalla, y por eso se resuelve en el
   * servidor: son tres cruces que el navegador no debería hacer.
   */
  async asignables(proyectoId, contexto = {}) {
    const proyecto = await this.#buscarProyectoVisible(proyectoId, contexto)

    // Un jefe de área sólo puede asignar de sus áreas en esa empresa.
    const areas = areasVisibles(
      {
        user: contexto.user,
        areasPorEmpresa: contexto.areasPorEmpresa,
        empresasVisibles: contexto.empresasVisibles
      },
      proyecto.empresaId
    )

    const empleados = await Affiliation.aggregate([
      {
        $match: {
          empresaId: proyecto.empresaId,
          activo: true,
          ...(areas !== null ? { areas: { $in: areas } } : {})
        }
      },
      {
        $lookup: {
          from: 'employees',
          localField: 'empleadoId',
          foreignField: '_id',
          as: 'e'
        }
      },
      { $unwind: '$e' },
      {
        $match: {
          'e.activo': true,
          'e.categoriaId': { $in: proyecto.categorias }
        }
      },
      {
        // Fuera los que ya están asignados a este proyecto.
        $lookup: {
          from: 'assignments',
          let: { emp: '$empleadoId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$empleadoId', '$$emp'] },
                    { $eq: ['$proyectoId', proyecto._id] },
                    { $eq: ['$activo', true] }
                  ]
                }
              }
            }
          ],
          as: 'ya'
        }
      },
      { $match: { ya: { $size: 0 } } },
      {
        $lookup: {
          from: 'categories',
          localField: 'e.categoriaId',
          foreignField: '_id',
          as: 'cat'
        }
      },
      { $unwind: { path: '$cat', preserveNullAndEmptyArrays: true } },
      { $sort: { 'e.nombreNormalizado': 1 } },
      {
        $project: {
          _id: '$e._id',
          nombre: '$e.nombre',
          tipo: '$e.tipo',
          categoriaId: '$e.categoriaId',
          categoriaNombre: '$cat.nombre',
          areas: '$areas'
        }
      }
    ])

    return {
      asignables: empleados.map((e) => ({
        _id: e._id.toString(),
        nombre: e.nombre,
        tipo: e.tipo,
        categoriaId: e.categoriaId.toString(),
        categoriaNombre: e.categoriaNombre ?? null,
        areas: e.areas || []
      }))
    }
  }

  async create(proyectoId, datos, contexto = {}) {
    const proyecto = await this.#buscarProyectoVisible(proyectoId, contexto)

    if (proyecto.estado === 'finalizado') {
      throw new AppError(400, 'No se puede asignar personal a un proyecto finalizado')
    }

    const empleado = await Employee.findById(datos.empleadoId)
    if (!empleado) throw AppError.notFound('El empleado no existe')
    if (!empleado.activo) {
      throw new AppError(400, 'No se puede asignar a una persona dada de baja')
    }

    // Regla 1: adscripción activa a la empresa del proyecto.
    const adscripcion = await Affiliation.findOne({
      empresaId: proyecto.empresaId,
      empleadoId: empleado._id,
      activo: true
    })
    if (!adscripcion) {
      throw AppError.validation(
        `${empleado.nombre} no está adscrito a la empresa de este proyecto. Adscríbelo antes de asignarlo.`,
        [{ msg: 'El empleado no está adscrito a esa empresa', path: 'empleadoId' }]
      )
    }

    // Un jefe de área sólo asigna gente de sus áreas.
    const areas = areasVisibles(
      {
        user: contexto.user,
        areasPorEmpresa: contexto.areasPorEmpresa,
        empresasVisibles: contexto.empresasVisibles
      },
      proyecto.empresaId
    )
    if (areas !== null && !(adscripcion.areas || []).some((a) => areas.includes(a))) {
      throw AppError.forbidden(
        areas.length > 0
          ? `Sólo puedes asignar personal de tus áreas: ${areas.join(', ')}`
          : 'No tienes áreas asignadas en esa empresa'
      )
    }

    // Regla 2: la categoría tiene que estar habilitada en el proyecto.
    if (!proyecto.categorias.map(String).includes(String(datos.categoriaId))) {
      throw AppError.validation(
        'Esa categoría no está habilitada en el proyecto. Agrégala primero.',
        [{ msg: 'La categoría no está habilitada en el proyecto', path: 'categoriaId' }]
      )
    }

    if (isBefore(datos.fechaAsignacion, proyecto.fechaInicio)) {
      throw AppError.validation(
        `La fecha de asignación no puede ser anterior al inicio del proyecto (${proyecto.fechaInicio})`,
        [{ msg: 'Fecha anterior al inicio del proyecto', path: 'fechaAsignacion' }]
      )
    }

    try {
      const asignacion = await Assignment.create({
        proyectoId: proyecto._id,
        empleadoId: empleado._id,
        categoriaId: datos.categoriaId,
        fechaAsignacion: datos.fechaAsignacion
      })
      return this.#unaConNombres(asignacion._id)
    } catch (error) {
      // El índice parcial: ya tiene una asignación ACTIVA en este proyecto.
      if (error.code === 11000) {
        throw AppError.conflict(`${empleado.nombre} ya está asignado a este proyecto`, {
          code: 'ASIGNACION_DUPLICADA'
        })
      }
      throw error
    }
  }

  /** Cierra la asignación. No borra: el histórico es el punto. */
  async salida(id, { fechaSalida }, contexto = {}) {
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError(400, 'La asignación indicada no es válida')
    }
    const asignacion = await Assignment.findById(id)
    if (!asignacion) throw AppError.notFound('La asignación no existe')

    // El alcance se comprueba por el proyecto al que pertenece.
    await this.#buscarProyectoVisible(asignacion.proyectoId, contexto)

    if (!asignacion.activo) {
      throw new AppError(400, 'Esa asignación ya está cerrada')
    }

    asignacion.activo = false
    asignacion.fechaSalida = fechaSalida
    await asignacion.save()

    return this.#unaConNombres(asignacion._id)
  }

  async #unaConNombres(id) {
    const asignacion = await Assignment.findById(id)
      .populate({ path: 'empleadoId', select: 'nombre tipo' })
      .populate({ path: 'categoriaId', select: 'nombre' })

    return {
      asignacion: {
        ...asignacion.toJSON(),
        empleadoNombre: asignacion.empleadoId?.nombre ?? null,
        empleadoTipo: asignacion.empleadoId?.tipo ?? null,
        categoriaNombre: asignacion.categoriaId?.nombre ?? null
      }
    }
  }

  async #buscarProyectoVisible(proyectoId, contexto) {
    if (!mongoose.isValidObjectId(proyectoId)) {
      throw new AppError(400, 'El proyecto indicado no es válido')
    }
    const proyecto = await Project.findById(proyectoId)
    if (!proyecto) throw AppError.notFound('El proyecto no existe')

    if (
      !empresaEsVisible(
        { empresasVisibles: contexto.empresasVisibles },
        proyecto.empresaId
      )
    ) {
      throw AppError.notFound('El proyecto no existe')
    }
    return proyecto
  }
}

module.exports = new AssignmentService()
