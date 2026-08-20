/**
 * Envelope de respuesta. Regla no negociable #2 del spec:
 *
 *   { "status": "success" | "fail" | "error", "message"?: "…", "data": { … } }
 *
 * Los datos van SIEMPRE anidados bajo una llave con nombre
 * (`data: { usuarios: [...] }`), nunca sueltos (`data: [...]`), porque el front
 * desenvuelve `data` automáticamente.
 *
 * Usar estos helpers en vez de `res.json` a mano es lo que evita que un
 * endpoint se salga del contrato sin que nadie lo note.
 */

/** 200 — lectura o actualización exitosa. */
function ok(res, data = null, message) {
  return res.status(200).json({
    status: 'success',
    ...(message ? { message } : {}),
    data
  })
}

/** 201 — recurso creado. */
function created(res, data = null, message) {
  return res.status(201).json({
    status: 'success',
    ...(message ? { message } : {}),
    data
  })
}

/** 204 — baja sin cuerpo. */
function noContent(res) {
  return res.status(204).send()
}

module.exports = { ok, created, noContent }
