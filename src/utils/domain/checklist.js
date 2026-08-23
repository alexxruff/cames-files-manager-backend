const { idAString } = require('../ids')

/**
 * Generación y re-sincronización del checklist (modelo-datos §6.2).
 *
 * Funciones puras sobre objetos planos: el servicio de expedientes las llama y
 * persiste el resultado, pero aquí no se toca la base ni se sabe de HTTP.
 *
 * ─── La idea que hay que entender ────────────────────────────────────────────
 * El expediente es **de la persona**, no de su empleo. Si alguien es
 * administrativo en una empresa del grupo y personal de obra en otra, su
 * expediente pide **lo que exijan las dos plantillas**, tomando siempre la
 * condición más estricta: requerido gana a opcional, y la vigencia más corta gana.
 */

/** Clave de la plantilla que sirve de red de seguridad. */
const CLAVE_PLANTILLA_GENERAL = 'plantilla-general'

const mismoId = (a, b) => idAString(a) === idAString(b)
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

/**
 * Elige la plantilla que le toca a una adscripción, de más específica a más
 * general (modelo-datos §6.2):
 *
 *   1. Plantilla de la empresa que empata **alguna de sus áreas + contrato**
 *   2. Plantilla de la empresa que empata **contrato**
 *   3. Plantilla global que empata **área + contrato**
 *   4. Plantilla global que empata **contrato**
 *   5. `plantilla-general` como red de seguridad
 *
 * @param {object[]} plantillas todas las candidatas (se filtran las inactivas)
 * @param {object} adscripcion `{ empresaId, areas, tipoContrato }`
 */
function resolveTemplate(
  plantillas = [],
  { empresaId = null, areas = [], tipoContrato } = {}
) {
  const activas = plantillas.filter((p) => p.activo !== false)
  const compatibles = activas.filter((p) =>
    (p.tiposContrato || []).includes(tipoContrato)
  )

  const deLaEmpresa = (p) => empresaId != null && mismoId(p.empresaId, empresaId)
  const global = (p) => p.empresaId == null
  const conAlgunaArea = (p) =>
    Array.isArray(p.areas) &&
    p.areas.length > 0 &&
    (areas || []).some((area) => p.areas.includes(area))

  const niveles = [
    (p) => deLaEmpresa(p) && conAlgunaArea(p),
    (p) => deLaEmpresa(p) && aplicaATodasLasAreas(p),
    (p) => global(p) && conAlgunaArea(p),
    (p) => global(p) && aplicaATodasLasAreas(p)
  ]

  for (const cumple of niveles) {
    const encontrada = compatibles.find(cumple)
    if (encontrada) return encontrada
  }

  // Sin plantilla compatible se cae a la general, para no dejar el expediente
  // sin checklist. No debería pasar: todo tipo de contrato tiene la suya.
  return activas.find((p) => p.clave === CLAVE_PLANTILLA_GENERAL) || activas[0] || null
}

/**
 * Une los renglones de varias plantillas en un solo checklist.
 *
 * Por cada tipo de documento:
 * - `requerido` = **OR** de los requeridos (requerido gana a opcional)
 * - `vigenciaMeses` = **MIN** de las vigencias definidas (la más estricta gana)
 *
 * El orden del resultado es el de la primera plantilla que introdujo cada tipo,
 * que es el orden del catálogo con el que el front los pinta.
 */
function unirRenglones(listasDeRenglones = []) {
  const porTipo = new Map()

  for (const renglones of listasDeRenglones) {
    for (const renglon of renglones || []) {
      const previo = porTipo.get(renglon.tipo)
      if (!previo) {
        porTipo.set(renglon.tipo, {
          tipo: renglon.tipo,
          requerido: Boolean(renglon.requerido),
          vigenciaMeses: renglon.vigenciaMeses ?? null
        })
        continue
      }

      porTipo.set(renglon.tipo, {
        tipo: renglon.tipo,
        requerido: previo.requerido || Boolean(renglon.requerido),
        vigenciaMeses: menorVigencia(previo.vigenciaMeses, renglon.vigenciaMeses)
      })
    }
  }

  return [...porTipo.values()]
}

/** La vigencia más corta gana; `null` significa «no caduca» y no compite. */
function menorVigencia(a, b) {
  if (a == null) return b ?? null
  if (b == null) return a
  return Math.min(a, b)
}

/**
 * El checklist que le corresponde a un empleado, a partir de sus adscripciones
 * **activas** y del catálogo de plantillas.
 *
 * @returns {{documentos: object[], plantillas: string[]}} los documentos en
 *   blanco y los ids de las plantillas de las que salieron.
 */
function construirChecklist(adscripciones = [], plantillas = []) {
  const usadas = []
  const listas = []

  for (const adscripcion of adscripciones) {
    if (adscripcion.activo === false) continue

    const plantilla = resolveTemplate(plantillas, {
      empresaId: adscripcion.empresaId,
      areas: adscripcion.areas || [],
      tipoContrato: adscripcion.tipoContrato
    })
    if (!plantilla) continue

    const id = idAString(plantilla._id)
    if (id && !usadas.includes(id)) usadas.push(id)
    listas.push(plantilla.documentos || [])
  }

  return {
    documentos: unirRenglones(listas).map(documentoEnBlanco),
    plantillas: usadas
  }
}

/**
 * Reaplica el checklist que toca sobre uno existente. **Nunca se pierde trabajo
 * hecho** (modelo-datos §6.2):
 *
 * - Documento que sigue pidiéndose → se conserva con su estatus, archivo y
 *   versiones; sólo se actualizan `requerido` y `vigenciaMeses`.
 * - Documento que ya no se pide: con versiones → se conserva como
 *   `requerido: false`; sin nada subido → se descarta.
 * - Documento nuevo → se agrega en `pending`.
 *
 * Se dispara al cambiar áreas o contrato de una adscripción, al agregar o dar de
 * baja una adscripción, y al editar una plantilla.
 */
function syncChecklist(documentos = [], renglones = []) {
  const porTipo = new Map(documentos.map((doc) => [doc.tipo, doc]))

  const resultado = renglones.map((renglon) => {
    const existente = porTipo.get(renglon.tipo)
    porTipo.delete(renglon.tipo)

    if (!existente) return documentoEnBlanco(renglon)

    return {
      ...existente,
      requerido: Boolean(renglon.requerido),
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

/** Checklist en blanco a partir de UNA plantilla. Útil para pruebas y semillas. */
function createChecklist(plantilla) {
  return (plantilla?.documentos || []).map(documentoEnBlanco)
}

module.exports = {
  CLAVE_PLANTILLA_GENERAL,
  resolveTemplate,
  unirRenglones,
  construirChecklist,
  syncChecklist,
  createChecklist,
  documentoEnBlanco
}
