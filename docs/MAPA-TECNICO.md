# Mapa técnico — snapshot para diseñar coordinación de agentes

> **Esto es una FOTO, no un documento mantenido.** Estado del repo al
> **2026-08-30 02:11:25 -0600**, commit `a96ccf4`, rama `develop`. Nadie se
> comprometió a actualizarlo y `tests/unitarias/docs.test.js` **no lo vigila**.
> Si lo lees semanas después, verifica contra el código antes de decidir nada.
>
> Sólo análisis: no se modificó código, esquemas ni migraciones.

---

## 1. ARQUITECTURA

### Estructura real

```
src/
  app.js                    Express: helmet, cors, json, compression, requestContext,
                            requestLogger, apiLimiter, rutas, notFound, errorHandler
  server.js                 Arranca SÓLO si conecta a Mongo (deliberado)
  api/v1/<recurso>/         14 recursos con rutas + 4 sin rutas
  models/index.js           Registra los 14 modelos al arrancar (D-31)
  config/                   env.js (zod) · database.js (ping real, no readyState)
  constants/                Enums del contrato, 7 archivos
  middlewares/              8 archivos
  utils/                    response · asyncHandler · dates · text · permissions ·
                            logger · routeInventory · spreadsheet · ids · fileTypes
  utils/domain/             8 módulos PUROS, sin I/O
  services/                 storageService (R2) · bootstrapAdmin · seedAreas ·
                            seedChecklistTemplates
  validations/              14 archivos express-validator ← VER INCONSISTENCIA #1
scripts/                    14 scripts operativos, ninguno con pruebas
tests/                      unitarias/ (13) · integracion/ (24) · helpers/ (4)
docs/                       21 documentos, 11 916 líneas
```

**Tamaño:** 17 249 líneas en `src/`, 14 973 en `tests/`. Ratio ~0.87:1.

### Capas y responsabilidades

| Capa        | Archivo                        | Responsabilidad                                                                         | Regla                   |
| ----------- | ------------------------------ | --------------------------------------------------------------------------------------- | ----------------------- |
| Ruta        | `<x>Routes.js`                 | Monta path, middlewares y validaciones                                                  | Sin lógica              |
| Validación  | `validations/<x>Validation.js` | express-validator                                                                       | Sin acceso a base       |
| Controlador | `<x>Controller.js`             | Parsea HTTP, llama servicio, responde con `utils/response`                              | **Sin negocio**         |
| Servicio    | `<x>Service.js`                | Reglas, transacciones, acceso a modelos                                                 | **Sin HTTP**            |
| Modelo      | `<x>Model.js`                  | Esquema, índices, invariantes en `pre('validate')`, `toJSON`                            | —                       |
| Dominio     | `utils/domain/*`               | Funciones **puras** (avance, estatus, alertas, checklist, vigencias, import, registros) | Sin I/O, probadas solas |

### Patrones realmente usados

- **Cuatro capas por recurso**, respetado sin excepciones en los 14 con rutas.
- **Servicios como singleton**: `module.exports = new XService()`. Estado en el
  módulo, no inyección de dependencias.
- **Envelope centralizado** (`utils/response`) y **errores como excepción**
  (`AppError` + `errorHandler`). No hay `res.json` a mano.
- **Nada derivado en la base**: `avance`, `estatus`, alertas, `registroPatronalCoincide`
  y `trazabilidad` se calculan **al leer**.
- **Alcance derivado, nunca un campo**: `scopeMiddleware` cruza `affiliations`.
- **Baja lógica en todo**: `activo`/`activa`, nunca `DELETE` físico.
- **Índices únicos parciales** (`$type: 'string'`), nunca `sparse`, porque los
  campos opcionales tienen `default: null` y existen en el documento.
- **Transacciones** para toda escritura multi-colección (11 sitios).
- **Inventario de rutas derivado del router** (`utils/routeInventory`), expuesto
  en `GET /api/v1`. No hay lista escrita a mano.

### Inconsistencias importantes

| #   | Qué                                                                                                                                                                                                                 | Dónde                                                                                                                        | Gravedad                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | **`req.scopeFilter` NO EXISTE.** El middleware expone `req.empresasVisibles` y `req.areasPorEmpresa`. Pero lo prometen `CLAUDE.md` regla 7, `docs/ARQUITECTURA.md` §4, y **dos definiciones de agente + una skill** | `.claude/agents/scope-security-auditor.md`, `.claude/agents/resource-implementer.md`, `.claude/skills/new-resource/SKILL.md` | **Crítica para agentes**: dos agentes auditan/implementan contra una API inexistente |
| 2   | `validations/` es una carpeta hermana, no vive con el recurso. `CLAUDE.md` dice «rutas, validaciones, middlewares» en `<x>Routes.js`                                                                                | `src/validations/`                                                                                                           | Menor, pero rompe la localidad de las cuatro capas                                   |
| 3   | `docs/ARQUITECTURA.md` §4 menciona `req.areaFilter`, `req.dataFilter`, `req.ownerClienteId` — **ninguno existe**                                                                                                    | `docs/ARQUITECTURA.md:45`                                                                                                    | Alta: es el documento de capas                                                       |
| 4   | `accessLevelToRole()` sigue emitiendo `role: 'admin'\|'user'` por compatibilidad con un front que ya migró                                                                                                          | `src/constants/accessLevels.js:18`                                                                                           | Media: contrato muerto vivo                                                          |
| 5   | 4 recursos tienen modelo sin rutas: `credentials`, `accessLogs`, `checklistTemplates` (a propósito) y `routes/` (no es recurso)                                                                                     | `src/api/v1/`                                                                                                                | Baja, es intencional salvo checklistTemplates                                        |
| 6   | `employees/` acumula 3 272 líneas y 4 servicios (`employeeService`, `accessService`, `employeeImportService`, + controlador de 248)                                                                                 | `src/api/v1/employees/`                                                                                                      | Alta: ver §7                                                                         |

---

## 2. DOMINIOS / MÓDULOS

