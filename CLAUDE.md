# CLAUDE.md — Backend de expedientes laborales (Urbacames)

Punto de entrada para cualquier agente o persona que llegue a este repo. Léelo
completo antes de tocar código; toma 3 minutos y evita reescrituras.

## Qué es esto

API de la plataforma de **expedientes laborales de Urbacames**: checklist de
documentos por colaborador, carga de archivos, validación por RH, control de
vigencias, alertas y reportes de auditoría.

- El **front ya está construido** y ya pega contra este servidor en casi todo;
  la capa simulada la conserva para desarrollar. Donde su lógica y la nuestra
  difieran, **manda ésta**.
- Documentos autoritativos, los tres en `docs/`:
  - **`ARQUITECTURA-DATOS.md`** — el mapa de lo que HAY: las 14 colecciones, cómo
    se relacionan y qué se rompe al tocar cada una. **Léelo antes de cambiar
    cualquier esquema, y actualízalo en el mismo cambio.**
  - **`modelo-datos.md`** — el diseño y su porqué. Ha derivado; donde discrepe
    con el anterior, manda el anterior.
  - **`backend-spec.md`** — cómo se habla con el backend: envelope, códigos,
    errores y catálogo de rutas.

  Los dos últimos **son de este repo desde el 29 ago 2026**: el front los lee
  aquí y ya no guarda copia, así que se actualizan en el mismo cambio que el
  código, igual que los `ENDPOINTS-*.md`.

- `backend-spec.md` en la raíz es la versión **anterior** de la especificación, de
  cuando el eje era el cliente. Se conserva como referencia histórica; **no la
  sigas**.
- `docs/RUMBO.md` dice **hacia dónde va** la plataforma (roles armables,
  checklists operativos). Es contexto, **no una especificación**: nada de ahí
  está decidido y no se implementa desde ese archivo.
- El proyecto hermano `~/Documents/projects/talentlink-backend` es el **origen de
  las convenciones**, no un repo del que se copie sin revisar: lo que se mejoró
  respecto a él está en `docs/DECISIONES.md`.

## Hablar con el front

El front vive en `~/Documents/projects/cames-files-manager`. **Nadie edita ni
copia los documentos del otro**: copiarlos fue lo que hizo implementar dos veces
contra versiones desfasadas.

- Escribe en **`docs/HANDOFF-BACKEND.md`** al cerrar una tarea que les afecte, o
  al encontrarles un bug. Encabezado `AAAA-MM-DD HH:MM:SS · backend · título`,
  la más reciente arriba, y **la hora sácala con `date`, no de memoria**: los dos
  lados escriben el mismo día sobre las mismas cosas.
- Lee **`~/Documents/projects/cames-files-manager/docs/HANDOFF-FRONTEND.md`**
  antes de empezar: ahí está lo que ya aplicaron y lo que necesitan.
- Se mantienen cortas. Al cerrar algo grande, sus entradas se colapsan a un
  renglón en «Cerrado», el detalle baja a su documento, y **se le avisa al otro
  que se recortó**.

## Arrancar

```bash
npm install
cp .env.example .env      # y llena MONGODB_URI y JWT_SECRET
npm run db:up             # MongoDB 8 local (docker), replica set, puerto 27018
npm run dev               # http://localhost:8080/api/v1/health
npm test                  # toda la suite, base en memoria (no necesita Mongo)
npm run lint
npm run esqueleto         # qué colecciones, campos, índices y rutas existen HOY
```

`npm run esqueleto` sale del **código**, no de los documentos: lee los esquemas de
Mongoose y el stack de Express. Imprime JSON —lo que consume una herramienta— y
con `-- --texto`, lo mismo para leerlo con los ojos. No se conecta a nada y no
necesita el `.env`. Úsalo antes de creerle una cifra a un documento.

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
manual para cualquier momento: `npm run seed:admin`.

Ese administrador **nace con la contraseña marcada como temporal**: puede iniciar
sesión, pero toda la API le responde `403 PASSWORD_TEMPORAL` hasta que la cambie
con `POST /auth/cambiar-password` (D-49). Ya no hace falta acordarse. Lo que sigue
siendo manual es apagar el bootstrap (`BOOTSTRAP_ADMIN_ENABLED=false`) antes de
exponer el backend.

