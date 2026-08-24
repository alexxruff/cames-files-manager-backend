# Guía de integración para el front

Cómo conectar el front de Expedientes Urbacames con este backend, con el **modelo
nuevo** (empresas como entidad raíz, empleados y clientes como catálogos
compartidos, vínculos en sus propias colecciones).

Cubre lo que está implementado y probado: **sesión** y **administración de
accesos**. Todo lo demás sigue en `src/mocks/` con `VITE_USE_MOCKS=true`.

> Verificado con 389 pruebas automatizadas. Si algo no coincide con lo que ves, es
> un bug del backend: repórtalo con el `X-Request-Id` de la respuesta.
>
> Esta guía **reemplaza** la versión anterior: el CRUD de `/usuarios`, el campo
> `role` y el eje `clienteId` ya no existen.

---

## 0. Qué existe hoy — la lista completa

**Estos 22 endpoints son TODO lo que responde el servidor.** Cualquier otra ruta
devuelve `404`.

| Método   | Ruta                                                | Sesión                     |
| -------- | --------------------------------------------------- | -------------------------- |
| `GET`    | `/api/v1`                                           | — (inventario)             |
| `GET`    | `/api/v1/health`                                    | —                          |
| `GET`    | `/api/v1/ready`                                     | —                          |
| `POST`   | `/api/v1/auth/login`                                | —                          |
| `GET`    | `/api/v1/auth/me`                                   | ✓                          |
| `POST`   | `/api/v1/auth/logout`                               | ✓                          |
| `POST`   | `/api/v1/auth/cambiar-password`                     | ✓                          |
| `GET`    | `/api/v1/empleados`                                 | ✓ ver empleados            |
| `GET`    | `/api/v1/empleados/:id`                             | ✓ ver empleados            |
| `PATCH`  | `/api/v1/empleados/:id`                             | ✓ quien crea ese `tipo`    |
| `PATCH`  | `/api/v1/empleados/:id/estado`                      | ✓ `rh_admin`               |
| `POST`   | `/api/v1/empleados/:id/acceso`                      | ✓ `rh_admin`               |
| `PATCH`  | `/api/v1/empleados/:id/acceso`                      | ✓ `rh_admin`               |
| `DELETE` | `/api/v1/empleados/:id/acceso`                      | ✓ `rh_admin`               |
| `POST`   | `/api/v1/empleados/:id/acceso/restablecer-password` | ✓ `rh_admin`               |
| `ALL`    | `/api/v1/usuarios*`                                 | responde **410**: se movió |

### Verifícalo sin creerle a este documento

```bash
curl -s http://localhost:8080/api/v1 | jq '.data.implementados, .data.pendientes'
```

`GET /api/v1` es público y **se deriva del router en tiempo de ejecución**: no
puede desincronizarse del código.

> **`data.empleado` significa siempre lo mismo:** el **RenglonEmpleado**
> (`{ empleado, categoriaNombre, adscripciones, asignaciones, avanceExpediente,
expedienteId }`), en el alta, la edición, el estado y las tres rutas de acceso.
> Así se puede reemplazar el renglón de la tabla con la respuesta, sin una segunda
> petición. La única excepción es `GET /empleados`, que devuelve la lista paginada.

### Cómo interpretar cada respuesta

| Respuesta                         | Significa                                                  |
| --------------------------------- | ---------------------------------------------------------- |
| `404` con `"La ruta … no existe"` | **No implementado**                                        |
| `404` con otro mensaje            | La ruta existe; el recurso no, **o no es visible para ti** |
| `410`                             | La ruta **se movió**; el mensaje dice a dónde              |
| `401`                             | La ruta existe, falta el token o dejó de ser válido        |
| `403`                             | Existe y tienes sesión, pero tu nivel no alcanza           |

---

## 1. Lo que cambia respecto a lo que tienen hoy

| Hoy en el front                   | Con este backend                                                       |
| --------------------------------- | ---------------------------------------------------------------------- |
| `VITE_API_BASE_URL=…:5001/api/v1` | `http://localhost:8080/api/v1`                                         |
| `GET /users` → `data.users`       | `GET /empleados` → `data.empleados` (paginado)                         |
| `POST /users` crea un usuario     | `POST /empleados/:id/acceso` da acceso a una **persona que ya existe** |
| `DELETE /users/:id`               | `DELETE /empleados/:id/acceso` (quita el acceso, no a la persona)      |
| `role: 'user' \| 'admin'`         | `nivelAcceso` + `alcanceGlobal`                                        |
| `accessLevelFromRole(user.role)`  | `user.nivelAcceso` directo                                             |
| `user.area` (una)                 | `user.empresas[].areas` (por empresa)                                  |
| `user.alcance` / `user.clienteId` | Desaparecen: el alcance sale de las adscripciones                      |
| `POST /auth/register`             | No existe                                                              |
| `/usuarios`                       | **410**, con las rutas nuevas en el mensaje                            |