| Dominio          | Archivos principales                                                                                 | Responsabilidad                                                                                                               | Depende de                                                                        | Acoplamiento                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **auth**         | `api/v1/auth/{Service,Controller,Routes,authUser}.js`, `middlewares/{auth,password}Middleware.js`    | Login, sesión, logout, cambio de contraseña, construcción del `AuthUser`                                                      | `employees`, `credentials`, `affiliations`, `companies`                           | **Alto** — `authUser.js` cruza adscripciones y empresas para armar el alcance |
| **employees**    | `employees/{employeeService,accessService,employeeImportService,employeeModel,Controller,Routes}.js` | Catálogo de personas, alta con expediente en transacción, edición, baja, accesos (sub‑recurso) e **importación .xlsx**        | `affiliations`, `areas`, `categories`, `records`, `companies`, `credentials`      | **Crítico** — el nodo más conectado del sistema                               |
| **credentials**  | `credentials/credentialModel.js`                                                                     | Aislar el hash de contraseña de `employees` (D‑27)                                                                            | `employees`                                                                       | Bajo, deliberadamente aislado                                                 |
| **companies**    | `companies/*`                                                                                        | Empresa (entidad raíz) + **registros patronales embebidos**                                                                   | `affiliations`, `portfolios`, `projects` (para conteos y candados de baja)        | Alto                                                                          |
| **clients**      | `clients/*`                                                                                          | Catálogo global de clientes + **registros de obra embebidos**                                                                 | `portfolios`, `projects`                                                          | Medio                                                                         |
| **categories**   | `categories/*`                                                                                       | Catálogo global de puestos. **`tipo` marcado de salida (D‑73)**                                                               | `employees`                                                                       | Medio                                                                         |
| **areas**        | `areas/*`, `services/seedAreas.js`                                                                   | Catálogo de áreas: 9 base + temporales del .xlsx (D‑58)                                                                       | `affiliations`, `employees` (import)                                              | Medio                                                                         |
| **affiliations** | `affiliations/*`                                                                                     | **La relación laboral**: empresa ↔ empleado, áreas, jefaturas, contrato, condiciones, `nomina` (oculta), `registroPatronalId` | `companies`, `areas`, `records`, `assignments`                                    | **Crítico** — de aquí sale TODO el alcance                                    |
| **portfolios**   | `portfolios/*`                                                                                       | Vínculo empresa ↔ cliente. Habilita clientes por empresa                                                                      | `companies`, `clients`                                                            | Bajo                                                                          |
| **projects**     | `projects/*`                                                                                         | Proyecto/obra, sus categorías habilitadas, aplazar/finalizar/reabrir y los **candados**                                       | `companies`, `clients`, `portfolios`, `contracts`, `assignments`                  | Alto                                                                          |
| **contracts**    | `contracts/*`                                                                                        | Contrato = fase del proyecto, con **SIROC embebido y único global**                                                           | `projects`                                                                        | Medio (unidireccional hacia arriba)                                           |
| **assignments**  | `assignments/*`                                                                                      | Proyecto ↔ empleado, avisos de registro patronal y **trazabilidad resuelta al leer** (D‑71)                                   | `projects`, `employees`, `affiliations`, `companies`, `categories`                | Alto                                                                          |
| **records**      | `records/*`, `checklistTemplates/*`, `accessLogs/*`                                                  | Expediente, checklist por unión, subida versionada a R2, revisión, URL firmada + bitácora                                     | `employees`, `affiliations`, `checklistTemplates`, `accessLogs`, `storageService` | **Crítico**                                                                   |
| **alerts**       | `alerts/*`, `utils/domain/alerts.js`                                                                 | Bandeja **derivada**: documentación y cumpleaños. Sin estado                                                                  | `records`, `employees`                                                            | Medio (sólo lectura)                                                          |
| **users (gone)** | `users/goneRoutes.js`                                                                                | `410` con la ruta nueva                                                                                                       | —                                                                                 | Nulo. **Borrable cuando el front deje de llamarla**                           |

### Grafo de dependencias entre servicios

```
alerts ──────────► employees
affiliations ────► areas, companies, records
employees ───────► affiliations, areas, categories, records
records ─────────► employees          ◄── CICLO
projects ────────► companies, contracts, portfolios
```

**Ciclo real: `employees ↔ records`.** Está roto a mano con `require()` perezoso
dentro de la función (`employeeService.js:385`, `employeeImportService.js:1154`
y `:1357`), con el motivo comentado. `recordService.js:7` sí lo importa arriba.
Es frágil: cualquier `require` nuevo en el encabezado de `employeeService`
reintroduce el objeto vacío.

---

## 3. FLUJOS END‑TO‑END

### 3.1 Sesión

- **Entrada:** `POST /api/v1/auth/login` (única ruta pública junto a `/`, `/health`, `/ready`)
- **Módulos:** `authService` → `Employee` (`acceso.email`) → `Credential` (bcrypt) → `authUser.js`
- **Datos:** `employees.acceso`, `credentials.passwordHash`, `affiliations` activas, `companies`
- **Salida:** `{ user, token }`; JWT 12 h en `Authorization: Bearer`
- **Efectos:** `acceso.ultimoAccesoEn`; contador de intentos fallidos
- **Dependencias:** `protect` **relee al usuario en cada petición** (revocar surte efecto ya, no al expirar)
- **Trampa:** si `acceso.passwordTemporal`, todo salvo `/auth/me`, `/auth/logout` y `/auth/cambiar-password` responde `403 PASSWORD_TEMPORAL` (D‑49, `passwordMiddleware`)

### 3.2 Alta de colaborador

- **Entrada:** `POST /api/v1/empleados`
- **Módulos:** `employeeService` → `Category` (de ahí sale el `tipo`) → permiso → `Employee` + `Affiliation` + `Record`
- **Transacción:** sí (`employeeService.js:336`). **Requiere replica set.**
- **Datos:** `employees`, `affiliations`, `records`, lee `categories` y `areas`
- **Efectos:** crea el expediente con checklist resuelto por unión de plantillas
- **Orden crítico:** categoría → tipo → permiso → escritura. El permiso depende del tipo.

### 3.3 Documento del expediente

- **Entrada:** `POST /api/v1/expedientes/:id/documentos/:tipo` (multipart, `archivo` + `vigenciaHasta?`)
- **Módulos:** `uploadMiddleware` (multer memoria, 10 MB) → `recordService` → `storageService` (R2)
- **Datos:** `records.documentos[].versiones[]` (array embebido creciente)
- **Efectos:** sube a R2; si la escritura en Mongo falla, **borra el objeto** (`recordService.js:339`); numera versión, marca `reemplazadaEn`, inserta al inicio, pone `in_review` y **limpia `motivoRechazo`, `revisadoPor`, `revisadoEn`**
- **Revisión:** `POST …/:tipo/revisar` con `{ aprobado, motivo? }` — **un solo endpoint** (D‑43), sólo desde `in_review`
- **Descarga:** `GET …/versiones/:v/url` → URL firmada 10 min + **escritura en `access_logs`** (LFPDPPP)

### 3.4 Importación .xlsx de nómina

- **Entrada:** `POST /empleados/importar/previsualizar` (no escribe) → `POST /empleados/importar`
- **Módulos:** `uploadMiddleware` → `employeeImportService` (1 488 líneas) → `utils/domain/employeeImport` (puro, 511)
- **Datos escritos:** `employees`, `affiliations`, `records`, `areas` (temporales), `categories`
- **Efectos:** crea áreas y puestos faltantes; da de baja a quien se queda sin empresa (D‑55); **no pisa lo corregido a mano** (D‑56, D‑57); vincula `registroPatronalId` (D‑72); resincroniza expedientes
- **Idempotente:** re‑subir el mismo archivo no duplica a nadie
- **Riesgo:** el módulo más grande del repo y el que más colecciones toca a la vez

### 3.5 Cadena de la obra

- **Entrada:** `POST /proyectos` → `POST /proyectos/:id/contratos` → `PUT /contratos/:id/siroc`
- **Candados** (`projectService.js:356`, vía `contractService.contarPorProyecto`):

  | Campo del proyecto                | Se bloquea cuando                |
  | --------------------------------- | -------------------------------- |
  | `clienteId`, `registroPatronalId` | ≥1 contrato **activo**           |
  | `registroObraId`                  | ≥1 contrato activo **con SIROC** |
  | `empresaId`                       | siempre                          |