### Cadencia de las pruebas

La suite completa tarda ~11 minutos. Correrla de mas es el mayor desperdicio de
tiempo en una tarea, asi que:

- **Mientras trabajas:** solo los archivos afectados (`npx jest <archivo>`).
- **Al terminar:** la suite completa, UNA vez.
- **Si esa corrida falla en algo acotado** —una cifra de un documento, un caso
  suelto— corrige y vuelve a correr SOLO la suite afectada. No repitas la
  completa: ya sabes que el resto pasaba.
- **Nunca lances dos corridas a la vez**, ni dejes una en segundo plano mientras
  arrancas otra: comparten la misma base y se pisan. Antes de la completa,
  `pgrep -f jest` debe salir vacio (ojo con el watch de la extension de Jest del
  editor).

**Como esperar a que termine.** Dos formas de perder media hora, las dos vistas ya:

- **No encadenes** `npm test` detras de otros comandos con `&&` ni le pongas
  `| tail`. El `tail` retiene TODA la salida hasta el final, asi que mientras
  corre no ves nada y no sabes si avanza. Redirige a un archivo:
  `npm test > /tmp/suite.log 2>&1` y despues consulta lo que necesites.
- **No esperes con `pgrep -f jest` en un bucle.** El propio comando de espera
  lleva la palabra `jest` en su linea, asi que se encuentra a si mismo y el bucle
  no termina nunca. Si tienes que esperar, busca la linea de resumen en el archivo
  de salida, no un proceso.


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
`Category`/`categories`/categorías · `Area`/`areas`/áreas ·
`Affiliation`/`affiliations`/adscripciones ·
`Portfolio`/`portfolios`/carteras · `Assignment`/`assignments`/asignaciones ·
`Project`/`projects`/proyectos · `Contract`/`contracts`/contratos ·
`Record`/`records`/expedientes ·
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
    affiliations/       adscripción empresa ↔ empleado: la relación laboral, con
                        su registro patronal vinculado (D-72)
    contracts/          contratos del proyecto (= fases) y su SIROC (D-70)
    assignments/        proyecto ↔ empleado; avisa si el registro patronal no
                        coincide y resuelve la trazabilidad (D-71)
    alerts/             bandeja derivada: documentos y cumpleaños (D-47)
    clients/ categories/  catálogos compartidos
    areas/              catálogo de áreas: 9 base + las temporales que deja el
                        archivo de nómina (D-58)
    checklistTemplates/ plantillas (pendiente de mudar a empresaId)
    users/goneRoutes.js /usuarios → 410, se borra cuando el front migre
    routes/             index.js monta los recursos y expone el inventario
  models/index.js       registra TODOS los modelos (D-31). Agrega los nuevos aquí
  config/               env.js (validado con zod) · database.js
  constants/            enums del contrato
  middlewares/          authMiddleware · scopeMiddleware · passwordMiddleware ·
                        validateRequest · errorHandler · requestContext ·
                        rateLimiters · uploadMiddleware
  utils/                response (envelope) · asyncHandler · dates · text ·
                        permissions · logger · routeInventory · spreadsheet ·
                        schemaSkeleton (el esqueleto real, derivado del código)
  utils/domain/         reglas PURAS: documentStatus · progress · alerts ·
                        checklist · expiry · employeeImport · registries
  services/             bootstrapAdmin · seedChecklistTemplates
scripts/                semillas, índices, migración y el esqueleto
tests/                  unitarias/ · integracion/ · helpers/
docs/                   modelo-datos · backend-spec · arquitectura · contrato ·
                        handoff-backend (la conversación con el front) ·
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
      `tests/unitarias/docs.test.js` compara las cifras de los documentos contra
      el código: si falla, el número del documento es el que está mal.
- [ ] Prueba de integración del camino feliz, 401, 403, **404 por alcance** y 400.
- [ ] `docs/CONTRATO-API.md` con la forma exacta de la respuesta nueva, y
      `docs/INTEGRACION-FRONTEND.md` si el cambio afecta a lo que el front ya usa.
