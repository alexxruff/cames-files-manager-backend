/**
 * Los 12 documentos del checklist (spec 5).
 *
 * El ORDEN de `DOCUMENT_TYPES` es el orden en que el front los pinta.
 *
 * - `sensitive`: el jefe de área ve que está entregado, pero no puede abrirlo
 *   ni descargarlo (no se le emite URL firmada → 403).
 * - `expires`: puede llevar `vigenciaHasta` y disparar alertas de vencimiento.
 */
// prettier-ignore -- la tabla se lee mejor con una fila por renglón.
const DOCUMENT_CATALOG = Object.freeze([
  {
    tipo: 'ine',
    label: 'Identificación oficial (INE)',
    category: 'identidad',
    sensitive: true,
    expires: false
  },
  { tipo: 'curp', label: 'CURP', category: 'identidad', sensitive: true, expires: false },
  {
    tipo: 'rfc',
    label: 'Constancia de situación fiscal (RFC)',
    category: 'fiscal_seguridad_social',
    sensitive: true,
    expires: false
  },
  {
    tipo: 'nss',
    label: 'Número de Seguro Social (NSS)',
    category: 'fiscal_seguridad_social',
    sensitive: true,
    expires: false
  },
  {
    tipo: 'comprobante_domicilio',
    label: 'Comprobante de domicilio',
    category: 'personales',
    sensitive: true,
    expires: false
  },
  {
    tipo: 'acta_nacimiento',
    label: 'Acta de nacimiento',
    category: 'identidad',
    sensitive: true,
    expires: false
  },
  {
    tipo: 'comprobante_estudios',
    label: 'Comprobante de estudios (título/cédula)',
    category: 'formacion',
    sensitive: false,
    expires: false
  },
  {
    tipo: 'cv',
    label: 'Currículum vitae (CV)',
    category: 'formacion',
    sensitive: false,
    expires: false
  },
  {
    tipo: 'referencias_laborales',
    label: 'Referencias laborales',
    category: 'formacion',
    sensitive: false,
    expires: false
  },
  {
    tipo: 'alta_imss',
    label: 'Alta ante el IMSS',
    category: 'fiscal_seguridad_social',
    sensitive: false,
    expires: false
  },
  {
    tipo: 'contrato',
    label: 'Contrato de trabajo firmado',
    category: 'contratacion',
    sensitive: true,
    expires: true
  },
  {
    tipo: 'examen_medico',
    label: 'Examen médico de ingreso',
    category: 'contratacion',
    sensitive: true,
    expires: true
  }
])

const DOCUMENT_TYPES = Object.freeze(DOCUMENT_CATALOG.map((d) => d.tipo))

const DOCUMENT_CATEGORIES = Object.freeze([
  'identidad',
  'fiscal_seguridad_social',
  'personales',
  'formacion',
  'contratacion'
])

const DOCUMENT_LABELS = Object.freeze(
  Object.fromEntries(DOCUMENT_CATALOG.map((d) => [d.tipo, d.label]))
)

/**
 * Lista global de documentos sensibles. En fase 2 un cliente puede pisarla con
 * `configuracion.documentosSensibles` (spec 4).
 */
const SENSITIVE_DOCUMENT_TYPES = Object.freeze(
  DOCUMENT_CATALOG.filter((d) => d.sensitive).map((d) => d.tipo)
)

const EXPIRING_DOCUMENT_TYPES = Object.freeze(
  DOCUMENT_CATALOG.filter((d) => d.expires).map((d) => d.tipo)
)

function documentLabel(tipo) {
  return DOCUMENT_LABELS[tipo] || tipo
}

function isSensitiveDocument(tipo, sensitiveList = SENSITIVE_DOCUMENT_TYPES) {
  return sensitiveList.includes(tipo)
}

module.exports = {
  DOCUMENT_CATALOG,
  DOCUMENT_TYPES,
  DOCUMENT_CATEGORIES,
  DOCUMENT_LABELS,
  SENSITIVE_DOCUMENT_TYPES,
  EXPIRING_DOCUMENT_TYPES,
  documentLabel,
  isSensitiveDocument
}
