# CLAUDE.md — Backend de expedientes laborales (Urbacames)

Punto de entrada para cualquier agente o persona que llegue a este repo. Léelo
completo antes de tocar código; toma 3 minutos y evita reescrituras.

## Qué es esto

API de la plataforma de **expedientes laborales de Urbacames**: checklist de
documentos por colaborador, carga de archivos, validación por RH, control de
vigencias, alertas y reportes de auditoría.

- El **front ya está terminado y probado** contra una capa simulada. Este backend
  tiene que devolver **exactamente** las formas que el front espera.
- La especificación cerrada es **`backend-spec.md`** (raíz). Es la fuente de
  verdad del contrato: §2 reglas no negociables, §5 enums, §6 modelo de datos,
  §7 lógica de negocio, §8 permisos, §9 API, §13 criterios de aceptación.
- El proyecto hermano `~/Documents/projects/talentlink-backend` es el **origen de
  las convenciones**, no un repo del que se copie sin revisar: lo que se mejoró
  respecto a él está en `docs/DECISIONES.md`.

## Arrancar

```bash
npm install
cp .env.example .env      # y llena MONGODB_URI y JWT_SECRET
npm run seed:admin        # crea el primer rh_admin
npm run dev               # http://localhost:8080/api/v1/health
npm test                  # 79 pruebas, base en memoria (no necesita Mongo)
npm run lint
```

El proceso **no arranca** si el entorno está incompleto o si no hay base de
datos: es deliberado (`src/config/env.js`, `src/config/database.js`).

## Idiomas — la regla que más se equivoca

| Qué                                                                   | Idioma                               |
| --------------------------------------------------------------------- | ------------------------------------ |
| Rutas (`/usuarios`, `/expedientes`)                                   | **español** (el front ya las llama)  |
| Llaves JSON del dominio (`nivelAcceso`, `vigenciaHasta`, `clienteId`) | **español** (contrato)               |
| Valores de enums (`rh_admin`, `obra_determinada`)                     | **español** (igualdad estricta)      |
| Mensajes de error                                                     | **español** (se muestran al usuario) |
| Archivos, funciones, variables, modelos, colecciones                  | **inglés**                           |
| Campos internos que no se serializan (`nameNormalized`)               | **inglés**                           |

Mapa de nombres: `User`/`app_users` = usuarios · `Client`/`clients` = clientes ·
`Employee`/`employees` = colaboradores · `Record`/`records` = expedientes ·
`ChecklistTemplate`/`checklist_templates` = plantillas · `AccessLog`/`access_logs`
= bitácora.

## Estructura

```
src/
  api/v1/
    auth/          login, me, logout, cambiar-password
    users/         CRUD de usuarios de la plataforma  (ruta /usuarios)
    clients/       modelo de cliente (fase 2, sin rutas)
    routes/        index.js monta todos los recursos
  config/          env.js (validado con zod) · database.js
  constants/       enums del contrato: áreas, niveles, contratos, documentos…
  middlewares/     authMiddleware · scopeMiddleware · validateRequest ·
                   errorHandler · requestContext · rateLimiters
  utils/           response (envelope) · asyncHandler · dates · text ·
                   permissions · logger · domain/ (reglas de expedientes)
  validations/     reglas de express-validator por recurso
scripts/           seedAdminUser.js · syncIndexes.js
tests/             unitarias/ · integracion/ · helpers/
docs/              arquitectura, contrato, decisiones, estado, migración
.claude/skills/    api-contract · new-resource · mongo-modeling · testing ·
                   records-domain
.claude/agents/    api-contract-reviewer · scope-security-auditor ·
                   resource-implementer
```

**Cuatro capas por recurso**, sin excepciones: `<x>Model.js` (esquema) →
`<x>Service.js` (negocio, sin HTTP) → `<x>Controller.js` (HTTP, sin negocio) →
`<x>Routes.js` (rutas, validaciones, middlewares).

## Las siete reglas que rompen el front

1. **Envelope** `{ status, message?, data }` en toda respuesta, con los datos
   anidados bajo llave nombrada. Usa `utils/response` (`ok`, `created`,
   `noContent`), nunca `res.json` a mano.
2. **Errores** con `errors[0].msg` en español, mostrable tal cual. Lanza
   `AppError`, no respondas errores a mano.
3. **`_id` en string**, nunca `id`.
4. **Fechas de calendario** (`fechaIngreso`, `vigenciaHasta`) como `String`
   `'YYYY-MM-DD'`; marcas de tiempo como `Date` → ISO. Nunca una fecha civil
   como `Date`.
5. **Opcionales en `null` u omitidos**, jamás `''`.
6. **Nada derivado en la base**: `expiring`, `expired`, `avance` y las alertas se
   calculan al leer.
7. **Toda consulta parte de `req.scopeFilter`** y fuera de alcance se responde
   **404, no 403**.

## Seguridad: los dos filtros

- `req.scopeFilter` — cliente: `interno` → `{}`, `cliente` → `{ clienteId }`.
- `req.areaFilter` — área: `jefe_area` sólo ve la suya.
- Se combinan (`req.dataFilter`). El `clienteId` **nunca** se lee del body ni del
  query string: sale del usuario (`req.ownerClienteId` al crear).
- Permisos por capacidad: `requireCapability(CAPABILITIES.X)` contra la matriz de
  `utils/permissions.js`. Ninguna ruta pública salvo `POST /auth/login`,
  `/health` y `/ready`.

## Antes de decir "listo"

- [ ] `npm test` y `npm run lint` en verde; `npx prettier --write` en lo tocado.
- [ ] Prueba de integración del camino feliz, 401, 403, **404 por alcance** y 400.
- [ ] `docs/CONTRATO-API.md` con la forma exacta de la respuesta nueva.
- [ ] `docs/ESTADO.md` actualizado (es el mapa de qué falta).
- [ ] Desviaciones del spec anotadas en `docs/DECISIONES.md`, con el motivo.

## Estado

**Fase 1 en curso.** Hecho: base del proyecto, conexión, contrato de errores,
sesión y usuarios. Pendiente: colaboradores, expedientes y documentos, alertas,
métricas, plantillas, reportes, R2, correos y job de vigencias. El detalle, con
checkboxes, está en `docs/ESTADO.md`.
