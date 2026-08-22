# Estado del backend

Mapa de qué está hecho y qué falta. **Actualízalo al cerrar cada módulo**: es lo
primero que lee quien llega, humano o agente.

Última actualización: **2026-08-21** · 307 pruebas en verde.

El modelo autoritativo es [`modelo-datos.md`](./modelo-datos.md) (jerarquía de
empresas, catálogos compartidos y vínculos) y el contrato es
[`backend-spec.md`](./backend-spec.md). Lo implementado antes sobre el modelo
anterior (usuarios con `clienteId`) **ya se migró**: ver D-27 a D-31 en
[`DECISIONES.md`](./DECISIONES.md).

## Leyenda

✅ hecho y probado · 🟡 parcial · ⬜ no empezado · 🔒 no implementar todavía

---

## Base del proyecto

| Pieza                                                  | Estado | Dónde                                                      |
| ------------------------------------------------------ | ------ | ---------------------------------------------------------- |
| Esqueleto de capas y convenciones                      | ✅     | `src/`, `CLAUDE.md`                                        |
| Entorno validado (zod), falla al arrancar              | ✅     | `src/config/env.js`                                        |
| MongoDB **replica set** local (transacciones)          | ✅     | `docker-compose.yml`, D-29                                 |
| Conexión con reintentos y diagnóstico de errores       | ✅     | `src/config/database.js`                                   |
| Registro central de modelos (evita MissingSchemaError) | ✅     | `src/models/index.js`, D-31                                |
| Apagado ordenado (SIGTERM/SIGINT)                      | ✅     | `src/server.js`                                            |
| Envelope de respuesta y `AppError`                     | ✅     | `src/utils/response.js`, `src/middlewares/errorHandler.js` |
| Validación con `errors[{ msg, path }]`                 | ✅     | `src/middlewares/validateRequest.js`                       |
| Logger JSON + `X-Request-Id`                           | ✅     | `src/utils/logger.js`                                      |
| Rate limit general y de login                          | ✅     | `src/middlewares/rateLimiters.js`                          |
| CORS por lista blanca                                  | ✅     | `src/app.js`                                               |
| Enums del contrato                                     | ✅     | `src/constants/`                                           |
| Fechas de calendario y aritmética                      | ✅     | `src/utils/dates.js`                                       |
| Búsqueda insensible a acentos                          | ✅     | `src/utils/text.js`                                        |
| Inventario de la API (`GET /api/v1`)                   | ✅     | `src/utils/routeInventory.js`                              |
| Administrador de plataforma inicial                    | ✅     | `src/services/bootstrapAdmin.js`                           |
| Migración `app_users` → modelo nuevo                   | ✅     | `scripts/migrateUsersToEmployees.js`                       |
| Dockerfile · ESLint · Prettier                         | ✅     | raíz                                                       |
| Skills y agentes del proyecto                          | ✅     | `.claude/`                                                 |
| Guía e instrucciones para el front                     | ✅     | `docs/INTEGRACION-FRONTEND.md`, `docs/CAMBIOS-FRONTEND.md` |
| CI                                                     | ⬜     | —                                                          |

## Modelo de datos

| Colección             | Modelo              | Estado | Notas                                                                                                  |
| --------------------- | ------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| `companies`           | `Company`           | ✅     | Nombre único normalizado, branding y configuración                                                     |
| `employees`           | `Employee`          | ✅     | La persona, con `acceso` opcional. Sin contrato ni áreas                                               |
| `credentials`         | `Credential`        | ✅     | Secreto aislado, 1 a 1 con el empleado (D-27)                                                          |
| `clients`             | `Client`            | ✅     | Catálogo global, sin empresa dueña                                                                     |
| `categories`          | `Category`          | ✅     | Catálogo global                                                                                        |
| `affiliations`        | `Affiliation`       | ✅     | Adscripción empresa ↔ empleado: la relación laboral                                                    |
| `portfolios`          | `Portfolio`         | ⬜     | Cartera empresa ↔ cliente                                                                              |
| `assignments`         | `Assignment`        | ⬜     | Asignación proyecto ↔ empleado                                                                         |
| `projects`            | `Project`           | ⬜     | La única entidad que pertenece a una empresa                                                           |
| `records`             | `Record`            | ⬜     | Expediente, 1 a 1 con el empleado                                                                      |
| `checklist_templates` | `ChecklistTemplate` | 🟡     | Existe del modelo anterior; su eje pasa a `empresaId` y la resolución a **unión** de plantillas (§6.2) |
| `access_logs`         | `AccessLog`         | ⬜     | Bitácora, requisito legal (LFPDPPP)                                                                    |

## API

