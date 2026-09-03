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
 * - **Hasta dónde se pide**: hasta `fechaFin`, y ni un día más (D-84). Pasada esa
 *   fecha el contrato ya no acumula refrendos nuevos, pero **los que debía antes
 *   de terminar los sigue debiendo**: el techo corta la cuenta, no la borra. Y
 *   cuando ya no debe nada, lo que le falta no es un trámite ante el IMSS, es
 *   que alguien lo cierre o corrija sus fechas — eso lo dice
 *   `deriveContractTracking`, aparte, porque no es del SIROC.
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

/** Estados del contrato como cabo suelto, del más tranquilo al que pide acción. */
const ESTADOS_CONTRATO = Object.freeze([
  'por_iniciar',
  'en_curso',
  'terminado_sin_cerrar',
  'finalizado',
  'baja'
])

/**
 * Ventanas de `PERIODO_SIROC_MESES` que hacen falta para llegar de `desde` a
 * `hasta`. La cuenta base de todo lo demás, y la única que recorre el calendario.
 *
 * @returns {number} 0 si las fechas no sirven o `hasta` no queda por delante
 */
function ventanasHasta(desde, hasta) {
  if (!desde || !hasta || !isAfter(hasta, desde)) return 0

  let ventanas = 1
  // Tope de seguridad: 100 ventanas son ~16 años, más que cualquier obra real.
  while (isBefore(addMonths(desde, ventanas * PERIODO_SIROC_MESES), hasta)) {
    ventanas += 1
    if (ventanas > 100) break
  }
  return ventanas
}

/**
 * Cuántas actualizaciones **predicen las fechas del contrato**: las ventanas que
 * hacen falta para cubrirlo, MENOS la primera, que ya la cubre el SIROC original.
 *
 * Es una predicción, no una deuda: sale del plan de la obra y se responde desde
 * el alta, antes de que exista el SIROC. Puede quedar por debajo de las que de
 * verdad se registraron —al recortar la fecha de fin— y eso **no es un error**
 * (D-84): los refrendos se presentaron ante el IMSS y no se borran. Lo que se
 * debe hoy es `actualizacionesPendientes`, que es otra cosa.
 *
 * @returns {number} 0 si las fechas no sirven o el contrato cabe en una ventana
 */
function requiredSirocRenewals(fechaInicio, fechaFin) {
  return Math.max(ventanasHasta(fechaInicio, fechaFin) - 1, 0)
}

/**
 * Cuántas actualizaciones **faltan de verdad**: las ventanas que hacen falta para
 * ir de donde llega el aviso vigente hasta el final del contrato (D-84).
 *
 * No es `requeridas − registradas`. Se cuenta desde `vigenciaPeriodoHasta`, que
 * ya incorpora cada refrendo presentado, así que mover las fechas del contrato
 * recalcula solo y **contando lo que ya hay**: aplazarlas vuelve a pedir desde
 * donde va el aviso y no desde cero, recortarlas deja de pedir lo que los
 * refrendos alcanzan a cubrir, y por debajo de lo registrado da 0 en vez de un
 * número negativo. Y como la cuenta termina en `fechaFin`, un contrato pasado de
 * fecha no acumula refrendos para siempre.
 */
