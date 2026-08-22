/**
 * Generación y re-sincronización del checklist (spec 7.1, 7.2 y 4).
 *
 * Funciones puras sobre objetos planos: el servicio de expedientes las llama y
 * persiste el resultado, pero aquí no se toca la base ni se sabe de HTTP.
 */

/** Clave de la plantilla que sirve de red de seguridad. */
const CLAVE_PLANTILLA_GENERAL = 'plantilla-general'

const mismoId = (a, b) => String(a ?? '') === String(b ?? '')
const aplicaATodasLasAreas = (plantilla) =>
  !plantilla.areas || plantilla.areas.length === 0

/** Renglón de plantilla → documento en blanco del checklist. */
function documentoEnBlanco(renglon) {
  return {
    tipo: renglon.tipo,
    requerido: renglon.requerido,
    estatus: 'pending',
    vigenciaMeses: renglon.vigenciaMeses ?? null,
    vigenciaHasta: null,
    archivo: null,
    motivoRechazo: null,
    revisadoPor: null,
    revisadoEn: null,
    versiones: []
  }
}

/** Checklist en blanco a partir de una plantilla (paso B del flujo). */
function createChecklist(plantilla) {
  return (plantilla?.documentos || []).map(documentoEnBlanco)
}

/**
 * Reaplica una plantilla sobre un checklist existente (spec 7.2).
 *
 * Se dispara al cambiar el área o el tipo de contrato del colaborador, o al
 * editar la plantilla que usa el expediente. **Nunca se borra trabajo hecho:**
 *
 * - Documento que sigue en la plantilla → se conserva con su estatus, archivo y
 *   versiones; sólo se actualizan `requerido` y `vigenciaMeses`.
 * - Documento que ya no está: con versiones → se conserva como `requerido: false`;
 *   sin nada subido → se descarta.
 * - Documento nuevo → se agrega en `pending`.
 *
 * El orden del resultado es el de la plantilla (que es el orden en que el front
 * los pinta), con los conservados al final.
 */
function syncChecklist(documentos = [], plantilla) {
  const porTipo = new Map(documentos.map((doc) => [doc.tipo, doc]))

  const resultado = (plantilla?.documentos || []).map((renglon) => {
    const existente = porTipo.get(renglon.tipo)
    porTipo.delete(renglon.tipo)

    if (!existente) return documentoEnBlanco(renglon)

    return {
      ...existente,
      requerido: renglon.requerido,
      vigenciaMeses: renglon.vigenciaMeses ?? null
    }
  })

  for (const huerfano of porTipo.values()) {
    if ((huerfano.versiones || []).length > 0) {
      resultado.push({ ...huerfano, requerido: false })
    }
  }

  return resultado
}

/**
 * Elige la plantilla que le toca a un colaborador, de más específica a más
 * general (spec 4):
 *
 *   1. Plantilla del cliente que empata área + tipo de contrato
 *   2. Plantilla del cliente que empata tipo de contrato
 *   3. Plantilla global que empata área + tipo de contrato
 *   4. Plantilla global que empata tipo de contrato
 *   5. `plantilla-general` como red de seguridad
 *
 * En fase 1 sólo existen los niveles 3 a 5 (todo es global, `clienteId: null`),
 * que es exactamente lo que el front implementa hoy.
 *
 * @returns {object|null} la plantilla elegida, o null si no hay ninguna
 */
function resolveTemplate(plantillas = [], { area, tipoContrato, clienteId = null } = {}) {
  const compatibles = plantillas.filter((p) =>
    (p.tiposContrato || []).includes(tipoContrato)
  )

  const delCliente = (p) => clienteId != null && mismoId(p.clienteId, clienteId)
  const global = (p) => p.clienteId == null
  const conArea = (p) => Array.isArray(p.areas) && p.areas.includes(area)

  const niveles = [
    (p) => delCliente(p) && conArea(p),
    (p) => delCliente(p) && aplicaATodasLasAreas(p),
    (p) => global(p) && conArea(p),
    (p) => global(p) && aplicaATodasLasAreas(p)
  ]

  for (const cumple of niveles) {
    const encontrada = compatibles.find(cumple)
    if (encontrada) return encontrada
  }

  // Sin plantilla compatible se cae a la general para no dejar el expediente sin
  // checklist. No debería pasar: todo tipo de contrato tiene la suya.
  return (
    plantillas.find((p) => p.clave === CLAVE_PLANTILLA_GENERAL) || plantillas[0] || null
  )
}

module.exports = {
  CLAVE_PLANTILLA_GENERAL,
  createChecklist,
  syncChecklist,
  resolveTemplate,
  documentoEnBlanco
}
