# Ajustes que necesita el front — modelo de empresas

Delta sobre el front **tal como está hoy** (ya aplicó la integración anterior:
`nivelAcceso`, `alExpirarSesion`, `cambiarPasswordRequest`). Aquí sólo está lo que
cambia con el modelo nuevo de `modelo-datos.md`.

El contrato completo, con todos los endpoints y su catálogo de errores, está en
[`INTEGRACION-FRONTEND.md`](./INTEGRACION-FRONTEND.md). Este documento es la lista
de trabajo.

---

## Respuesta a su solicitud del alta (2026-08-21)

**Ya está implementado.** `POST /empresas`, `GET/POST /categorias` y
`POST /empleados` (con adscripción, en transacción) responden en el servidor, con
la matriz de permisos corregida. Verificado de punta a punta: crear empresa →
categoría → empleado → darle acceso → ese empleado entra y ve su empresa y su área.

### Sus tres preguntas, respondidas

**1. ¿Alta y adscripción en una transacción, o dos llamadas?** → **Transacción**,
como propusieron. `POST /empleados` crea persona y adscripción, o no crea nada.

Con una corrección: la adscripción es **obligatoria también para `rh_admin`**,
no sólo para `rh_consulta` y `jefe_area`. Su documento la dejaba opcional ahí, pero
un `rh_admin` sin `alcanceGlobal` que la omita crea una persona **que él mismo no
puede ver** — el mismo problema que vinieron a reportar, un nivel más abajo. Sólo
el administrador de plataforma puede omitirla, porque él sí ve todo.

Y hay un tercer nivel del mismo hueco que cerramos: un `jefe_area` tiene que
indicar **al menos un área de las suyas**. Si no, la persona nace fuera de su
filtro de áreas y tampoco la ve. Área ajena → `403` con la lista de las suyas;
ninguna área → `400` explicando por qué.

**2. ¿Cómo resolvemos el duplicado sin CURP?** → **Como propusieron.** `409` con
`data.candidatos` y `confirmarDuplicado: true` para forzar. Dos detalles:

- La **CURP repetida no se puede forzar** (`409 CURP_DUPLICADA` siempre): es la
  identidad de la persona.
- De cada candidato devolvemos `_id`, `nombre`, `curp`, `fechaNacimiento`, `tipo`,
  `activo` y **`yaEstaEnTuEmpresa`**. No listamos en qué empresas trabaja: el
  catálogo es compartido, pero eso no es información de otra empresa.
  `yaEstaEnTuEmpresa` es lo que necesitan para elegir entre «ya la tienes» y
  «existe en el grupo, ¿la adscribo?».

**3. ¿Los conteos de la tarjeta de empresa vienen del servidor?** → **Sí.**
`GET /empresas` devuelve `conteos` resueltos con agregación, sin N+1. Hoy
`empleados` trae el número real; `clientes`, `proyectosActivos` y
`alertasPendientes` vienen en **`null`** —no en `0`— porque esos módulos aún no
existen: `0` diría «no tiene ninguno» y sería mentira. Cuando existan se llenan
sin cambiar la forma.

### Dos cosas que cambiamos de su especificación

**`activo`, no `activa`.** Su ejemplo de `POST /empresas` usaba `"activa": true`.
Respondemos **`activo`**, igual que en todas las demás colecciones. Si la UI ya
lee `activa`, falla en silencio.

**`categorias.tipo` se agregó** (no estaba en el modelo) y **se valida la
coherencia**: dar de alta a alguien de obra con una categoría administrativa
responde `400`. Es lo que hace que su desplegable filtrado signifique algo.

### También quedó lista la edición

`PATCH /empleados/:id` (datos de la persona) y `PATCH /empleados/:id/estado`
(baja con motivo y reactivación). Ojo: la baja **no existía** —la tenían por
hecha— y ahora sí. El detalle está en `INTEGRACION-FRONTEND.md` §5.

Dos cosas que necesitan saber:

