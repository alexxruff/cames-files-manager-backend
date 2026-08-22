const env = require('../../config/env')
const { ALERT_SEVERITY, documentLabel } = require('../../constants')
const { today } = require('../dates')
const { compareNames } = require('../text')
const { resolveDocument, daysUntilExpiry } = require('./documentStatus')

/**
 * Alertas derivadas del estado de los expedientes (spec 7.6).
 *
 * NUNCA se almacenan: se recalculan en cada consulta, así que no pueden quedar
 * desincronizadas. Los expedientes de colaboradores dados de baja no generan
 * ninguna.
 *
 * @param {Array<{_id: any, colaborador: object, documentos: object[]}>} expedientes
 * @param {object} [opciones]
 * @param {string} [opciones.hoy] `'YYYY-MM-DD'`
 * @param {number} [opciones.diasAlerta]
 * @returns {object[]} alertas ordenadas: severidad, luego días, luego nombre
 */
function deriveAlerts(expedientes = [], opciones = {}) {
  const hoy = opciones.hoy || today()
  const diasAlerta = opciones.diasAlerta ?? env.DIAS_ALERTA_VENCIMIENTO
  const contexto = { hoy, diasAlerta }

  const alertas = []

  for (const expediente of expedientes) {
    // Un colaborador dado de baja ya no genera pendientes.
    if (!expediente?.colaborador?.activo) continue

    const expedienteId = String(expediente._id)

    for (const original of expediente.documentos || []) {
      const documento = resolveDocument(original, contexto)
      const tipo = tipoDeAlerta(documento)
      if (!tipo) continue

      const diasRestantes = daysUntilExpiry(documento, { hoy })

      alertas.push({
        // Estable entre recálculos: el front lo usa como `key` de React y si
        // cambia entre consultas, la lista parpadea.
        id: `${expedienteId}:${documento.tipo}:${tipo}`,
        tipo,
        expedienteId,
        colaboradorNombre: expediente.colaborador.nombre,
        colaboradorPuesto: expediente.colaborador.puesto,
        area: expediente.colaborador.area,
        tipoDocumento: documento.tipo,
        diasRestantes,
        vigenciaHasta: documento.vigenciaHasta ?? null,
        motivoRechazo: documento.motivoRechazo ?? null,
        mensaje: mensajeAlerta(tipo, documento.tipo, diasRestantes)
      })
    }
  }

  return alertas.sort(ordenarAlertas)
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
 * Se corrige el singular respecto al front (`hace 1 días` → `hace 1 día`): ahora
 * el mensaje lo genera el servidor y lo lee una persona. Ver D-25.
 */
function mensajeAlerta(tipo, tipoDocumento, diasRestantes) {
  const nombre = documentLabel(tipoDocumento)
  const dias = (n) => `${n} ${n === 1 ? 'día' : 'días'}`

  switch (tipo) {
    case 'vencido':
      return `${nombre} venció hace ${dias(Math.abs(diasRestantes ?? 0))}.`
    case 'por_vencer':
      return diasRestantes === 0
        ? `${nombre} vence hoy.`
        : `${nombre} vence en ${dias(diasRestantes)}.`
    case 'documento_rechazado':
      return `${nombre} fue rechazado y hay que volver a subirlo.`
    case 'documento_faltante':
      return `Falta subir ${nombre}.`
    default:
      return ''
  }
}

/** Primero lo más grave; dentro del mismo tipo, lo que vence antes. */
function ordenarAlertas(a, b) {
  const severidad = ALERT_SEVERITY[a.tipo] - ALERT_SEVERITY[b.tipo]
  if (severidad !== 0) return severidad

  const diasA = a.diasRestantes ?? Number.POSITIVE_INFINITY
  const diasB = b.diasRestantes ?? Number.POSITIVE_INFINITY
  if (diasA !== diasB) return diasA - diasB

  return compareNames(a.colaboradorNombre, b.colaboradorNombre)
}

module.exports = { deriveAlerts, mensajeAlerta, ordenarAlertas }