**Archivos del front que hay que tocar:**

1. `.env` → `VITE_API_BASE_URL`
2. `src/interfaces/auth-user.ts` → forma nueva
3. `src/modules/users/users-service.ts` → reescribir contra `/empleados`
4. `src/utils/access-level.ts` → leer `nivelAcceso`; borrar el mapeo de `role`
5. `src/modules/auth/auth-provider.tsx` → guardar el token nuevo que devuelve el
   cambio de contraseña

`src/lib/api-client.ts` **no necesita cambios**: el envelope, `errors[0].msg` y el
manejo de `204` que ya implementa son exactamente lo que este backend devuelve.

---

## 2. Configuración

```dotenv
VITE_API_BASE_URL=http://localhost:8080/api/v1
VITE_USE_MOCKS=true   # sigue en true: expedientes aún no tiene backend
```

- Puerto **8080**. Sus puertos de dev (5173 y 5174) ya están en la lista de CORS.
- **Sesión de 12 h**, JWT en `localStorage` con las llaves que ya usan.
- `GET /health` para saber si el backend está arriba.

### Credenciales del primer acceso (desarrollo)

|            |                                                                        |
| ---------- | ---------------------------------------------------------------------- |
| Correo     | `alexxruff@yahoo.com`                                                  |
| Contraseña | `1234`                                                                 |
| Nivel      | `rh_admin` con **`alcanceGlobal: true`** (administrador de plataforma) |

El login no valida complejidad, así que `1234` entra sin cambios en su formulario.
`cambiar-password` **sí** exige que la nueva cumpla las reglas.

> ⚠️ Es una credencial de desarrollo: la vamos a rotar. **No la escriban en el
> código del front.**

---

## 3. Reglas del contrato

### Envelope

```json
{ "status": "success" | "fail" | "error", "message": "…", "data": { } }
```

Datos **siempre bajo llave nombrada**. Su `request<T>()` ya devuelve `envelope.data`.

### Errores

```json
{
  "status": "fail",
  "message": "El nombre es requerido",
  "errors": [{ "msg": "El nombre es requerido", "path": "name" }],
  "data": null
}
```

Los mensajes están **en español y listos para mostrar**: no hace falta
traducirlos. `errors[].path` es el campo culpable, para marcar el input.

### Códigos

`200` lectura/actualización · `201` creación · `204` sin cuerpo · `400` validación
o estado inválido · `401` sin sesión · `403` sin permiso · `404` no existe o no es
visible · `409` conflicto · `410` movido · `429` rate limit.

### Fechas, identificadores y opcionales

- `_id` en string, nunca `id`.
- **Fechas de calendario** (`fechaIngreso`, `vigenciaHasta`): `'YYYY-MM-DD'`, sin
  hora. No las pasen por `new Date()` para formatear.
- **Marcas de tiempo** (`createdAt`, `ultimoAccesoEn`): ISO 8601 UTC.
- Opcionales: `null` u omitidos, **nunca cadena vacía**.

### `X-Request-Id`

Va en toda respuesta. Si lo muestran en el error de un `500`, encontramos la
petición en los logs en segundos.

---

## 4. El usuario de la plataforma

Esto es lo que cambió de fondo, y conviene entenderlo antes de tocar código.

**No hay colección de usuarios.** Quien entra a la plataforma es un **empleado con
acceso**: la misma persona de la que se lleva expediente, con un subdocumento
`acceso` que dice con qué correo entra y qué puede hacer. Así nunca existen dos
registros de la misma persona — era la invariante que pidieron y se cumple **por
construcción**, porque para dar acceso hay que partir de un empleado que ya
existe.

Tres consecuencias prácticas:

1. **Dar acceso no crea gente.** Es `POST /empleados/:id/acceso` sobre alguien
   que ya está en el catálogo.
2. **Quitar el acceso no borra a la persona.** Sigue siendo empleada y conserva su
   expediente; sólo deja de poder entrar.
3. **Lo que alguien ve se deriva de sus adscripciones**, no de un campo. Un
   usuario ve las empresas donde tiene adscripción activa, y a la gente de esas
   empresas. El administrador de plataforma (`alcanceGlobal`) ve todo.

La contraseña vive en otra colección (`credentials`) y **nunca** viaja en ninguna
respuesta. Para el front eso es invisible; se menciona porque explica por qué
`acceso` no tiene campo de contraseña.

### `AuthUser`

```ts
import type { AccessLevel } from '@/enums/access-level'
import type { Area } from '@/enums/area'

/** Empresa donde la persona tiene adscripción activa, con sus áreas ahí. */
export interface EmpresaDeUsuario {
  _id: string
  nombre: string
  areas: Area[]
}

export interface AuthUser {
  _id: string // id del EMPLEADO
  name: string
  email: string // el correo de acceso
  nivelAcceso: AccessLevel // 'rh_admin' | 'rh_consulta' | 'jefe_area'
  /** Administrador de plataforma: ve todas las empresas y los catálogos. */
  alcanceGlobal: boolean
  empresas: EmpresaDeUsuario[]
  active: boolean
  ultimoAccesoEn: string | null // ISO
  createdAt: string
  updatedAt: string
}
```

