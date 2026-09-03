# Arquitectura de datos y relaciones

**Qué es esto:** el mapa de lo que existe **hoy** en la base — qué colecciones
hay, cómo se relacionan y qué se rompe si tocas cada una. Se lee antes de
cambiar cualquier esquema.

**Cómo se relaciona con los otros documentos:**

| Documento            | Qué manda                                                       |
| -------------------- | --------------------------------------------------------------- |
| **Este**             | **Lo que HAY**: colecciones, relaciones e impacto de cambiarlas |
| `modelo-datos.md`    | El diseño y su porqué. Ha derivado; donde discrepe, manda éste  |
| `backend-spec.md`    | El contrato HTTP: envelope, códigos, enums y catálogo de rutas  |
| `DECISIONES.md`      | Por qué cada cosa es como es (D-01 … D-83)                      |
| `CONTRATO-API.md`    | La forma de las respuestas HTTP, petición por petición          |
| `ARQUITECTURA.md`    | Las capas del código (modelo → servicio → controlador → ruta)   |
| `ESTADO.md`          | Qué está hecho y qué falta                                      |
| `HANDOFF-BACKEND.md` | La conversación con el front                                    |

> **Mantener esto al día es parte de cambiar el esquema, no un extra.** Si
> agregas o quitas una colección, un campo que relacione datos, un índice único o
> una invariante, actualiza este archivo **en el mismo cambio**. Un mapa
> desactualizado es peor que no tenerlo.

---

## 1. Panorama: 15 colecciones en tres grupos

Lo primero que hay que entender es que **no todas son iguales**. Se comportan
distinto y se rompen distinto.

### Catálogos — independientes, sin dueño

Existen por sí solos. Nadie los "posee" y casi todo lo demás los apunta. Se dan
de baja, **nunca se borran**.

| Colección    | Qué es                   | Único por                   | Baja                                 |
| ------------ | ------------------------ | --------------------------- | ------------------------------------ |
| `companies`  | Las empresas del grupo   | nombre, RFC                 | `activo: false`                      |
| `clients`    | Clientes del grupo       | nombre, RFC                 | `activo: false`                      |
| `categories` | Puestos                  | nombre normalizado          | `activo: false`, bloqueada si en uso |
| `areas`      | Áreas de la organización | `clave`, nombre normalizado | `activa: false`, bloqueada si en uso |

**Dentro de dos de ellos viven subdocumentos con identidad propia** (D-65, D-66),
y esto importa más de lo que parece:

| Subdocumento                      | Dentro de   | Único por               | Lo referencia                 |
| --------------------------------- | ----------- | ----------------------- | ----------------------------- |
| `companies.registrosPatronales[]` | `companies` | `numero`, en su empresa | `projects.registroPatronalId` |
| `clients.registrosObra[]`         | `clients`   | `numero`, en su cliente | `projects.registroObraId`     |

Desde **D-79**, el registro de obra lleva además su papel escaneado en
`clients.registrosObra[].archivo` (`models/attachmentSchema.js`): opcional, uno
solo y **sin versiones** —reemplazarlo borra el anterior de R2—. Su
`claveAlmacenamiento` **no** va `select: false`, al revés que en el expediente
(D-41): el cliente se guarda entero cada vez que se toca uno de sus registros, y
un campo no cargado se escribiría vacío. Lo que impide que se filtre es el
`toJSON`, que nunca la incluye.

No son colecciones porque no tienen vida fuera de su padre: un registro patronal
sin empresa no significa nada. Pero **sí tienen `_id`**, porque hay que apuntarles
— y un `ObjectId` es único globalmente, así que basta para identificarlo sin
ambigüedad. La alternativa que se descartó era guardarlos como cadenas: corregir
un dígito habría roto en silencio cada proyecto que lo apuntaba.

Los cuatro catálogos son **globales**, no por empresa. La razón es siempre la misma: el
empleado es global y puede estar en dos empresas, así que un catálogo por empresa
lo dejaría con un puesto o un área ambiguos (D-32).

### Entidades y vínculos — el núcleo