- **Quien puede dar de alta puede también editar ese mismo tipo de persona**
  (confirmado con Urbacames). Un `rh_consulta` o un `jefe_area` corrige su
  personal de obra sin pedírselo a un administrador; a un administrativo, sólo
  `rh_admin`. Lo que no se abrió: **cambiar el `tipo`** a administrativo exige
  poder crear administrativos, y **la baja del sistema sigue siendo de
  `rh_admin`** — corregir datos y sacar a alguien del sistema no son la misma
  decisión. Para la UI: el botón de editar se muestra igual que el de dar de alta
  de ese `tipo`; el de dar de baja, sólo a `rh_admin`.
- Al dar de baja a alguien, su acceso a la plataforma queda desactivado; al
  reactivarlo, **no** se le devuelve solo.

### Lo que sigue pendiente de su lista

Prioridad 2 en adelante: `GET/POST /clientes`, `GET/POST /carteras`,
`POST /adscripciones` (suelto, para mover gente sin recrearla) y proyectos.
Dígannos si el orden cambia.

---

## Lo que cambió, en tres frases

1. **El usuario de la plataforma es un empleado con `acceso`.** No hay colección
   de usuarios: dar acceso es agregarle un subdocumento a una persona que ya está
   en el catálogo. Por eso `/usuarios` desaparece y su lugar lo toma
   `/empleados/:id/acceso`.
2. **El alcance es por empresa y se deriva de las adscripciones.** `area` (una
   sola) y `alcance`/`clienteId` desaparecen del `AuthUser`; llega
   `empresas: [{ _id, nombre, areas }]` y `alcanceGlobal`.
3. **Cambiar la contraseña invalida las sesiones abiertas** y devuelve un token
   nuevo que hay que guardar.

### Lo que NO hay que tocar todavía

El resto del modelo —`Empleado.empresaId`, `Cliente.empresaId`, categorías por
empresa, `Empleado.proyectos`— **también cambia**, pero **no hay endpoints
todavía**. Esas pantallas siguen con `VITE_USE_MOCKS=true` y se migran cuando
avisemos. Está listado al final para que lo tengan en el radar, no para hacerlo
ahora.

---

## 0. Antes de empezar

```dotenv
VITE_API_BASE_URL=http://localhost:8080/api/v1
VITE_USE_MOCKS=true
```

Credenciales de desarrollo: `alexxruff@yahoo.com` / `1234` (es `rh_admin` con
`alcanceGlobal: true`).

Lo que responde el servidor hoy, verificable con
`curl -s http://localhost:8080/api/v1 | jq '.data.implementados'`:

`/auth/login` · `/auth/me` · `/auth/logout` · `/auth/cambiar-password` ·
`GET /empleados` · `GET /empleados/:id` ·
`POST|PATCH|DELETE /empleados/:id/acceso` ·
`POST /empleados/:id/acceso/restablecer-password` · `/health` · `/ready` ·
`GET /api/v1`

`/usuarios` responde **410** con las rutas nuevas en el mensaje.

---

## 1. `src/interfaces/auth-user.ts`

Salen `role`, `area`, `alcance` y `clienteId`. Entran `alcanceGlobal` y
`empresas`.

```ts
import type { AccessLevel } from '@/enums/access-level'
import type { Area } from '@/enums/area'

/** Empresa donde la persona tiene adscripción activa, con sus áreas ahí. */
export interface EmpresaDeUsuario {
  _id: string
  nombre: string
  areas: Area[]
}

/** Usuario de la plataforma: un empleado con acceso. */
export interface AuthUser {
  /** Id del EMPLEADO. */
  _id: string
  name: string
  /** El correo de acceso, que puede diferir del correo de contacto. */
  email: string
  nivelAcceso: AccessLevel
  /** Administrador de plataforma: ve todas las empresas y los catálogos. */
  alcanceGlobal: boolean
  /** Vacío en un administrador de plataforma, y no significa "sin acceso". */
  empresas: EmpresaDeUsuario[]
  active: boolean
  ultimoAccesoEn: string | null
  createdAt: string
  updatedAt: string
}
```

`src/enums/user-role.ts` queda sin usarse: **bórrenlo** junto con su línea en
`src/enums/index.ts`. El backend ya no manda `role`.

---

## 2. `src/utils/access-level.ts`

