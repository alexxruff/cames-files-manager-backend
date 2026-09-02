# Estado del backend

Mapa de qué está hecho y qué falta. **Actualízalo al cerrar cada módulo**: es lo
primero que lee quien llega, humano o agente.

Última actualización: **2026-08-31** · toda la suite en verde.

> **No se anota aquí cuántas pruebas son.** El número se queda viejo a la
> primera prueba que alguien agregue —pasó tres veces— y no dice nada que
> `npm test` no diga mejor. Lo que sí se verifica solo es el resto de las cifras
> de la documentación: `tests/unitarias/docs.test.js`.

El modelo autoritativo es [`modelo-datos.md`](./modelo-datos.md) (jerarquía de
empresas, catálogos compartidos y vínculos) y el contrato es
[`backend-spec.md`](./backend-spec.md). Lo implementado antes sobre el modelo
anterior (usuarios con `clienteId`) **ya se migró**: ver D-27 a D-31 en
[`DECISIONES.md`](./DECISIONES.md).

## Leyenda

✅ hecho y probado · 🟡 parcial · ⬜ no empezado · 🔒 no implementar todavía

---

## Base del proyecto

| Pieza                                                           | Estado | Dónde                                                      |
| --------------------------------------------------------------- | ------ | ---------------------------------------------------------- |
| Esqueleto de capas y convenciones                               | ✅     | `src/`, `CLAUDE.md`                                        |
| Entorno validado (zod), falla al arrancar                       | ✅     | `src/config/env.js`                                        |
| Requisitos de entorno legibles sin dispararlos                  | ✅     | `src/config/env.schema.js`, `npm run env:requisitos`       |
| MongoDB **replica set** local (transacciones)                   | ✅     | `docker-compose.yml`, D-29                                 |
| Conexión con reintentos y diagnóstico de errores                | ✅     | `src/config/database.js`                                   |
| Registro central de modelos (evita MissingSchemaError)          | ✅     | `src/models/index.js`, D-31                                |
| Apagado ordenado (SIGTERM/SIGINT)                               | ✅     | `src/server.js`                                            |
| Envelope de respuesta y `AppError`                              | ✅     | `src/utils/response.js`, `src/middlewares/errorHandler.js` |
| Validación con `errors[{ msg, path }]`                          | ✅     | `src/middlewares/validateRequest.js`                       |
| Logger JSON + `X-Request-Id`                                    | ✅     | `src/utils/logger.js`                                      |
| Rate limit general y de login                                   | ✅     | `src/middlewares/rateLimiters.js`                          |
| CORS por lista blanca                                           | ✅     | `src/app.js`                                               |
| Enums del contrato                                              | ✅     | `src/constants/`                                           |
| Fechas de calendario y aritmética                               | ✅     | `src/utils/dates.js`                                       |
| Búsqueda insensible a acentos                                   | ✅     | `src/utils/text.js`                                        |
| Inventario de la API (`GET /api/v1`)                            | ✅     | `src/utils/routeInventory.js`                              |
| Esqueleto real del código (colecciones, campos, índices, rutas) | ✅     | `src/utils/schemaSkeleton.js`, `npm run esqueleto`         |
| Identidad del release (`GET /version`), horneada al construir   | ✅     | `src/api/v1/routes/index.js`, `Dockerfile`, D-74           |
| Administrador de plataforma inicial                             | ✅     | `src/services/bootstrapAdmin.js`                           |
| Migración `app_users` → modelo nuevo                            | ✅     | `scripts/migrateUsersToEmployees.js`                       |
| Dockerfile · ESLint · Prettier                                  | ✅     | raíz                                                       |
| Skills y agentes del proyecto                                   | ✅     | `.claude/`                                                 |
| Guía e instrucciones para el front                              | ✅     | `docs/INTEGRACION-FRONTEND.md`, `docs/CAMBIOS-FRONTEND.md` |
| CI                                                              | ⬜     | —                                                          |

## Modelo de datos