| Colección             | Qué es                                         | Depende de                            |
| --------------------- | ---------------------------------------------- | ------------------------------------- |
| `employees`           | **La persona.** El centro de todo              | `categories`                          |
| `credentials`         | La contraseña, aislada (D-27)                  | `employees` (1 a 1)                   |
| `affiliations`        | **La relación laboral** empresa ↔ persona      | `companies`, `employees`, `areas`     |
| `portfolios`          | Qué clientes usa cada empresa                  | `companies`, `clients`                |
| `projects`            | Obras y proyectos                              | `companies`, `clients`                |
| `assignments`         | Quién está en qué proyecto                     | `projects`, `employees`, `categories` |
| `contracts`           | **El contrato/fase** de una obra, con su SIROC | `projects`                            |
| `checklist_templates` | Qué documentos exige cada perfil               | `companies` (o global), `areas`       |
| `uploads`             | **Permiso de subida directa**, efímero (D-83)  | `employees` (quien lo pidió)          |
| `records`             | **El expediente.** Uno por persona             | `employees`, `checklist_templates`    |
| `access_logs`         | Bitácora legal de accesos a documentos         | `employees`, `records`                |

### Lo que NO es una colección

Esto es lo que más confunde: **hay cosas que parecen tablas y no lo son.** Se
calculan al leer, en cada petición.

| Concepto                    | Dónde se calcula                 | Por qué no se guarda                                                                      |
| --------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------- |
| **Alertas**                 | `utils/domain/alerts.js` (D-47)  | Se resuelven solas: un documento que se renueva deja de alertar sin que nadie marque nada |
| **Estatus de un documento** | `utils/domain/documentStatus.js` | `vencido` depende de la fecha de hoy, no de un campo                                      |
| **Avance del expediente**   | `utils/domain/progress.js`       | Se deriva de los documentos; guardarlo se desincroniza                                    |
| **El checklist**            | `utils/domain/checklist.js`      | Es la **unión** de las plantillas de sus adscripciones                                    |
| **El alcance del usuario**  | `middlewares/scopeMiddleware.js` | Se deriva de sus adscripciones activas. **No es un campo** (D-31)                         |

> Regla del proyecto: **nada derivado se guarda en la base.** Si un dato se puede
> calcular a partir de otros, se calcula al leer.

---

## 2. El diagrama

```mermaid
erDiagram
    COMPANIES  ||--o{ AFFILIATIONS : "tiene adscritos"
    EMPLOYEES  ||--o{ AFFILIATIONS : "trabaja en"
    EMPLOYEES  ||--o| CREDENTIALS  : "su contraseña"
    EMPLOYEES  ||--|| RECORDS      : "su expediente"
    CATEGORIES ||--o{ EMPLOYEES    : "es su puesto"

    COMPANIES  ||--o{ PORTFOLIOS   : "su cartera"
    CLIENTS    ||--o{ PORTFOLIOS   : "está en carteras"

    COMPANIES  ||--o{ PROJECTS     : "sus obras"
    CLIENTS    ||--o{ PROJECTS     : "cliente de"

    PROJECTS   ||--o{ ASSIGNMENTS  : "su gente"
    EMPLOYEES  ||--o{ ASSIGNMENTS  : "asignado a"
    CATEGORIES ||--o{ ASSIGNMENTS  : "con el puesto"

    PROJECTS   ||--o{ CONTRACTS    : "sus contratos (fases)"

    COMPANIES  ||--o{ REGISTROS_PATRONALES : "embebidos"
    CLIENTS    ||--o{ REGISTROS_OBRA       : "embebidos"
    REGISTROS_PATRONALES ||--o{ PROJECTS     : "opera con (sin ref)"
    REGISTROS_PATRONALES ||--o{ AFFILIATIONS : "cotiza en (sin ref, D-72)"
    REGISTROS_OBRA       ||--o{ PROJECTS     : "es la obra de (sin ref)"

    COMPANIES  ||--o{ CHECKLIST_TEMPLATES : "sus plantillas"
    CHECKLIST_TEMPLATES ||--o{ RECORDS    : "genera el checklist"

    EMPLOYEES  ||--o{ ACCESS_LOGS  : "quién consultó"
    RECORDS    ||--o{ ACCESS_LOGS  : "qué se consultó"

    EMPLOYEES  ||--o{ UPLOADS       : "pidió subir (efímero, D-83)"

    AREAS      ||--o{ AFFILIATIONS : "por clave (string)"
    AREAS      ||--o{ CHECKLIST_TEMPLATES : "por clave (string)"
```