El respaldo por `role` deja de compilar (el campo ya no existe) y no hace falta:
`nivelAcceso` siempre viene.

```ts
import { AccessLevel } from '@/enums/access-level'
import type { Area } from '@/enums/area'
import type { AuthUser } from '@/interfaces/auth-user'

export function accessLevelOf(user: AuthUser | null | undefined): AccessLevel {
  return user?.nivelAcceso ?? AccessLevel.RhConsulta
}

export function canManageUsers(user: AuthUser | null | undefined): boolean {
  return accessLevelOf(user) === AccessLevel.RhAdmin
}

/** Administrador de plataforma: catálogos compartidos y todas las empresas. */
export function esAdminPlataforma(user: AuthUser | null | undefined): boolean {
  return Boolean(user?.alcanceGlobal)
}

/** Áreas del usuario EN UNA empresa. Un jefe puede tener distintas en cada una. */
export function areasEn(user: AuthUser | null | undefined, empresaId: string): Area[] {
  return user?.empresas.find((e) => e._id === empresaId)?.areas ?? []
}

/** Empresas donde puede trabajar. Para el admin de plataforma, son todas. */
export function empresasDe(user: AuthUser | null | undefined): EmpresaDeUsuario[] {
  return user?.empresas ?? []
}
```

> **Cuidado con un atajo que va a salir mal:** `empresas.length === 0` **no**
> significa "no tiene acceso a nada". Un administrador de plataforma puede no
> tener ninguna adscripción y aun así verlo todo. La pregunta correcta es
> `esAdminPlataforma(user) || user.empresas.length > 0`.

---

## 3. `src/utils/permisos.ts`

La matriz sigue siendo la fuente única del front, pero cambia en tres puntos
(modelo-datos §8.2):

| Cambio                                | Detalle                                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `gestionarProyectos` para `jefe_area` | **Ahora sí puede**: crear, cerrar y asignar personal a proyectos                                           |
| Nuevo: `adscribirEmpleados`           | Vincular una persona del catálogo a su empresa. Sólo `rh_admin`                                            |
| Nuevo: `altaEnCatalogosCompartidos`   | Dar de alta empleados, clientes o categorías **globales**. Sólo `rh_admin` **con `alcanceGlobal`**         |
| `gestionarClientes` se parte en dos   | Alta en el catálogo global (exige `alcanceGlobal`) vs. gestionar la **cartera** de su empresa (`rh_admin`) |
| `limitadoASuArea`                     | Sigue igual, pero las áreas son **por empresa**: úsenlo con `areasEn(user, empresaId)`                     |

Como `altaEnCatalogosCompartidos` depende de `alcanceGlobal` y no sólo del nivel,
la función que consulta la matriz necesita el usuario completo, no el nivel:

```ts
export function permisosDe(user: AuthUser | null | undefined): Permisos {
  const base = MATRIZ[accessLevelOf(user)]
  return {
    ...base,
    altaEnCatalogosCompartidos: base.altaEnCatalogosCompartidos && esAdminPlataforma(user)
  }
}
```

---

## 4. `src/modules/auth/auth-service.ts`

`cambiarPasswordRequest` ahora devuelve **usuario y token**.

```ts
export interface CambioPasswordResult {
  user: AuthUser
  token: string
}

export function cambiarPasswordRequest(
  passwordActual: string,
  passwordNueva: string
): Promise<CambioPasswordResult> {
  return request<CambioPasswordResult>(
    {
      url: '/auth/cambiar-password',
      method: 'POST',
      data: { passwordActual, passwordNueva }
    },
    'No pudimos cambiar la contraseña.'
  )
}
```

---

## 5. `src/modules/auth/auth-provider.tsx`

Dos cambios, y el primero es **el que más duele si se olvida**.

### 5.1 Guardar el token nuevo al cambiar la contraseña

Hoy el provider dice _"El token sigue siendo válido; sólo refrescamos al
usuario"_. **Ya no es cierto:** el cambio invalida todas las sesiones, incluida la
que hizo la petición. Sin esto, la siguiente petición da `401` y parece un bug del
backend.

