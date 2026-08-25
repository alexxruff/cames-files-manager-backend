const env = require('../../config/env')
const { ALERT_SEVERITY, ALERT_ORIGIN_BY_TYPE, documentLabel } = require('../../constants')
const {
  today,
  nextAnniversary,
  daysUntilAnniversary,
  ageOnNextAnniversary
} = require('../dates')
const { compareNames } = require('../text')
const { resolveDocument, daysUntilExpiry } = require('./documentStatus')

/**
 * Alertas derivadas — funciones PURAS, sin Mongoose y sin HTTP
 * (spec §6.6, modelo-datos §6.4).
 *
 * ─── NUNCA SE ALMACENAN, y eso es la característica principal ────────────────
 * Se recalculan en cada consulta, así que **no pueden quedar desincronizadas** y
 * **se resuelven solas**: el día que alguien sube el documento que faltaba, la
 * alerta desaparece en la siguiente lectura; cuando pasa el cumpleaños, también.
 * No hay estado que apagar, ni un `resuelta: true` que se pueda olvidar de
 * escribir, ni un job que limpie. Es la regla #6 del contrato y D-04.
 *
 * Dos familias, con el mismo sobre y discriminadas por `origen`:
 *
 * | `origen`     | De dónde sale                              |
 * | ------------ | ------------------------------------------ |
 * | `documento`  | El estatus efectivo de cada documento      |
 * | `cumpleanos` | La fecha de nacimiento de la persona       |
 *
 * **Sólo de gente activa.** Quien está dado de baja no genera ninguna alerta —ni
 * de documento ni de cumpleaños—: ya no hay nada que hacer con su expediente y
 * felicitarlo sería incómodo.
 */

/**
 * El renglón de entrada: una persona visible con su expediente.
 *
 * @typedef {object} EntradaAlerta
 * @property {object} empleado `{ _id, nombre, activo, fechaNacimiento }`
 * @property {string|null} categoriaNombre
 * @property {Array<{empresaId: string, empresaNombre: string|null, areas: string[], activo: boolean}>} adscripciones
 * @property {object|null} expediente `{ _id, documentos[] }`
 */

/**
 * Todas las alertas de un conjunto de personas, ya ordenadas.
 *
 * @param {EntradaAlerta[]} entradas
 * @param {object} [opciones]
 * @param {string} [opciones.hoy] `'YYYY-MM-DD'`
 * @param {number} [opciones.diasAlerta] umbral de "por vencer"
 * @param {number} [opciones.diasCumpleanos] con cuánta anticipación se avisa
 * @returns {object[]} severidad, luego días restantes, luego nombre
 */
function deriveAlerts(entradas = [], opciones = {}) {
  const contexto = normalizarOpciones(opciones)

  const alertas = []
  for (const entrada of entradas) {
    if (!esActiva(entrada)) continue
    alertas.push(...alertasDeDocumentos(entrada, contexto))
    alertas.push(...alertasDeCumpleanos(entrada, contexto))
  }

  return alertas.sort(ordenarAlertas)
}

/** Sólo la familia de documentos. Mismo orden. */
function deriveDocumentAlerts(entradas = [], opciones = {}) {
  const contexto = normalizarOpciones(opciones)
  return entradas
    .filter(esActiva)
    .flatMap((entrada) => alertasDeDocumentos(entrada, contexto))
    .sort(ordenarAlertas)
}

/** Sólo la familia de cumpleaños. Mismo orden. */
function deriveBirthdayAlerts(entradas = [], opciones = {}) {
  const contexto = normalizarOpciones(opciones)
  return entradas
    .filter(esActiva)
    .flatMap((entrada) => alertasDeCumpleanos(entrada, contexto))
    .sort(ordenarAlertas)
}

function normalizarOpciones(opciones) {
  return {
    hoy: opciones.hoy || today(),
    diasAlerta: opciones.diasAlerta ?? env.DIAS_ALERTA_VENCIMIENTO,
    diasCumpleanos: opciones.diasCumpleanos ?? env.DIAS_ALERTA_CUMPLEANOS
  }
}

/** Ni los dados de baja del sistema, ni los que no tienen adscripción activa. */
function esActiva(entrada) {
  if (!entrada?.empleado?.activo) return false
  return (entrada.adscripciones || []).some((a) => a.activo !== false)
}

// ─── Familia: documentos ──────────────────────────────────────────────────────

function alertasDeDocumentos(entrada, contexto) {
  const expediente = entrada.expediente
  if (!expediente) return []

  const expedienteId = String(expediente._id)
  const alertas = []

  for (const original of expediente.documentos || []) {
    const documento = resolveDocument(original, contexto)
    const tipo = tipoDeAlerta(documento)
    if (!tipo) continue

    const diasRestantes = daysUntilExpiry(documento, { hoy: contexto.hoy })

    alertas.push({
      ...sobre(entrada, tipo, `${expedienteId}:${documento.tipo}`),
      diasRestantes,
      expedienteId,
      tipoDocumento: documento.tipo,
      vigenciaHasta: documento.vigenciaHasta ?? null,
      motivoRechazo: documento.motivoRechazo ?? null,
      mensaje: mensajeDeDocumento(tipo, documento.tipo, diasRestantes)
    })
  }

  return alertas
}

function tipoDeAlerta(documento) {
  switch (documento.estatus) {
    case 'expired':
      return 'vencido'
    case 'expiring':
      return 'por_vencer'
    case 'rejected':
      return 'documento_rechazado'
    case 'pending':
      // Un opcional sin subir no le falta a nadie.
      return documento.requerido ? 'documento_faltante' : null
    default:
      return null
  }
}

/**
 * Texto listo para pintar, en español.
 *
 * Se corrige el singular respecto al front (`hace 1 días` → `hace 1 día`): el
 * mensaje lo genera el servidor y lo lee una persona. Ver D-25.
 */