Ya no existen `role`, `area`, `alcance` ni `clienteId`.

```ts
// src/utils/access-level.ts — queda así
export function canManageUsers(user?: AuthUser): boolean {
  return user?.nivelAcceso === AccessLevel.RhAdmin
}
export function esAdminPlataforma(user?: AuthUser): boolean {
  return Boolean(user?.alcanceGlobal)
}
export function areasEn(user: AuthUser, empresaId: string): Area[] {
  return user.empresas.find((e) => e._id === empresaId)?.areas ?? []
}
```

### El empleado, como lo devuelve el listado

```ts
export interface AccesoEmpleado {
  email: string
  nivelAcceso: AccessLevel
  alcanceGlobal: boolean
  activo: boolean
  passwordActualizadaEn: string | null
}

export interface Empleado {
  _id: string
  nombre: string
  curp: string | null // puede faltar en un alta provisional
  rfc: string | null
  nss: string | null
  fechaNacimiento: string | null // 'YYYY-MM-DD'
  email: string | null // contacto, distinto del de acceso
  telefono: string | null
  categoriaId: string
  tipo: 'administrativo' | 'mano_de_obra'
  /** `null` = no entra a la plataforma. Es la mayoría. */
  acceso: AccesoEmpleado | null
  activo: boolean
  motivoBaja: string | null
  fechaBaja: string | null
  createdAt: string
  updatedAt: string
}

export interface AdscripcionDeEmpleado {
  _id: string
  empresaId: string
  empresaNombre: string | null
  areas: Area[]
  tipoContrato: TipoContrato
  fechaIngreso: string // 'YYYY-MM-DD'
  fechaTerminoContrato: string | null
  activo: boolean
}

/*
 * OJO: la adscripción que devuelven `/empresas/:id/adscripciones` y
 * `/adscripciones/:id` trae TRES campos más —`numeroEmpleado`, `departamento` y
 * `datosPendientes`— que agregó la importación desde .xlsx (D-46). Son
 * aditivos: nada cambió de nombre ni de forma. El renglón del listado de
 * empleados, el de arriba, sigue igual. Detalle en
 * `docs/ENDPOINTS-ADSCRIPCIONES.md`.
 */

/** Un renglón del listado. La forma ya es la definitiva. */
export interface RenglonEmpleado {
  empleado: Empleado
  categoriaNombre: string | null
  adscripciones: AdscripcionDeEmpleado[]
  /** Vacío hasta que exista el módulo de proyectos. */
  asignaciones: unknown[]
  /** Porcentaje del expediente, 0–100. Ver docs/ENDPOINTS-EXPEDIENTES.md. */
  avanceExpediente: number | null
  expedienteId: string | null
}
```

**El contrato ya no cambia** cuando implementemos proyectos y expedientes: se
llenan `asignaciones`, `avanceExpediente` y `expedienteId`, que hoy vienen vacíos.

---

## 5. Endpoints

### `POST /auth/login` — pública

```jsonc
// petición
{ "email": "marisol@urbacames.com", "password": "Urbacames1!" }

// 200 → data
{ "user": { /* AuthUser */ }, "token": "eyJhbGciOi…" }
```

| Código | `message`                                                                        | Cuándo                                                                |
| ------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `400`  | `'Escribe tu correo'` · `'Escribe un correo válido'` · `'Escribe tu contraseña'` | Validación                                                            |
| `401`  | `'Correo o contraseña incorrectos'`                                              | Credenciales mal **o correo inexistente**. No lo desambigüen en la UI |
| `401`  | `'Tu cuenta está desactivada. Contacta a Recursos Humanos.'`                     | Persona dada de baja                                                  |
| `401`  | `'Tu acceso a la plataforma fue desactivado. Contacta a Recursos Humanos.'`      | Le quitaron el acceso                                                 |
| `401`  | `'Tu acceso está bloqueado temporalmente…'`                                      | Bloqueo puesto por un administrador                                   |
| `429`  | `'Demasiados intentos de inicio de sesión…'`                                     | 10 fallidos por IP+correo en 15 min                                   |

### `GET /auth/me`

```jsonc
{ "user": {/* AuthUser */} }
```

`401` si el token expiró, si le quitaron el acceso, si dieron de baja a la persona
**o si cambió su contraseña** después de emitirse el token. Llámenlo al arrancar y
**rehidraten los permisos con la respuesta**: el `nivelAcceso` y las empresas
pueden haber cambiado desde el último login.

### `POST /auth/logout`

`200` con `data: null`. La sesión es un JWT sin estado: lo importante es borrarlo
del cliente.

### `POST /auth/cambiar-password`

