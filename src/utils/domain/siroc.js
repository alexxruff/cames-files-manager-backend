const env = require('../../config/env')
const { addMonths, daysBetween, isAfter, isBefore, today } = require('../dates')

/**
 * Seguimiento del SIROC de un contrato (D-76).
 *
 * El aviso de obra ante el IMSS **no se registra una vez y ya**: se actualiza
 * cada dos meses conservando el mismo número. Lo que cambia es la vigencia del
 * aviso, no su identidad, y por eso `siroc.numero` sigue siendo uno solo y las
 * renovaciones son una lista de fechas dentro del mismo SIROC.
 *
 * Funciones PURAS, sin Mongoose y sin HTTP: todo lo de aquí **se deriva al
 * leer** (regla #6 del contrato). Lo único que se guarda es el hecho —qué día se
 * actualizó—; cuántas faltan, cuándo vence la actual y si urge se calculan cada
 * vez, así que se resuelven solas al pasar el tiempo o al capturar la renovación.
 *
 * Los dos cálculos que es fácil equivocar y que las pruebas fijan:
 *
 * - **Cuántas actualizaciones pide un contrato**: son las ventanas de dos meses
 *   que hacen falta para cubrirlo, MENOS la primera, que ya la cubre el SIROC
 *   original. Un contrato de dos meses justos pide cero.
 * - **Desde cuándo corre la ventana vigente**: desde la última actualización
 *   registrada, o desde `fechaRegistro` si no hay ninguna. No desde el inicio del
 *   contrato: un SIROC que se registró tarde vence tarde.
 *
 * El aviso **no tiene fecha final capturada**: su vigencia es siempre el registro
 * (o la última actualización) más dos meses, y por eso `vigenciaPeriodoHasta` se
 * calcula aquí. Guardarla además como campo era pedirle al usuario un dato que ya
 * se sabe, y cuando la tecleaba distinta de la del contrato el aviso quedaba
 * contradiciendo lo que la pantalla mostraba.
 */

/** Cada cuántos meses hay que actualizar el aviso. Lo fija el IMSS, no nosotros. */
const PERIODO_SIROC_MESES = 2

/** Estados del seguimiento, del más tranquilo al más urgente. */
const ESTADOS_SIROC = Object.freeze([
  'sin_siroc',
  'no_requiere',
  'al_dia',
  'por_vencer',
  'vencida'
])

/**
 * Ventanas de `PERIODO_SIROC_MESES` que hacen falta para cubrir el contrato.
 * La primera la cubre el SIROC original; el resto son actualizaciones.
 *
 * @returns {number} 0 si las fechas no sirven o el contrato cabe en una ventana
 */
function requiredSirocRenewals(fechaInicio, fechaFin) {
  if (!fechaInicio || !fechaFin || isBefore(fechaFin, fechaInicio)) return 0

  let ventanas = 1
  // Tope de seguridad: 100 ventanas son ~16 años, más que cualquier obra real.
  while (isBefore(addMonths(fechaInicio, ventanas * PERIODO_SIROC_MESES), fechaFin)) {
    ventanas += 1
    if (ventanas > 100) break
  }
  return ventanas - 1
}

/**
 * El bloque `seguimientoSiroc` que acompaña a cada contrato en la respuesta.
 *
 * @param {object} contrato ya serializado (`fechaInicio`, `fechaFin`, `estado`,
 *   `activo`, `siroc`)
 * @param {object} [opciones]
 * @param {string} [opciones.hoy] fecha de calendario con la que se compara
 * @param {number} [opciones.diasAlerta] umbral de `por_vencer`, inclusivo
 */
function deriveSirocTracking(contrato, opciones = {}) {
  const hoy = opciones.hoy ?? today()
  const diasAlerta = opciones.diasAlerta ?? env.DIAS_ALERTA_SIROC

  const requeridas = requiredSirocRenewals(contrato?.fechaInicio, contrato?.fechaFin)
  const actualizaciones = fechasDeActualizacion(contrato?.siroc)
  const registradas = actualizaciones.length

  const base = {
    periodoMeses: PERIODO_SIROC_MESES,
    actualizacionesRequeridas: requeridas,
    actualizacionesRegistradas: registradas,
    actualizacionesPendientes: Math.max(requeridas - registradas, 0),
    ultimaActualizacion: actualizaciones[registradas - 1] ?? null,
    vigenciaPeriodoHasta: null,
    diasParaActualizacion: null,
    requiereActualizacion: false,
    estado: 'sin_siroc',
    mensaje: 'Este contrato todavía no tiene SIROC registrado.'
  }

  if (!contrato?.siroc?.fechaRegistro) return base

  /*
   * Un contrato finalizado o dado de baja no renueva nada: el aviso de obra
   * acompaña a la obra. Se dice explícito para que el front no tenga que
   * deducirlo del estado del contrato.
   */
  const vigenciaPeriodoHasta = addMonths(
    actualizaciones[registradas - 1] ?? contrato.siroc.fechaRegistro,
    PERIODO_SIROC_MESES
  )

  if (contrato.estado === 'finalizado' || contrato.activo === false) {
    return {
      ...base,
      vigenciaPeriodoHasta,
      estado: 'no_requiere',
      mensaje: 'El contrato ya no está en curso: su SIROC no necesita actualizarse.'
    }
  }

  const dias = daysBetween(hoy, vigenciaPeriodoHasta)

  /*
   * La ventana vigente ya cubre el final del contrato: no hay una renovación más
   * que pedir aunque el aviso siga venciendo más adelante.
   *
   * Pero el atajo vale **sólo mientras el contrato siga dentro de sus fechas**.
   * Uno que ya pasó su `fechaFin` sin que nadie lo finalizara sigue en curso —para
   * el IMSS la obra sigue abierta— y su aviso vence igual: mirar `fechaFin` sin
   * mirar el calendario callaba el aviso justo cuando más falta hace, que es lo
   * que hacía el contrato vencido y no finalizado no pedir nada.
   */
  if (
    contrato.fechaFin &&
    !isAfter(contrato.fechaFin, vigenciaPeriodoHasta) &&
    !isBefore(contrato.fechaFin, hoy)
  ) {
    return {
      ...base,
      vigenciaPeriodoHasta,
      diasParaActualizacion: dias,
      estado: 'no_requiere',
      mensaje: 'El SIROC vigente cubre lo que queda del contrato.'
    }
  }

  const estado = dias < 0 ? 'vencida' : dias <= diasAlerta ? 'por_vencer' : 'al_dia'

  return {
    ...base,
    vigenciaPeriodoHasta,
    diasParaActualizacion: dias,
    /*
     * Un contrato que se pasó de sus fechas pide una actualización que su
     * predicción no contemplaba: si el aviso venció, hay al menos una pendiente,
     * porque decir «vencida» y «0 pendientes» a la vez no es dos veces el mismo
     * dato, es una contradicción.
     */
    actualizacionesPendientes:
      estado === 'vencida'
        ? Math.max(base.actualizacionesPendientes, 1)
        : base.actualizacionesPendientes,
    // `por_vencer` avisa, pero todavía no se debe nada: sólo `vencida` lo exige.
    requiereActualizacion: estado === 'vencida',
    estado,
    mensaje: mensajeDeSiroc(estado, dias, vigenciaPeriodoHasta)
  }
}