- [ ] `docs/ESTADO.md` actualizado (es el mapa de qué falta).
- [ ] Desviaciones del spec anotadas en `docs/DECISIONES.md`, con el motivo.
- [ ] Si tocaste un **esquema** —colección, campo que relacione datos, índice
      único o invariante—, `docs/ARQUITECTURA-DATOS.md` actualizado en el mismo
      cambio: la tabla de colecciones, el diagrama y la matriz de impacto. Un mapa
      desactualizado es peor que no tenerlo.

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

Y la **cadena de la obra**, completa (`docs/PLAN-OBRA-CONTRATOS.md`, sus ocho
fases): empresa → registros patronales → proyecto ← cliente → registros de obra, y
los **contratos** del proyecto —que son sus fases— con el **SIROC** embebido y
único en todo el sistema (D-65 a D-70). A partir del primer contrato el proyecto
deja de cambiar de cliente y de registro patronal; a partir del primer SIROC,
tampoco de registro de obra.

Y la **coherencia con la gente** (D-71): asignar a alguien que cotiza en otro
registro patronal **avisa, no bloquea** —Maquinaria CAMES tiene 144 personas
repartidas en cuatro registros—, y `GET /asignaciones/:id` devuelve la cadena
`empleado → empresa → registro patronal → proyecto → registro de obra` resuelta
al leer, sin guardar un solo id nuevo.

Y desde D-72 la adscripción **se vincula a su registro patronal** por id
(`registroPatronalId`), que convive con el texto de la nómina en vez de
reemplazarlo: donde hay vínculo, el número sale del catálogo de la empresa; donde
no, del texto. Se llena con `npm run migrate:vinculo-rp` y con cada importación,
y **nada lo pisa** una vez corregido a mano.

**Pendiente:** métricas, reportes, plantillas de checklist, el árbol de
`/organizacion` y el job diario de vigencias — ver `docs/ESTADO.md` para el
detalle y el orden sugerido.

**Al reportar pendientes, las decisiones abiertas van primero**, no sólo los
módulos por construir: un módulo se empieza cuando hay hueco, una decisión
bloquea y sólo la resuelve el cliente. Están en `docs/ESTADO.md` § «Decisiones
abiertas», con un aviso al inicio que dice cuáles bloquean hoy. El plan de obra está
**cerrado**: las migraciones corrieron y los respaldos se borraron en los dos
entornos, local y Fly.

**Decisión abierta que bloquea al front:** `affiliations.nomina` guarda salario,
SBC y cuenta bancaria porque el archivo de nómina los trae, pero **ninguna
respuesta los devuelve** hasta que se decida quién puede verlos (LFPDPPP). No
"arregles" esto agregándolos al `toJSON`: ver D-46 y `ESTADO.md` #10.

El detalle, con checkboxes y el orden sugerido, está en `docs/ESTADO.md`.

## El plan de tareas

Las tareas viven en `~/Documents/projects/cames-ops/plan/tareas.json`, compartido
con el front. Ahí está el estado de cada una y qué falta.

Cuando se te pida **«implementa la siguiente tarea pendiente»**:

1. Lee `../cames-ops/plan/tareas.json`.
2. Toma la primera con `"repo": "backend"`, estado `pending`, y cuyo `dependsOn`
   —si lo tiene— esté en `done`. Si no hay ninguna, dilo y para.
3. Si tiene `dependsOn`, lee `../cames-ops/plan/handoff/<id>.md`: ahí está lo que
   el otro lado dejó escrito.
4. **Antes de tocar código**, escribe tu traducción técnica en `propuestaTecnica`
   —qué archivos y campos concretos vas a tocar, en 3-5 renglones—, cambia el
   estado a `proposed` y **para**. El usuario la aprueba o la corrige. La
   descripción de la tarea está escrita en su idioma, no en el nuestro: traducirla
   es tu primer trabajo, y confirmarla evita implementar lo que no era.
