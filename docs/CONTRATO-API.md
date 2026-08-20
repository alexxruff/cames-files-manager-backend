# Contrato de la API

Base: **`/api/v1`**. Todas las rutas exigen sesión salvo `POST /auth/login`,
`GET /health` y `GET /ready`.

En los ejemplos se muestra sólo el contenido de `data`; recuerda que va envuelto.

## Reglas transversales

```json
{ "status": "success" | "fail" | "error", "message": "…", "data": { } }
```

- Datos **anidados bajo llave nombrada**: `data: { usuarios: [...] }`.
- Errores de validación:
  `{ "status": "fail", "message": "…", "errors": [{ "msg": "…", "path": "email" }], "data": null }`
  El front muestra `errors[0].msg` si existe, y si no `message`.
- `_id` en string, nunca `id`. Opcionales en `null`, nunca `''`.
- Fechas de calendario `'YYYY-MM-DD'`; marcas de tiempo ISO 8601 UTC.
- Códigos: `200` lectura/actualización · `201` creación · `204` baja ·
  `400` validación o estado inválido · `401` sin sesión · `403` sin permiso ·
  `404` no existe **o no es visible** · `409` conflicto · `413` archivo grande ·
  `415` tipo no permitido · `429` rate limit.
- Header `X-Request-Id` en toda respuesta (útil para reportar errores).

## `AuthUser`

Forma exacta que devuelven `/auth/login`, `/auth/me` y todos los endpoints de
usuarios:

```ts
{
  _id: string
  name: string
  email: string
  role: 'user' | 'admin' // compatibilidad
  nivelAcceso: 'rh_admin' | 'rh_consulta' | 'jefe_area' // fuente real
  area: Area | null // sólo jefe_area
  alcance: 'interno' | 'cliente'
  clienteId: string | null
  active: boolean
  ultimoAccesoEn: string | null // ISO
  createdAt: string // ISO
  updatedAt: string // ISO
}
```

`role` se deriva de `nivelAcceso` (`rh_admin` → `admin`, el resto → `user`) y se
manda **sólo mientras el front termina la transición**. Cuando el front lea
`nivelAcceso` directo, se puede quitar (ver `docs/DECISIONES.md` D-08).

---

## Salud

| Método | Ruta      | Respuesta                                                                     |
| ------ | --------- | ----------------------------------------------------------------------------- |
| GET    | `/health` | `200` · `data: { timestamp }`. No toca la base.                               |
| GET    | `/ready`  | `200` o `503` · `data: { baseDeDatos: { estado, listo, dbName }, timestamp }` |

---

## 1. Autenticación — `/auth`

### `POST /auth/login` — pública

```jsonc
// petición
{ "email": "marisol@urbacames.com", "password": "Urbacames1!" }

// data
{ "user": { /* AuthUser */ }, "token": "eyJhbGciOi…" }
```

- `400` falta el correo o la contraseña, o el correo no tiene forma válida.
- `401` **`'Correo o contraseña incorrectos'`** — el mismo mensaje si el correo
  no existe o si la contraseña está mal, para no revelar qué cuentas hay.
- `401` `'Tu cuenta está desactivada. Contacta a Recursos Humanos.'`
- `429` tras `LOGIN_RATE_LIMIT_MAX` intentos fallidos (10) en la ventana, por
  IP + correo.
- Efecto: actualiza `ultimoAccesoEn`.
- Sesión de 12 h (`JWT_EXPIRES_IN`).

### `GET /auth/me`

```jsonc
// data
{ "user": {/* AuthUser */} }
```

`401` si el token es inválido, expiró o el usuario se desactivó **después** de
emitirlo: la autorización relee al usuario en cada petición.

### `POST /auth/logout`

`200` con `data: null`. La sesión es un JWT sin estado; el front borra el token.

### `POST /auth/cambiar-password`

```jsonc
{ "passwordActual": "…", "passwordNueva": "…" }
// data: { "user": { /* AuthUser */ } }
```

`400` si la actual no coincide (`errors[0].path = 'passwordActual'`), si la nueva
no cumple las reglas o si es igual a la actual.

**Reglas de contraseña:** mínimo 8 caracteres, con mayúscula, minúscula, dígito y
uno de `!@#$%^&*`.