**Leer el diagrama:** `||` es uno, `o{` es varios, `o|` es cero o uno.

`REGISTROS_PATRONALES` y `REGISTROS_OBRA` **no son colecciones**: son los arreglos
embebidos de la sección anterior, dibujados aparte porque el proyecto —y, desde
D-72, también la adscripción— les apuntan.

Las líneas de `AREAS` y las de los registros son distintas de todas las demás y
están explicadas en la sección 4: **Mongoose no las resuelve sola**.

---

## 3. Colección por colección

### `employees` — la persona

El centro. Todo cuelga de aquí. **No lleva `empresaId`**: dónde trabaja está en
`affiliations`.

- **Llaves únicas:** `curp`, `numeroEmpleado`, `acceso.email` — las tres
  **parciales**: sólo aplican cuando el campo es una cadena, porque `default:
null` haría chocar a todos los que no lo tienen.
- **`acceso`** es un subdocumento, no una colección: quien entra a la plataforma
  **es un empleado**. No hay tabla de usuarios (D-27).
- **`tipo`** (`administrativo` / `mano_de_obra`) se **deriva de `categoriaId`**
  (D-59); no se captura. Decide **quién puede gestionar a quién**.
- **Depende de:** `categories`.
- **Quién depende de ella:** todo — `affiliations`, `credentials`, `records`,
  `assignments`, `access_logs`, `projects.registradoPorId`.

### `credentials` — el secreto, aparte

Una por empleado (`empleadoId` único). Existe **sólo** para que el hash no viva
en `employees`: las agregaciones ignoran `select: false`, y el listado de
empleados es un `$lookup` sobre `employees` (D-27). **No la vuelvas a embeber**:
hay una prueba que lo impide.

### `affiliations` — la relación laboral

El vínculo empresa ↔ persona, y **la colección más cargada de reglas**.

- **Única por `(empresaId, empleadoId)`.** Si alguien vuelve a una empresa, se
  **reactiva** la que existe; no se crea otra.
- **`areas`** — dónde **trabaja**, en esa empresa.
- **`dirigeAreas`** — qué áreas **dirige** ahí (D-60). Son cosas distintas: de
  aquí sale el alcance del jefe de área, no de `areas`.
- **`nomina`** (`select: false`) — salario, SBC y cuenta bancaria, **y nada más**.
  **Ninguna respuesta los devuelve** hasta que se decida quién puede verlos
  (LFPDPPP). Hasta la limpieza de la Fase 8 cargaba además los ocho campos de
  `condiciones` duplicados, del respaldo de D-63: si ves un volcado viejo con
  `nomina.registroPatronal`, es eso y no un campo que falte hoy.
- **`payrollSnapshot`** (`select: false`) — lo que dijo el último archivo de
  nómina, para distinguir «el archivo cambió» de «lo cambiaron a mano» (D-57).
- **`registroPatronalId`** — el registro patronal de esa relación, por id contra
  el catálogo de su empresa (D-72). `null` en lo que la migración M3 no resolvió;
  el texto crudo sigue en `condiciones.registroPatronal`. Ni el importador ni la
  migración lo **pisan** si ya está: se corrige a mano y esa decisión gana.
- **Invariantes:** contrato temporal exige fecha de término; una baja exige
  motivo; `datosPendientes` relaja lo que el importador dejó sin capturar.

### `records` — el expediente

**Uno por persona** (`empleadoId` único), no uno por empresa: su INE es su INE en
las dos.

- **`documentos[]`** embebido, con **`versiones[]`** dentro. Se embebe porque
  siempre se lee y se escribe completo, y son pocas versiones.
- **`versiones[0]` es la vigente**, ordenadas de más reciente a más antigua.
- **`archivo.claveAlmacenamiento`** es `select: false`: la ubicación real en R2
  nunca se expone; para abrir un archivo se emite una URL firmada (D-41).
