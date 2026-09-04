const { body, param, query } = require('express-validator')
const { PERMISSION_KEYS } = require('../utils/permissions')

/**
 * Roles (D-93).
 *
 * Aquí sólo la FORMA: que el nombre quepa, que `permisos` sea una lista de
 * claves del catálogo y que no llegue nada de más. Que la lista sea **coherente**
 * —no marcar «modificar» sin «ver»— lo decide `roleService`, porque el mensaje
 * tiene que decir qué casilla falta con su etiqueta, y eso es negocio.
 */
const nombre = (regla) =>
  regla
    .trim()
    .notEmpty()
    .withMessage('El nombre del rol es requerido')
    .bail()
    .isLength({ min: 3, max: 60 })
    .withMessage('El nombre debe tener entre 3 y 60 caracteres')

const descripcion = (regla) =>
  regla
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 240 })
    .withMessage('La descripción no puede exceder 240 caracteres')

const permisos = (regla, { obligatorio = false } = {}) => {
  const base = obligatorio ? regla : regla.optional()
  return base
    .isArray()
    .withMessage('Los permisos deben venir como una lista')
    .bail()
    .custom((claves) => {
      const inventadas = claves.filter((c) => !PERMISSION_KEYS.includes(c))
      if (inventadas.length > 0) {
        throw new Error(`Ese permiso no existe: ${inventadas[0]}`)
      }
      return true
    })
}

const soloSusAreas = (regla) =>
  regla.optional().isBoolean().withMessage('soloSusAreas debe ser verdadero o falso')

exports.listRolesValidation = [
  query('incluirInactivos')
    .optional()
    .isIn(['true', 'false'])
    .withMessage('incluirInactivos debe ser true o false'),
  query('busqueda').optional().trim().isLength({ max: 60 })
]

exports.roleIdValidation = [
  param('id').isMongoId().withMessage('El rol indicado no es válido')
]

exports.createRoleValidation = [
  nombre(body('nombre')),
  descripcion(body('descripcion')),
  permisos(body('permisos'), { obligatorio: true }),
  soloSusAreas(body('soloSusAreas'))
]

exports.updateRoleValidation = [
  param('id').isMongoId().withMessage('El rol indicado no es válido'),
  nombre(body('nombre').optional()),
  descripcion(body('descripcion')),
  permisos(body('permisos')),
  soloSusAreas(body('soloSusAreas')),
  body('activo').optional().isBoolean().withMessage('activo debe ser verdadero o falso'),
  body().custom((cuerpo) => {
    const campos = ['nombre', 'descripcion', 'permisos', 'soloSusAreas', 'activo']
    if (!campos.some((c) => cuerpo[c] !== undefined)) {
      throw new Error('No hay nada que actualizar')
    }
    return true
  })
]