function pendingSirocRenewals(vigenciaPeriodoHasta, fechaFin) {
  return ventanasHasta(vigenciaPeriodoHasta, fechaFin)
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

  const fechaFin = contrato?.fechaFin ?? null
  const requeridas = requiredSirocRenewals(contrato?.fechaInicio, fechaFin)
  const actualizaciones = fechasDeActualizacion(contrato?.siroc)
  const registradas = actualizaciones.length

  /*
   * Las dos razones por las que un contrato deja de pedir refrendos. `cerrado`
   * es una decisión de alguien; `fueraDePlazo` es el calendario pasando por
   * encima de la fecha de fin, que es el techo del cálculo (D-84).
   */
  const cerrado = contrato?.estado === 'finalizado' || contrato?.activo === false
  const fueraDePlazo = Boolean(fechaFin) && isBefore(fechaFin, hoy)

  const base = {
    periodoMeses: PERIODO_SIROC_MESES,
    actualizacionesRequeridas: requeridas,
    actualizacionesRegistradas: registradas,
    actualizacionesPendientes: 0,
    ultimaActualizacion: actualizaciones[registradas - 1] ?? null,
    vigenciaPeriodoHasta: null,
    diasParaActualizacion: null,
    requiereActualizacion: false,
    estado: 'sin_siroc',
    mensaje: 'Este contrato todavía no tiene SIROC registrado.'
  }

  /*
   * Sin SIROC no hay ventana desde la que contar, así que lo pendiente es lo que
   * predicen las fechas — que ya terminan en `fechaFin`, así que un contrato
   * pasado de fecha sigue debiendo lo que debía. Sólo cerrarlo lo apaga.
   */
  if (!contrato?.siroc?.fechaRegistro) {
    return { ...base, actualizacionesPendientes: cerrado ? 0 : requeridas }
  }

  const vigenciaPeriodoHasta = addMonths(
    actualizaciones[registradas - 1] ?? contrato.siroc.fechaRegistro,
    PERIODO_SIROC_MESES
  )

  /*
   * Un contrato finalizado o dado de baja no renueva nada: el aviso de obra
   * acompaña a la obra. Se dice explícito para que el front no tenga que
   * deducirlo del estado del contrato.
   */
  if (cerrado) {
    return {
      ...base,
      vigenciaPeriodoHasta,
      estado: 'no_requiere',
      mensaje: 'El contrato ya no está en curso: su SIROC no necesita actualizarse.'
    }
  }

  const dias = daysBetween(hoy, vigenciaPeriodoHasta)
  const pendientes = pendingSirocRenewals(vigenciaPeriodoHasta, fechaFin)

  /*
   * Pasada la fecha de fin **el SIROC no acumula más refrendos** (D-84): la obra
   * que el aviso ampara ya terminó según el propio contrato, y seguir contando
   * ventanas cada dos meses dejaba en rojo para siempre a toda obra que nadie
   * cerró —que son casi todas—, hasta que alguien capturaba refrendos que el
   * IMSS no exigió sólo para apagarlo.
   *
   * Pero el techo **corta la cuenta, no la borra**. `pendientes` ya termina en
   * `fechaFin`; si aun así es mayor que cero, es deuda de cuando el contrato
   * seguía en curso —un refrendo que se debía antes de que terminara— y sigue
   * debiéndose: la primera versión respondía `no_requiere` aquí sin mirarlo, y
   * deshacer un refrendo en un contrato pasado de fecha lo hacía desaparecer.
   * Se captura con la fecha en que se presentó, que es lo que dice el mensaje.
   *
   * Sólo cuando no queda nada por cubrir, lo que le falta al contrato es que
   * alguien lo cierre o corrija sus fechas. Eso lo dice `deriveContractTracking`,
   * por lo que es, y por eso aquí no queda ni un número que invite a pintar
   * rojo: sin días para la actualización, sin pendientes y sin exigirla.
   */
  if (fueraDePlazo) {
    if (pendientes > 0) {
      return {
        ...base,
        vigenciaPeriodoHasta,
        diasParaActualizacion: dias,
        actualizacionesPendientes: pendientes,
        requiereActualizacion: true,
        estado: 'vencida',
        mensaje: `El SIROC requiere actualización desde el ${vigenciaPeriodoHasta}: venció hace ${enDias(Math.abs(dias))}, con el contrato todavía en curso. Regístrala con la fecha en que se presentó, a más tardar el ${fechaFin}.`
      }
    }

    return {
      ...base,
      vigenciaPeriodoHasta,
      estado: 'no_requiere',
      mensaje: `El contrato terminó el ${fechaFin}: su SIROC ya no requiere actualizaciones.`
    }
  }

  /*
   * La ventana vigente ya cubre lo que le queda al contrato: no hay una
   * renovación más que pedir aunque el aviso siga venciendo más adelante.
   */
  if (pendientes === 0) {
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
     * Aquí `pendientes` ya es 1 o más por construcción —se llega sólo si la
     * ventana no alcanza la fecha de fin—, así que «vencida» y «0 pendientes» no
     * pueden salir juntas. Antes se forzaba con un `Math.max` porque la cuenta
     * venía de la predicción; ahora sale sola de la misma ventana que fija el
     * estado, que era el origen de la contradicción.
     */
    actualizacionesPendientes: pendientes,
    // `por_vencer` avisa, pero todavía no se debe nada: sólo `vencida` lo exige.
    requiereActualizacion: estado === 'vencida',
    estado,
    mensaje: mensajeDeSiroc(estado, dias, vigenciaPeriodoHasta)
  }
}

