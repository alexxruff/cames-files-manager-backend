---
name: api-contract
description: Reglas del contrato HTTP con el front (envelope, códigos, fechas, errores, nombres). Úsala SIEMPRE que crees o modifiques un endpoint, un controlador, una validación o la forma de una respuesta. Si el backend devuelve otra forma, el front se rompe.
---

# Contrato con el front

El front de Urbacames ya está terminado y probado contra estas formas exactas.
No son preferencias: **si el backend devuelve otra cosa, el front se rompe.**
La fuente completa es `backend-spec.md` §2; esto es el resumen operativo.

## 1. Envelope, siempre

```json
{ "status": "success" | "fail" | "error", "message": "…", "data": { } }
```

- `data` **anidado bajo llave nombrada**: `data: { expedientes: [...] }`,
  nunca `data: [...]`.
- No construyas la respuesta a mano. Usa los helpers:

```js
const { ok, created, noContent } = require('../../../utils/response')

return ok(res, { usuarios }) // 200
return created(res, { usuario }, 'Usuario creado') // 201
return noContent(res) // 204
```

## 2. Errores

Formato de `express-validator`, que el front ya sabe leer:

```json
{ "status": "fail", "message": "…", "errors": [{ "msg": "El nombre es requerido" }] }
```

El front muestra `errors[0].msg` si existe, y si no `message`. Por eso:

- **Los mensajes se escriben en español** y se le muestran tal cual a la persona
  usuaria: dicen qué hacer, no qué falló internamente.
  - Sí: `'Escribe un correo válido'`, `'Debe quedar al menos un administrador activo'`
  - No: `'ValidationError: email path failed'`, `'Invalid ObjectId'`
- Lanza `AppError`, nunca respondas el error a mano:

```js
const { AppError } = require('../../../middlewares/errorHandler')

throw AppError.notFound('El expediente no existe')
throw AppError.validation('Ya existe un usuario con ese correo', [
  { msg: 'Ya existe un usuario con ese correo', path: 'email' }
])
throw new AppError(400, 'Este documento ya fue revisado')
```

## 3. Códigos HTTP

| Código | Cuándo                                                      |
| ------ | ----------------------------------------------------------- |
| 200    | Lectura y actualización                                     |
| 201    | Creación                                                    |
| 204    | Baja lógica, sin cuerpo                                     |
| 400    | Validación o estado inválido                                |
| 401    | Sin sesión o sesión inválida                                |
| 403    | Con sesión, sin permiso                                     |
| 404    | No existe **o no es visible para quien pregunta**           |
| 409    | Conflicto                                                   |
| 413    | Archivo muy grande · 415 tipo no permitido · 429 rate limit |

**Fuera de alcance es 404, nunca 403**: un 403 confirmaría que el recurso
existe. Ver la skill `mongo-modeling` y `middlewares/scopeMiddleware.js`.

## 4. Identificadores, fechas y campos vacíos

- **`_id` en string. Nunca `id`.** Lo garantiza el `toJSON` de cada modelo.
- **Dos formatos de fecha, no se mezclan:**
  - Fechas de calendario (ingreso, vigencia, baja) → `String` `'YYYY-MM-DD'`,
    sin hora ni zona. Se manejan con `utils/dates.js`.
  - Marcas de tiempo (`createdAt`, `subidoEn`, `revisadoEn`) → `Date`, salen en
    ISO 8601 UTC.
  - **Nunca guardes una fecha de calendario como `Date`**: se va a medianoche
    UTC y en México se lee un día antes.
- **Campos opcionales: `null` u omitidos, jamás `''`.** El front trata `""`
  como valor presente.

## 5. Idiomas

| Qué                                                                   | Idioma     | Por qué                           |
| --------------------------------------------------------------------- | ---------- | --------------------------------- |
| Rutas (`/usuarios`, `/expedientes`)                                   | español    | El front ya las llama             |
| Llaves JSON del dominio (`nivelAcceso`, `vigenciaHasta`, `clienteId`) | español    | Contrato                          |
| Valores de enums (`rh_admin`, `obra_determinada`)                     | español    | Se comparan por igualdad estricta |
| Mensajes de error                                                     | español    | Se muestran al usuario            |
| Archivos, funciones, variables, modelos, colecciones                  | **inglés** | Convención del código             |
| Campos internos que no se serializan (`nameNormalized`)               | inglés     | No son contrato                   |

## 6. Nada de estado calculado que venga del cliente

El front manda **intenciones** ("sube esto", "valida aquello"), nunca estados.
Cualquier `avance`, `estatus`, `porcentaje` o `clienteId` que llegue en el
cuerpo **se ignora**: el servidor recalcula y el `clienteId` sale del usuario.

## Antes de dar por terminado un endpoint

- [ ] Respuesta con helper de `utils/response`, datos bajo llave nombrada.
- [ ] Handler envuelto en `asyncHandler`; el controlador no tiene `try/catch`.
- [ ] Validaciones en `src/validations/` + `validateRequest` en la ruta.
- [ ] `protect` y `applyScope` en la ruta; permiso por `requireCapability`.
- [ ] Fechas de calendario como `'YYYY-MM-DD'`; opcionales en `null`.
- [ ] Prueba de integración del camino feliz, del 401/403 y del 404 por alcance.
- [ ] `docs/CONTRATO-API.md` y `docs/ESTADO.md` actualizados.