- **SIROC:** único en **todo el sistema**, índice parcial global. `409 SIROC_DUPLICADO` devuelve contrato y proyecto del choque en `data`.
- **Trampa:** `estado` (`finalizado`) y `activo` (baja) son distintos y van por rutas distintas — y la ruta `PATCH /contratos/:id/estado` mueve **`activo`**, no `estado`.

### 3.6 Asignación con coherencia de registro patronal

- **Entrada:** `POST /proyectos/:id/asignaciones`
- **Salida:** `201` **con `avisos: string[]`**, no error. Asignar a alguien que cotiza en otro registro **avisa, no bloquea** (D‑71)
- **Derivado al leer:** `registroPatronalEmpleado`, `registroPatronalCoincide` (**tres estados**: `true` / `false` / `null` = no comparable)
- **`GET /asignaciones/:id`** resuelve `empleado → empresa → registro patronal → proyecto → registro de obra` sin guardar un solo id nuevo

### 3.7 Alertas

- **Entrada:** `GET /alertas`
- **Derivadas en cada consulta** de `records` + `employees.fechaNacimiento` (D‑47). **Sin estado, sin job, sin nada que marcar.** Agrupadas por empleado y paginadas (D‑48)

---

## 4. CONTRATOS FRONT/BACK

**No hay OpenAPI, ni Swagger, ni tipos compartidos, ni generación de cliente.**
El contrato vive en **prosa versionada** y en **pruebas de integración**.

| Dónde vive                     | Qué cubre                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| `docs/backend-spec.md`         | Envelope, códigos, enums, catálogo de rutas                                               |
| `docs/CONTRATO-API.md`         | Forma exacta, petición por petición                                                       |
| `docs/INTEGRACION-FRONTEND.md` | Convenciones y lo que el front ya consume                                                 |
| `docs/ENDPOINTS-*.md` (6)      | Detalle por recurso                                                                       |
| `GET /api/v1`                  | **Inventario derivado del router en tiempo real** — lo único que no puede desincronizarse |
| `tests/integracion/*` (24)     | El contrato ejecutable de facto                                                           |

### Reglas del contrato

- **Envelope:** `{ status: 'success'|'fail'|'error', message?, data }`. `data` siempre bajo llave nombrada, nunca suelto.
- **Errores:** `errors[0].msg` en español, mostrable tal cual. Opcional `code` estable y `data` con lo necesario para reaccionar.
- **Códigos estables** (15): `ADSCRIPCION_DUPLICADA`, `ASIGNACION_DUPLICADA`, `CARTERA_DUPLICADA`, `CATEGORIA_OTRO_TIPO`, `CLIENTE_DUPLICADO`, `CURP_DUPLICADA`, `EMPRESA_DUPLICADA`, `NUMERO_EMPLEADO_DUPLICADO`, `PASSWORD_TEMPORAL`, `POSIBLE_DUPLICADO`, `PROYECTO_DUPLICADO`, `RFC_DISTINTO`, `RFC_DUPLICADO`, `RUTA_MOVIDA`, `SIROC_DUPLICADO`
- **HTTP:** `400` validación · `401` sin sesión · `403` sin permiso · **`404` no existe _o está fuera de alcance_** · `409` conflicto · `410` movida · `413` grande · `415` tipo · `429` rate limit
- **Ids:** `_id` string, nunca `id`
- **Fechas:** calendario como `'YYYY-MM-DD'` string; marcas de tiempo como ISO
- **Opcionales:** `null` u omitidos, **jamás `''`**
- **Idioma:** rutas y llaves JSON en español (contrato); código en inglés
- **Auth:** JWT 12 h, `Authorization: Bearer`. `protect` relee al usuario en cada petición
- **Paginación:** `?pagina=&porPagina=` (base 1, 25 por defecto). Respuesta con `total`, `pagina`, `porPagina`. Una página más allá del final da lista vacía y el `total` real, no `404`
- **Uploads:** `multipart/form-data`, campo `archivo`, multer en memoria, `MAX_UPLOAD_BYTES` (10 MB), errores traducidos a `413`/`415`
- **Descargas:** URL firmada de R2, 10 min, bucket privado, cada emisión a `access_logs`
- **WebSockets/eventos:** **ninguno.** Todo es petición‑respuesta

---

## 5. DOCUMENTACIÓN PARA AGENTES

### Instrucciones

| Archivo                                                                            | Qué es                                                                               | Estado                                                        |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `CLAUDE.md`                                                                        | Punto de entrada obligatorio. Idiomas, siete reglas, estructura, checklist de cierre | Al día, salvo la **regla 7 (`req.scopeFilter`) que es falsa** |
| `.claude/agents/api-contract-reviewer.md`                                          | Revisa envelope, códigos, fechas, enums                                              | Correcto                                                      |
| `.claude/agents/scope-security-auditor.md`                                         | Audita aislamiento multi‑empresa                                                     | **Instruido contra `req.scopeFilter`, que no existe**         |
| `.claude/agents/resource-implementer.md`                                           | Levanta un recurso de punta a punta                                                  | **Misma falla**                                               |
| `.claude/skills/{api-contract,mongo-modeling,new-resource,records-domain,testing}` | 5 skills                                                                             | `new-resource` arrastra `scopeFilter`                         |
| `.claude/settings.json`                                                            | Config del harness                                                                   | —                                                             |

### Docs relevantes (21, 11 916 líneas)

| Grupo             | Archivos                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Autoritativos** | `ARQUITECTURA-DATOS.md` (lo que HAY), `modelo-datos.md` (el diseño y su porqué), `backend-spec.md` (contrato HTTP) |
| Contrato          | `CONTRATO-API.md`, `INTEGRACION-FRONTEND.md`, `ENDPOINTS-*.md` ×6                                                  |
| Cocina            | `DECISIONES.md` (D‑01…D‑73, 3 146 líneas), `ESTADO.md`, `PLAN-*.md` ×2, `MIGRACION.md`, `ARQUITECTURA.md`          |
| Entregas al front | `CAMBIOS-FRONTEND.md`, `CAMBIOS-FRONTEND-OBRA.md`                                                                  |
| Coordinación      | **`HANDOFF-BACKEND.md`** ↔ `~/Documents/projects/cames-files-manager/docs/HANDOFF-FRONTEND.md`                     |
| Contexto, no spec | `RUMBO.md`                                                                                                         |

### Handoff (el protocolo ya existente)

Dos bitácoras, una por repo, **que no se copian**. Entradas con encabezado
`AAAA-MM-DD HH:MM:SS · lado · título`, la hora al segundo sacada de `date`. Tres
secciones: Pendientes para el otro, Bitácora, Cerrado. Tope ~150 líneas; al
cerrar algo grande se colapsa a un renglón. **Es el precedente directo del
sistema de coordinación que se quiere diseñar.**

### Lo mínimo que un agente necesita leer

1. `CLAUDE.md` — idiomas y las siete reglas
2. `docs/ARQUITECTURA-DATOS.md` — qué colecciones hay y qué rompe tocarlas
3. `docs/backend-spec.md` §2 — reglas del contrato
4. `docs/ESTADO.md` — qué falta y **qué decisiones bloquean**
5. `curl -s localhost:8080/api/v1 | jq` — la verdad sobre qué responde