/** Texto en español, listo para pintar tal cual (misma regla que D-25). */
function mensajeDeSiroc(estado, dias, vigenciaPeriodoHasta) {
  switch (estado) {
    case 'vencida':
      return `El SIROC requiere actualización desde el ${vigenciaPeriodoHasta}: venció hace ${enDias(Math.abs(dias))}.`
    case 'por_vencer':
      return dias === 0
        ? 'El SIROC cumple hoy sus dos meses y requiere actualización.'
        : `El SIROC cumple sus dos meses el ${vigenciaPeriodoHasta}: requiere actualización en ${enDias(dias)}.`
    default:
      return `El SIROC está al día. La próxima actualización toca el ${vigenciaPeriodoHasta}.`
  }
}

/** Las fechas de las actualizaciones, ordenadas y sin huecos. */
function fechasDeActualizacion(siroc) {
  return (siroc?.actualizaciones ?? [])
    .map((a) => a?.fecha)
    .filter(Boolean)
    .sort()
}

const enDias = (n) => `${n} ${n === 1 ? 'día' : 'días'}`

/**
 * De los contratos de UN proyecto, cuál es el SIROC que le toca a su gente.
 *
 * Un proyecto tiene varios contratos —sus fases—, y cada uno puede traer su
 * propio aviso de obra. Quien está asignado al proyecto está bajo el que cubre
 * **el día en que se pregunta**:
 *
 * 1. El contrato cuya ventana `fechaInicio`–`fechaFin` contiene `hoy`. Si hay
 *    varios —fases que se traslapan—, el que empezó después.
 * 2. Si ninguno la contiene, **el último que estuvo activo**: el de `fechaFin`
 *    más grande de entre las ya pasadas, aunque esté `finalizado`. La obra
 *    terminó, pero el aviso bajo el que trabajó esa persona sigue siendo un dato
 *    de su expediente.
 *
 * Nunca uno con `activo: false` —capturado por error o cancelado, D-70— ni uno
 * cuya ventana esté entera por delante: ése ni cubre hoy ni cubrió nunca a
 * nadie. Un proyecto donde sólo hay contratos futuros no aporta SIROC todavía.
 *
 * @param {object[]} contratos ya serializados, del MISMO proyecto
 * @param {string} [hoy] fecha de calendario con la que se compara
 * @returns {{contrato: object, vigente: boolean}|null}
 */
function pickCurrentSirocContract(contratos, hoy = today()) {
  const conSiroc = (contratos ?? []).filter(
    (c) => c && c.activo !== false && c.siroc?.numero && c.fechaInicio && c.fechaFin
  )
  if (conSiroc.length === 0) return null

  // `!isAfter(inicio, hoy)` y no `isBefore`: el día que arranca la fase ya cuenta.
  const vigentes = conSiroc.filter(
    (c) => !isAfter(c.fechaInicio, hoy) && !isBefore(c.fechaFin, hoy)
  )
  if (vigentes.length > 0) {
    return { contrato: masReciente(vigentes, 'fechaInicio'), vigente: true }
  }

  const pasados = conSiroc.filter((c) => isBefore(c.fechaFin, hoy))
  if (pasados.length === 0) return null

  return { contrato: masReciente(pasados, 'fechaFin'), vigente: false }
}

/** El de la fecha más grande; a igualdad, el que empezó después. */
function masReciente(contratos, campo) {
  return contratos.reduce((mejor, actual) => {
    if (isAfter(actual[campo], mejor[campo])) return actual
    if (
      actual[campo] === mejor[campo] &&
      isAfter(actual.fechaInicio, mejor.fechaInicio)
    ) {
      return actual
    }
    return mejor
  })
}

module.exports = {
  PERIODO_SIROC_MESES,
  ESTADOS_SIROC,
  requiredSirocRenewals,
  deriveSirocTracking,
  mensajeDeSiroc,
  pickCurrentSirocContract
}
