# CLAUDE.md — Backend de expedientes laborales (Urbacames)

Punto de entrada para cualquier agente o persona que llegue a este repo. Léelo
completo antes de tocar código; toma 3 minutos y evita reescrituras.

## Qué es esto

API de la plataforma de **expedientes laborales de Urbacames**: checklist de
documentos por colaborador, carga de archivos, validación por RH, control de
vigencias, alertas y reportes de auditoría.

- El **front ya está construido** contra una capa simulada, pero **todavía asume
  el modelo anterior**: su interfaz se ajusta después (ver `modelo-datos.md` §11).
- Documentos autoritativos, los dos en `docs/`:
  - **`modelo-datos.md`** — qué se guarda y cómo se relaciona. Manda en modelado.
  - **`backend-spec.md`** — cómo se habla con el backend: envelope, códigos,
    errores y catálogo de rutas.
- `backend-spec.md` en la raíz es la versión **anterior** de la especificación, de
  cuando el eje era el cliente. Se conserva como referencia histórica; **no la
  sigas**.
- El proyecto hermano `~/Documents/projects/talentlink-backend` es el **origen de
  las convenciones**, no un repo del que se copie sin revisar: lo que se mejoró
  respecto a él está en `docs/DECISIONES.md`.

## Arrancar

```bash
npm install
cp .env.example .env      # y llena MONGODB_URI y JWT_SECRET
npm run db:up             # MongoDB 8 local (docker), replica set, puerto 27018
npm run dev               # http://localhost:8080/api/v1/health
npm test                  # 79 pruebas, base en memoria (no necesita Mongo)
npm run lint
```

El proceso **no arranca** si el entorno está incompleto o si no hay base de
datos: es deliberado (`src/config/env.js`, `src/config/database.js`).

**MongoDB 4.2+ y replica set**, las dos cosas no negociables: Mongoose 8 va con el
driver 6, y el modelo usa transacciones (crear un empleado escribe su expediente;
dar acceso escribe empleado y credencial). El `mongo:3.6` que ocupa el 27017 en
las máquinas del equipo **no sirve**; el de este repo vive en el 27018 como
replica set de un nodo y los dos conviven. `maximum wire version` → D-22;
`Transaction numbers are only allowed on a replica set` → D-29.

**Primer acceso.** Si la colección de usuarios está vacía, el arranque crea un
`rh_admin` con `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`
(`alexxruff@yahoo.com` / `1234` por defecto). Sólo ocurre con la base vacía, es
idempotente y se apaga con `BOOTSTRAP_ADMIN_ENABLED=false` — ver D-21. Alternativa
manual para cualquier momento: `npm run seed:admin`. **Antes de exponer el backend,
cambia esa contraseña y apaga el bootstrap.**

## Idiomas — la regla que más se equivoca

| Qué                                                                   | Idioma                               |
| --------------------------------------------------------------------- | ------------------------------------ |
| Rutas (`/usuarios`, `/expedientes`)                                   | **español** (el front ya las llama)  |
| Llaves JSON del dominio (`nivelAcceso`, `vigenciaHasta`, `clienteId`) | **español** (contrato)               |
| Valores de enums (`rh_admin`, `obra_determinada`)                     | **español** (igualdad estricta)      |
| Mensajes de error                                                     | **español** (se muestran al usuario) |
| Archivos, funciones, variables, modelos, colecciones                  | **inglés**                           |
| Campos internos que no se serializan (`nameNormalized`)               | **inglés**                           |

Mapa de nombres (modelo → colección → nombre en el spec):
`Company`/`companies`/empresas · `Employee`/`employees`/empleados ·
`Credential`/`credentials`/credenciales · `Client`/`clients`/clientes ·
`Category`/`categories`/categorías · `Affiliation`/`affiliations`/adscripciones ·
`Portfolio`/`portfolios`/carteras · `Assignment`/`assignments`/asignaciones ·
`Project`/`projects`/proyectos · `Record`/`records`/expedientes ·
`ChecklistTemplate`/`checklist_templates`/plantillas ·
`AccessLog`/`access_logs`/bitácora.

## Estructura