```jsonc
// petición
{ "passwordActual": "1234", "passwordNueva": "NuevaClave9#" }

// 200 → data  ⚠️ trae token NUEVO
{ "user": { /* AuthUser */ }, "token": "eyJhbGciOi…" }
```

**Cambio importante respecto a la guía anterior:** cambiar la contraseña
**invalida todas las sesiones abiertas**, incluida la que hizo la petición. Por eso
la respuesta trae un token nuevo — **guárdenlo en `localStorage` en lugar del
anterior** o la siguiente petición dará `401`.

| Código | `message` / `path`                                                                                                                                             |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | `'Tu contraseña actual no es correcta'` · `passwordActual`                                                                                                     |
| `400`  | `'La contraseña debe tener al menos 8 caracteres'` / `'…necesita una mayúscula, una minúscula, un número y uno de estos símbolos: !@#$%^&*'` · `passwordNueva` |
| `400`  | `'La contraseña nueva debe ser distinta de la actual'`                                                                                                         |

### `GET /empleados` — el listado, paginado

Query, todos opcionales:

| Parámetro              | Valores                                         | Default      |
| ---------------------- | ----------------------------------------------- | ------------ |
| `busqueda`             | nombre, parcial, ignora acentos                 | —            |
| `empresaId`            | acota **dentro** de lo visible; nunca lo amplía | —            |
| `area`                 | área de la adscripción                          | —            |
| `tipo`                 | `administrativo` \| `mano_de_obra`              | —            |
| `soloConAcceso`        | `true` \| `false`                               | `false`      |
| `incluirInactivos`     | `true` \| `false`                               | `false`      |
| `orden`                | `nombre_asc` \| `nombre_desc`                   | `nombre_asc` |
| `pagina` / `porPagina` | empieza en 1; máximo 100                        | 1 / 25       |

```jsonc
// data
{
  "total": 47,
  "pagina": 1,
  "porPagina": 25,
  "empleados": [/* RenglonEmpleado[] */]
}
```

- El orden se calcula **sobre el total** y después se corta la página.
- Una página más allá del final devuelve `empleados: []` y el `total` real, no un
  `404`.
- **Sólo aparecen las adscripciones activas** de las empresas que ustedes ven: si
  alguien está en dos empresas, cada una ve la suya.
- `incluirInactivos=true` trae también a las personas dadas de baja y las
  adscripciones cerradas — es como se encuentra a quien ya se fue.
- Un `jefe_area` sólo ve a la gente de sus áreas; si no tiene áreas asignadas, ve
  **cero**, no todo.
- `empresaId` de una empresa que no es suya → `404`.

### `GET /empleados/:id`

```jsonc
{ "empleado": {/* RenglonEmpleado */} }
```

`400` si el id no tiene forma de ObjectId; `404` si no existe **o no es visible**.

### `POST /empresas` → `201` — sólo administrador de plataforma

```jsonc
// petición
{ "nombre": "Urbacames Edificación", "rfc": "UED210101AB1" }   // rfc opcional

// data
{
  "empresa": { "_id": "…", "nombre": "…", "rfc": "…", "activo": true, "branding": {…}, "configuracion": {…}, "createdAt": "…", "updatedAt": "…" },
  "conteos": { "empleados": 0, "clientes": null, "proyectosActivos": null, "alertasPendientes": null }
}
```

**Es `activo`, no `activa`.** Un solo nombre en toda la API.

| Código | Cuándo                                                                                                                                   |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `403`  | No es administrador de plataforma (ni siquiera un `rh_admin` normal)                                                                     |
| `409`  | `code: 'EMPRESA_DUPLICADA'` (nombre, ignorando acentos) o `'RFC_DUPLICADO'` (con `data.empresaId` y `data.nombre` de la que ya lo tiene) |
| `400`  | Nombre de menos de 3 caracteres, o RFC mal formado                                                                                       |

### `GET /empresas` · `GET /empresas/:id`

Query: `?incluirInactivas=true|false` · `?busqueda=`

```jsonc
// data
{ "empresas": [ { "empresa": { … }, "conteos": { … } } ] }
```

Cada quien ve **sus** empresas (las de sus adscripciones activas); el
administrador de plataforma, todas. Los `conteos` vienen resueltos del servidor con
agregación: `empleados` (adscripciones activas), `clientes` (cartera activa) y
`proyectosActivos` (sólo los **en curso**) son reales. `alertasPendientes` sigue en
`null` porque ese módulo no existe — `null` significa «todavía no se sabe», no
«cero». Una empresa ajena da `404`.

### `GET /categorias` · `POST /categorias` · `PATCH /categorias/:id/estado`

```jsonc
// GET /categorias?tipo=mano_de_obra&incluirInactivas=false&busqueda=
{ "categorias": [ { "_id": "…", "nombre": "Albañil", "tipo": "mano_de_obra", "esBase": false, "activo": true, … } ] }

// POST /categorias
{ "nombre": "Auxiliar contable", "tipo": "administrativo" }
```

