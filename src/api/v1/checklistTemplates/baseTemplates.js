const { DOCUMENT_TYPES } = require('../../../constants')

/**
 * Plantillas base del checklist (spec 6.5).
 *
 * Son copia exacta de las que el front ya usa en `src/mocks/plantillas.ts`:
 * mismos nombres, mismas descripciones, mismos documentos opcionales y mismas
 * vigencias. Si cambian de un lado, hay que cambiarlas del otro, porque el front
 * las muestra en la pantalla de configuración.
 *
 * `esBase: true` ⟹ no se pueden borrar. `empresaId: null` ⟹ son globales.
 */

/**
 * Todos los documentos en el orden del catálogo, requeridos salvo los que se
 * indiquen como opcionales.
 */
function renglones(opcionales = [], vigencias = {}) {
  return DOCUMENT_TYPES.map((tipo) => ({
    tipo,
    requerido: !opcionales.includes(tipo),
    vigenciaMeses: vigencias[tipo] ?? null
  }))
}

const BASE_TEMPLATES = Object.freeze([
  {
    clave: 'plantilla-general',
    nombre: 'General — tiempo indeterminado',
    descripcion:
      'Checklist completo de 12 documentos. Aplica a cualquier área con contrato por tiempo indeterminado.',
    tiposContrato: ['indeterminado'],
    areas: null,
    documentos: renglones([], { examen_medico: 12 }),
    esBase: true,
    empresaId: null
  },
  {
    clave: 'plantilla-temporal',
    nombre: 'Contrato temporal',
    descripcion:
      'Tiempo determinado, obra determinada y capacitación inicial. El contrato se vigila por su fecha de término.',
    tiposContrato: ['determinado', 'obra_determinada', 'capacitacion_inicial'],
    areas: null,
    documentos: renglones(['referencias_laborales', 'comprobante_estudios'], {
      examen_medico: 12
    }),
    esBase: true,
    empresaId: null
  },
  {
    clave: 'plantilla-obra',
    nombre: 'Personal de obra',
    descripcion:
      'Áreas de operaciones. Sin comprobante de estudios ni referencias, y el examen médico se renueva cada 6 meses.',
    tiposContrato: [
      'indeterminado',
      'determinado',
      'obra_determinada',
      'capacitacion_inicial'
    ],
    // Las dos áreas de operaciones del catálogo base (D-58). Antes eran `obra`
    // y `mantenimiento`, que ya no existen.
    areas: ['operaciones_urbanizadora', 'operaciones_maquinaria'],
    documentos: renglones(['comprobante_estudios', 'referencias_laborales', 'cv'], {
      examen_medico: 6
    }),
    esBase: true,
    empresaId: null
  },
  {
    clave: 'plantilla-prueba',
    nombre: 'Periodo a prueba',
    descripcion:
      'Documentación mínima mientras dura la prueba. El resto se completa al confirmar la contratación.',
    tiposContrato: ['prueba'],
    areas: null,
    documentos: renglones(
      ['comprobante_estudios', 'referencias_laborales', 'alta_imss', 'examen_medico'],
      { examen_medico: 12 }
    ),
    esBase: true,
    empresaId: null
  }
])

module.exports = { BASE_TEMPLATES, renglones }