5. Aprobada: estado `in_progress` y trabaja. El `acceptance` es el alcance; nada
   fuera de ahí.
   Si la tarea traia `revisiones`, lo que dice la ultima entrada entra en el
   alcance junto con el `acceptance`.
   Si la tarea traia `revisiones`, lo que dice la ultima entrada entra en el
   alcance junto con el `acceptance`.
6. Al cerrar, aplica «Antes de decir listo» de este mismo documento, sin excepción.
7. Si la tarea tiene `handoff`, escribe `../cames-ops/plan/handoff/<id>.md` con el
   formato de abajo. Es lo único que el otro lado va a leer: si algo no está ahí,
   para ellos no existe.
8. Estado `in_review`, y escribe en `commit` el mensaje que el usuario debe usar:
   `feat(#<id>): <título>` más el cuerpo y la línea `Plan: #<id>`.
9. **Termina tu respuesta con el mensaje de commit completo, en un bloque de
   código listo para copiar.** No basta con dejarlo en `tareas.json`: el usuario
   commitea desde la terminal y no deberia tener que ir a buscarlo al archivo.

**`in_review` no es `done`.** Tu no cierras una tarea: la dejas lista para que el
usuario la pruebe. El pasa a `done` cuando la valido, o la devuelve a
`in_progress` diciendo que fallo. Una tarea de backend, ademas, no se puede dar
por buena hasta que el front la consuma.

Una tarea cuyo `dependsOn` este en `in_review` SI se puede empezar: el trabajo
esta hecho y su handoff escrito; lo unico que falta es el visto bueno del usuario.

**Si una tarea vuelve, vuelve con el motivo escrito.** Cuando el usuario la
devuelve de `in_review` a `in_progress`, el porque queda en el campo
`revisiones` de la tarea: una lista que crece, con `fecha` y `motivo` en cada
entrada.

- **Antes de retomar una tarea, lee `revisiones`.** Si tiene entradas, la ultima
  es lo que fallo al probarla, y arreglarlo es parte del alcance igual que el
  `acceptance`. Si hay varias, leelas todas: son los intentos anteriores, y
  repetir un error ya senalado es el fallo mas caro de esta lista.
- **No las borres ni las reescribas.** Son del usuario, no tuyas, y se acumulan a
  proposito. Tu `propuestaTecnica` si la reescribes al retomar —por eso el motivo
  no vive ahi—, y en ella di como atacas lo que te devolvieron.
- **Una tarea que nunca se devolvio no lleva el campo.** No lo agregues vacio.


**Si una tarea vuelve, vuelve con el motivo escrito.** Cuando el usuario la
devuelve de `in_review` a `in_progress`, el porque queda en el campo
`revisiones` de la tarea: una lista que crece, con `fecha` y `motivo` en cada
entrada.

- **Antes de retomar una tarea, lee `revisiones`.** Si tiene entradas, la ultima
  es lo que fallo al probarla, y arreglarlo es parte del alcance igual que el
  `acceptance`. Si hay varias, leelas todas: son los intentos anteriores, y
  repetir un error ya senalado es el fallo mas caro de esta lista.
- **No las borres ni las reescribas.** Son del usuario, no tuyas, y se acumulan a
  proposito. Tu `propuestaTecnica` si la reescribes al retomar —por eso el motivo
  no vive ahi—, y en ella di como atacas lo que te devolvieron.
- **Una tarea que nunca se devolvio no lleva el campo.** No lo agregues vacio.


**Nunca hagas `git add`, `git commit` ni `git push`.** El usuario revisa el diff y
commitea. Deja el árbol como está.

Si te bloqueas: estado `blocked`, escribe el porqué en `propuestaTecnica` y para.
No improvises un rodeo.

### Formato de `handoff/<id>.md`

```markdown
# Tarea #<id> — <título>

## Rutas

| Método | Ruta | Qué hace |

## Forma de la respuesta

El envelope y la forma exacta de `data`, con un ejemplo real.

## Cuerpo de la petición

Campos, tipos, cuáles son obligatorios.

## Errores

Código, `errors[0].msg` tal cual sale, y qué lo dispara.

## Permisos

Qué nivel de acceso hace falta y qué pasa fuera de alcance.

## Documentos que cambiaron

Cuál, qué sección, y qué dice ahora distinto.

## Lo que NO se hizo

Lo que quedó fuera y por qué.
```