```ts
const cambiarPassword = useCallback(async (actual: string, nueva: string) => {
  const { user: actualizado, token: tokenNuevo } = await cambiarPasswordRequest(
    actual,
    nueva
  )
  // El cambio cerró las demás sesiones: el token anterior ya no sirve.
  window.localStorage.setItem(AUTH_TOKEN_KEY, tokenNuevo)
  window.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(actualizado))
  setToken(tokenNuevo)
  setUser(actualizado)
}, [])
```

### 5.2 `area` sale del contexto; entran empresas

```ts
interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  accessLevel: AccessLevel;
  /** Empresas donde tiene adscripción activa. Vacío en el admin de plataforma. */
  empresas: EmpresaDeUsuario[];
  /** Ve todas las empresas y administra los catálogos compartidos. */
  esAdminPlataforma: boolean;
  isAuthenticated: boolean;
  isReady: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => void;
  cambiarPassword: (actual: string, nueva: string) => Promise<void>;
}

// en el value:
empresas: user?.empresas ?? [],
esAdminPlataforma: esAdminPlataforma(user),
```

Quien usara `area` del contexto (el jefe de área) pasa a `areasEn(user, empresaId)`
con la empresa que esté viendo.

> **Empresa activa.** Si alguien pertenece a dos empresas, la interfaz necesita
> decidir en cuál está trabajando: un selector en la barra superior y ese
> `empresaId` viaja como filtro (`GET /empleados?empresaId=…`). El backend lo usa
> para **acotar**, nunca para ampliar: si mandan una empresa que no es suya,
> responde `404`. Dígannos qué prefieren y lo dejamos fijo en el contrato.

---

## 6. `src/modules/users/` → módulo de accesos

Es el cambio de fondo. **El flujo ya no es "crear un usuario"**, es _buscar a la
persona en el catálogo y concederle acceso_.

### 6.1 Servicio nuevo

Sugerencia: renombrar el módulo a `src/modules/accesos/` y el servicio a
`accesos-service.ts`.

```ts
import { request } from '@/lib/api-client'
import type { AccessLevel } from '@/enums/access-level'
import type { RenglonEmpleado } from '@/interfaces/empleado'

export interface ListadoEmpleados {
  total: number
  pagina: number
  porPagina: number
  empleados: RenglonEmpleado[]
}

export interface FiltrosEmpleados {
  busqueda?: string // nombre o número de empleado (D-51)
  empresaId?: string
  area?: string
  tipo?: 'administrativo' | 'mano_de_obra'
  categoriaId?: string // D-51
  soloConAcceso?: boolean
  activo?: 'true' | 'false' | 'todos' // reemplaza a incluirInactivos (D-51)
  orden?: 'nombre_asc' | 'nombre_desc' | 'numero_asc' | 'numero_desc' // numero_* funciona con o sin empresaId (D-53)
  pagina?: number
  porPagina?: number
}

/** Listado paginado. El orden se calcula en el servidor sobre el total. */
export function fetchEmpleados(
  filtros: FiltrosEmpleados = {}
): Promise<ListadoEmpleados> {
  return request<ListadoEmpleados>(
    { url: '/empleados', method: 'GET', params: filtros },
    'No pudimos cargar el personal.'
  )
}

export interface DarAccesoPayload {
  email: string
  password: string
  nivelAcceso: AccessLevel
  /** Sólo un administrador de plataforma puede pedirlo, y sólo sobre rh_admin. */
  alcanceGlobal?: boolean
}

export function darAcceso(
  empleadoId: string,
  payload: DarAccesoPayload
): Promise<RenglonEmpleado['empleado']> {
  return request<{ empleado: RenglonEmpleado['empleado'] }>(
    { url: `/empleados/${empleadoId}/acceso`, method: 'POST', data: payload },
    'No pudimos dar el acceso.'
  ).then((d) => d.empleado)
}

/** Sólo email, nivelAcceso, alcanceGlobal y activo. La contraseña NO va aquí. */
export function actualizarAcceso(
  empleadoId: string,
  payload: Partial<Omit<DarAccesoPayload, 'password'>> & { activo?: boolean }
): Promise<RenglonEmpleado['empleado']> {
  return request<{ empleado: RenglonEmpleado['empleado'] }>(
    { url: `/empleados/${empleadoId}/acceso`, method: 'PATCH', data: payload },
    'No pudimos actualizar el acceso.'
  ).then((d) => d.empleado)
}

/** Quita el acceso. La persona y su expediente quedan intactos. */
export function quitarAcceso(empleadoId: string): Promise<void> {
  return request<void>(
    { url: `/empleados/${empleadoId}/acceso`, method: 'DELETE' },
    'No pudimos quitar el acceso.'
  )
}

export function restablecerPassword(
  empleadoId: string,
  password: string
): Promise<RenglonEmpleado['empleado']> {
  return request<{ empleado: RenglonEmpleado['empleado'] }>(
    {
      url: `/empleados/${empleadoId}/acceso/restablecer-password`,
      method: 'POST',
      data: { password }
    },
    'No pudimos restablecer la contraseña.'
  ).then((d) => d.empleado)
}
```