- **Leer**: cualquiera con sesión (pueblan el desplegable del alta).
- **Crear**: sólo administrador de plataforma — el catálogo es de todo el grupo.
- **Es idempotente por nombre**: si ya existe devuelve **`200`** con la que hay y
  `message: "Esa categoría ya existía"`; **`201`** sólo cuando la creó. Así
  distinguen sin adivinar.
- `409 CATEGORIA_OTRO_TIPO` si ese nombre ya existe con otro `tipo`, con la
  existente en `data.categoria`.
- `PATCH …/estado` falla con `400` si hay personas con ese puesto o si es `esBase`.

### `POST /empleados` → `201` — el alta

```jsonc
// petición
{
  "nombre": "Roberto Aguilar Sosa",
  "tipo": "mano_de_obra",              // o "administrativo"
  "categoriaId": "…",                  // del tipo que corresponda
  "curp": "AUSR900101HJCGSB03",        // opcional
  "rfc": null, "nss": null, "fechaNacimiento": null, "email": null, "telefono": null,

  // Obligatoria salvo para el administrador de plataforma.
  "adscripcion": {
    "empresaId": "…",
    "areas": ["obra"],
    "tipoContrato": "obra_determinada",
    "fechaIngreso": "2026-09-01",
    "fechaTerminoContrato": "2027-03-01"   // sólo contratos temporales
  },

  "confirmarDuplicado": false           // ver duplicados, abajo
}

// data — el RenglonEmpleado completo, igual que GET /empleados
{ "empleado": { "empleado": { … }, "categoriaNombre": "Albañil", "adscripciones": [ … ], "asignaciones": [], "avanceExpediente": null, "expedienteId": null } }
```

**Persona y adscripción se crean en una transacción**: o las dos, o ninguna. Nunca
queda una persona huérfana e invisible.

| Quien pide          | Puede crear         | La adscripción                            |
| ------------------- | ------------------- | ----------------------------------------- |
| admin de plataforma | cualquier `tipo`    | **opcional** (llena el catálogo)          |
| `rh_admin`          | cualquier `tipo`    | obligatoria, sólo sus empresas            |
| `rh_consulta`       | sólo `mano_de_obra` | obligatoria, sólo sus empresas            |
| `jefe_area`         | sólo `mano_de_obra` | obligatoria, sus empresas y **sus áreas** |

| Código | Cuándo                                                                                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | Falta nombre o `categoriaId`; falta la adscripción; CURP mal formada; un administrativo sin áreas; contrato temporal con término anterior al ingreso; la categoría no corresponde al `tipo` |
| `403`  | `tipo: 'administrativo'` pedido por `rh_consulta` o `jefe_area`; o un `jefe_area` pidiendo un área que no es suya (el mensaje lista las suyas)                                              |
| `404`  | `empresaId` que no es suya, o `categoriaId` inexistente                                                                                                                                     |
| `409`  | Duplicado — ver abajo                                                                                                                                                                       |

#### Duplicados

```jsonc
// 409 con CURP repetida
{
  "status": "fail",
  "message": "Ya existe una persona registrada con esa CURP: Roberto Aguilar Sosa",
  "code": "CURP_DUPLICADA",
  "errors": [{ "msg": "Esa CURP ya está registrada", "path": "curp" }],
  "data": {
    "candidatos": [
      {
        "_id": "…",
        "nombre": "Roberto Aguilar Sosa",
        "curp": "AUSR…",
        "fechaNacimiento": null,
        "tipo": "mano_de_obra",
        "activo": true,
        "yaEstaEnTuEmpresa": true
      }
    ]
  }
}
```

- **`CURP_DUPLICADA`** no se puede forzar: es la identidad de la persona.
- **`POSIBLE_DUPLICADO`** aparece cuando no mandan CURP y hay alguien con el mismo
  nombre normalizado (y la misma `fechaNacimiento`, si la mandan). Para crear de
  todas formas: reenviar con `confirmarDuplicado: true`.
- **`yaEstaEnTuEmpresa`** decide el mensaje de la UI: «ya la tienes» o «existe en
  el grupo, ¿la adscribo?». Deliberadamente **no** decimos en qué otras empresas
  está.

### `PATCH /empleados/:id` — editar a la persona

**Quien puede dar de alta a alguien de un tipo puede también editarlo**: un
`rh_consulta` o un `jefe_area` corrige a su personal de obra sin pedírselo a un
administrador; a un administrativo, sólo `rh_admin`.

Acepta **estos nueve campos y ninguno más**: `nombre`, `curp`, `rfc`, `nss`,
`fechaNacimiento`, `email`, `telefono`, `categoriaId`, `tipo`.

```jsonc
// petición — sólo lo que cambia
{ "nombre": "Roberto Aguilar Sosa", "curp": "AUSR900101HJCGSB03", "telefono": "3312345678" }

// data — el RenglonEmpleado completo, igual que GET /empleados
{ "empleado": { "empleado": { … }, "categoriaNombre": "…", "adscripciones": [ … ], … } }
```

