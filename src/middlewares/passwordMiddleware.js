const { AppError } = require('./errorHandler')

/**
 * Bloquea la plataforma mientras la contraseña sea temporal (D-49).
 *
 * ─── Qué problema resuelve ───────────────────────────────────────────────────
 * Cuando un administrador da acceso o repone una contraseña, **él la conoce**. Y
 * el administrador inicial del bootstrap nace con la contraseña de arranque
 * (`1234` por defecto, D-21). Hasta ahora nada obligaba a cambiarla: el aviso
 * quedaba en un log que nadie lee, y una instalación podía quedarse para siempre
 * con una credencial que conoce quien la instaló.
 *
 * Con esto, la sesión existe pero **no sirve para nada** hasta que la persona
 * pone una contraseña que sólo ella conoce.
 *
 * ─── Qué SÍ se puede hacer con una contraseña temporal ───────────────────────
 * Exactamente tres cosas, y son las rutas de `authRoutes` que no llevan este
 * middleware:
 *
 * - `POST /auth/cambiar-password` — la salida.
 * - `GET /auth/me` — para que el front sepa quién es y vea el estado.
 * - `POST /auth/logout` — nadie debe quedar atrapado.
 *
 * Todo lo demás responde **403 con `code: 'PASSWORD_TEMPORAL'`**. Es 403 y no
 * 401 a propósito: la sesión es válida y el token sirve; lo que falta es un
 * requisito, no la identidad. Un 401 haría que el front cerrara la sesión y
 * mandara a la pantalla de login, que es justo el bucle que hay que evitar.
 *
 * ─── Por qué se aplica router por router ─────────────────────────────────────
 * Va en el `router.use(protect, …)` de cada recurso, no dentro de `protect`, para
 * que `protect` no tenga que conocer una lista de rutas exentas. El candado de
 * que no se olvide en un recurso nuevo es una prueba: `passwords.test.js`
 * recorre el **inventario de rutas derivado del router** y exige que todas
 * respondan 403 con una contraseña temporal, salvo las tres de arriba.
 */
function requirePasswordDefinitiva(req, res, next) {
  if (!req.user) {
    return next(new AppError(401, 'Necesitas iniciar sesión para continuar'))
  }

  if (req.user.acceso?.passwordTemporal) {
    return next(
      new AppError(
        403,
        'Tu contraseña es temporal: cámbiala para poder usar la plataforma.',
        { code: 'PASSWORD_TEMPORAL' }
      )
    )
  }

  return next()
}

module.exports = { requirePasswordDefinitiva }