### Información duplicada

| Qué se repite                                   | Dónde                                                                                          | Riesgo                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Reglas del contrato (envelope, códigos, fechas) | `CLAUDE.md`, `backend-spec.md` §2, `INTEGRACION-FRONTEND.md` §3, `.claude/skills/api-contract` | 4 copias, ya divergieron una vez              |
| Catálogo de rutas                               | `backend-spec.md` §6, `CONTRATO-API.md`, `ENDPOINTS-*.md`                                      | 3 niveles de detalle del mismo hecho          |
| Lógica de dominio (avance, semáforo)            | `modelo-datos.md` §6, `.claude/skills/records-domain`, `utils/domain/`                         | La skill y el doc pueden desviarse del código |
| Matriz de permisos                              | `modelo-datos.md` §8.2, `utils/permissions.js`                                                 | —                                             |
| Decisiones abiertas                             | `ESTADO.md`, `modelo-datos.md` §12, `backend-spec.md` §11                                      | 3 copias                                      |

### Documentación potencialmente desactualizada

- **`docs/ARQUITECTURA.md`** — la más rezagada: `req.scopeFilter`, `req.areaFilter`, `req.dataFilter`, `req.ownerClienteId`, ninguno existe.
- **`backend-spec.md` en la raíz** — versión anterior del spec, cuando el eje era el cliente. Conservada como historia; `CLAUDE.md` avisa de no seguirla.
- **`docs/MIGRACION.md`**, `PLAN-*.md` — planes cerrados, son historia.
- **`modelo-datos.md` §5** documenta 8 esquemas de 14 colecciones: faltan `credentials`, `areas`, `access_logs`.
- **Este archivo**, en cuanto alguien toque el código.

---

## 6. TESTING

| Tipo                         | Ubicación                      | Cantidad                                                                                     |
| ---------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------- |
| Unitarias de dominio         | `tests/unitarias/domain/`      | 7 archivos, funciones puras                                                                  |
| Unitarias de infraestructura | `tests/unitarias/`             | 7: `models`, `permissions`, `dates`, `text`, `storageKey`, `database`, `credentialIsolation` |
| Guardia de documentación     | `tests/unitarias/docs.test.js` | Compara cifras de los docs contra el código                                                  |
| Integración HTTP             | `tests/integracion/`           | 24 archivos, supertest + mongodb-memory-server                                               |

- **Ejecución:** `npm test` (`jest --runInBand`, ~10 min), `test:watch`, `test:coverage`
- **Andamiaje:** `helpers/env.js` (setupFiles, fija el entorno antes de cargar módulos), `helpers/db.js` (setupFilesAfterEnv, base en memoria), `helpers/factories.js`, `helpers/nominaWorkbook.js`
- **No requiere Mongo local.** `testTimeout: 60000`, `clearMocks: true`
- **Estado:** 39 suites, 853 pruebas, verde al 2026‑08‑30

### Áreas sin cobertura

| Área                                     | Nota                                                                                                                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`scripts/` — los 14**                  | Ningún test los importa. Incluye 8 migraciones destructivas y `seedAdminUser`, donde vivía un bug encontrado a mano el 30 ago. No están estructurados para importarse (se autoejecutan, no exportan) |
| `storageService` contra R2 real          | Sólo `storageKey.test.js` (construcción de clave) y el script manual `npm run r2:check`                                                                                                              |
| `rateLimiters`                           | Sin prueba de que dispare `429`                                                                                                                                                                      |
| `checklistTemplates`                     | Tiene test de integración pero **no hay rutas**: cubre la resolución, no la administración                                                                                                           |
| Concurrencia / carreras en transacciones | No hay pruebas de escrituras simultáneas                                                                                                                                                             |

---

## 7. DEUDA TÉCNICA Y ZONAS DE RIESGO

### Módulos con demasiadas responsabilidades

| Módulo                               | Líneas    | Problema                                                                                                                                                                                         |
| ------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `employees/employeeImportService.js` | **1 488** | Lee .xlsx, resuelve áreas, crea categorías, clasifica, da de alta, de baja, reactiva, actualiza, vincula registros y resincroniza expedientes. Escribe en **5 colecciones**. 18 métodos privados |
| `employees/employeeService.js`       | 852       | Listado con agregación, alta transaccional, edición con derivación de tipo, baja                                                                                                                 |
| `records/recordService.js`           | 629       | Checklist, subida a R2, versionado, revisión, URL firmada, bitácora                                                                                                                              |
| `utils/domain/alerts.js`             | 404       | Puro, pero concentra dos dominios (documentos y cumpleaños)                                                                                                                                      |

### Dependencias circulares

**`employeeService ↔ recordService`.** Rota con `require()` diferido en 3 puntos,
comentado. Es una convención frágil que un `require` de encabezado reintroduce.

### Lógica de negocio mezclada con infraestructura

- `recordService` orquesta R2 y Mongo en la misma función, con compensación
  manual: si Mongo falla tras subir, borra el objeto (`:339`). No hay
  transacción posible entre los dos sistemas — el riesgo real es el inverso
  (Mongo bien, borrado fallido) y no está cubierto.
- `employeeImportService` mezcla parseo de hoja de cálculo, reglas de negocio y
  escritura transaccional. Su parte pura sí está separada en
  `utils/domain/employeeImport.js` (511 líneas), pero la orquestación no.

### Código temporal que se volvió permanente

| Qué                                                                         | Dónde                          | Desde                            |
| --------------------------------------------------------------------------- | ------------------------------ | -------------------------------- |
| `accessLevelToRole()` — emite `role` para un front que ya migró             | `constants/accessLevels.js:18` | D‑27                             |
| `users/goneRoutes.js` — `410`                                               | `api/v1/users/`                | «se borra cuando el front migre» |
| `condiciones.registroPatronal` (texto) conviviendo con `registroPatronalId` | `affiliationModel`             | D‑72, convivencia deliberada     |
| `departamento` (texto crudo) junto a `areas` (modelado)                     | `affiliationModel`             | D‑46                             |
| `categorias.tipo` — **marcado de salida, bloqueado**                        | `categoryModel`                | D‑73                             |

### APIs inconsistentes

- `PATCH /contratos/:id/estado` mueve **`activo`**, no `estado`. Única colisión de nombres del sistema, documentada.
- `activo` en casi todo, pero **`activa`** en `areas`.
- Tres modos de `activo` (`true`/`false`/`todos`) en empleados, adscripciones y expedientes; booleano en el resto.
- El alta de contratos **ignora campos de más en silencio** (`201`); el `PATCH` los rechaza con `400`.

### Modelos que cambiaron varias veces

`affiliations` (D‑46, D‑51, D‑52, D‑55…D‑58, D‑60, D‑72) y `projects` (D‑65…D‑70)
son los que más se movieron. `employees` cambió de eje entero (D‑27…D‑31).

### Cambios que afectan flujos no relacionados

- Tocar `affiliations` mueve **el alcance de toda la API** (`scopeMiddleware`, `authUser`).
- Tocar `categories.tipo` mueve **los permisos** (`canManageEmployeeType`).
- Tocar `records.documentos[]` mueve avance, semáforo, alertas y métricas, todos derivados.
- Tocar `companies.registrosPatronales[]` mueve proyectos y adscripciones por ids **sin `ref`** (§8).

