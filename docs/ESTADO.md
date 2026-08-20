# Estado del backend

Mapa de qué está hecho y qué falta. **Actualízalo al cerrar cada módulo**: es lo
primero que lee quien llega, humano o agente.

Última actualización: **2026-08-19** · 79 pruebas en verde.

## Leyenda

✅ hecho y probado · 🟡 parcial · ⬜ no empezado · 🔒 fase 2, no implementar

---

## Base del proyecto

| Pieza                                          | Estado | Dónde                                                      |
| ---------------------------------------------- | ------ | ---------------------------------------------------------- |
| Esqueleto de capas y convenciones              | ✅     | `src/`, `CLAUDE.md`                                        |
| Entorno validado (zod), falla al arrancar      | ✅     | `src/config/env.js`                                        |
| Conexión a MongoDB con reintentos y estado     | ✅     | `src/config/database.js`                                   |
| Apagado ordenado (SIGTERM/SIGINT)              | ✅     | `src/server.js`                                            |
| Envelope de respuesta y `AppError`             | ✅     | `src/utils/response.js`, `src/middlewares/errorHandler.js` |
| Validación con `errors[{ msg }]`               | ✅     | `src/middlewares/validateRequest.js`                       |
| Logger JSON + `X-Request-Id`                   | ✅     | `src/utils/logger.js`, `src/middlewares/requestContext.js` |
| Rate limit general y de login                  | ✅     | `src/middlewares/rateLimiters.js`                          |
| CORS por lista blanca desde el entorno         | ✅     | `src/app.js`                                               |
| Enums del contrato                             | ✅     | `src/constants/`                                           |
| Fechas de calendario y aritmética              | ✅     | `src/utils/dates.js`                                       |
| Búsqueda insensible a acentos                  | ✅     | `src/utils/text.js`                                        |
| Matriz de permisos por capacidades             | ✅     | `src/utils/permissions.js`                                 |
| Middleware de alcance multi-cliente            | ✅     | `src/middlewares/scopeMiddleware.js`                       |
| Health y readiness                             | ✅     | `src/api/v1/routes/index.js`                               |
| Semilla del primer admin · sincronizar índices | ✅     | `scripts/`                                                 |
| Dockerfile                                     | ✅     | `Dockerfile`                                               |
| ESLint + Prettier                              | ✅     | `eslint.config.js`, `.prettierrc`                          |
| Skills y agentes del proyecto                  | ✅     | `.claude/`                                                 |
| CI (GitHub Actions o equivalente)              | ⬜     | —                                                          |

## Módulos de la API

| Módulo                                  | Spec      | Estado | Notas                                  |
| --------------------------------------- | --------- | ------ | -------------------------------------- |
| Autenticación (`/auth`)                 | 9.1       | ✅     | login, me, logout, cambiar-password    |
| Recuperar / restablecer contraseña      | 9.1       | ⬜     | Deseable; hoy repone un admin          |
| Usuarios (`/usuarios`)                  | 9.2       | ✅     | CRUD, baja lógica, reactivar, búsqueda |
| Clientes — modelo                       | 6.1       | ✅     | Colección creada, vacía                |
| Clientes — rutas (`/clientes`)          | 9.8       | 🔒     | Reservadas, no implementar             |
| Colaboradores (modelo `Employee`)       | 6.3       | ⬜     | Siguiente paso                         |
| Plantillas de checklist                 | 6.5 / 9.6 | ⬜     | Sembrar las base                       |
| Expedientes (`/expedientes`)            | 6.4 / 9.3 | ⬜     | Decidir paginación **antes**           |
| Documentos (subir/validar/rechazar/URL) | 9.4       | ⬜     | Necesita R2                            |
| Lógica de dominio (`utils/domain/`)     | 7         | ⬜     | Skill `records-domain`                 |
| Alertas (`/alertas`)                    | 9.5       | ⬜     | Derivadas, nunca almacenadas           |
| Métricas (`/dashboard/metricas`)        | 9.5       | ⬜     |                                        |
| Reportes (`/reportes/expedientes`)      | 9.7       | ⬜     | Registra en bitácora                   |
| Bitácora de accesos                     | 6.6       | ⬜     | Requisito legal (LFPDPPP)              |
| Almacenamiento R2 + URLs firmadas       | 10        | ⬜     | Reutilizar de talentlink               |
| Correo (Mailjet / Mailtrap)             | 11        | ⬜     | Reutilizar de talentlink               |
| Job diario de vigencias                 | 11        | ⬜     | Un correo por persona, idempotente     |
| Migración de usuarios de Urbacames      | 12        | ⬜     | `docs/MIGRACION.md`                    |

## Orden sugerido

1. **Colaboradores + plantillas de checklist.** Sin ellos no hay expediente que
   generar. Incluye sembrar las plantillas base del front
   (`src/mocks/plantillas.ts`).
2. **`utils/domain/`**: estatus efectivo, avance, semáforo, alertas, generación y
   re-sincronización del checklist. Funciones puras con pruebas unitarias — aquí
   están todos los casos borde del spec §13.
3. **Expedientes**: listado con orden por severidad, detalle, alta, cambio de
   colaborador y de estado. **Decidir la paginación antes de escribir el
   listado.**
4. **R2 + documentos**: subir con validación de magic bytes, validar, rechazar,
   versionado, URL firmada con bitácora.
5. **Alertas y métricas**, que sólo leen y derivan.
6. **Reportes** con registro en bitácora.
7. **Correo + job de vigencias** (06:00 hora de México, un correo por persona,
   idempotente por día).
8. **Migración** de los usuarios reales y cambio de `VITE_API_BASE_URL` en el
   front.

## Decisiones abiertas

Bloquean o encarecen trabajo posterior; conviene cerrarlas con Urbacames.

1. **Paginación de `GET /expedientes`.** Si va a existir, `data` debe ser
   `{ expedientes, total, pagina, porPagina }` desde la primera versión. Después
   es un cambio incompatible.
2. **Umbral de aviso de vencimiento.** Hoy 30 días (`DIAS_ALERTA_VENCIMIENTO`).
3. **Qué documentos son sensibles.** Hoy 8 de 12 (`SENSITIVE_DOCUMENT_TYPES`).
4. **A quién llegan los correos de alerta** y con cuánta anticipación.
5. **¿El colaborador sube sus propios documentos?** Si sí, hace falta un cuarto
   nivel de acceso y un flujo de invitación por token: **cambia el modelo de
   usuarios**, así que conviene preguntarlo antes de avanzar mucho más.
6. **Quitar `role` del `AuthUser`** cuando el front lea `nivelAcceso` (D-08).
7. **Aislamiento físico de la base** si legal lo exige (D-02).