| Colección             | Modelo              | Estado | Notas                                                                                                                                                                                                                                                |
| --------------------- | ------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `companies`           | `Company`           | ✅     | Nombre único normalizado, branding y configuración                                                                                                                                                                                                   |
| `employees`           | `Employee`          | ✅     | La persona, con `acceso` opcional. Sin contrato ni áreas                                                                                                                                                                                             |
| `credentials`         | `Credential`        | ✅     | Secreto aislado, 1 a 1 con el empleado (D-27)                                                                                                                                                                                                        |
| `clients`             | `Client`            | ✅     | Catálogo global, sin empresa dueña                                                                                                                                                                                                                   |
| `categories`          | `Category`          | ✅     | Catálogo global                                                                                                                                                                                                                                      |
| `affiliations`        | `Affiliation`       | ✅     | Adscripción empresa ↔ empleado: la relación laboral                                                                                                                                                                                                  |
| `portfolios`          | `Portfolio`         | ✅     | Cartera empresa ↔ cliente; sacar falla si hay proyectos                                                                                                                                                                                              |
| `assignments`         | `Assignment`        | ✅     | Índice parcial: histórico + sin duplicado activo                                                                                                                                                                                                     |
| `contracts`           | `Contract`          | ✅     | Contrato = fase (`nombre` y `fase`, D-75), con el SIROC embebido —número y fecha de registro, sin fecha final—, único global (D-70) y sus refrendos de cada 2 meses (D-76). Lleva además **su propio archivo**: el contrato firmado escaneado (D-81) |
| `projects`            | `Project`           | ✅     | Aplazamientos en el historial; registro patronal y de obra obligatorios en los nuevos (D-69)                                                                                                                                                         |
| `records`             | `Record`            | ✅     | Expediente, 1 a 1 con el empleado (`empleadoId` único, D-41)                                                                                                                                                                                         |
| `checklist_templates` | `ChecklistTemplate` | ✅     | Eje en `empresaId`; resolución por **unión** de plantillas, OR en requerido y MIN en vigencia (D-41)                                                                                                                                                 |
| `access_logs`         | `AccessLog`         | ✅     | Bitácora; se escribe en cada URL firmada emitida (LFPDPPP)                                                                                                                                                                                           |

## API

