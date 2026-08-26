/**
 * Áreas de la organización — **ya no son un enum fijo** (D-58).
 *
 * Antes esta lista era el catálogo: `affiliations.areas` la validaba con un
 * `enum` de Mongoose y las rutas con `isIn(AREAS)`. Se convirtió en una
 * colección (`areas`) porque el archivo de nómina trae en la columna
 * `Departamento` valores que no son áreas de la organización sino obras
 * concretas —`Axis Zapopan`, `Axis 3`—, y cada una tenía que entrar a mano en
 * este archivo y desplegarse. Ahora entran solas como **áreas temporales** y RH
 * las da de baja cuando la obra termina.
 *
 * Lo que queda aquí es sólo la **semilla**: con qué arranca el catálogo en una
 * base vacía. La verdad vive en la colección; para validar, `areaService`.
 *
 * `clave` es el valor del contrato —lo que se guarda en `adscripciones.areas` y
 * lo que compara el front— y `nombre` es lo que se muestra. Las claves se fijan
 * a mano, no se derivan del nombre: `Recursos Humanos (RH)` tiene que seguir
 * siendo `recursos_humanos`, que es lo que ya está guardado en producción.
 */
const AREAS_BASE = Object.freeze([
  { clave: 'direccion', nombre: 'Dirección' },
  { clave: 'recursos_humanos', nombre: 'Recursos Humanos (RH)' },
  { clave: 'finanzas', nombre: 'Finanzas' },
  { clave: 'operaciones_maquinaria', nombre: 'Operaciones (Maquinaria)' },
  { clave: 'operaciones_urbanizadora', nombre: 'Operaciones (Urbanizadora)' },
  { clave: 'costos_y_presupuestos', nombre: 'Costos y Presupuestos' },
  { clave: 'comercial', nombre: 'Comercial' },
  { clave: 'tesoreria', nombre: 'Tesorería' },
  { clave: 'contabilidad', nombre: 'Contabilidad' }
])

/**
 * Áreas del modelo anterior que ya tienen gente asignada en producción.
 *
 * No se mapean a mano a las nuevas: **las corrige el archivo** al re-importar
 * la nómina (decisión del cliente). Entran al catálogo como NO base y
 * **activas**, para que nadie pierda su área ni un jefe de área deje de ver a su
 * gente mientras tanto; cuando el archivo termine de reasignarlas se quedan sin
 * nadie y RH puede darlas de baja.
 *
 * Sólo se siembran las que de verdad estén en uso: en una base nueva no
 * aparecen.
 */
const AREAS_HEREDADAS = Object.freeze([
  { clave: 'administracion', nombre: 'Administración' },
  { clave: 'obra', nombre: 'Obra' },
  { clave: 'proyectos', nombre: 'Proyectos' },
  { clave: 'compras', nombre: 'Compras' },
  { clave: 'ventas', nombre: 'Ventas' },
  { clave: 'mantenimiento', nombre: 'Mantenimiento' }
])

module.exports = { AREAS_BASE, AREAS_HEREDADAS }