---

## 8. CAMBIOS ARQUITECTÓNICOS RECIENTES

| Cambio                                    | Decisiones  | Por qué importa entender el sistema                                                                                                                                |
| ----------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **El usuario dejó de ser entidad**        | D‑27…D‑31   | No hay colección `usuarios`. Quien entra es un empleado con `acceso`, y la contraseña vive aparte en `credentials` porque las agregaciones ignoran `select: false` |
| **El alcance se deriva, no se guarda**    | D‑27, §8.1  | Ningún `clienteId`/`empresaId` decide visibilidad. Se cruza `affiliations` en cada petición. Fuera de alcance = **404, no 403**                                    |
| **Áreas: de enum a colección**            | D‑58        | El .xlsx puede crear áreas. El contrato viaja la `clave`, no el nombre                                                                                             |
| **`tipo` derivado del puesto**            | D‑59        | Dejó de capturarse y de filtrar. Sigue en el modelo **sólo** porque de él cuelgan los permisos                                                                     |
| **Registros con identidad propia**        | D‑65…D‑67   | `registrosPatronales` y `registrosObra` pasaron de `string[]` a subdocumentos con `_id`. Los apuntan `projects` y `affiliations`                                   |
| **Contratos = fases, SIROC único global** | D‑68…D‑70   | Colección nueva. Traba campos del proyecto según cuántos contratos activos haya                                                                                    |
| **Coherencia de registro patronal**       | D‑71, D‑72  | Avisa, no bloquea. `trazabilidad` y `registroPatronalCoincide` se **resuelven al leer**, sin guardar ids nuevos                                                    |
| **Un solo endpoint de revisión**          | D‑43        | `…/revisar` con `{ aprobado }` sustituyó a `/validar` y `/rechazar`                                                                                                |
| **Alertas derivadas**                     | D‑47, D‑48  | Sin estado, sin job. Se resuelven solas                                                                                                                            |
| **Documentos ahora son de este repo**     | 29 ago 2026 | `modelo-datos.md` y `backend-spec.md` pasaron del front al backend; el front los lee aquí                                                                          |
| **Guardia de documentación**              | 30 ago 2026 | `tests/unitarias/docs.test.js` verifica las cifras de los docs contra el código                                                                                    |
| **`tipo` sale del puesto**                | **D‑73**    | **Decidido, sin implementar, BLOQUEADO** por la redefinición de la matriz de permisos                                                                              |

---

## 9. AGENT CONTEXT MAP

```yaml
- domain: auth
  relevant_docs: [docs/backend-spec.md §6.1, docs/INTEGRACION-FRONTEND.md §4, DECISIONES D-21 D-27 D-49]
  relevant_source: [src/api/v1/auth/, src/middlewares/authMiddleware.js, src/middlewares/passwordMiddleware.js, src/api/v1/credentials/]
  dependencies: [employees, credentials, affiliations, companies]
  external_contracts: ["POST /auth/login (pública)", "GET /auth/me", "POST /auth/logout", "POST /auth/cambiar-password", "403 PASSWORD_TEMPORAL"]
  tests: [tests/integracion/auth.test.js, tests/integracion/passwords.test.js, tests/integracion/bootstrap.test.js, tests/unitarias/credentialIsolation.test.js]

- domain: scope-and-permissions
  relevant_docs: [docs/modelo-datos.md §8, CLAUDE.md "Seguridad", DECISIONES D-32 D-44 D-60]
  relevant_source: [src/middlewares/scopeMiddleware.js, src/utils/permissions.js, src/api/v1/auth/authUser.js]
  dependencies: [affiliations]
  external_contracts: ["404 fuera de alcance, nunca 403", "req.empresasVisibles", "req.areasPorEmpresa"]
  tests: [tests/integracion/scope.test.js, tests/unitarias/permissions.test.js]
  warning: "req.scopeFilter NO existe. Dos agentes y una skill lo dan por hecho."

- domain: employees
  relevant_docs: [docs/backend-spec.md §6.2, docs/INTEGRACION-FRONTEND.md §5, docs/ENDPOINTS-IMPORTACION.md, DECISIONES D-32..D-34 D-46 D-50..D-59]
  relevant_source: [src/api/v1/employees/, src/utils/domain/employeeImport.js]
  dependencies: [affiliations, areas, categories, records, companies, credentials]
  external_contracts: ["GET/POST /empleados", "PATCH /empleados/:id[/estado]", "/empleados/:id/acceso*", "/empleados/importar[/previsualizar]"]
  tests: [tests/integracion/employees*.test.js (4), tests/integracion/access.test.js, tests/unitarias/domain/employeeImport.test.js]
  warning: "employeeImportService: 1488 líneas, escribe en 5 colecciones. Ciclo con records."

- domain: records
  relevant_docs: [docs/ENDPOINTS-EXPEDIENTES.md, docs/modelo-datos.md §6, .claude/skills/records-domain, DECISIONES D-41..D-45]
  relevant_source: [src/api/v1/records/, src/api/v1/checklistTemplates/, src/api/v1/accessLogs/, src/utils/domain/{progress,documentStatus,checklist,expiry}.js, src/services/storageService.js]
  dependencies: [employees, affiliations, checklistTemplates, accessLogs, storage]
  external_contracts: ["GET /expedientes[/:id]", "POST /expedientes/:id/documentos/:tipo", "POST …/revisar { aprobado }", "GET …/versiones/:v/url"]
  tests: [tests/integracion/records.test.js, tests/integracion/recordsList.test.js, tests/unitarias/domain/*]
  warning: "Divergencia conocida con el front en `faltantes` (pending vs pending+rejected)."

- domain: obra
  relevant_docs: [docs/ENDPOINTS-PROYECTOS.md, docs/PLAN-OBRA-CONTRATOS.md, DECISIONES D-65..D-72]
  relevant_source: [src/api/v1/{projects,contracts,assignments,portfolios}/, src/utils/domain/registries.js]
  dependencies: [companies, clients, categories, employees, affiliations]
  external_contracts: ["25 endpoints", "409 SIROC_DUPLICADO", "201 con avisos[]", "registroPatronalCoincide con tres estados"]
  tests: [tests/integracion/{projects,contracts,assignments,portfolios}.test.js]

- domain: catalogos
  relevant_docs: [docs/ENDPOINTS-AREAS.md, docs/ENDPOINTS-ADSCRIPCIONES.md, DECISIONES D-37 D-40 D-58 D-72 D-73]
  relevant_source: [src/api/v1/{companies,clients,categories,areas,affiliations}/]
  dependencies: [affiliations ← todo el alcance]
  external_contracts: ["/empresas*", "/clientes*", "/categorias*", "/areas*", "/adscripciones*", "registros-patronales", "registros-obra"]
  tests: [tests/integracion/{companies,clients,categories,areas,affiliations,jefaturas}.test.js]
  warning: "categories.tipo de salida (D-73). affiliations.nomina existe pero NUNCA se serializa."

- domain: alerts
  relevant_docs: [docs/ENDPOINTS-ALERTAS.md, DECISIONES D-47 D-48]
  relevant_source: [src/api/v1/alerts/, src/utils/domain/alerts.js]
  dependencies: [records, employees]
  external_contracts: ["GET /alertas — derivada, sin estado"]
  tests: [tests/integracion/alerts.test.js, tests/unitarias/domain/alerts.test.js]

- domain: platform
  relevant_docs: [CLAUDE.md, docs/ARQUITECTURA.md (DESACTUALIZADO), docs/ESTADO.md]
  relevant_source: [src/app.js, src/server.js, src/config/, src/middlewares/, src/utils/, src/api/v1/routes/index.js]
  dependencies: []
  external_contracts: ["envelope", "GET /api/v1 (inventario derivado)", "/health", "/ready", "410 en /usuarios*"]
  tests: [tests/integracion/inventario.test.js, tests/unitarias/{database,docs,models}.test.js]
```

