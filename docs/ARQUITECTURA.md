# Arquitectura

## Panorama

```
Front (React, ya terminado)
  │  fetch  Authorization: Bearer <jwt>
  ▼
Express  ─ helmet · cors · compression · requestContext · rate limit
  │
  ├─ /api/v1/auth        (login público, resto con sesión)
  ├─ /api/v1/usuarios    protect → applyScope → requireCapability
  └─ …
  │
  ▼
Routes → Validations → Controller → Service → Model → MongoDB
                            │          │
                            │          └─ utils/domain (funciones puras)
                            └─ utils/response (envelope)
  │
  ▼
errorHandler  →  { status, message, errors?, data: null }
```

## Las cuatro capas

| Capa        | Archivo            | Responsabilidad                              | Lo que NO hace                  |
| ----------- | ------------------ | -------------------------------------------- | ------------------------------- |
| Rutas       | `<x>Routes.js`     | Método, ruta, middlewares, validaciones      | Lógica                          |
| Controlador | `<x>Controller.js` | Leer `req`, llamar al servicio, responder    | Consultar Mongo, decidir reglas |
| Servicio    | `<x>Service.js`    | Reglas de negocio, transacciones, `AppError` | Saber que existe HTTP           |
| Modelo      | `<x>Model.js`      | Esquema, invariantes, índices, `toJSON`      | Reglas de flujo                 |

Las reglas de dominio calculables (avance, semáforo, vigencias, alertas,
checklist) viven en `src/utils/domain/` como **funciones puras**, no en los
servicios: así se prueban sin base de datos y sin HTTP, que es donde están los
casos borde que el front ya tiene probados.

## Ciclo de una petición

1. `requestContext` asigna un `X-Request-Id` y un logger hijo con ese id.
2. `apiLimiter` aplica el límite de peticiones.
3. `protect` verifica el JWT y **relee al usuario de la base** (revocar acceso
   surte efecto de inmediato, no al expirar el token).
4. `applyScope` deja `req.scopeFilter`, `req.areaFilter`, `req.dataFilter` y
   `req.ownerClienteId`.
5. `requireCapability` contrasta con la matriz de `utils/permissions.js`.
6. Las validaciones de `express-validator` + `validateRequest` traducen los
   fallos al formato `errors[{ msg }]`.
7. El controlador (envuelto en `asyncHandler`) llama al servicio y responde con
   `utils/response`.
8. Cualquier error llega a `errorHandler`, que lo traduce a HTTP + envelope.

## Idiomas

Regla: **el contrato manda en español, el código en inglés.**

| Superficie              | Idioma  | Ejemplos                                             |
| ----------------------- | ------- | ---------------------------------------------------- |
| Rutas                   | español | `/usuarios`, `/expedientes`, `/plantillas-checklist` |
| Llaves JSON del dominio | español | `nivelAcceso`, `vigenciaHasta`, `clienteId`          |
| Valores de enums        | español | `rh_admin`, `obra_determinada`, `documento_faltante` |
| Mensajes al usuario     | español | `'Escribe un correo válido'`                         |
| Código                  | inglés  | `userService.deactivate`, `scopeFilter`, `addMonths` |
| Colecciones             | inglés  | `app_users`, `records`, `checklist_templates`        |
| Campos internos         | inglés  | `nameNormalized`                                     |

Los campos de los esquemas **espejan el contrato**: donde el JSON dice
`nivelAcceso`, el campo se llama `nivelAcceso`. Es deliberado: una capa de
traducción entre esquema y respuesta obligaría a mapear también cada filtro,
cada índice y cada proyección, y ahí es donde se cuelan los errores.

| Modelo              | Colección             | Nombre en el spec      |
| ------------------- | --------------------- | ---------------------- |
| `User`              | `app_users`           | `usuarios`             |
| `Client`            | `clients`             | `clientes`             |
| `Employee`          | `employees`           | `colaboradores`        |
| `Record`            | `records`             | `expedientes`          |
| `ChecklistTemplate` | `checklist_templates` | `plantillas_checklist` |
| `AccessLog`         | `access_logs`         | `bitacora_accesos`     |

## Modelo multi-cliente

Hoy Urbacames gestiona a sus propios colaboradores. Mañana un **cliente** —otra
empresa— entra a la plataforma y ve a "sus" trabajadores como propios. Para que
eso no exija migrar nada:

- Existe la colección `clients` desde ahora, aunque esté vacía.
- Todo documento que pertenece a alguien lleva
  `clienteId: ObjectId | null`, donde **`null` = Urbacames** (la casa).
- Cada usuario tiene un `alcance`: `interno` (ve todo) o `cliente` (ve sólo el
  suyo), con `clienteId` obligatorio en el segundo caso.
- `scopeMiddleware` construye el filtro una sola vez por petición y **ningún
  servicio consulta sin él**. El `clienteId` jamás se lee del body ni del query.
- En `records` el `clienteId` va **desnormalizado** desde el colaborador: casi
  todas las consultas del producto empiezan por expediente, y así se evita un
  `$lookup` por consulta. El precio es mantener la copia sincronizada cuando un
  colaborador cambia de cliente.

En fase 1 todos los usuarios son `interno` y el filtro es `{}`. El middleware
existe **y está probado** (`tests/integracion/scope.test.js`) desde el primer día
para que activar la fase 2 no obligue a revisar cada consulta.

## Permisos

`utils/permissions.js` tiene la matriz del spec §8 como fuente única. Las rutas
piden **capacidades**, no niveles:

```js
requireCapability(CAPABILITIES.MANAGE_USERS)
```

`'own_area'` no es un booleano: es un permiso con filtro, y se traduce a
`req.areaFilter`. Para un jefe de área de un cliente aplican los dos filtros.

## Configuración y arranque

- `config/env.js` valida el entorno con zod y **mata el proceso** si falta algo.
  Nadie más lee `process.env`.
- `config/database.js` conecta con reintentos y backoff; si agota los intentos,
  **rechaza**, y el servidor no empieza a escuchar sin base de datos.
- `server.js` apaga ordenadamente en SIGTERM/SIGINT: deja de aceptar conexiones,
  termina lo que está en curso y cierra Mongo, con un límite de 10 s.

## Observabilidad

- Logs JSON a stdout en producción, legibles en desarrollo, callados en pruebas
  (`LOG_VERBOSE=true` los activa).
- `X-Request-Id` de ida y vuelta: el front puede citarlo y se encuentra la
  petición completa en los logs.
- `GET /api/v1/health` (liveness, no toca la base) y `GET /api/v1/ready`
  (readiness, 503 si Mongo no está listo).