Los tipos `Empleado`, `AdscripcionDeEmpleado` y `RenglonEmpleado` están completos
en `INTEGRACION-FRONTEND.md` §4, listos para pegar en
`src/interfaces/empleado.ts`.

### 6.2 La pantalla

| Antes                                                       | Ahora                                                                                                                              |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Tabla de usuarios + botón «Nuevo usuario»                   | Tabla de **accesos** (`?soloConAcceso=true`) + botón «Dar acceso»                                                                  |
| Formulario con nombre, correo, contraseña, nivel y **área** | Buscar persona en el catálogo → correo de acceso, contraseña y nivel. **Sin área**: las áreas son de la adscripción, no del acceso |
| «Dar de baja» al usuario                                    | «Quitar acceso» (la persona sigue siendo empleada)                                                                                 |
| «Reactivar»                                                 | `PATCH … { activo: true }`                                                                                                         |
| —                                                           | «Restablecer contraseña» (cierra las sesiones de esa persona)                                                                      |

`user-form-dialog.tsx` se parte en dos pasos: **selector de persona** (busca en
`GET /empleados?busqueda=`) y **datos del acceso**. Quiten el campo de área del
formulario.

Errores que la UI debe mostrar tal cual, porque son los que va a ver a diario:

- `409` — «Esta persona ya tiene acceso a la plataforma. Edítalo en vez de
  crearlo.»
- `400` con `path: 'email'` — el correo de acceso ya está en uso.
- `400` — «No puedes quitarte tu propio acceso» / «Debe quedar al menos un
  administrador de plataforma activo…»
- `403` — pedir `alcanceGlobal` sin ser administrador de plataforma.

> **Límite de hoy, y es importante para el diseño:** todavía **no existe
> `POST /empleados`**, así que desde la UI no se puede dar de alta a una persona
> nueva; sólo conceder acceso a quien ya está en el catálogo. Mientras tanto las
> personas entran por migración o semilla. Si la pantalla necesita el alta
> completa para tener sentido, dígannoslo y subimos `POST /empleados` de
> prioridad.

---

## 7. `src/test/utilidades.tsx` — fixtures

```ts
export const USUARIO_ADMIN: AuthUser = {
  _id: 'emp-admin',
  name: 'Marisol Avila',
  email: 'marisol@urbacames.com',
  nivelAcceso: AccessLevel.RhAdmin,
  alcanceGlobal: false,
  empresas: [{ _id: 'emp-1', nombre: 'Urbacames Edificación', areas: [] }],
  active: true,
  ultimoAccesoEn: '2026-08-21T15:13:42.119Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

export const USUARIO_ADMIN_PLATAFORMA: AuthUser = {
  ...USUARIO_ADMIN,
  _id: 'emp-global',
  alcanceGlobal: true,
  empresas: [] // ve todo aunque no tenga ninguna
}

export function usuarioJefeDeArea(area: Area): AuthUser {
  return {
    ...USUARIO_ADMIN,
    _id: 'emp-jefe',
    name: 'Rodrigo Nunez',
    email: 'rodrigo@urbacames.com',
    nivelAcceso: AccessLevel.JefeArea,
    empresas: [{ _id: 'emp-1', nombre: 'Urbacames Edificación', areas: [area] }]
  }
}
```