---

# MAPA DE DEPENDENCIAS DE MONGODB

## Grafo entre colecciones

```
companies  (RAÍZ — nada apunta hacia arriba)
  ├── registrosPatronales[]  (EMBEBIDO, con _id propio)
  │     ◄── projects.registroPatronalId       (ObjectId SIN ref)
  │     ◄── affiliations.registroPatronalId   (ObjectId SIN ref)
  ├── affiliations.empresaId
  ├── portfolios.empresaId
  ├── projects.empresaId
  └── checklist_templates.empresaId

employees  (CENTRAL — el nodo más referenciado)
  ├── credentials.empleadoId        (1:1, unique)
  ├── records.empleadoId            (1:1, unique)
  ├── affiliations.empleadoId
  ├── assignments.empleadoId
  ├── access_logs.empleadoId + sujetoId
  └── ──► categories.categoriaId

clients
  ├── registrosObra[]  (EMBEBIDO, con _id propio)
  │     ◄── projects.registroObraId  (ObjectId SIN ref)
  ├── portfolios.clienteId
  └── projects.clienteId

projects
  ├── ──► companies, clients, categories[]
  ├── ◄── contracts.proyectoId
  └── ◄── assignments.proyectoId

records
  ├── ──► employees, checklist_templates[]
  ├── documentos[]  (EMBEBIDO)
  │     └── versiones[]  (EMBEBIDO ANIDADO — crece sin tope)
  └── ◄── access_logs.expedienteId

areas      (catálogo por CLAVE string, no por ObjectId)
  ◄── affiliations.areas[]  y  affiliations.dirigeAreas[]   ← acoplamiento por VALOR
```

---

## Colecciones

```yaml
collection: employees
owner_domain: employees
purpose:
  - La persona, catálogo compartido por todas las empresas
  - Contiene el subdocumento `acceso` (quién entra a la plataforma)
important_fields:
  nombre: String
  numeroEmpleado: String|null      # único global (D-54)
  curp: String|null                # OPCIONAL, decisión abierta #2
  rfc, nss, fechaNacimiento, email, telefono: String|null
  categoriaId: ObjectId → Category
  tipo: String                     # derivado del puesto (D-59), de salida con D-73
  acceso: { email, nivelAcceso, alcanceGlobal, activo, passwordTemporal, ultimoAccesoEn } | null
  activo: Boolean
  nombreNormalizado: String        # select:false, búsqueda sin acentos
relationships: [credentials 1:1, records 1:1, affiliations 1:N, assignments 1:N, access_logs 1:N, categories N:1]
indexes:
  - "{curp} unique parcial $type:string"
  - "{numeroEmpleado} unique parcial $type:string"
  - "{'acceso.email'} unique parcial $type:string"
  - "{nombreNormalizado}"
  - "{activo, tipo}"
reads_from: [authService, authMiddleware, employeeService, accessService, employeeImportService, recordService, assignmentService, affiliationService, categoryService, alertService]
writes_from: [employeeService, accessService, employeeImportService, bootstrapAdmin, seedAdminUser, 4 scripts de migración]
affected_endpoints: ["/empleados*", "/auth/*", "/expedientes*", "/alertas", "/asignaciones/:id"]
affected_flows: [login, alta, importación, expediente, alertas, asignación, alcance]
schema_assumptions:
  - "`acceso === null` distingue quien no entra a la plataforma; el código lo compara contra null, no contra undefined"
  - "`tipo` SIEMPRE existe y vale 'administrativo' o 'mano_de_obra' — de ahí cuelga canManageEmployeeType"
  - "La contraseña NO está aquí (D-27). Hay una prueba que impide reembeberla"
migration_history:
  - "D-27..D-31: nació de la colección `usuarios`, hoy retirada (410)"
  - "D-50/D-54: `numeroEmpleado` se movió de la adscripción a la persona"
  - "D-59: `tipo` dejó de capturarse"
risks:
  - "Quitar `tipo` (D-73) rompe la matriz de permisos entera"
  - "`nombreNormalizado` se mantiene en pre('validate'): un update directo lo deja viejo"
technical_debt:
  - "`accessLevelToRole()` sigue emitiendo `role` para un front que ya migró"
  - "Índice {activo, tipo} quedará inútil con D-73"
```

```yaml
collection: affiliations
owner_domain: affiliations
purpose:
  - La relación laboral empresa ↔ empleado
  - LA FUENTE DEL ALCANCE de toda la API
important_fields:
  empresaId, empleadoId: ObjectId
  areas: [String]                   # claves de `areas`, NO ObjectIds
  dirigeAreas: [String]             # jefaturas (D-60)
  departamento: String|null         # texto crudo de la nómina
  registroPatronalId: ObjectId|null # SIN ref → subdoc de companies (D-72)
  condiciones: { registroPatronal, turno, tipoRegimen, ... }
  nomina: {...}                     # select:false, NUNCA se serializa (LFPDPPP)
  tipoContrato, fechaIngreso, fechaTerminoContrato
  datosPendientes: [String]
  activo, motivoBaja, fechaBaja
relationships: [companies N:1, employees N:1]
indexes: ["{empresaId, empleadoId} unique", "{empresaId, activo, areas}", "{empleadoId, activo}"]
reads_from: [scopeMiddleware, authUser, affiliationService, employeeService, recordService, assignmentService, areaService, companyService, employeeImportService]
writes_from: [affiliationService, employeeService, employeeImportService, 3 scripts]
affected_endpoints: ["TODAS las autenticadas — el alcance sale de aquí"]
affected_flows: [login, alcance, alta, importación, expediente, asignación, jefaturas]
schema_assumptions:
  - "`areas[]` guarda CLAVES string del catálogo `areas`: renombrar una clave rompe el vínculo en silencio"
  - "`registroPatronalId` apunta a un subdocumento embebido en companies — Mongo NO lo valida"
  - "`nomina` existe pero ninguna respuesta lo devuelve. NO agregarlo al toJSON (decisión abierta #10)"
  - "El scope asume que TODA adscripción activa da visibilidad de su empresa"
migration_history:
  - "D-46: llegó `departamento`, `datosPendientes`, `nomina`"
  - "D-58: `areas` dejó de ser enum"
  - "D-60: se separó `dirigeAreas` de `areas`"
  - "D-72: llegó `registroPatronalId` (npm run migrate:vinculo-rp)"
risks:
  - "CRÍTICO: un cambio aquí redefine quién ve qué en toda la API"
  - "Duplicación deliberada: `registroPatronalId` (vínculo) vs `condiciones.registroPatronal` (texto), y `areas` vs `departamento`"
  - "Sin índice sobre `registroPatronalId`: la comparación de D-71 recorre"
technical_debt:
  - "365 líneas de modelo, el más grande. Cinco grupos de campos con orígenes distintos"
```

