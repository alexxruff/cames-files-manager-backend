/**
 * Áreas de la organización.
 *
 * Los VALORES son literales del contrato: el front los compara por igualdad
 * estricta (`src/enums/area.ts`). No renombrar, no reordenar.
 */
const AREAS = Object.freeze([
  'direccion',
  'administracion',
  'recursos_humanos',
  'contabilidad',
  'obra',
  'proyectos',
  'compras',
  'ventas',
  'mantenimiento'
])

const AREA_LABELS = Object.freeze({
  direccion: 'Dirección',
  administracion: 'Administración',
  recursos_humanos: 'Recursos Humanos',
  contabilidad: 'Contabilidad',
  obra: 'Obra',
  proyectos: 'Proyectos',
  compras: 'Compras',
  ventas: 'Ventas',
  mantenimiento: 'Mantenimiento'
})

module.exports = { AREAS, AREA_LABELS }