Vale la pena agregar un caso de `USUARIO_ADMIN_PLATAFORMA`: es el que rompe el
atajo de `empresas.length === 0`.

---

## 8. Checklist, en orden

Los primeros cinco son mecánicos y desbloquean la compilación; el resto es la
pantalla.

- [ ] `auth-user.ts`: quitar `role`, `area`, `alcance`, `clienteId`; agregar
      `alcanceGlobal` y `empresas`.
- [ ] Borrar `src/enums/user-role.ts` y su export en `src/enums/index.ts`.
- [ ] `access-level.ts`: quitar el respaldo por `role`; agregar
      `esAdminPlataforma`, `areasEn`, `empresasDe`.
- [ ] `auth-provider.tsx`: guardar el **token nuevo** de `cambiarPassword`;
      cambiar `area` por `empresas` + `esAdminPlataforma`.
- [ ] `auth-service.ts`: `cambiarPasswordRequest` devuelve `{ user, token }`.
- [ ] `permisos.ts`: proyectos para `jefe_area`, `adscribirEmpleados`,
      `altaEnCatalogosCompartidos` con `alcanceGlobal`.
- [ ] `src/interfaces/empleado.ts` nuevo (tipos de §4 de la otra guía).
- [ ] `users-service.ts` → `accesos-service.ts` contra `/empleados`.
- [ ] Pantalla de accesos: buscar persona → dar acceso; paginación de
      `/empleados`; quitar/restablecer.
- [ ] Fixtures y tests que usaban `role`, `area` o `data.usuarios`.
- [ ] Verificar que ninguna llamada apunte a `/usuarios` (da 410) ni a
      `/auth/register`.
- [ ] Decidir el selector de **empresa activa** si van a soportar multi-empresa
      en la interfaz.

---

## 9. Lo que llega después (no lo hagan ahora)

Cuando existan los endpoints, avisamos y coordinamos. Va aquí para que no les
tome por sorpresa:

| Qué cambia                                                                  | Detalle                                                                                                        |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `Empleado.empresaId`                                                        | Desaparece. La relación pasa a `adscripciones`, y una persona puede tener varias                               |
| `Empleado.areas` / `tipoContrato` / `fechaIngreso` / `fechaTerminoContrato` | Se mudan a la adscripción, una por empresa                                                                     |
| `Cliente.empresaId`                                                         | Desaparece: el cliente es global y se vincula por **cartera**                                                  |
| Categorías por empresa                                                      | Pasan a ser un catálogo global                                                                                 |
| `Empleado.proyectos: string[]`                                              | Pasa a `asignaciones` con categoría y fechas                                                                   |
| Pantallas nuevas                                                            | Catálogos compartidos, adscribir a una empresa, vincular cliente a cartera, asignar personal desde el proyecto |

Y una decisión de producto que **bloquea los expedientes**: ¿el expediente se
comparte entre empresas del grupo (es de la persona) o cada empresa tiene el suyo?
El modelo actual dice lo primero. Si Urbacames necesita lo segundo, cambia el
modelo y hay que saberlo antes de que lo implementemos.

---

## 10. Cómo probarlo mientras desarrollan

```bash
# El backend, con su base local
npm run db:up && npm run dev     # en el repo del backend

BASE=http://localhost:8080/api/v1
TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"alexxruff@yahoo.com","password":"1234"}' | jq -r .data.token)

# El AuthUser nuevo, tal cual les va a llegar
curl -s $BASE/auth/me -H "Authorization: Bearer $TOKEN" | jq .data.user

# El listado paginado
curl -s "$BASE/empleados?porPagina=5" -H "Authorization: Bearer $TOKEN" | jq .data

# Quiénes entran a la plataforma
curl -s "$BASE/empleados?soloConAcceso=true" -H "Authorization: Bearer $TOKEN" \
  | jq '[.data.empleados[] | {nombre: .empleado.nombre, nivel: .empleado.acceso.nivelAcceso}]'
```

Si algo no coincide con este documento, es un bug nuestro: mándennos el
`X-Request-Id` de la respuesta y lo buscamos en los logs.