```yaml
collection: records
owner_domain: records
purpose:
  - Expediente, 1 a 1 con el empleado. El checklist va EMBEBIDO
important_fields:
  empleadoId: ObjectId # unique por definición del campo
  plantillas: [ObjectId → ChecklistTemplate]
  documentos:
    [
      {
        tipo,
        requerido,
        estatus,
        vigenciaHasta,
        motivoRechazo,
        revisadoPor,
        revisadoEn,
        versiones: [...]
      }
    ]
relationships: [employees 1:1, checklist_templates N:M, access_logs 1:N]
indexes:
  [
    '{empleadoId} unique (en el campo)',
    "{'documentos.vigenciaHasta'}",
    "{'documentos.estatus'}"
  ]
reads_from: [recordService, alertService, employeeService (avance del renglón)]
writes_from:
  [recordService, employeeService (alta), employeeImportService (resync), syncRecords.js]
affected_endpoints:
  ['/expedientes*', '/empleados/:id/expediente', '/empleados (avance)', '/alertas']
affected_flows: [alta, subida, revisión, descarga, alertas, listados con avance]
schema_assumptions:
  - 'NADA derivado se guarda: `expiring`, `expired`, `avance` y el semáforo se calculan al leer'
  - '`versiones[0]` es SIEMPRE la vigente (se inserta al inicio)'
  - 'Subir limpia motivoRechazo/revisadoPor/revisadoEn'
migration_history:
  - 'D-41: checklist por UNIÓN de plantillas (OR en requerido, MIN en vigencia)'
  - 'D-43: un solo endpoint /revisar'
risks:
  - '`documentos[].versiones[]` es un array anidado que CRECE SIN TOPE — riesgo del límite de 16 MB por documento a largo plazo'
  - 'Los índices sobre arrays embebidos son multikey: el job de vigencias sobre `documentos.vigenciaHasta` traerá el documento entero'
  - 'El borrado compensatorio en R2 sólo cubre una dirección del fallo'
technical_debt:
  - 'recordService mezcla negocio con R2'
```

```yaml
collection: companies
owner_domain: companies
purpose:
  - Entidad raíz. Cambia poco, se lee mucho
important_fields:
  nombre, rfc: String
  registrosPatronales: [{ _id, numero, descripcion, activo }]   # EMBEBIDO
  branding, configuracion
  activo: Boolean
relationships: [affiliations 1:N, portfolios 1:N, projects 1:N, checklist_templates 1:N]
indexes: ["{nombreNormalizado} unique", "{activo}", "{rfc} unique parcial"]
reads_from: [companyService, authUser, affiliationService, assignmentService, portfolioService, employeeImportService]
writes_from: [companyService, migrateEmployerRegistrations.js]
affected_endpoints: ["/empresas*", "/proyectos*", "/adscripciones*", "/asignaciones/:id"]
schema_assumptions:
  - "`registrosPatronales[]._id` es referenciado desde DOS colecciones sin ref de Mongoose"
  - "Los números se guardan en mayúsculas; el alta es idempotente por número"
risks:
  - "ALTO: borrar un registro patronal embebido deja punteros colgados en projects y affiliations, y Mongo no lo impide"
  - "Sin índice sobre `registrosPatronales._id`"
technical_debt:
  - "Baja de empresa bloqueada por conteos que se calculan en caliente"
```

```yaml
collection: clients
owner_domain: clients
important_fields:
  nombre, rfc, contactoEmail, contactoTelefono
  registrosObra: [{ _id, numero, descripcion, activo }]   # EMBEBIDO
relationships: [portfolios 1:N, projects 1:N]
indexes: ["{nombreNormalizado} unique", "{activo}", "{rfc} unique parcial"]
reads_from: [clientService, projectService, portfolioService]
writes_from: [clientService]
affected_endpoints: ["/clientes*", "/empresas/:id/clientes", "/proyectos*"]
risks: ["Mismo patrón de puntero colgante que companies.registrosPatronales"]
```

```yaml
collection: projects
owner_domain: projects
important_fields:
  empresaId, clienteId: ObjectId
  registroPatronalId, registroObraId: ObjectId|null # SIN ref, a subdocs
  categorias: [ObjectId → Category]
  estado: en_curso|finalizado
  fechas: String YYYY-MM-DD
relationships: [companies, clients, categories, contracts 1:N, assignments 1:N]
indexes:
  [
    '{empresaId, estado}',
    '{registroPatronalId}',
    '{registroObraId}',
    '{clienteId}',
    '{empresaId, fechaFinEstimada}',
    '{empresaId, nombreNormalizado} unique'
  ]
reads_from:
  [
    projectService,
    contractService,
    assignmentService,
    clientService,
    companyService,
    affiliationService
  ]
writes_from: [projectService, resolveLegacyProjects.js]
schema_assumptions:
  - 'Los cuatro campos de registros PUEDEN venir null en proyectos heredados, id incluido — el contrato lo permite aunque los datos ya no lo tengan'
  - 'Los candados miran el CAMBIO, no la presencia: reenviar el mismo id sigue funcionando'
migration_history:
  [
    'D-67 referencia, D-69 obligatorios al crear, resolveLegacyProjects cerró los incompletos'
  ]
risks:
  - 'Los candados dependen de contar contratos en vivo: un cambio en contractService.contarPorProyecto los mueve todos'
```

```yaml
collection: contracts
owner_domain: contracts
important_fields:
  proyectoId: ObjectId
  numero: Number                    # lo pone el SERVIDOR, max+1
  nombre: String|null               # la etiqueta de la fase
  siroc: { numero, fechaRegistro, actualizaciones[] } | null  # sin fecha final: se deriva
  estado: en_curso|finalizado       # ≠ activo
  activo: Boolean
indexes: ["{proyectoId, numero} unique", "{proyectoId, estado}", "{'siroc.numero'} unique parcial GLOBAL"]
reads_from: [contractService, projectService (candados)]
writes_from: [contractService]
schema_assumptions:
  - "`siroc.numero` es único en TODO el sistema, no por proyecto ni por empresa"
  - "`estado` y `activo` son cosas distintas por rutas distintas"
risks:
  - "El unique global del SIROC puede chocar entre empresas: el 409 revela nombre de proyecto ajeno (por eso NO se enlaza)"
```

```yaml
collection: assignments
owner_domain: assignments
important_fields:
  { proyectoId, empleadoId, categoriaId, fechaAsignacion, fechaSalida, activo }
indexes:
  [
    '{proyectoId, empleadoId} unique PARCIAL sobre activo:true',
    '{proyectoId, activo}',
    '{empleadoId, activo}'
  ]
schema_assumptions:
  - 'El unique parcial permite histórico y bloquea el duplicado activo. Un unique simple impediría la reincorporación'
  - 'registroPatronalEmpleado y registroPatronalCoincide NO se guardan: se derivan al leer'
risks: ['La derivación cruza affiliations + companies en cada lectura del listado']
```