- **`plantillas[]`** guarda de qué plantillas salió el checklist — varias si la
  persona está en varias empresas.

### `checklist_templates` — qué documentos exige cada perfil

Se indexa por `tiposContrato` y `areas`. `empresaId: null` significa **global**.
El checklist de una persona es la **unión** de las plantillas que le aplican por
cada adscripción.

### `projects` y `assignments`

`projects` cuelga de una empresa y un cliente, y **exige que el cliente esté en
la cartera activa** de esa empresa (`portfolios`). Desde D-69 exige además dos
referencias que dicen **con qué registro patronal opera** y **cuál es su obra**:
`registroPatronalId` (de su empresa) y `registroObraId` (de su cliente). Son
obligatorias en los proyectos nuevos, **no en los que ya existían** —
`required: () => this.isNew` — porque un cambio de forma deja el sistema en dos
estados y los dos tienen que funcionar.

**El proyecto no habilita puestos** (D-82). Tuvo un `categorias[]` —el
subconjunto del catálogo con el que se podía trabajar en esa obra—, y se quitó:
sólo servía para filtrar el selector de asignables y rechazar altas, y a una obra
va quien haga falta. Quién pertenece a la empresa lo dice la **adscripción**, que
es el dato que se mantiene al día porque sale de la nómina.

`assignments` es único por `(proyectoId, empleadoId)` **sólo mientras está
activa** — índice parcial, para que alguien pueda volver al mismo proyecto
después. Conserva su propio `categoriaId`: el puesto con el que esa persona
figura **en esa obra**, que ya no se valida contra nada del proyecto y, si el
alta no lo manda, se toma del propio empleado (D-82).

### `uploads` — el permiso de subida, que dura minutos

La única colección **efímera** del modelo (D-83). Un documento nace cuando alguien
pide subir un archivo, dice a qué recurso va y qué declaró el navegador —nombre,
tipo y tamaño—, y muere cuando el adjunto queda registrado o cuando caduca sin
usarse. No es el archivo: es el permiso.

Existe por una sola razón: **un permiso tiene que valer una vez**. Con un token
firmado bastaría para autorizar, pero no para impedir que el mismo se reutilice
hasta caducar; eso exige estado. De paso deja rastro de quién pidió subir qué.

Lo que hay que saber al tocarla:

- **`estado: 'usada'` no se borra.** Es el rastro de la subida que sí llegó a su
  sitio. Lo que se limpia son los `pendiente` vencidos, con
  `npm run limpiar:subidas`.
- **`claveTemporal` apunta a `pendientes/`**, nunca a una carpeta definitiva: el
  archivo se mueve al confirmar, y sólo después de comprobar su tipo por
  contenido.
- **Nada la referencia.** Ninguna otra colección guarda un `uploadId`: cuando el
  adjunto queda registrado, lo que se guarda en el recurso es el subdocumento
  `archivo` de siempre, igual que si hubiera llegado por `multipart`.

### `contracts` — el contrato, que es la fase, y su SIROC

Cada fase de una obra tiene exactamente un contrato, y un proyecto de una sola
fase no tiene fases: **son la misma entidad** y por eso hay una sola colección
(D-70). Lo que sí son dos son sus nombres: `nombre` es el del contrato
('Contrato 001-A') y `fase` su etiqueta de obra ('Fase 1', 'Cimentación'), los
dos opcionales y ninguno derivado del otro (D-75).

- `numero` es una **secuencia dentro del proyecto que asigna el servidor**, no un
  dato que se captura. Cuenta también los dados de baja: reusar un número
  chocaría contra el índice único.
- `siroc` va **embebido** porque es 1:1 con el contrato y no tiene ciclo de vida
  propio. Nace en `null`.
- **El aviso guarda una sola fecha, la de registro** (D-76). No hay
  `vigenciaHasta`: la vigencia son dos meses contados desde el registro —o desde
  la última actualización— y se deriva al leer. Mientras existió como campo,
  quien capturaba tecleaba ahí la fecha de fin del contrato y el aviso terminaba
  contradiciendo al seguimiento. La quita `npm run migrate:siroc-vigencia`.