function mensajeDeDocumento(tipo, tipoDocumento, diasRestantes) {
  const nombre = documentLabel(tipoDocumento)

  switch (tipo) {
    case 'vencido':
      return `${nombre} venció hace ${enDias(Math.abs(diasRestantes ?? 0))}.`
    case 'por_vencer':
      return diasRestantes === 0
        ? `${nombre} vence hoy.`
        : `${nombre} vence en ${enDias(diasRestantes)}.`
    case 'documento_rechazado':
      return `${nombre} fue rechazado y hay que volver a subirlo.`
    case 'documento_faltante':
      return `Falta subir ${nombre}.`
    default:
      return ''
  }
}

// ─── Familia: cumpleaños ──────────────────────────────────────────────────────

/**
 * Una alerta por persona cuyo cumpleaños cae de hoy en `diasCumpleanos` días.
 *
 * **Esta alerta no se resuelve con una acción, se resuelve con el calendario**:
 * al día siguiente del cumpleaños, `daysUntilAnniversary` devuelve ~364 y la
 * alerta sale sola de la ventana. Es la misma mecánica de las de documento —
 * derivar en cada lectura— aplicada a algo que nadie tiene que "cerrar".
 *
 * Sin fecha de nacimiento no hay alerta: 10 de las 145 personas del archivo de
 * nómina no la traen, y adivinarla no es una opción.
 */
function alertasDeCumpleanos(entrada, contexto) {
  const fechaNacimiento = entrada.empleado?.fechaNacimiento
  if (!fechaNacimiento) return []

  const diasRestantes = daysUntilAnniversary(fechaNacimiento, contexto.hoy)
  if (diasRestantes === null || diasRestantes > contexto.diasCumpleanos) return []

  // El día concreto en que se celebra este año (o el siguiente, si ya pasó).
  const fecha = nextAnniversary(fechaNacimiento, contexto.hoy)
  const edad = ageOnNextAnniversary(fechaNacimiento, contexto.hoy)

  return [
    {
      /*
       * El id lleva el AÑO del cumpleaños, no la fecha de nacimiento: así es
       * estable durante toda la ventana de avisos de este año —el front lo usa
       * como `key` y si cambia, la lista parpadea— y a la vez es distinto el año
       * que viene, que es otro cumpleaños.
       */
      ...sobre(entrada, 'cumpleanos', fecha.slice(0, 4)),
      diasRestantes,
      fecha,
      fechaNacimiento,
      edad,
      mensaje: mensajeDeCumpleanos(entrada.empleado.nombre, diasRestantes, edad)
    }
  ]
}

function mensajeDeCumpleanos(nombre, diasRestantes, edad) {
  const anios = edad === null ? '' : ` (cumple ${edad})`
  if (diasRestantes === 0) return `Hoy es el cumpleaños de ${nombre}${anios}.`
  if (diasRestantes === 1) return `Mañana es el cumpleaños de ${nombre}${anios}.`
  return `${nombre} cumple años en ${enDias(diasRestantes)}${anios}.`
}

// ─── Comunes ──────────────────────────────────────────────────────────────────

/**
 * La parte del sobre que comparten las dos familias.
 *
 * **`empresas[]` en plural, y no `empresaId`** como pedía el spec: el expediente
 * es de la PERSONA y se comparte entre las empresas del grupo (D-41), así que
 * quien está adscrito a dos no tiene un `empresaId` — poner uno de los dos sería
 * inventar de cuál es la alerta. Para acotar por empresa está `?empresaId=`, que
 * filtra a la gente antes de derivar. Ver D-47.
 */
function sobre(entrada, tipo, detalle) {
  const activas = (entrada.adscripciones || []).filter((a) => a.activo !== false)

  return {
    // Estable entre recálculos: `origen:entidad:detalle:tipo`.
    id: `${ALERT_ORIGIN_BY_TYPE[tipo]}:${entrada.empleado._id}:${detalle}:${tipo}`,
    origen: ALERT_ORIGIN_BY_TYPE[tipo],
    tipo,
    empleadoId: String(entrada.empleado._id),
    empleadoNombre: entrada.empleado.nombre,
    categoriaNombre: entrada.categoriaNombre ?? null,
    empresas: activas.map((a) => ({
      _id: String(a.empresaId),
      nombre: a.empresaNombre ?? null
    })),
    areas: [...new Set(activas.flatMap((a) => a.areas || []))]
  }
}

const enDias = (n) => `${n} ${n === 1 ? 'día' : 'días'}`

/** Primero lo más grave; dentro del mismo tipo, lo que ocurre antes. */
function ordenarAlertas(a, b) {
  const severidad = ALERT_SEVERITY[a.tipo] - ALERT_SEVERITY[b.tipo]
  if (severidad !== 0) return severidad

  const diasA = a.diasRestantes ?? Number.POSITIVE_INFINITY
  const diasB = b.diasRestantes ?? Number.POSITIVE_INFINITY
  if (diasA !== diasB) return diasA - diasB

  return compareNames(a.empleadoNombre, b.empleadoNombre)
}

/** Conteo por tipo, para el contador de la bandeja y el tablero. */
function summarizeAlerts(alertas = []) {
  const resumen = { total: alertas.length }
  for (const tipo of Object.keys(ALERT_SEVERITY)) resumen[tipo] = 0
  for (const alerta of alertas) resumen[alerta.tipo] += 1
  return resumen
}

module.exports = {
  deriveAlerts,
  deriveDocumentAlerts,
  deriveBirthdayAlerts,
  summarizeAlerts,
  mensajeDeDocumento,
  mensajeDeCumpleanos,
  ordenarAlertas
}