```
src/
  api/v1/
    auth/               login, me, logout, cambiar-password (+ authUser.js)
    employees/          catálogo de personas + accesos (sub-recurso) +
                        importación desde el .xlsx de nómina (D-46)
    credentials/        material secreto, aislado (D-27)
    companies/          empresas: la entidad raíz
    affiliations/       adscripción empresa ↔ empleado: la relación laboral
    alerts/             bandeja derivada: documentos y cumpleaños (D-47)
    clients/ categories/  catálogos compartidos
    checklistTemplates/ plantillas (pendiente de mudar a empresaId)
    users/goneRoutes.js /usuarios → 410, se borra cuando el front migre
    routes/             index.js monta los recursos y expone el inventario
  models/index.js       registra TODOS los modelos (D-31). Agrega los nuevos aquí
  config/               env.js (validado con zod) · database.js
  constants/            enums del contrato
  middlewares/          authMiddleware · scopeMiddleware · validateRequest ·
                        errorHandler · requestContext · rateLimiters
  utils/                response (envelope) · asyncHandler · dates · text ·
                        permissions · logger · routeInventory · spreadsheet
  utils/domain/         reglas PURAS: documentStatus · progress · alerts ·
                        checklist · expiry · employeeImport
  services/             bootstrapAdmin · seedChecklistTemplates
scripts/                semillas, índices y migración
tests/                  unitarias/ · integracion/ · helpers/
docs/                   modelo-datos · backend-spec · arquitectura · contrato ·
                        decisiones · estado · integración y cambios del front
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

## El usuario de la plataforma

**No hay colección de usuarios.** Quien entra es un **empleado con `acceso`**
(`empleados.acceso` = email, nivelAcceso, alcanceGlobal, activo). La contraseña
vive en `credentials`, aparte, porque las agregaciones ignoran `select: false` y
el listado de empleados es un `$lookup` sobre `empleados` — ver **D-27**, y no lo
"simplifiques" volviendo a embeberla: hay una prueba que lo impide.

Se administra como sub-recurso: `POST/PATCH/DELETE /empleados/:id/acceso`. Así es
imposible acabar con dos registros de la misma persona.

## Seguridad: el alcance se DERIVA, no es un campo

- `req.empresasVisibles` — ids de las empresas donde el usuario tiene adscripción
  activa, o `null` = todas (administrador de plataforma, `acceso.alcanceGlobal`).
- `req.areasPorEmpresa` — `{ empresaId: [areas] }`, para el jefe de área.
- Toda consulta de datos de empleados cruza `affiliations`; el `empresaId` **nunca
  se lee del body ni del query** para decidir alcance: si llega, sólo acota
  (`empresaFiltro`).
- Fuera de alcance: **404, no 403**.
- Permisos por capacidad: `requireCapability(CAPABILITIES.X)` contra
  `utils/permissions.js`. Los catálogos compartidos exigen además `alcanceGlobal`.
- Ninguna ruta pública salvo `POST /auth/login`, `GET /api/v1`, `/health` y
  `/ready`.

## Antes de decir "listo"

- [ ] `npm test` y `npm run lint` en verde; `npx prettier --write` en lo tocado.
- [ ] Prueba de integración del camino feliz, 401, 403, **404 por alcance** y 400.
- [ ] `docs/CONTRATO-API.md` con la forma exacta de la respuesta nueva, y
      `docs/INTEGRACION-FRONTEND.md` si el cambio afecta a lo que el front ya usa.
- [ ] `docs/ESTADO.md` actualizado (es el mapa de qué falta).
- [ ] Desviaciones del spec anotadas en `docs/DECISIONES.md`, con el motivo.

## Estado

**Hecho:** base del proyecto, replica set con transacciones, todas las
colecciones del modelo nuevo, sesión con el `AuthUser` nuevo, administración de
accesos, empleados (alta con expediente, edición, baja, listado con alcance y
paginación), empresas, categorías, clientes, carteras, proyectos, asignaciones,
adscripciones (alta, edición y baja de una empresa), y expedientes completos:
listado paginado, consulta, subida a R2 con versionado, checklist por unión y
revisión (validar/rechazar). Y la **importación de colaboradores desde el .xlsx
de nómina**: previsualizar, aplicar, y volver a subir el mismo archivo sin
duplicar a nadie (D-46).

Y las **alertas**: `GET /alertas` con documentación faltante (más vencida, por
vencer y rechazada) y cumpleaños, **derivadas en cada consulta** (D-47) — por eso
se resuelven solas y no hay nada que marcar.

**Pendiente:** métricas, reportes y el job diario de vigencias — ver
`docs/ESTADO.md` para el detalle y el orden sugerido.

**Decisión abierta que bloquea al front:** `affiliations.nomina` guarda salario,
SBC y cuenta bancaria porque el archivo de nómina los trae, pero **ninguna
respuesta los devuelve** hasta que se decida quién puede verlos (LFPDPPP). No
"arregles" esto agregándolos al `toJSON`: ver D-46 y `ESTADO.md` #10.

El detalle, con checkboxes y el orden sugerido, está en `docs/ESTADO.md`.