**Lo que NO se edita aquí**, y el error lo dice:

| Campo                               | Dónde va                              |
| ----------------------------------- | ------------------------------------- |
| `acceso`                            | `PATCH /empleados/:id/acceso`         |
| `activo`, `motivoBaja`, `fechaBaja` | `PATCH /empleados/:id/estado`         |
| empresa, contrato, áreas            | las adscripciones (su propio recurso) |

Mandar cualquiera de ellos devuelve `400` **con la ruta correcta en el mensaje**:
`"Estos campos no se pueden actualizar aquí: activo (usa PATCH /empleados/:id/estado)"`.

| Código | Cuándo                                                                                                                                                                            |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | Cuerpo vacío; campo no editable; formato inválido (`errors[].path` lo señala); la categoría no corresponde al `tipo`; volverlo administrativo cuando su adscripción no tiene área |
| `403`  | `rh_consulta` o `jefe_area`; o cambiar el `tipo` a `administrativo` sin poder crear administrativos                                                                               |
| `404`  | No existe o no es visible                                                                                                                                                         |
| `409`  | `CURP_DUPLICADA` — la CURP nueva ya es de otra persona, con el candidato en `data.candidatos`                                                                                     |

Detalles que importan para la UI:

- **Completar la CURP de un alta provisional es el caso principal**: se creó sin
  ella y aquí se agrega. Se normaliza a mayúsculas.
- **Corregir el nombre no se bloquea por duplicado**, a diferencia del alta:
  cambiar "Roberto Aguilar" por "Roberto Aguilar Sosa" es justo la corrección que
  se está haciendo. La identidad la cuida la CURP.
- **Vaciar un opcional**: mándenlo como `null` (nunca `""`).
- **Cambiar el `tipo`** exige mandar también una `categoriaId` del tipo nuevo, o
  responde `400`.

### `PATCH /empleados/:id/estado` — baja y reactivación

Sólo `rh_admin`. Baja **del sistema**, distinta de dejar una empresa (eso es dar
de baja la adscripción).

```jsonc
// baja
{ "activo": false, "motivo": "Renuncia voluntaria", "fecha": "2026-08-31" }  // fecha opcional, default hoy
// reactivación
{ "activo": true }
```

- **No borra nada**: el registro y su historial se conservan. Desaparece del
  listado normal y vuelve con `?incluirInactivos=true`.
- **El motivo es obligatorio** en la baja (5 a 200 caracteres).
- **Si tenía acceso a la plataforma, queda desactivado** en la misma operación —
  de todos modos no podría entrar, y dejarlo marcado como activo haría que la
  pantalla de accesos mintiera. La credencial no se borra.
- **Al reactivar, el acceso NO se restaura solo**: volver a dárselo es una
  decisión aparte (`PATCH /empleados/:id/acceso` con `activo: true`). El mensaje
  de la respuesta lo recuerda.
- `400` si intentan darse de baja a sí mismos o si dejaría al sistema sin
  administrador de plataforma activo.

### `POST /empleados/:id/acceso` → `201`

Da acceso a la plataforma a una persona que ya está en el catálogo.

```jsonc
// petición
{
  "email": "claudia@urbacames.com",
  "password": "Urbacames1!",
  "nivelAcceso": "rh_consulta",
  "alcanceGlobal": false // opcional
}
// data: { "empleado": { /* RenglonEmpleado — la misma forma que el listado */ } }
```

| Código | Cuándo                                                                        |
| ------ | ----------------------------------------------------------------------------- |
| `409`  | `'Esta persona ya tiene acceso a la plataforma. Edítalo en vez de crearlo.'`  |
| `400`  | Correo de acceso ya usado (`path: 'email'`), contraseña débil, nivel inválido |
| `400`  | `'No se puede dar acceso a una persona dada de baja'`                         |
| `400`  | `alcanceGlobal: true` con un nivel que no es `rh_admin`                       |
| `403`  | `alcanceGlobal: true` pidiéndolo sin ser administrador de plataforma          |
| `404`  | El empleado no existe o no es visible                                         |

### `PATCH /empleados/:id/acceso`

Acepta **sólo** `email`, `nivelAcceso`, `alcanceGlobal`, `activo`. La contraseña
no se cambia por aquí.

```jsonc
{ "nivelAcceso": "jefe_area", "activo": false }
// data: { "empleado": { /* RenglonEmpleado */ } }
```

`400` con la lista de campos no permitidos si mandan otro (incluido `password`),
si el cuerpo viene vacío, si dejaría al sistema sin administrador de plataforma
activo, o si alguien intenta desactivarse a sí mismo. `404` si esa persona no
tiene acceso.

### `DELETE /empleados/:id/acceso` → `204`