- **`siroc.numero` es único en TODO el sistema**, con índice parcial por
  `$type: 'string'` — no `sparse`, que haría chocar entre sí a los contratos sin
  SIROC. Repetirlo responde `409` diciendo dónde está el otro.
- `siroc.actualizaciones` es la lista de **refrendos del mismo aviso** (D-76): el
  SIROC se actualiza cada dos meses conservando su número, así que una renovación
  no es un SIROC nuevo sino una fecha más —con `nota` opcional— dentro del que ya
  hay. Es lo ÚNICO que se guarda de todo esto: cuántas faltan, cuándo vence la
  ventana vigente y si urge son `seguimientoSiroc`, derivado al leer (regla #6).
  Van en orden y ninguna puede ser anterior a `fechaRegistro`; una fecha suelta
  hacia atrás correría la ventana y el contrato callaría avisos que debe dar.
- **El aviso y cada refrendo llevan su propio archivo** (D-80): `siroc.archivo`
  es el aviso escaneado y `siroc.actualizaciones[].archivo` el acuse de esa
  renovación, los dos con el `attachmentSchema` de D-79 y los dos opcionales. Son
  dos papeles distintos a propósito: refrendar no sustituye al original, y la
  serie completa de acuses es lo que se enseña si el IMSS revisa. Corregir el
  SIROC con `PUT` **conserva los archivos**; sólo se reemplaza el del aviso si la
  petición trae uno nuevo, y entonces el anterior se borra de R2.
- **El contrato también lleva el suyo** (D-81): `archivo`, con el mismo
  `attachmentSchema`, es el contrato firmado escaneado. Es **uno y se
  reemplaza** —al revés que los del SIROC, que se suman—, y se adjunta al
  capturar o después, con el `PATCH` de siempre: el papel llega días más tarde
  que las fechas.
- **Las renovaciones siguen sin `_id`**, así que su archivo se pide **por
  posición**. Dárselo obligaría a migrar las ya capturadas y Mongoose les
  inventaría uno distinto en cada lectura mientras tanto.
- `estado` (`en_curso` | `finalizado`) y `activo` **no son lo mismo**: el primero
  es un contrato que terminó bien, el segundo uno capturado por error. Van por
  rutas distintas.

**Los contratos traban al proyecto.** En cuanto existe uno, el proyecto no cambia
de cliente ni de registro patronal; en cuanto uno tiene SIROC, tampoco de
registro de obra. La razón es que el aviso ante el IMSS ya salió con esa obra.

### `access_logs` — bitácora

**Requisito legal, no un extra**: un expediente trae CURP, NSS y examen médico.
Se escribe en cada emisión de URL firmada. **Nunca se edita ni se borra**, sólo
se agrega. Guarda el **nombre** de quien consultó, no sólo su id, para que el
registro siga siendo legible aunque la persona cambie.

---

## 4. Las relaciones que no son `ObjectId` — cuidado aquí

Casi todas las relaciones son `ObjectId` con `ref`, y Mongoose las resuelve.
**Siete no**, y son las que se rompen en silencio. Fallan por tres motivos
distintos.

**Las que apuntan por cadena**, contra la `clave` del área:

| Desde                         | Hacia         | Por    |
| ----------------------------- | ------------- | ------ |
| `affiliations.areas[]`        | `areas.clave` | cadena |
| `affiliations.dirigeAreas[]`  | `areas.clave` | cadena |
| `checklist_templates.areas[]` | `areas.clave` | cadena |

**Las que apuntan DENTRO de un arreglo embebido.** Son `ObjectId` de verdad, pero
**sin `ref`**, porque no hay colección a la que referir:

| Desde                         | Hacia                                 |
| ----------------------------- | ------------------------------------- |
| `projects.registroPatronalId` | `companies.registrosPatronales[]._id` |
| `projects.registroObraId`     | `clients.registrosObra[]._id`         |

`populate()` **no las resuelve**: hay que traer la empresa o el cliente y buscar
el subdocumento por `_id` dentro de su arreglo. Lo hace `findRegistry`, en
`utils/domain/registries.js`, y por eso los `populate` de proyectos y de
asignaciones seleccionan `'nombre registrosPatronales'` en vez de sólo el nombre.
Olvidarlo no da error: devuelve `null` y la pantalla se queda en blanco.

La tercera de esta familia se sumó en D-72:

| Desde                             | Hacia                                 |
| --------------------------------- | ------------------------------------- |
| `affiliations.registroPatronalId` | `companies.registrosPatronales[]._id` |

**Y una que apunta por TEXTO al mismo subdocumento**, la más floja de todas:

| Desde                                       | Hacia                                    |
| ------------------------------------------- | ---------------------------------------- |
| `affiliations.condiciones.registroPatronal` | `companies.registrosPatronales[].numero` |

Es la cadena libre que llegó del archivo de nómina, y **convive** con el id:
aquél es el vínculo validado, ésta el dato crudo del archivo — el mismo reparto
que entre `areas` y `departamento`. Nada garantiza que el texto exista entre los
registros de su empresa; el id sí.

Por eso la coherencia contra el proyecto **toma el número del vínculo cuando
existe** y se cae al texto cuando no (D-72), y en los dos casos compara números
normalizados —sólo letras y dígitos, en mayúsculas— y **avisa en vez de
bloquear** (D-71). Las dos rutas tienen que dar un resultado válido:
`registroPatronalId` está en nulo en todo lo que la migración M3 no resolvió.

**Por qué así:** la `clave` es el valor del contrato — es lo que el front compara
y lo que viaja en `?area=`. Guardar el `ObjectId` habría obligado a resolverlo en
cada respuesta y a que el front manejara ids en vez de valores legibles.

**Qué implica:**

- **La `clave` de un área es inmutable.** Renombrar cambia `nombre`, nunca
  `clave`: cambiarla dejaría huérfana a cada adscripción que la guarda.
- **No hay integridad referencial.** Nada impide que quede una `clave` apuntando a
  un área que no existe. Por eso `areaService.assertUsables` valida contra el
  catálogo **al guardar**, y `assertExiste` al filtrar.
- **Guardar exige área activa; filtrar no.** A un área dada de baja todavía hay
  gente asignada, y es justo a quien hay que encontrar para reasignar.

Hay una tercera relación por cadena, contra el **código** y no contra una
colección: `records.documentos[].tipo` apunta a `DOCUMENT_TYPES` en
`src/constants/`. Agregar un tipo de documento es cambiar el código, no un dato.

---

## 5. Matriz de impacto: si tocas esto, revisa aquello

| Si cambias…                                      | Revisa                                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| **`employees.categoriaId`**                      | `tipo` se deriva de ahí (D-59) → cambia **quién puede gestionar a esa persona**                                 |
| **`employees.tipo`**                             | `utils/permissions.js` (`canManageEmployeeType`), el desplegable de puestos                                     |
| **`affiliations.areas`**                         | El checklist (se resuelve por área) → puede cambiar **qué documentos se le exigen**                             |
| **`affiliations.dirigeAreas`**                   | `scopeMiddleware` → **qué gente ve un jefe de área**                                                            |
| **`affiliations.activo`**                        | El alcance del usuario, el checklist, las alertas, y si se queda sin ninguna activa, su baja del sistema (D-55) |
| **`areas` (dar de baja)**                        | Bloqueado si alguien la tiene. Al reactivar, vuelve a ofrecerse en los desplegables                             |
| **`categories.tipo`**                            | El `tipo` de todos los que tienen ese puesto                                                                    |
| **`checklist_templates`**                        | El checklist de **todos** los que caigan en esa plantilla; hay que re-sincronizar expedientes                   |
| **`companies.activo`**                           | Nadie puede importar ni adscribir a una empresa de baja                                                         |
| **Dar de baja un registro patronal o de obra**   | Bloqueado si un proyecto **en curso** lo usa. Hay que cerrarlos o cambiárselo primero                           |
| **Crear un contrato**                            | Traba el `clienteId` y el `registroPatronalId` de su proyecto (D-70)                                            |
| **Registrar un SIROC**                           | Traba además el `registroObraId`. Quitarlo lo libera                                                            |
| **Reemplazar el archivo de un registro de obra** | El anterior **se borra de R2** (D-79): no hay versiones a las que volver                                        |
| **`siroc.actualizaciones`**                      | Mueve la ventana de dos meses y con ella todo `seguimientoSiroc`: quitar una hace reaparecer el aviso (D-76)    |
| **Quitar el SIROC o su última renovación**       | Sus archivos **se borran de R2** (D-80): el del aviso y el acuse de cada refrendo. No hay versiones             |
| **Reemplazar el archivo de un contrato**         | El anterior **se borra de R2** (D-81): uno solo, sin versiones. El tope de subida son 30 MB, salvo la nómina    |
| **`affiliations.registroPatronalId`**            | El aviso de coherencia al asignar y en el listado (D-71). Manda sobre el texto; no bloquea nada                 |
| **`affiliations.condiciones.registroPatronal`**  | Lo mismo, pero **sólo mientras no haya vínculo**: es el respaldo de las que M3 no resolvió (D-72)               |
| **`projects.registroPatronalId`**                | Lo mismo: el aviso se recalcula al leer, así que cambiarlo mueve toda la trazabilidad ya registrada             |
| **Un enum de `src/constants/`**                  | Es **contrato**: el front compara por igualdad estricta. Cambiar un valor lo rompe                              |
| **Cualquier índice único**                       | `npm run db:indices` en producción — `autoIndex` está apagado ahí                                               |

### Los tres efectos en cadena más largos

1. **Cambiar el puesto de alguien** → cambia su `tipo` → cambia quién puede
   editarlo → si pasa a administrativo, **exige que tenga área** en cada empresa.
2. **Cerrar la última adscripción activa de alguien** → se queda sin empresa →
   la importación le da **baja del sistema** (D-55) → desaparece del listado por
   defecto y su acceso se desactiva.
3. **Editar las plantillas del checklist** → cambia el checklist de todos los que
   caigan en ellas → cambia su **avance** → cambia sus **alertas**. Nada de eso
   está guardado: se recalcula solo, pero se nota de inmediato en toda la app.

---

## 6. Cómo se deriva el alcance (lo que decide qué ve cada quien)

No es un campo. Se calcula en cada petición, en `applyScope`:

```
Empleado con acceso
  └─ sus adscripciones ACTIVAS
       ├─ empresaId  → req.empresasVisibles   (qué empresas ve)
       └─ dirigeAreas → req.areasPorEmpresa   (qué áreas dirige en cada una)

Administrador de plataforma (acceso.alcanceGlobal)
  └─ req.empresasVisibles = null  → todas
```

Dos reglas que no se negocian:

- **`empresaId` nunca se lee del cuerpo ni del query para decidir alcance.** Sale
  del usuario. Si llega en la petición, sólo **acota** dentro de lo visible.
- **Fuera de alcance responde `404`, no `403`.** Un `403` confirmaría que existe.

---

## 7. La conexión a la base no sobrevive a una suspensión

Un detalle de operación que no se ve en el modelo pero rompe la app entera
(D-61): el pool de conexiones a Atlas **no sobrevive a que la máquina se
suspenda**. `suspend` restaura la VM con los sockets vivos en memoria y muertos
del otro lado; la primera consulta se cuelga y falla.

Por eso `fly.toml` usa `auto_stop_machines = 'stop'` y no `'suspend'`: el proceso
arranca limpio y reconecta. Y por eso `/ready` hace un `ping` real en vez de leer
`readyState`, que es una bandera local y seguía diciendo «conectado».

**Si algún día alguien vuelve a poner `suspend` para ahorrar arranque en frío, el
síntoma será: la plataforma tarda muchísimo tras un rato inactiva y luego cierra
la sesión.**

## 8. Al cambiar el esquema

1. **Actualiza este documento** en el mismo cambio: la tabla de la sección 1, el
   diagrama si hay relación nueva, y la matriz de impacto.
2. Registra el modelo nuevo en `src/models/index.js` (D-31) — hay una prueba que
   falla si falta.
3. Si agregas un índice, di en `DECISIONES.md` que hay que correr
   `npm run db:indices` en producción.
4. Si el cambio afecta a datos existentes, escribe un script en `scripts/` con
   `--dry-run`, idempotente, que **no borre nada** por defecto.
5. Anota el porqué en `DECISIONES.md` y la forma nueva en `CONTRATO-API.md`.
