# Contrato de la API

Referencia interna y breve. El detalle por endpoint —peticiones, respuestas y
catálogo de errores— vive en
[`INTEGRACION-FRONTEND.md`](./INTEGRACION-FRONTEND.md), que es el documento que se
le entrega al front; aquí no se duplica para que no se desincronicen.

- **Modelo autoritativo:** [`modelo-datos.md`](./modelo-datos.md)
- **Contrato y catálogo completo de rutas:** [`backend-spec.md`](./backend-spec.md)
- **Estado de implementación:** [`ESTADO.md`](./ESTADO.md)

Base: `/api/v1`.

## Reglas transversales

```json
{ "status": "success" | "fail" | "error", "message": "…", "data": { } }
```

- Datos **anidados bajo llave nombrada**; nunca sueltos.
- Errores de validación: `errors: [{ msg, path }]`, en español y mostrables.
- `_id` string, nunca `id`. Opcionales en `null`, nunca `''`.
- Fechas de calendario `'YYYY-MM-DD'` (String); marcas de tiempo ISO 8601 UTC.
- Códigos: `200` · `201` · `204` · `400` · `401` · `403` · `404` (no existe **o no
  es visible**) · `409` · `410` (movido) · `413` · `415` · `429`.
- `X-Request-Id` en toda respuesta.
- Nada de estado derivado en la base ni leído del cliente: el servidor recalcula.

## Rutas públicas

Sólo estas cuatro: `POST /auth/login`, `GET /api/v1` (inventario), `GET /health`,
`GET /ready`. Todo lo demás exige sesión y pasa por el middleware de alcance.

## Implementado hoy

| Método | Ruta                                         | Permiso                      | Nota                                                                    |
| ------ | -------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| GET    | `/`                                          | —                            | Inventario: `implementados` se deriva del router, `pendientes` del spec |
| GET    | `/health` · `/ready`                         | —                            | Liveness y readiness (el segundo verifica Mongo)                        |
| POST   | `/auth/login`                                | —                            | `data: { user, token }` con el `AuthUser` nuevo                         |
| GET    | `/auth/me`                                   | sesión                       | Revalida; 401 si cambió la contraseña o le quitaron el acceso           |
| POST   | `/auth/logout`                               | sesión                       | `data: null`                                                            |
| POST   | `/auth/cambiar-password`                     | sesión                       | Invalida las demás sesiones y **devuelve token nuevo**                  |
| GET    | `/empleados`                                 | ver empleados                | Paginado, con alcance por empresa y filtros                             |
| POST   | `/empleados`                                 | quien puede crear ese `tipo` | Persona + adscripción en transacción (D-33); duplicados (D-34)          |
| GET    | `/empleados/:id`                             | ver empleados                | 404 si no es visible                                                    |
| PATCH  | `/empleados/:id`                             | quien puede crear ese `tipo` | Datos de la persona; no toca acceso, estado ni adscripciones            |
| PATCH  | `/empleados/:id/estado`                      | `rh_admin`                   | Baja lógica con motivo, o reactivación                                  |
| POST   | `/empleados/:id/acceso`                      | `rh_admin`                   | Da acceso a una persona existente                                       |
| PATCH  | `/empleados/:id/acceso`                      | `rh_admin`                   | Nivel, alcance, correo, activar                                         |
| DELETE | `/empleados/:id/acceso`                      | `rh_admin`                   | Quita el acceso; la persona queda                                       |
| POST   | `/empleados/:id/acceso/restablecer-password` | `rh_admin`                   | Cierra sus sesiones                                                     |
| GET    | `/empresas` · `/empresas/:id`                | sesión                       | Las suyas; con conteos por agregación                                   |
| POST   | `/empresas`                                  | admin de plataforma          | 409 en nombre o RFC repetidos                                           |
| GET    | `/categorias`                                | sesión                       | Pueblan el desplegable del alta; filtro `?tipo=`                        |
| POST   | `/categorias`                                | admin de plataforma          | Idempotente por nombre: 200 si ya existía                               |
| PATCH  | `/categorias/:id/estado`                     | admin de plataforma          | 400 si hay personas con ese puesto                                      |
| GET    | `/clientes` · `/clientes/:id`                | sesión                       | Catálogo global, paginado. Hoy sin filtrar por cartera (D-36)           |
| POST   | `/clientes`                                  | `rh_admin` o `jefe_area`     | 409 en nombre o RFC repetidos                                           |
| PATCH  | `/clientes/:id`                              | `rh_admin` o `jefe_area`     | Nombre, RFC y contactos                                                 |
| PATCH  | `/clientes/:id/estado`                       | `rh_admin` o `jefe_area`     | Baja lógica; no hay borrado real (D-36)                                 |
| ALL    | `/usuarios*`                                 | —                            | **410** con las rutas nuevas (se borra cuando el front migre)           |

### `AuthUser`

```ts
{
  _id: string            // id del empleado
  name: string
  email: string          // acceso.email
  nivelAcceso: 'rh_admin' | 'rh_consulta' | 'jefe_area'
  alcanceGlobal: boolean
  empresas: { _id: string; nombre: string; areas: Area[] }[]
  active: boolean
  ultimoAccesoEn: string | null
  createdAt: string
  updatedAt: string
}
```

Desaparecieron `role`, `area`, `alcance` y `clienteId` respecto al modelo anterior.

### Alcance y permisos

- `req.empresasVisibles` — `null` = todas (`acceso.alcanceGlobal`), o los ids de
  las empresas con adscripción activa.
- `req.areasPorEmpresa` — `{ empresaId: [areas] }` para el jefe de área.
- `empresaId` de la petición sólo **acota**; nunca amplía. Fuera de alcance: 404.
- Capacidades en `src/utils/permissions.js`; los catálogos compartidos exigen
  `alcanceGlobal`.

## Pendiente

Ver la tabla de `ESTADO.md` y `backend-spec.md` §6. Las rutas están reservadas:
responden `404` y no deben ocuparse con otra cosa. `GET /api/v1` las lista en
`pendientes`.