/**
 * El bloque `seguimientoContrato`: en qué punto de su vida está el contrato, y
 * si tiene un cabo suelto (D-84).
 *
 * Existe porque un contrato que pasó su fecha de fin y nadie cerró **sí es un
 * pendiente de verdad**, sólo que no del SIROC. Señalarlo con el aviso del SIROC
 * —lo que se hacía— pedía un trámite ante el IMSS que nadie debe; callarlo del
 * todo dejaba en verde una ficha que nadie revisó. Se dice aparte y por su
 * nombre: `terminado_sin_cerrar`, con lo que hay que hacer en el mensaje.
 *
 * Derivado al leer como todo lo demás (regla #6): el día que alguien finalice el
 * contrato o corrija su fecha, el aviso desaparece solo.
 *
 * @param {object} contrato ya serializado (`fechaInicio`, `fechaFin`, `estado`,
 *   `activo`)
 * @param {object} [opciones]
 * @param {string} [opciones.hoy] fecha de calendario con la que se compara
 */
function deriveContractTracking(contrato, opciones = {}) {
  const hoy = opciones.hoy ?? today()
  const { fechaInicio = null, fechaFin = null } = contrato ?? {}

  // Los días transcurridos desde el fin son un hecho, esté cerrado o no.
  const diasDesdeFin =
    fechaFin && isBefore(fechaFin, hoy) ? daysBetween(fechaFin, hoy) : null

  const base = { diasDesdeFin, requiereCierre: false }

  /*
   * La baja va primero: `activo: false` es un contrato capturado por error o
   * cancelado, y eso manda sobre en qué punto de sus fechas esté (D-70).
   */
  if (contrato?.activo === false) {
    return { ...base, estado: 'baja', mensaje: 'Este contrato está dado de baja.' }
  }

  if (contrato?.estado === 'finalizado') {
    return { ...base, estado: 'finalizado', mensaje: 'Este contrato está finalizado.' }
  }

  if (fechaInicio && isAfter(fechaInicio, hoy)) {
    return {
      ...base,
      estado: 'por_iniciar',
      mensaje: `Este contrato empieza el ${fechaInicio}.`
    }
  }

  if (diasDesdeFin !== null) {
    return {
      ...base,
      estado: 'terminado_sin_cerrar',
      requiereCierre: true,
      mensaje: `Este contrato terminó el ${fechaFin} hace ${enDias(diasDesdeFin)} y sigue abierto: finalízalo, o corrige su fecha de fin si la obra sigue.`
    }
  }

  return {
    ...base,
    estado: 'en_curso',
    mensaje: fechaFin
      ? `Este contrato está en curso hasta el ${fechaFin}.`
      : 'Este contrato está en curso.'
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
  ESTADOS_CONTRATO,
  requiredSirocRenewals,
  pendingSirocRenewals,
  deriveSirocTracking,
  deriveContractTracking,
  mensajeDeSiroc,
  pickCurrentSirocContract
}