```yaml
collection: areas
owner_domain: areas
important_fields:
  { clave: String, nombre, esBase: Boolean, temporal: Boolean, activa: Boolean }
indexes: ['{clave} unique', '{nombreNormalizado} unique', '{activa, temporal}']
schema_assumptions:
  - 'El contrato viaja la CLAVE, no el _id ni el nombre'
  - 'affiliations.areas[] y dirigeAreas[] guardan esa clave como string suelto'
risks:
  - 'ACOPLAMIENTO POR VALOR: renombrar una clave rompe todas las adscripciones sin que nada lo detecte. No hay integridad referencial'
  - '`activa`, no `activo`: inconsistencia de nombre con el resto'
```

```yaml
collection: credentials
owner_domain: auth
important_fields:
  { empleadoId: ObjectId unique, passwordHash, intentosFallidos, bloqueadoHasta }
indexes: ['{empleadoId} unique (en el campo)']
schema_assumptions:
  - 'Existe SÓLO para que las agregaciones no filtren el hash: `select:false` se ignora en $lookup (D-27)'
risks: ['Hay una prueba (credentialIsolation) que impide reembeberla en employees']
```

```yaml
collection: access_logs
owner_domain: records
purpose: [Bitácora LFPDPPP; una fila por URL firmada emitida]
important_fields: { empleadoId, sujetoId, expedienteId, tipoDocumento, version }
indexes: ['{expedienteId, createdAt:-1}', '{empleadoId, createdAt:-1}']
writes_from: [recordService (sólo al emitir URL)]
risks: ['Crece sin política de retención ni TTL', 'Sin endpoint para consultarla']
```

```yaml
collection: checklist_templates
owner_domain: records
important_fields:
  { empresaId, clave, tiposContrato: [String], areas: [String], documentos: [...] }
indexes: ['{empresaId, tiposContrato}', '{empresaId, clave} unique']
schema_assumptions:
  ['La resolución es por UNIÓN: OR en `requerido`, MIN en vigencia (D-41)']
technical_debt:
  ['Sin rutas de administración: sólo se siembran (npm run seed:plantillas)']
```

```yaml
collection: categories
owner_domain: categories
important_fields: { nombre, tipo: administrativo|mano_de_obra (REQUIRED), esBase, activo }
indexes: ['{nombreNormalizado} unique', '{tipo, activo}']
risks:
  [
    '`tipo` DE SALIDA (D-73). Quitarlo rompe canManageEmployeeType y la matriz de permisos'
  ]

collection: portfolios
owner_domain: portfolios
important_fields: { empresaId, clienteId, activo }
indexes: ['{empresaId, clienteId} unique', '{empresaId, activo}']
schema_assumptions: ['Reactiva en vez de duplicar (D-37)']
```

---

## DATABASE CHANGE RISK MAP

| Colección               | Riesgo                                  | Por qué                                                                                                                                                                                                                                                                                        |
| ----------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **affiliations**        | **CRÍTICO**                             | De aquí sale el alcance de **toda** la API (`scopeMiddleware`, `authUser`). Un cambio de forma o de semántica en `areas[]`, `empresaId` o `activo` redefine quién ve qué en cada endpoint autenticado. Además guarda datos bloqueados por LFPDPPP y dos pares de campos duplicados a propósito |
| **employees**           | **CRÍTICO**                             | Nodo más referenciado: 5 colecciones apuntan a él. Participa en login, alta, importación, expediente, alertas y asignaciones. `tipo` decide permisos                                                                                                                                           |
| **records**             | **ALTO**                                | Rompe expedientes, avance, semáforo, alertas y métricas de golpe, porque todo se deriva de aquí. Sus arrays anidados crecen sin tope                                                                                                                                                           |
| **companies**           | **ALTO**                                | Entidad raíz, y sus `registrosPatronales[]` embebidos son referenciados desde `projects` y `affiliations` **sin integridad referencial**. Borrar uno deja punteros colgados que Mongo no impide                                                                                                |
| **areas**               | **ALTO**                                | Acoplamiento **por valor**: las adscripciones guardan la `clave` como string. Renombrarla rompe todo en silencio, sin error ni migración automática                                                                                                                                            |
| **projects**            | **MEDIO**                               | Afecta obra, contratos y asignaciones, pero el daño queda dentro de ese dominio. Sus candados dependen de contar contratos en vivo                                                                                                                                                             |
| **clients**             | **MEDIO**                               | Mismo patrón de subdocumento referenciado que companies, con menos consumidores                                                                                                                                                                                                                |
| **categories**          | **MEDIO**, subiendo a **ALTO** con D-73 | Hoy sólo alimenta el desplegable y el `tipo` del empleado. En cuanto se toque `tipo`, arrastra la matriz de permisos entera                                                                                                                                                                    |
| **assignments**         | **MEDIO**                               | Su unique parcial es sutil: cambiarlo a unique simple rompería la reincorporación. Deriva campos al leer cruzando dos colecciones                                                                                                                                                              |
| **contracts**           | **MEDIO**                               | Unidireccional hacia projects, pero el SIROC único **global** puede chocar entre empresas                                                                                                                                                                                                      |
| **credentials**         | **BAJO**                                | Deliberadamente aislada, un solo consumidor. Protegida por prueba                                                                                                                                                                                                                              |
| **portfolios**          | **BAJO**                                | Vínculo simple, dos consumidores                                                                                                                                                                                                                                                               |
| **checklist_templates** | **BAJO** hoy                            | Sin rutas de administración; sólo se siembra. Subiría al implementarlas o al mudar el eje a `empresaId`                                                                                                                                                                                        |
| **access_logs**         | **BAJO**                                | Sólo escritura, un consumidor. Riesgo operativo (crecimiento sin retención), no de acoplamiento                                                                                                                                                                                                |

### Zonas donde un cambio de esquema exigiría migración de datos

1. **`categories.tipo` → área** (D-73): remapear todas las categorías y rehacer permisos.
2. **`areas.clave`**: cualquier renombre exige recorrer `affiliations.areas[]` y `dirigeAreas[]`.
3. **`records.documentos[].versiones[]`**: sacar las versiones a colección propia si el documento se acerca a 16 MB.
4. **`registrosPatronales`/`registrosObra` a colección propia**: hoy embebidos con `_id` referenciado desde fuera; extraerlos tocaría `projects` y `affiliations`.
5. **Quitar `accessLevelToRole()`**: no requiere migración, pero rompe a cualquier cliente que aún lea `role`.

### Índices que podrían faltar

- `affiliations.registroPatronalId` — sin índice, y D-71/D-72 lo consultan al leer asignaciones.
- `companies.registrosPatronales._id` y `clients.registrosObra._id` — sin índice; se resuelven recorriendo el array embebido.
- `employees.categoriaId` — sin índice, y el listado lo cruza.
- `records.plantillas` — sin índice.
- `contracts.activo` — los candados cuentan por proyecto y estado, no por `activo`.