> `POST /auth/recuperar` y `POST /auth/restablecer` (spec 9.1) **no están
> implementados**. Hoy sólo un administrador puede reponer una contraseña.
>
> **No existe registro público** (`POST /auth/register` responde `404`): las
> cuentas las crea un administrador.

---

## 2. Usuarios — `/usuarios`

Todas exigen `nivelAcceso: 'rh_admin'` (capacidad `manageUsers`) y quedan
acotadas por el alcance del usuario: un administrador de cliente sólo ve y toca
a los usuarios de su cliente.

### `GET /usuarios`

Query: `?incluirInactivos=true|false` (default `false`) · `?busqueda=` (nombre o
correo, ignora acentos y mayúsculas).

```jsonc
// data
{ "usuarios": [/* AuthUser[] */] }
```

Orden alfabético por nombre con colación española.

### `GET /usuarios/:id`

```jsonc
// data
{ "usuario": {/* AuthUser */} }
```

`404` si no existe **o es de otro cliente**.

### `POST /usuarios` → `201`

```jsonc
{
  "name": "Claudia Serrano",
  "email": "claudia@urbacames.com",
  "password": "Urbacames1!",
  "nivelAcceso": "rh_consulta",
  "area": null, // obligatoria si nivelAcceso = 'jefe_area'
  "alcance": "interno",
  "clienteId": null
}
// data: { "usuario": { /* AuthUser */ } }
```

- **No devuelve token**: es un alta administrativa, no un registro.
- `400` correo ya usado (`errors[0].path = 'email'`), contraseña débil, nivel o
  área inválidos, `jefe_area` sin área, `alcance: 'cliente'` sin `clienteId`, o
  `clienteId` que no existe.
- El `area` se ignora (queda `null`) si el nivel no es `jefe_area`.
- Si quien crea es un usuario de cliente, el `clienteId` que mande **se ignora**:
  hereda el suyo.
- El nombre admite acentos, ñ, apóstrofo y guion (`/^[\p{L}\s'-]+$/u`).

### `PATCH /usuarios/:id`

Acepta **sólo** `name`, `email`, `nivelAcceso`, `area`, `alcance`, `clienteId`.
Cualquier otro campo → `400` con la lista de los no permitidos. La contraseña no
se cambia por aquí.

```jsonc
// data: { "usuario": { /* AuthUser */ } }
```

`400` también si el cuerpo viene vacío, si el correo ya lo usa alguien más o si
el último administrador intenta quitarse la administración.

### `DELETE /usuarios/:id` → `204`

Baja lógica (`active: false`); el documento se conserva para auditoría.

- `400` `'No puedes darte de baja a ti mismo'`.
- `400` si dejaría al sistema sin ningún `rh_admin` activo.

### `PATCH /usuarios/:id/reactivar`

```jsonc
// data: { "usuario": { /* AuthUser con active: true */ } }
```

Idempotente sobre alguien que ya está activo.

---

## 3. Pendientes

Rutas especificadas y **no implementadas todavía**. Están reservadas: no las
ocupes con otra cosa. El detalle de cada una está en `backend-spec.md` §9.

| Ruta                                                                                           | Spec         |
| ---------------------------------------------------------------------------------------------- | ------------ |
| `GET/POST /expedientes`, `GET /expedientes/:id`, `PATCH /expedientes/:id/{colaborador,estado}` | 9.3          |
| `POST /expedientes/:id/documentos/:tipo` (+ `/validar`, `/rechazar`, `/versiones/:v/url`)      | 9.4          |
| `GET /alertas`, `GET /dashboard/metricas`                                                      | 9.5          |
| `GET /plantillas-checklist`, `PATCH /plantillas-checklist/:id`                                 | 9.6          |
| `GET /reportes/expedientes`                                                                    | 9.7          |
| `GET/POST/PATCH /clientes`                                                                     | 9.8 (fase 2) |

**Decisión pendiente antes de implementar `GET /expedientes`:** si va a haber
paginación, `data` debe ser `{ expedientes, total, pagina, porPagina }` **desde
la primera versión**; agregarla después es un cambio incompatible con el front.