Quita el acceso: borra la credencial y deja `acceso: null`. **La persona, su
adscripción y su expediente quedan intactos**, y el correo queda libre para
alguien más. `400` si intentan quitarse el propio o si era el último administrador
de plataforma.

### `POST /empleados/:id/acceso/restablecer-password`

```jsonc
{ "password": "RepuestaPorRH9#" }
// data: { "empleado": { /* RenglonEmpleado */ } }
```

Un `rh_admin` repone la contraseña de otra persona. **Cierra las sesiones abiertas
de esa persona** y limpia su bloqueo y sus intentos fallidos. Es lo que hay hasta
que exista `POST /auth/recuperar`.

---

## 6. Casos de uso

### 6.1 Iniciar sesión

`POST /auth/login` → guardar `token` y `user`. Derivar permisos de
**`user.nivelAcceso`** y el universo de datos de **`user.empresas`** (o de
`alcanceGlobal`, que significa "todas").

### 6.2 Revalidar al arrancar

`GET /auth/me`. Cualquier error ⇒ limpiar sesión e ir a login. Rehidratar
permisos y empresas con la respuesta, no con lo que había guardado.

### 6.3 Sesión perdida a media navegación

Con 12 h de sesión y con la invalidación por cambio de contraseña, va a pasar:

```ts
apiClient.interceptors.response.use(
  (r) => r,
  (error) => {
    const status = error.response?.status
    const esLogin = error.config?.url?.includes('/auth/login')
    if (status === 401 && !esLogin) {
      window.localStorage.removeItem(AUTH_TOKEN_KEY)
      window.localStorage.removeItem(AUTH_USER_KEY)
      window.location.assign('/login')
    }
    return Promise.reject(error)
  }
)
```

Excluyan `/auth/login`: ahí el `401` es "credenciales incorrectas".

### 6.4 Pantalla de accesos (la que sustituye a la de usuarios)

Sólo visible para `nivelAcceso === 'rh_admin'`.

| Acción                     | Llamada                                           |
| -------------------------- | ------------------------------------------------- |
| Listar quién entra         | `GET /empleados?soloConAcceso=true`               |
| Buscar a quién dar acceso  | `GET /empleados?busqueda=…`                       |
| Dar acceso                 | `POST /empleados/:id/acceso`                      |
| Cambiar nivel o desactivar | `PATCH /empleados/:id/acceso`                     |
| Quitar acceso              | `DELETE /empleados/:id/acceso`                    |
| Reponer contraseña         | `POST /empleados/:id/acceso/restablecer-password` |

**El flujo cambia de forma, no sólo de ruta:** ya no hay un formulario que crea un
usuario desde cero. Primero se busca a la persona en el catálogo de empleados y
después se le concede acceso. Si no está en el catálogo, hay que darla de alta como
empleada — y `POST /empleados` todavía no existe, así que por ahora las personas
entran por la migración o por el `seed`.

### 6.5 Cambiar la propia contraseña

`POST /auth/cambiar-password` → **reemplazar el token guardado con el que
devuelve**. Si no lo hacen, la siguiente petición da `401` y parecerá un bug.

### 6.6 Jefe de área

Su `AuthUser` trae `empresas: [{ _id, nombre, areas }]`. Sus áreas son **por
empresa**: puede ser jefe de obra en una y de proyectos en otra. Para pintar la UI,
`areasEn(user, empresaId)`. El servidor ya filtra; ustedes sólo apagan botones.

### 6.7 Administrador de plataforma

`alcanceGlobal: true` ve todas las empresas y es el único que puede dar de alta en
los catálogos compartidos (empleados, clientes, categorías) y otorgar alcance
global a alguien más. Puede tener `empresas: []` y aun así verlo todo: **no usen
`empresas.length === 0` como "no tiene acceso a nada"**.

---

## 7. Validaciones para replicar en los formularios

| Campo            | Regla                                                     | Mensaje del servidor                                                                                 |
| ---------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `email` (acceso) | correo válido, único entre todos los accesos              | `'Escribe un correo válido'` / `'Ya existe un acceso con ese correo'`                                |
| `password`       | ≥ 8, con mayúscula, minúscula, dígito y uno de `!@#$%^&*` | `'La contraseña necesita una mayúscula, una minúscula, un número y uno de estos símbolos: !@#$%^&*'` |
| `nivelAcceso`    | `rh_admin` \| `rh_consulta` \| `jefe_area`                | `'Selecciona un nivel de acceso válido'`                                                             |
| `alcanceGlobal`  | sólo con `nivelAcceso: 'rh_admin'`                        | `'El alcance global sólo se puede dar a un administrador de RH'`                                     |

```ts
const PATRON_PASSWORD = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[!@#$%^&*]).*$/
```

---

## 8. Checklist de migración del front

- [ ] `VITE_API_BASE_URL` → `http://localhost:8080/api/v1`.
- [ ] `AuthUser`: quitar `role`, `area`, `alcance`, `clienteId`; agregar
      `nivelAcceso`, `alcanceGlobal`, `empresas[]`.