| Módulo                            | Spec      | Estado | Notas                                                                                                     |
| --------------------------------- | --------- | ------ | --------------------------------------------------------------------------------------------------------- |
| Sesión (`/auth`)                  | 6.1       | ✅     | login, me, logout, cambiar-password con `AuthUser` nuevo                                                  |
| Recuperar contraseña              | 6.1       | ⬜     | Hoy la repone un `rh_admin`                                                                               |
| Alcance por empresa               | 8.1       | ✅     | `applyScope` deriva de adscripciones activas                                                              |
| Matriz de permisos                | 8.2       | ✅     | Capacidades + `alcanceGlobal`                                                                             |
| Accesos (`/empleados/:id/acceso`) | 6.2       | ✅     | Dar, editar, quitar, restablecer (D-30)                                                                   |
| Empleados — listado y detalle     | 6.2       | ✅     | Agregación con alcance, filtros, orden y paginación                                                       |
| Empleados — **alta**              | 6.2       | ✅     | Persona + adscripción en transacción, permisos por tipo, duplicados (D-32 a D-34)                         |
| Categorías                        | 6.2       | ✅     | CRUD con `tipo`, alta idempotente por nombre                                                              |
| Empleados — edición y baja        | 6.2       | ✅     | Editar: quien puede crear ese tipo. Baja: `rh_admin`. El acceso y las adscripciones tienen su propia ruta |
| Clientes                          | 6.2       | ✅     | CRUD con baja lógica; sin filtrar por cartera todavía (D-36)                                              |
| Empresas                          | 6.3       | ✅     | Alta sólo admin de plataforma, listado con conteos                                                        |
| Adscripciones                     | 6.3       | ⬜     | Modelo listo, faltan rutas                                                                                |
| Carteras                          | 6.3       | ⬜     |                                                                                                           |
| Proyectos                         | 6.4       | ⬜     | Regla: su cliente debe estar en la cartera de la empresa                                                  |
| Asignaciones                      | 6.4       | ⬜     |                                                                                                           |
| Expedientes y documentos          | 6.5       | ⬜     | Checklist por **unión** de plantillas                                                                     |
| Lógica de dominio                 | modelo §6 | 🟡     | Estatus, avance, semáforo, alertas y vigencias listos y probados; falta la unión de plantillas            |
| Alertas, métricas y reportes      | 6.6       | ⬜     | Derivados                                                                                                 |
| Almacenamiento R2                 | 7         | ⬜     | Reutilizar de talentlink                                                                                  |
| Job diario de vigencias           | 8         | ⬜     | Un correo por persona, idempotente                                                                        |
| `/usuarios` (modelo anterior)     | —         | ✅     | Responde **410** con las rutas nuevas                                                                     |

## Orden sugerido

1. ~~Colecciones base + credenciales + `/auth` + migración~~ ✅
2. ~~**Empresas, categorías y el alta de personal**~~ ✅ Con la matriz corregida
   (D-32), la adscripción obligatoria en el alta (D-33) y la política de
   duplicados (D-34).
3. ~~**Edición y baja de empleados**~~ ✅
4. ~~**Clientes**~~ ✅
5. **Carteras** (empresa ↔ cliente) y `POST /adscripciones` suelto (mover gente
   entre empresas sin recrearla). La cartera además desbloquea el filtro por
   alcance del catálogo de clientes.
6. **Expedientes**: modelo `records`, plantillas por `empresaId` y resolución del
   checklist **por unión**, más R2 para los archivos.
7. **Carteras y proyectos**, con la regla de cliente en cartera.
8. **Asignaciones** y las agregaciones de `modelo-datos.md` §9.1 y §9.3.
9. **Alertas, métricas y reportes.**
10. **Job diario de vigencias** y correos.

## Decisiones abiertas

1. **¿El expediente se comparte entre empresas del grupo?** El modelo dice que sí
   (es de la persona). Si Urbacames necesita uno por empresa, cambia a expediente
   por adscripción y **hay que decidirlo antes de implementar expedientes**.
2. **¿La CURP es obligatoria desde el alta?** Implementado como opcional con
   índice parcial (D-28); confirmar.
3. **¿El empleado sube sus propios documentos?** Añadiría un cuarto nivel de
   acceso y un flujo de invitación por token.
4. **Umbral de vencimiento de documentos** (hoy 30 días) y **de aviso de
   proyecto** (hoy 7).
5. **Qué documentos son sensibles** (hoy 8 de 12).
6. **A quién llegan los correos de alerta.**
7. **Apagar el administrador inicial** (`BOOTSTRAP_ADMIN_ENABLED=false`) y
   cambiar su contraseña antes de exponer el backend (D-21).
8. **Bloqueo automático por intentos fallidos**: hoy se cuentan y se respeta un
   bloqueo puesto a mano, pero no se bloquea solo — bloquear automáticamente deja
   que cualquiera deje fuera a una persona a propósito.
9. ~~¿Quién puede editar a un empleado?~~ **Resuelto:** quien puede crear a
   alguien de un `tipo` puede también editarlo (D-32). La baja sigue siendo de
   `rh_admin`.