Las rutas sácalas del inventario que deriva el router, no de memoria.

### Si la tarea necesita una migracion

Una tarea necesita migracion cuando el cambio deja datos que ya existen en un
estado que el codigo nuevo no entiende: un campo que cambia de forma o de
significado, datos que se mueven de una coleccion a otra, un indice unico nuevo
sobre datos que pueden tener duplicados, o un valor obligatorio donde antes no lo
habia.

Cuando sea el caso, dilo en la propuesta tecnica ANTES de implementar, y al
cerrar llena el campo `migracion` de la tarea:

```json
"migracion": {
  "script": "scripts/migrateAlgo.js",
  "queHace": "en una frase, que le pasa a los datos que ya existen",
  "aplicadaEn": []
}
```

`aplicadaEn` se queda vacio: la corre el usuario, en local y en produccion, y es
el quien lo marca. Tu no la ejecutas ni la das por aplicada.

Si la tarea no necesita migracion, el campo se queda en `null`.

El script sigue las convenciones de `scripts/`: idempotente, con `--dry-run` que
reporta sin escribir, y lo destructivo detras de una bandera aparte.

### Cuando descubres que falta trabajo del otro lado

A media tarea puedes toparte con que no puedes terminar sin algo que le toca al
otro repo, o con que hace falta algo que nadie ha pedido. No lo resuelvas de tu
lado ni lo dejes pasar.

1. Escribe la propuesta en `../cames-ops/plan/propuestas/<AAAA-MM-DD>-<repo>-<slug>.md`
   con: qué hace falta, por qué lo descubriste ahora, qué se rompe si no se hace,
   y qué tarea lo destapó.
2. Escríbela **en lenguaje de negocio**, como la escribiría el usuario: qué debe
   ser cierto al terminar, no qué archivo tocar. Quien la apruebe la va a leer sin
   tu contexto.
3. Si tu tarea no puede continuar sin eso: estado `blocked` y para. Si sí puede,
   sigue y entrégala, dejando dicho en el informe qué quedó fuera.
4. **No escribas en `tareas.json` por tu cuenta.** Primero muestras la
   propuesta y esperas. Solo cuando el usuario diga que sí, en esta misma
   sesión, la insertas tú al final del array `tareas` con el siguiente `id`
   libre. Si te pide cambios, corriges el bloque y se lo vuelves a mostrar
   antes de escribir nada.
5. **Termina tu respuesta con el bloque JSON de la tarea, en un bloque de
   codigo listo para copiar**, ademas de la ruta del archivo. El usuario no
   deberia tener que abrir el .md para enterarse de que propusiste algo.

Cierra la propuesta con el bloque JSON de la tarea, listo para pegar en
`tareas.json`, con `"id": null` para que el usuario le ponga el numero:

```json
{
  "id": null,
  "repo": "backend|frontend",
  "titulo": "",
  "descripcion": "... Ver plan/propuestas/<archivo>.md.",
  "acceptance": [],
  "handoff": null,
  "dependsOn": null,
  "estado": "pending",
  "propuestaTecnica": null,
  "commit": null,
  "migracion": null,
  "migracion": null
}
```

El `acceptance` sale de tu seccion «que debe ser cierto al terminar», en el mismo
lenguaje.

Junto al JSON, di **por que importa** en una o dos frases: que se rompe o que se
responde mal hoy. El usuario decide con eso, no con el titulo.

Escribir el JSON no es aprobarlo. Espera su respuesta:

- «si» o equivalente → insertas la tarea en `tareas.json` con el siguiente `id`
  libre y le confirmas el numero que le tocó.
- pide cambios → corriges y vuelves a mostrar, sin escribir todavia.
- «no» → no insertas nada. La propuesta se queda como archivo, por si cambia de
  opinion.

Si lo que falta es una decisión de producto —si algo *debe* existir, no cómo
hacerlo—, la propuesta es el sitio para plantearla, no para resolverla.