- [ ] Borrar `accessLevelFromRole` y leer `nivelAcceso`.
- [ ] Reescribir `users-service.ts` contra `/empleados` y el sub-recurso `acceso`.
- [ ] Rehacer la pantalla de usuarios como **pantalla de accesos**: buscar persona
      → conceder acceso.
- [ ] Guardar el **token nuevo** que devuelve `cambiar-password`.
- [ ] Interceptor global de `401` (excluyendo `/auth/login`).
- [ ] Manejar la paginación de `/empleados` (`total`, `pagina`, `porPagina`).
- [ ] Quitar cualquier llamada a `/usuarios` y a `/auth/register`.
- [ ] Dejar `VITE_USE_MOCKS=true`.
- [ ] Ajustar los tests que esperaban `data.users` y `role`.

Cuando migremos a los usuarios reales, **sus contraseñas no cambian**: el hash se
copia tal cual. Ya está probado con los usuarios que existían.

---

## 9. Lo que todavía no existe

| Ruta                                                         | Para qué                         | Spec |
| ------------------------------------------------------------ | -------------------------------- | ---- |
| `POST/PATCH /empleados`, `PATCH /empleados/:id/estado`       | Alta, edición y baja de personas | 6.2  |
| `GET /empleados/:id/{expediente,adscripciones,asignaciones}` | Detalle de la persona            | 6.2  |
| `GET/POST /clientes`, `/categorias`                          | Catálogos compartidos            | 6.2  |
| `GET/POST /empresas`                                         | Empresas                         | 6.3  |
| `GET/POST /adscripciones`, `/carteras`                       | Vínculos                         | 6.3  |
| `GET/POST /proyectos`, `/asignaciones`                       | Proyectos y su personal          | 6.4  |
| `/expedientes/…`                                             | Expedientes y documentos         | 6.5  |
| `/alertas`, `/dashboard/metricas`, `/reportes/…`             | Derivados                        | 6.6  |
| `POST /auth/recuperar`, `/restablecer`                       | Olvidé mi contraseña             | 6.1  |

### Lo que necesitamos que decidan

1. **¿El expediente se comparte entre empresas del grupo?** El modelo dice que sí
   (es de la persona). Si tiene que ser uno por empresa, **cambia el modelo** y hay
   que saberlo antes de implementar expedientes.
2. **¿La CURP es obligatoria desde el alta?** Está implementada como opcional, con
   la regla de que no se puede validar el expediente de alguien sin ella.
3. **¿El empleado sube sus propios documentos?** Añadiría un cuarto nivel de acceso
   y un flujo de invitación por token.

---

## 10. Probar sin front

```bash
BASE=http://localhost:8080/api/v1

TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"alexxruff@yahoo.com","password":"1234"}' | jq -r .data.token)

curl -s $BASE/auth/me -H "Authorization: Bearer $TOKEN" | jq .data.user

# Listado paginado
curl -s "$BASE/empleados?porPagina=5" -H "Authorization: Bearer $TOKEN" \
  | jq '{total: .data.total, gente: [.data.empleados[].empleado.nombre]}'

# Sólo quienes entran a la plataforma
curl -s "$BASE/empleados?soloConAcceso=true" -H "Authorization: Bearer $TOKEN" \
  | jq '[.data.empleados[] | {nombre: .empleado.nombre, acceso: .empleado.acceso.nivelAcceso}]'

# Dar acceso a alguien del catálogo
ID=$(curl -s "$BASE/empleados?porPagina=1" -H "Authorization: Bearer $TOKEN" | jq -r .data.empleados[0].empleado._id)
curl -s -X POST $BASE/empleados/$ID/acceso -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"email":"nuevo@urbacames.com","password":"Urbacames1!","nivelAcceso":"rh_consulta"}' | jq .message
```

---

## Referencias

| Qué                                               | Dónde                             |
| ------------------------------------------------- | --------------------------------- |
| **Ajustes concretos que debe hacer el front**     | `docs/CAMBIOS-FRONTEND.md`        |
| Carteras, proyectos y asignaciones                | `docs/ENDPOINTS-PROYECTOS.md`     |
| Expedientes: listado, consulta, subida y revisión | `docs/ENDPOINTS-EXPEDIENTES.md`   |
| Adscripciones: vincular a alguien que ya existe   | `docs/ENDPOINTS-ADSCRIPCIONES.md` |
| Importar colaboradores desde el .xlsx de nómina   | `docs/ENDPOINTS-IMPORTACION.md`   |
| Modelo de datos autoritativo                      | `docs/modelo-datos.md`            |
| Contrato de API y catálogo de rutas               | `docs/backend-spec.md`            |
| Endpoints implementados, al detalle               | `docs/CONTRATO-API.md`            |
| Decisiones y por qué de cada regla                | `docs/DECISIONES.md`              |
| Qué está hecho y qué falta                        | `docs/ESTADO.md`                  |
