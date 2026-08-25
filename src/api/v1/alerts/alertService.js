const Record = require('../records/recordModel')
const employeeService = require('../employees/employeeService')
const {
  deriveAlerts,
  groupAlertsByEmployee,
  summarizeAlerts
} = require('../../../utils/domain/alerts')

/**
 * `GET /alertas` — la bandeja de pendientes (spec §6.6, D-47).
 *
 * ─── No hay colección de alertas, y es la decisión principal ─────────────────
 * Se derivan en cada consulta a partir de los expedientes y de las fechas de
 * nacimiento (regla #6 del contrato, D-04). Consecuencia directa de lo que se
 * pidió —«que se remuevan o se desactiven cuando se resuelven»—: **no hay nada
 * que remover**. Sube el documento que faltaba y la alerta ya no existe en la
 * lectura siguiente; pasa el cumpleaños y sale sola de la ventana. Sin campo
 * `resuelta` que alguien pueda olvidar de escribir, sin job de limpieza y sin la
 * posibilidad de que la bandeja mienta.
 *
 * ─── El alcance ──────────────────────────────────────────────────────────────
 * No se consulta `records` directamente: se parte de `employeeService.list`, que
 * ya resuelve el alcance por empresa y por área con su agregación (D-45). Así es
 * imposible que una alerta hable de alguien que quien pregunta no puede ver, y no
 * hay una segunda copia de esa lógica que se pueda desincronizar.
 */

/**
 * Tope de personas que se evalúan de una vez. Mismo criterio que
 * `recordService.list`: derivar es en memoria y hay que acotarlo.
 */
const LIMITE_PERSONAS = 2000

const POR_PAGINA_DEFECTO = 25
const POR_PAGINA_MAXIMO = 100

class AlertService {
  /**
   * @param {object} filtros `{ tipo, origen, empresaId, area, empleadoId, agrupar, pagina, porPagina }`
   * @param {object} contexto `{ user, empresasVisibles, areasPorEmpresa }`
   *
   * ─── Agrupado por empleado por defecto ───────────────────────────────────
   * Con 145 personas y una docena de documentos requeridos cada una, la bandeja
   * plana son ~730 renglones y los cinco primeros son de la misma persona. Se
   * agrupa por defecto —un renglón por empleado— y `?agrupar=ninguno` devuelve la
   * lista plana para el detalle de una persona. Ver D-48.
   *
   * ─── Se pagina en memoria, no en Mongo ───────────────────────────────────
   * Como el avance de los expedientes (D-45): las alertas son derivadas, no
   * existen como documentos, así que no hay nada que paginar en la base. Se
   * derivan todas las de la gente visible, se filtran, se agrupan y se corta la
   * página al final.
   */
  async list(filtros = {}, contexto = {}) {
    const pagina = Math.max(1, Number(filtros.pagina) || 1)
    const porPagina = Math.min(
      POR_PAGINA_MAXIMO,
      Math.max(1, Number(filtros.porPagina) || POR_PAGINA_DEFECTO)
    )
    const agrupado = filtros.agrupar !== 'ninguno'

    const entradas = await this.#entradas(filtros, contexto)

    const todas = deriveAlerts(entradas, {
      diasCumpleanos: filtros.diasCumpleanos
    })

    /*
     * El resumen se calcula sobre TODAS las alertas y ANTES de aplicar `tipo` y
     * `origen`: es el contador de las pestañas, y tiene que decir cuántos
     * pendientes hay de cada tipo, no cuántos quedaron después del filtro que la
     * pantalla trae puesto. `empresaId`, `area` y `empleadoId` sí lo afectan,
     * porque acotan a la gente antes de derivar y eso es lo que se espera del
     * selector de área.
     */
    const resumen = summarizeAlerts(todas)

    const filtradas = todas.filter((alerta) => this.#pasaFiltros(alerta, filtros))

    // Siempre se informan las dos magnitudes: la interfaz necesita decir
    // «731 pendientes en 147 personas», y una sola de las dos no alcanza.
    const totalAlertas = filtradas.length
    const totalEmpleados = new Set(filtradas.map((a) => a.empleadoId)).size

    const comunes = { agrupado, pagina, porPagina, totalAlertas, totalEmpleados, resumen }
    const inicio = (pagina - 1) * porPagina

    if (!agrupado) {
      return {
        ...comunes,
        total: totalAlertas,
        alertas: filtradas.slice(inicio, inicio + porPagina)
      }
    }

    const grupos = groupAlertsByEmployee(filtradas)
    return {
      ...comunes,
      // `total` es lo que se pagina: grupos aquí, alertas en el modo plano.
      total: grupos.length,
      grupos: grupos.slice(inicio, inicio + porPagina)
    }
  }

  /** Las personas visibles, con su expediente, listas para derivar. */
  async #entradas(filtros, contexto) {
    const { empleados } = await employeeService.list(
      {
        id: filtros.empleadoId,
        empresaId: filtros.empresaId,
        area: filtros.area,
        // Sólo gente activa: un dado de baja no genera pendientes ni cumpleaños.
        incluirInactivos: false,
        pagina: 1,
        porPagina: LIMITE_PERSONAS,
        limitePorPagina: LIMITE_PERSONAS
      },
      contexto
    )

    if (empleados.length === 0) return []

    /*
     * El expediente se trae aparte y no del renglón: `employeeService.list` sólo
     * proyecta los tres campos que necesita el avance, y para derivar alertas
     * hacen falta también `motivoRechazo` y el tipo de cada documento. Se
     * proyecta explícitamente para NO arrastrar las claves de almacenamiento de
     * los archivos (D-27, D-41).
     */
    const ids = empleados.map((renglon) => renglon.empleado._id)
    /*
     * `.lean()` no es sólo por velocidad: las funciones de dominio esparcen el
     * documento (`{ ...documento }`) y **un subdocumento de Mongoose no se puede
     * esparcir** —copia sus internos, no sus campos—, así que sin esto cada
     * documento llegaría vacío al derivador y la bandeja saldría siempre en cero,
     * sin ningún error. Costó un rato encontrarlo; `resolveDocument` ahora también
     * se defiende.
     */
    const expedientes = await Record.find({ empleadoId: { $in: ids } })
      .select(
        'empleadoId documentos.tipo documentos.requerido documentos.estatus documentos.vigenciaHasta documentos.motivoRechazo'
      )
      .lean()
    const porEmpleado = new Map(expedientes.map((e) => [e.empleadoId.toString(), e]))

    return empleados.map((renglon) => ({
      empleado: renglon.empleado,
      categoriaNombre: renglon.categoriaNombre,
      adscripciones: renglon.adscripciones,
      expediente: porEmpleado.get(renglon.empleado._id) || null
    }))
  }

  #pasaFiltros(alerta, { tipo, origen }) {
    if (tipo && alerta.tipo !== tipo) return false
    if (origen && alerta.origen !== origen) return false
    return true
  }
}

module.exports = new AlertService()
module.exports.LIMITE_PERSONAS = LIMITE_PERSONAS
module.exports.POR_PAGINA_DEFECTO = POR_PAGINA_DEFECTO
module.exports.POR_PAGINA_MAXIMO = POR_PAGINA_MAXIMO