| Módulo                             | Spec      | Estado | Notas                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | --------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sesión (`/auth`)                   | 6.1       | ✅     | login, me, logout, cambiar-password con `AuthUser` nuevo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Contraseñas temporales             | 6.1       | ✅     | La que puso un admin (o el bootstrap) bloquea la API hasta cambiarla (D-49)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Recuperar por correo               | 6.1       | ⬜     | La repone un `rh_admin` y queda temporal (D-49); falta el flujo por correo, que necesita mailer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Jefaturas de área                  | —         | ✅     | `dirigeAreas` explícito: trabajar en un área ya no es dirigirla (D-60)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Alcance por empresa                | 8.1       | ✅     | `applyScope` deriva de adscripciones activas                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Matriz de permisos                 | 8.2       | ✅     | Capacidades + `alcanceGlobal`. **Una sola tabla**, la de modelo §8.2, comparada celda por celda contra `utils/permissions.js` por `docs.test.js` (#4)                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Accesos (`/empleados/:id/acceso`)  | 6.2       | ✅     | Dar, editar, quitar, restablecer (D-30)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Empleados — listado y detalle      | 6.2       | ✅     | Agregación con alcance, filtros, orden y paginación; orden por número con o sin `empresaId` (D-51, D-53); `activo` en tres estados y `busqueda` por número (D-52)                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Empleados — **alta**               | 6.2       | ✅     | Persona + adscripción en transacción, permisos por tipo, duplicados (D-32 a D-34); `numeroEmpleado` obligatorio (D-50, D-54); `tipo` derivado del puesto (D-59)                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Áreas** (`/areas`)               | —         | ✅     | Catálogo administrable: 9 base, temporales desde el archivo, baja y reactivación (D-58)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Categorías                         | 6.2       | ✅     | CRUD con `tipo`, alta idempotente por nombre                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Empleados — edición y baja         | 6.2       | ✅     | Editar: quien puede crear ese tipo. Baja: `rh_admin`. El acceso y las adscripciones tienen su propia ruta                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Clientes                           | 6.2       | ✅     | CRUD, baja lógica y **acotado por cartera** (D-40); el registro de obra lleva **su papel adjunto**, opcional y reemplazable, con el enlace firmado en cada lectura (D-79)                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Empresas                           | 6.3       | ✅     | Alta sólo admin de plataforma, listado con conteos                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Adscripciones                      | 6.3       | ✅     | Alta, edición y baja de esa empresa; baja cierra sus asignaciones ahí (D-45); filtros y orden (D-51); `activo` con default excluyente (D-52); **vínculo con el registro patronal** de su empresa (D-72)                                                                                                                                                                                                                                                                                                                                                                                       |
| Carteras                           | 6.3       | ✅     | Bajo la empresa; reactiva en vez de duplicar (D-37)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Proyectos                          | 6.4       | ✅     | CRUD, aplazar, finalizar, reabrir, clonar categorías (D-38)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Asignaciones                       | 6.4       | ✅     | Con `asignables` (§9.3), cierre con fecha de salida, y el **aviso de registro patronal** más `GET /asignaciones/:id` con la cadena resuelta (D-71)                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Contratos y SIROC                  | 6.7       | ✅     | Contrato = fase, con `nombre` y `fase` como etiquetas separadas (D-75); SIROC embebido y único global; traba los cambios del proyecto (D-70). **Actualización cada 2 meses** con `seguimientoSiroc` derivado al leer, y sin fecha final que capturar (D-76); el aviso lleva **su papel escaneado** y cada refrendo **su acuse**, los dos opcionales y con el enlace firmado en cada lectura (D-80). Y el **contrato escaneado**, que se adjunta al capturar o después con el mismo `PATCH`; el tope de subida pasó a **30 MB** para todos los adjuntos, menos la importación de nómina (D-81) |
| Expedientes y documentos           | 6.5       | ✅     | Listado paginado, consulta, subida y **revisar** (valida y rechaza) (D-42, D-43, D-45); mismos filtros nuevos que `/empleados` (D-52); el detalle trae **`obras`**: el SIROC de la obra donde trabaja —con su archivo (D-80)— y el contrato con el suyo (D-81), derivado al leer (D-77)                                                                                                                                                                                                                                                                                                       |
| Lógica de dominio                  | modelo §6 | ✅     | Estatus, avance, semáforo, vigencias y la **unión** de plantillas, listos y probados                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Importar colaboradores (.xlsx)     | —         | ✅     | Previsualizar y aplicar; idempotente al re-subir; crea puestos y adscripciones (D-46); el `Estatus` da de baja también del sistema a quien se queda sin empresa (D-55); no pisa lo corregido a mano y lo reporta (D-56, D-57)                                                                                                                                                                                                                                                                                                                                                                 |
| Alertas (`GET /alertas`)           | 6.6       | ✅     | Derivadas y sin estado (D-47); **agrupadas por empleado y paginadas** (D-48)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **`tipo` fuera del puesto** (D-73) | —         | 🔒     | **Decidido, sin implementar y bloqueado**: el área sustituye a `categorias.tipo`, pero primero hay que redefinir la matriz de permisos, que hoy cuelga de él (`canManageEmployeeType`). Ver D-73                                                                                                                                                                                                                                                                                                                                                                                              |
| Métricas y reportes                | 6.6       | ⬜     | Derivados. `/dashboard/metricas` y `/reportes/expedientes`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Plantillas de checklist            | 6.5       | 🟡     | La resolución por unión está y sembrada; falta **administrarlas** (`GET`/`PATCH /plantillas-checklist`) y mudar el eje a `empresaId`                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Árbol de `/organizacion`           | 6.3       | ⬜     | Empresa → áreas → proyectos (modelo §9.2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Almacenamiento R2                  | 7         | ✅     | Bucket `cames-files/employes-files`, probado de punta a punta; `npm run r2:check` (D-41). Acepta **PDF, JPG, PNG, WEBP, DOC, DOCX, XLS, XLSX y CSV**, y cada archivo dice si es `previsualizable` (D-78)                                                                                                                                                                                                                                                                                                                                                                                      |
| Job diario de vigencias            | 8         | ⬜     | Un correo por persona, idempotente                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/usuarios` (modelo anterior)      | —         | ✅     | Responde **410** con las rutas nuevas                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Orden sugerido

1. ~~Colecciones base + credenciales + `/auth` + migración~~ ✅
2. ~~**Empresas, categorías y el alta de personal**~~ ✅ Con la matriz corregida
   (D-32), la adscripción obligatoria en el alta (D-33) y la política de
   duplicados (D-34).
3. ~~**Edición y baja de empleados**~~ ✅
4. ~~**Clientes**~~ ✅
5. ~~**Carteras, proyectos y asignaciones**~~ ✅
6. ~~**Expedientes**: consulta, subida a R2 con versionado y checklist por unión~~
   ✅ (D-41)
7. ~~**Revisión de documentos**: validar y rechazar~~ ✅ un solo endpoint,
   `POST …/revisar` (D-43, D-44)
8. ~~**`GET /expedientes` paginado**~~ ✅ §6.5 queda cerrado (D-45)
9. ~~**Adscripciones con sus rutas**~~ ✅ alta, edición y baja de esa empresa,
   sin recrear a la persona (D-45)
10. ~~**Importación de colaboradores desde .xlsx**~~ ✅ los dos endpoints,
    idempotente al re-subir el mismo archivo (D-46). No estaba en el backlog
    original: lo pidió Urbacames para no capturar a mano a los 145 que ya tienen
    en nómina.
11. ~~**Alertas**~~ ✅ `GET /alertas` con las dos familias que pidió Urbacames
    —documentación faltante y cumpleaños—, derivadas y sin estado que apagar
    (D-47).
12. ~~**La cadena de la obra**~~ ✅ fases 1 a 6 de 8 de
    `PLAN-OBRA-CONTRATOS.md`: registros patronales y de obra con identidad
    propia, el proyecto referenciándolos, los contratos con su SIROC único, y la
    coherencia del registro patronal al asignar —que **avisa, no bloquea**— con
    la trazabilidad completa resuelta al leer (D-65 a D-71).
13. ~~**Fase 7 del plan de obra**~~ ✅ `affiliations.registroPatronalId` con su
    migración **M3** (`npm run migrate:vinculo-rp`) y el importador resolviéndolo
    (D-72). La cadena deja de depender de comparar cadenas de texto donde hay
    vínculo, y donde no lo hay sigue funcionando con el texto.
14. ~~**Fase 8 del plan de obra**~~ ✅ migraciones corridas y respaldos borrados en
    **local y en Fly**, `ARQUITECTURA-DATOS.md` al día y el mensaje al front en
    `CAMBIOS-FRONTEND-OBRA.md`. El plan de obra queda cerrado.
15. ~~**Extractor del esqueleto real**~~ ✅ `npm run esqueleto` contesta desde el
    código —esquemas de Mongoose y stack de Express— qué colecciones, campos,
    índices y rutas existen hoy, sin base de datos y sin `.env`. Es la vara con
    la que se mide si un documento sigue siendo cierto (plan #1).
16. ~~**Reconciliar la documentación del modelo y del contrato**~~ ✅ una sola
    versión de `modelo-datos.md` y `backend-spec.md`, la de este repo,
    contrastada contra el extractor: se corrigieron cuatro afirmaciones falsas
    sobre rutas y seis sobre campos —entre ellas la contraseña embebida en
    `empleados.acceso`, que D-27 movió a `credentials`—. Cada diferencia con la
    copia del front y qué se decidió, en
    [`RECONCILIACION-DOCS.md`](./RECONCILIACION-DOCS.md). El candado nuevo de
    `docs.test.js` falla si un documento cita una ruta que no existe ni está
    declarada pendiente (plan #2).
17. **Métricas y reportes**, y el job diario de vigencias con correos. Lo que
    queda del backlog original. El job puede reusar `deriveAlerts` tal cual.

## Decisiones abiertas

> **Las dos que bloquean trabajo hoy son la #10** (quién ve la nómina, traba una
> pantalla del front) **y la #18** (la matriz de permisos, traba D-73). El resto
> son confirmaciones o constantes: se pueden dejar correr sin que se detenga
> nada. Las tachadas ya se resolvieron y se dejan para no repetir la discusión.

1. ~~¿El expediente se comparte entre empresas del grupo?~~ **Resuelto:** es de la
   persona, uno por `empleadoId`, y el checklist es la unión de las plantillas de
   sus adscripciones activas (D-41).
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
10. **¿Quién puede ver el salario, el SBC y la cuenta bancaria?** La importación
    los guarda en `affiliations.nomina` (D-46) porque el archivo de nómina los
    trae y sirven para no volver a capturarlos, pero **hoy ninguna respuesta de la
    API los devuelve**: son datos personales sensibles bajo la LFPDPPP y, sin una
    regla, los vería cualquiera que pueda ver la adscripción —incluido
    `jefe_area` en sus áreas—. El mecanismo ya existe (capacidad propia +
    bitácora de accesos, como los documentos sensibles); falta la decisión de
    negocio. **Está bloqueando** que el front pueda mostrar nómina.
11. **La lista de puestos que cuentan como mano de obra**
    (`PALABRAS_MANO_DE_OBRA` en `utils/domain/employeeImport.js`). Con los 19
    puestos del archivo de Maquinaria Cames clasifica bien, y el catálogo manda
    cuando el puesto ya existe, pero conviene revisarla contra los puestos reales
    de todas las empresas del grupo. Es una constante de una línea.
12. **¿La bandeja necesita "posponer" una alerta?** Hoy no se puede, a propósito:
    las alertas se derivan y no hay estado que guardar (D-47). Si RH pide «no me
    lo recuerdes hasta el lunes», se diseña como aplazamiento por usuario y
    documento —nunca como un campo `resuelta`—, para que sigan derivándose.
13. **¿Los cumpleaños van en la misma bandeja que los pendientes de expediente?**
    Hoy sí, con la severidad más baja para que no tapen nada. Si en la interfaz
    conviven mal, se separan con `?origen=` sin tocar el backend.
14. **La ventana de aviso de cumpleaños** (hoy 7 días, `DIAS_ALERTA_CUMPLEANOS`).
15. **Las 99 fechas de término de contrato pendientes.** Entran marcadas en
    `datosPendientes` (D-46) y mientras lo estén su documento `contrato` no
    deriva vigencia. Falta capturarlas, y falta decidir si se avisa en el tablero.
16. ~~¿Se vincula la adscripción a su registro patronal?~~ **Resuelto:** sí,
    `affiliations.registroPatronalId` (D-72), y M3 corrió en los dos entornos:
    144 de 144, ninguna sin resolver. Si en el futuro un archivo trae un registro
    que no está en el catálogo, hay que agregarlo a mano y volver a importar: el
    importador no los crea (eso es del administrador de plataforma).
17. ~~Los proyectos sin registro de obra (o sin ninguno de los dos)~~
    **Resuelto el 30 de agosto de 2026.** Los proyectos anteriores a D-69 se
    quedaron sin esos campos porque la obligatoriedad se aplica sólo al crear.
    Se cerró con `npm run proyectos:incompletos`, en dos pasos y en los dos
    entornos: primero `--rellenar`, que **no pisa lo que ya está** y omite los
    proyectos sin candidato, y después `--borrar` sobre lo que quedó.

    | Entorno | Qué pasó                                                                                                      |
    | ------- | ------------------------------------------------------------------------------------------------------------- |
    | local   | «Plenares» rellenado (`R13-77767-10-5` + `OB-2026-0145`); «Torre Andares — Etapa 2» borrado con su asignación |
    | Fly     | «Axis 3» borrado, sin asignaciones                                                                            |

    Los tres borrados o rellenados eran datos de prueba. Se borraron los dos que
    **no se podían rellenar**: sus empresas —Urbacames Edificación y Urbanizadora
    Cames— no tienen ningún registro patronal capturado, así que completarlos
    habría exigido inventar cuatro registros en el catálogo.

    Los dos entornos reportan **0 incompletos**. A partir de aquí, todo proyecto
    tiene exactamente un registro patronal y uno de obra — la invariante de la
    Fase 4, ahora cierta también para lo heredado. **Ojo para el front:** el caso
    `registroPatronalId: null` ya no se da en los datos, pero el contrato lo
    sigue permitiendo y `GET /proyectos` puede devolverlo si alguien vuelve a
    dejar un proyecto a medias por la base.

18. **¿Cómo queda la matriz de permisos cuando `tipo` salga del puesto?**
    **BLOQUEA a D-73**, que ya está decidido: `categorias.tipo` desaparece y lo
    sustituye el área. Lo que falta es que hoy `canManageEmployeeType`
    (`utils/permissions.js`) decide con `tipo` quién gestiona a quién —
    `rh_consulta` y `jefe_area` dan de alta personal de obra pero no
    administrativos— y con nueve áreas en vez de dos tipos hay que rehacerla.
    Dos caminos:

    | Camino                                       | Qué implica                                                 |
    | -------------------------------------------- | ----------------------------------------------------------- |
    | Marcar cada área con quién puede gestionarla | Un campo nuevo en `areas`; la matriz de §8.2 se queda igual |
    | Permisos por área en el nivel de acceso      | Más fino y más cerca de `RUMBO.md`; rehace la matriz entera |

    **Hasta que se elija, D-73 no se empieza**: es la parte que rompe seguridad
    si se improvisa. El alcance completo del cambio está en D-73.
