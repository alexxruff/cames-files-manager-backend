# Decisiones

Registro de decisiones de arquitectura: qué se decidió, por qué, y qué se mejoró
respecto a `talentlink-backend`, que es el proyecto del que salieron las
convenciones. Si te desvías de algo de aquí, agrega una entrada nueva en vez de
editar la vieja.

---

## D-01 · JavaScript CommonJS, no TypeScript ni ESM

**Decisión.** Node 20 + Express 4 + Mongoose 8 en CommonJS, igual que
`talentlink-backend`.

**Por qué.** Los dos repos los mantiene el mismo equipo y comparten piezas
(servicio de R2, correo, patrones de capas). Con el mismo lenguaje y el mismo
sistema de módulos, mover código entre ellos es copiar y ajustar, no portar. El
spec además fija ese stack. TypeScript daría tipos compartidos con el front, pero
a cambio de un build step y de reescribir lo que se reutiliza; se descartó a
sabiendas y se puede reconsiderar cuando el módulo de expedientes esté cerrado.

---

## D-02 · Base de datos propia en el cluster compartido

**Decisión.** Mismo cluster de Atlas, base `cames_expedientes` fijada por
`MONGODB_DB_NAME` y **no** por el URI.

**Por qué.** Aislamiento lógico sin costo de infraestructura, y migrar los
usuarios de Urbacames desde la base de talentlink es mover documentos dentro del
mismo cluster. Que el nombre de la base venga de su propia variable evita el
accidente clásico: pegar un URI con base incluida y escribir en la de otro
proyecto.

**Consecuencia.** Si más adelante se exige aislamiento físico (backups y
credenciales propias por LFPDPPP), sólo cambia `MONGODB_URI`.

---

## D-03 · Colección nueva `app_users`, no la `users` heredada

**Decisión.** El modelo `User` declara `collection: 'app_users'`.

**Por qué.** El requisito era no reutilizar la colección del proyecto base. Con
base de datos propia bastaría, pero un nombre distinto hace que el aislamiento no
dependa de que una variable de entorno esté bien puesta: aunque alguien apuntara
a la base equivocada, no mezclaría usuarios de Humenta con los de Urbacames.

---

## D-04 · `clienteId` nulable desde el día uno

**Decisión.** Cada colección que pertenece a alguien lleva
`clienteId: ObjectId | null`, con **`null` = Urbacames**; la colección `clients`
existe desde ahora aunque esté vacía; el filtro se construye en
`scopeMiddleware` y ningún servicio consulta sin él.

**Por qué.** El spec §4 lo exige y es la decisión que evita una migración
completa cuando entre el primer cliente. Un "cliente Urbacames" ficticio en la
tabla obligaría a sembrarlo, referenciarlo en cada alta y tratarlo distinto en los
permisos; `null` se lee mejor en las consultas (`{ clienteId: null }` es "lo de la
casa").

**Consecuencia.** Está prohibido usar `clienteId` para significar "empleador": si
algún día hay outsourcing, se agrega `empleadorId` **junto** a `clienteId`.

---

## D-05 · Autorización por capacidades, no por roles

**Decisión.** Las rutas piden capacidades
(`requireCapability(CAPABILITIES.MANAGE_USERS)`) contra la matriz de
`utils/permissions.js`.

**Por qué.** `talentlink-backend` usaba `restrictTo('admin')` en cada ruta: la
matriz de permisos quedaba repartida por todo el código y cambiar una regla
significaba cazar rutas. Con capacidades, la matriz del spec §8 vive en un solo
archivo y las rutas expresan intención. `'own_area'` se modela como permiso con
filtro (`req.areaFilter`), no como booleano, porque un jefe de área **sí** puede
ver expedientes: sólo los de su área.

---

## D-06 · Sin registro público

**Decisión.** No existe `POST /auth/register`. Las cuentas las crea un
administrador por `POST /usuarios`, y el primero sale de `npm run seed:admin`.

**Por qué.** El backend prestado exponía registro abierto. Aquí eso daría acceso
a expedientes con INE, CURP, NSS y exámenes médicos a cualquiera que descubriera
la URL.

---

## D-07 · La autorización relee al usuario en cada petición

**Decisión.** El JWT lleva `sub`, `nivelAcceso` y `alcance`, pero `protect`
siempre carga el usuario de la base y valida `active`.

**Por qué.** Con 12 h de sesión, confiar en el payload significa que dar de baja
a alguien o bajarle el nivel tarda hasta 12 h en surtir efecto. El costo es una
consulta por petición sobre un índice único: barato comparado con el riesgo.

---

## D-08 · Se manda `role` **y** `nivelAcceso`

**Decisión.** El `AuthUser` incluye los dos: `nivelAcceso` como fuente real y
`role` derivado (`rh_admin` → `admin`, el resto → `user`).

**Por qué.** El front todavía traduce `role` a nivel de acceso; hasta que lea
`nivelAcceso` directo, el `jefe_area` no puede existir de verdad. Es compatibilidad
temporal, no diseño: cuando el front cambie (tres líneas), se quita `role` del
`toJSON` y se anota aquí.

---

## D-09 · Fechas de calendario como `String 'YYYY-MM-DD'`

**Decisión.** Las fechas civiles se guardan y transportan como cadena; sólo las
marcas de tiempo son `Date`. La aritmética vive en `utils/dates.js`.

**Por qué.** Un `Date` con fecha civil se guarda en medianoche UTC y en México se
lee un día antes. Ya fue un bug real en el front. `addMonths` respeta el fin de
mes (31 de enero + 1 mes = 28 o 29 de febrero) y `today()` usa la zona de negocio,
no la del servidor: en un contenedor en UTC, "hoy" para el usuario no es "hoy"
para el proceso.

---

## D-10 · Nada derivado en la base

**Decisión.** Sólo se persisten `pending`, `in_review`, `validated`, `rejected`.
`expiring`, `expired`, `avance` y las alertas se calculan al leer.

**Por qué.** Un estatus que depende del calendario queda desactualizado al día
siguiente de escribirlo. El spec lo pone como regla no negociable y los criterios
de aceptación lo verifican.

---

## D-11 · Entorno validado al arrancar

**Decisión.** `config/env.js` valida con zod y mata el proceso si falta algo o
está mal; nadie más lee `process.env`.

**Por qué.** En el proyecto base cada módulo leía `process.env` directo y una
variable mal escrita sólo se notaba al fallar en caliente — de hecho el `.env`
definía `JWT_EXPIRES_IN` y el código leía `JWT_EXPIRE`, así que la expiración
real era el default. Fallar al arrancar es barato; fallar en la primera petición
de un usuario, no.

---

## D-12 · El servidor no levanta sin base de datos

**Decisión.** `connect()` reintenta con backoff (5 intentos) y **rechaza** si
agota; `server.js` sólo escucha después de conectar.

**Por qué.** En `talentlink-backend` el reintento atrapaba el error y la promesa
se resolvía igual, así que el servidor empezaba a escuchar sin base y respondía
500 a todo, con un health check en verde. Aquí un contenedor sin base falla
rápido y el orquestador lo reinicia.

---

## D-13 · Envelope por helpers, no a mano

**Decisión.** `utils/response` (`ok`, `created`, `noContent`) y `AppError` son la
única forma de responder. ESLint avisa si se usa `res.send`.

**Por qué.** El envelope es contrato. Escrito a mano en cada controlador, se
desvía en el primer endpoint con prisa y el front se rompe en un caso que nadie
probó.

---

## D-14 · `asyncHandler` en vez de `try/catch` por método

**Decisión.** Los controladores no llevan `try/catch`; las rutas envuelven con
`asyncHandler`.

**Por qué.** El patrón repetido del proyecto base (`try { … } catch (e) { logger.error; next(e) }`)
duplicaba el log del error —el `errorHandler` ya lo registra— y bastaba olvidar un
`next(error)` para dejar la petición colgada sin respuesta.

---

## D-15 · Errores de validación con `errors[]`

**Decisión.** `validateRequest` devuelve `errors: [{ msg, path }]` además de
`message`.

**Por qué.** El proyecto base concatenaba todos los mensajes en `message` y
perdía el arreglo, así que el front no podía señalar el campo culpable. El spec
§2.3 lo pide y el front ya lo lee.

---

## D-16 · Nombre de usuario con acentos

**Decisión.** El patrón es `/^[\p{L}\s'-]+$/u`, no `/^[a-zA-Z\s-]+$/`.

**Por qué.** El patrón heredado rechazaba a quien se llama Muñoz o Ángeles. Es
una limitación del backend prestado, no un requisito.

**Pendiente.** Avisar al front para que relaje su validación
(`src/utils/user-validation.ts`); hoy es el lado más estricto.

---

## D-17 · Sin sanitización destructiva del nombre

**Decisión.** El nombre se valida y se recorta, pero no se le quitan caracteres.

**Por qué.** El proyecto base pasaba los nombres por `xss()` y luego
`replace(/[^\w\s-]/g, '')`, que **borra** acentos y ñ del dato guardado: "Muñoz"
quedaba como "Muoz". El escape correcto es al renderizar (lo hace React), no al
guardar; y para inyección, Mongoose ya tipa y escapa los valores.

---

## D-18 · Rate limit específico en el login

**Decisión.** Límite general de la API más uno estricto en `POST /auth/login`,
contado por **IP + correo** y saltándose los intentos exitosos.

**Por qué.** Es la puerta de entrada a datos personales sensibles. Contar sólo por
IP permite repartir un ataque cambiando de red; contar sólo por correo permite
barrer correos desde una IP. Y limitar los intentos exitosos castigaría a un
equipo de RH que entra desde la misma oficina.

---

## D-19 · Logs JSON a stdout, archivos opcionales

**Decisión.** Consola siempre (JSON en producción, legible en desarrollo);
archivos sólo con `LOG_TO_FILE=true`; `X-Request-Id` en cada línea y en la
respuesta.

**Por qué.** En un contenedor los archivos de log se pierden al reiniciar y
mientras tanto llenan el disco. El proyecto base escribía siempre a
`logs/combined.log` sin rotación. El id de correlación permite seguir una
petición completa y que el front lo cite al reportar un error.

---

## D-20 · Pruebas con MongoDB en memoria

**Decisión.** Jest + supertest + `mongodb-memory-server`, con las colecciones
limpiadas entre pruebas.

**Por qué.** Los criterios de aceptación del spec §13 son una lista de pruebas
automatizadas. Que no hagan falta servicios instalados ni una base compartida es
lo que hace que se corran de verdad, en cada máquina y en CI.

---

## D-21 · Administrador inicial en la primera corrida, no un endpoint de bootstrap

**Decisión.** Al arrancar, si la colección de usuarios está **vacía**, se crea un
`rh_admin` con las credenciales de `BOOTSTRAP_ADMIN_*`
(`src/services/bootstrapAdmin.js`). No existe ningún endpoint público para
crear el primer usuario.

**Por qué.** Sin registro público (D-06), un sistema recién instalado no tiene
puerta de entrada. La alternativa era un `POST /auth/bootstrap` protegido por
"sólo si no hay usuarios", pero eso abre una ventana en cada instalación nueva —
y en cada base recién vaciada — en la que quien llegue primero se queda con el
sistema, y esa ventana es alcanzable desde internet. El arranque no la tiene: el
usuario ya existe antes de que el servidor acepte la primera conexión.

**Consecuencias y garantías.**

- Corre **sólo** con la colección vacía: reiniciar no resucita ni sobreescribe a
  nadie, y cambiar la contraseña de ese usuario es permanente.
- Es idempotente y tolera arranques simultáneos: el índice único del correo deja
  pasar a una sola instancia.
- Se desactiva con `BOOTSTRAP_ADMIN_ENABLED=false`, sin tocar código, y el módulo
  está aislado para poder borrarlo completo (las instrucciones están en su
  encabezado).
- Un fallo al crearlo **no** impide que la API levante; se registra como error.

**La excepción deliberada.** La contraseña de arranque (`1234` por defecto) no
cumple las reglas de la API, así que el alta se hace con
`User.collection.insertOne`, saltándose la validación de Mongoose. Es el único
lugar del proyecto donde se hace: mantener la regla `minlength: 8` intacta para
todos y saltarla en un módulo cerrado es preferible a relajarla en el esquema.
El documento se escribe completo, así que después se lee, edita, da de baja y
cambia de contraseña como cualquier otro usuario.

**Riesgo asumido, y cómo se cierra.** Entre la primera corrida y el primer cambio
de contraseña, existe una cuenta de administrador con una credencial trivial. En
un servidor accesible desde internet eso es explotable en minutos. Antes de
exponer el backend: cambiar la contraseña (`POST /auth/cambiar-password`) y poner
`BOOTSTRAP_ADMIN_ENABLED=false`. Para producción lo apropiado es no usar el
default sino definir `BOOTSTRAP_ADMIN_PASSWORD` con algo fuerte, o crear al
primer administrador con `npm run seed:admin`.

---

## D-22 · MongoDB 4.2+ y un Mongo propio en el 27018, sin bajar de Mongoose

**El problema.** Al arrancar contra el Mongo local, el driver aborta con
`Server at 127.0.0.1:27017 reports maximum wire version 6, but this version of
the Node.js Driver requires at least 8 (MongoDB 4.2)`. En las máquinas del equipo
el 27017 lo ocupa un contenedor `mongo:3.6` —el que usa `talentlink-backend`— y
Mongoose 8 va con el driver 6, que exige MongoDB 4.2 como mínimo. En talentlink
funciona porque ahí es Mongoose 7 (driver 5), compatible con 3.6.

**Decisión.** Se mantiene Mongoose 8 y este proyecto levanta **su propio
MongoDB 8 en el puerto 27018** (`docker-compose.yml`, `npm run db:up`). El
contenedor viejo se queda intacto en el 27017 y los dos conviven.

**Por qué no bajar a Mongoose 7.** MongoDB 3.6 quedó sin soporte en 2021 y el 4.2
en 2023: alinear el proyecto nuevo con un servidor de 2018 para no tocar un
contenedor de desarrollo sería atarlo a una versión sin parches de seguridad, en
un sistema que guarda INE, CURP, NSS y exámenes médicos. Además el cluster de
Atlas al que apunta producción ya es moderno, así que bajar el driver sólo
desalinearía desarrollo de producción.

**Por qué otro puerto y no reemplazar el contenedor.** Apagar o actualizar el
`mongo:3.6` rompería el entorno de desarrollo de talentlink, que está en
producción y no es nuestro para migrar. Un puerto distinto no le pide permiso a
nadie.

**Diagnóstico, además.** `config/database.js` traduce este error (y los de
credenciales, DNS, conexión rechazada y lista de IPs de Atlas) a un mensaje en
español que dice qué hacer, y **deja de reintentar** cuando esperar no lo va a
arreglar: el caso real tardaba 66 segundos en cinco intentos idénticos y ahora
falla en 11 con la instrucción exacta. Probado en
`tests/unitarias/database.test.js`.

**Transacciones (pendiente).** El contenedor es un nodo suelto y las transacciones
de MongoDB exigen un replica set. Cuando haga falta —el spec §4 pide actualizar
colaborador y expediente en la misma transacción— se convierte a un replica set de
un nodo (`--replSet rs0` + `rs.initiate()`) y se agrega
`?replicaSet=rs0&directConnection=true` al URI. Atlas ya es replica set: esto sólo
aplica al Mongo local.

---

## D-23 · `GET /expedientes` va paginado desde la primera versión

**Decisión.** El listado responde
`data: { expedientes, total, pagina, porPagina }` y acepta `?pagina=&porPagina=`
junto con los filtros. Aunque el endpoint todavía no exista, la forma queda
cerrada.

**Por qué ahora y no después.** El front ya está escrito contra un arreglo pelón.
Si el backend nace devolviendo el arreglo y luego hace falta paginar, es un cambio
**incompatible**: se les rompe la pantalla y hay que coordinar un despliegue de los
dos lados. Decidirlo antes de escribir la primera línea cuesta cero. Con ~300
colaboradores, además, la paginación va a hacer falta.

---

## D-24 · Las plantillas llevan `clave`, además de `_id`

**Decisión.** `ChecklistTemplate` tiene un campo `clave` (`'plantilla-general'`,
`'plantilla-obra'`…), único por cliente. No está en el spec 6.5.

**Por qué.** Dos cosas lo necesitan y ninguna puede depender de un `ObjectId`, que
es distinto en cada ambiente:

1. La resolución de plantilla usa `plantilla-general` como **red de seguridad**
   cuando ningún nivel de especificidad empata (spec 4). El front la identifica
   así (`_id: 'plantilla-general'` en sus mocks).
2. El **sembrado idempotente**: "esta plantilla base ya existe" tiene que poder
   comprobarse por identidad estable, no por nombre —que un administrador puede
   editar— ni por `_id`.

`clave` es `null` en las plantillas que cree un usuario: sólo las base la traen.

---

## D-25 · El mensaje de alerta usa el singular correcto

**Decisión.** `venció hace 1 día` y `vence en 1 día`, no `1 días`.

**Por qué.** El front genera `hace ${dias} días` siempre, así que en el caso de un
día dice "hace 1 días". Ahora el mensaje lo produce el servidor y lo lee el equipo
de RH de Urbacames: es texto de producto, no un log. No rompe nada —el front pinta
`alerta.mensaje` tal cual, no lo compara— y el resto de los mensajes es idéntico
al suyo, carácter por carácter.

---

## D-26 · El índice de plantillas no puede ser el del spec

**Decisión.** El índice es `{ clienteId: 1, tiposContrato: 1 }`, no
`{ clienteId: 1, tiposContrato: 1, areas: 1 }` como sugiere el spec 6.7. El área
se resuelve en memoria.

**Por qué.** MongoDB **no puede** indexar dos arreglos en el mismo índice
compuesto: `cannot index parallel arrays [areas] [tiposContrato]`. No es una
preferencia, es un límite del motor, y el intento no falla al crear el índice sino
**al insertar** un documento que tenga valores en los dos arreglos — que es
exactamente la plantilla de obra. Lo detectaron las pruebas de sembrado.

Resolver el área en memoria no cuesta nada: son un puñado de plantillas y
`resolveTemplate` ya recibe la lista completa.

**Lección que quedó documentada.** `autoIndex` **crea** índices pero nunca borra
los que ya no están en el esquema. El índice inválido siguió vivo en la base de
desarrollo después de corregir el modelo, y el sembrado seguía fallando sin razón
aparente. Para eso está `npm run db:indices` (`syncIndexes`), que sí los elimina:
si un cambio de índices no parece surtir efecto, correrlo es el primer paso.

---

# Modelo nuevo (jerarquía de empresas)

A partir de aquí, las decisiones corresponden al modelo de
[`docs/modelo-datos.md`](./modelo-datos.md): empresas como entidad raíz,
empleados y clientes como catálogos compartidos, y los vínculos
(`adscripciones`, `carteras`, `asignaciones`) como colecciones propias.

---

## D-27 · El secreto de acceso vive en `credentials`, no dentro del empleado

**El contexto.** El front propuso —con buen criterio— que el usuario de la
plataforma **sea un empleado con `acceso`**, para que nunca existan dos registros
de la misma persona. Se conserva esa decisión. Lo único que se movió es el
`passwordHash`.

**El problema medido.** Con el hash embebido y `select: false`, la protección se
cae en las lecturas que este modelo usa todo el tiempo:

| Lectura                                       | ¿Se filtra el hash? |
| --------------------------------------------- | ------------------- |
| `findOne()`                                   | No                  |
| `findOne().select('acceso')`                  | **Sí**              |
| `aggregate([{ $match }])`                     | **Sí**              |
| `$lookup` desde `adscripciones` a `empleados` | **Sí**              |

`select: false` sólo lo respeta el query builder de Mongoose; **las agregaciones
lo ignoran**, y seleccionar el padre anula el `select` del hijo. Está probado en
`tests/unitarias/credentialIsolation.test.js`. Y el listado principal del producto
es exactamente `adscripciones.aggregate($lookup empleados)`: bastaría olvidar un
`$unset` una vez para publicar credenciales al navegador. En un sistema con datos
personales sensibles, eso es un incidente reportable.

**Decisión.**

- `empleados.acceso` = `{ email, nivelAcceso, alcanceGlobal, activo, passwordActualizadaEn }`
  — autorización, nada secreto.
- `credentials` = `{ empleadoId (único), passwordHash, resetToken, resetExpiraEn,
intentosFallidos, bloqueadaHasta, ultimoAccesoEn }`.

**Por qué sale mejor sin costar nada.**

- El aislamiento es **estructural**: no hay proyección que se pueda olvidar,
  porque el secreto no está en el documento que se agrega.
- **Mismo costo por petición**: `protect` necesita nivel, alcance y estado, que
  siguen en el empleado → una consulta. Las credenciales sólo se leen en el login
  y al cambiar contraseña.
- `?soloConAcceso=true` sigue siendo un filtro directo (`acceso != null`), sin
  `$lookup`.
- El login **no escribe en el empleado**: `ultimoAccesoEn` vive en la credencial y
  no le mueve el `updatedAt` al documento de la persona, que es candidato a caché.
- Deja lugar natural para lo que un login de verdad necesita (recuperación,
  bloqueo, invitación por token) sin engordar el documento más leído.
- **Para el front no cambia nada**: el `AuthUser` que definieron queda idéntico,
  porque el hash nunca se exponía.

**El precio, asumido.** Dar o quitar acceso escribe dos colecciones, así que va en
transacción. No es costo nuevo: el modelo ya exige transacciones (crear un
empleado escribe su expediente).

**`passwordActualizadaEn` es la excepción y vive en el empleado**: no es secreto y
se consulta en cada petición para invalidar tokens viejos. Ponerlo en la
credencial obligaría a una segunda consulta en el camino caliente.

---

## D-28 · La CURP es opcional al dar de alta, con índice único parcial

**Decisión.** `curp` admite `null` y su índice es
`unique + partialFilterExpression: { curp: { $type: 'string' } }`.

**Por qué.** `modelo-datos.md` §5.2 la pone obligatoria y deja la decisión
abierta: con personal de obra el primer día, exigirla bloquea el alta. La salida
elegida es la primera que el propio documento propone: alta provisional sin CURP
y **no se puede validar el expediente de alguien sin ella**.

**Lo que hay que saber.** Es el sentido _menos_ reversible de los dos: volver a
hacerla obligatoria exige limpiar los registros que quedaron sin ella. Por eso la
regla de "no validar sin CURP" no es opcional — es lo que evita acumular
provisionales para siempre. **Confirmar con Urbacames.**

**Nota sobre el índice.** Es parcial y no `sparse` porque con `default: null` el
campo **existe** en el documento, así que un índice disperso no lo omitiría y dos
altas sin CURP colisionarían. Lo mismo aplica a `acceso.email`.

---

## D-29 · MongoDB local como replica set de un nodo

**Decisión.** El contenedor corre con `--replSet rs0` y el URI lleva
`?replicaSet=rs0`. `npm run db:up` inicia el set solo.

**Por qué.** El modelo nuevo **exige transacciones**: crear un empleado escribe su
expediente, dar acceso escribe empleado y credencial, migrar escribe tres
colecciones. Las transacciones de MongoDB sólo existen en un replica set. Sin
esto, cada operación multi-documento tendría que implementarse "a mano" y dejaría
estados a medias cuando algo falla.

Las pruebas usan `MongoMemoryReplSet` por la misma razón: con
`MongoMemoryServer` a secas, cada `withTransaction` falla con _"Transaction
numbers are only allowed on a replica set member or mongos"_.

**Detalle que cuesta una tarde si se ignora.** El puerto dentro del contenedor es
el mismo que fuera (27018). Un replica set **anuncia la dirección de sus
miembros**, así que si dentro escuchara en 27017, el driver del host acabaría
intentando conectarse al `mongo:3.6` de talentlink.

---

## D-30 · El acceso es un sub-recurso del empleado; `/usuarios` responde 410

**Decisión.** No hay CRUD de usuarios. Hay:

| Ruta                                              | Qué hace                                   |
| ------------------------------------------------- | ------------------------------------------ |
| `GET /empleados?soloConAcceso=true`               | Quiénes entran a la plataforma             |
| `POST /empleados/:id/acceso`                      | Da acceso a alguien que **ya existe**      |
| `PATCH /empleados/:id/acceso`                     | Nivel, alcance, correo, activar/desactivar |
| `DELETE /empleados/:id/acceso`                    | Quita el acceso; la persona queda intacta  |
| `POST /empleados/:id/acceso/restablecer-password` | Un `rh_admin` la repone                    |

**Por qué así.** Es lo que hace **estructuralmente imposible** duplicar a la
persona, que era la invariante innegociable del front: para dar acceso hay que
partir de un empleado existente. Con un `POST /usuarios` que crea persona y acceso
a la vez, la duplicación depende de que alguien se acuerde de buscar primero.

**Por qué 410 y no 404.** `404` diría "esta ruta nunca existió"; lo que pasó es
que se movió. El 410 lleva en el mensaje las rutas nuevas, así que el front lo
descubre en la primera llamada. Se borra `goneRoutes.js` cuando hayan migrado.

**Dos reglas que se agregaron a la matriz:** `alcanceGlobal` sólo sobre
`rh_admin` (es el administrador de plataforma, no un nivel aparte) y **sólo un
administrador de plataforma puede otorgar alcance global** — si no, cualquier
`rh_admin` de una empresa se ascendería a ver todo el grupo. Tampoco se puede
dejar al sistema sin administrador de plataforma activo, ni quitarse el acceso a
uno mismo.

---

## D-31 · Todos los modelos se registran al arrancar

**Decisión.** `src/models/index.js` requiere cada modelo y `app.js` lo carga.

**Por qué.** `populate()` resuelve el modelo referenciado **por nombre** en
tiempo de ejecución. `/auth/login` popula la empresa de las adscripciones, y en el
servidor real nadie había cargado `Company` todavía: el login de cualquiera con
adscripción respondía **500** con `MissingSchemaError`. Las pruebas no lo vieron
porque las fábricas importan todos los modelos y los registran de rebote.

`tests/unitarias/models.test.js` cierra la puerta: importa la app **sin** las
fábricas, comprueba que todos los modelos quedaron registrados y recorre cada
`ref` de cada esquema verificando que apunte a un modelo que existe.

**Regla:** al agregar un modelo, agrégalo a `src/models/index.js`.

---

## D-32 · La matriz de permisos del alta se corrige, y el alta se decide por tipo

**Decisión.** Se aplica la corrección que Urbacames confirmó al front:

| Recurso                              | admin de plataforma |   `rh_admin`   | `rh_consulta` |  `jefe_area`   |
| ------------------------------------ | :-----------------: | :------------: | :-----------: | :------------: |
| `POST /empresas`                     |          ✓          |                |               |                |
| `POST /categorias`                   |          ✓          |                |               |                |
| `POST /clientes`                     |          ✓          |       ✓        |               |       ✓        |
| `POST /carteras`                     |       ✓ todas       | ✓ sus empresas |               | ✓ sus empresas |
| `POST /empleados` · `mano_de_obra`   |          ✓          |       ✓        |       ✓       |       ✓        |
| `POST /empleados` · `administrativo` |          ✓          |       ✓        |               |                |
| `POST /adscripciones`                |          ✓          |       ✓        |               |                |

**Lo que implica en el código.** El alta de personal **no se puede autorizar con
un middleware fijo** en la ruta: depende del `tipo` que viene en el cuerpo. Un
`requireCapability` en `POST /empleados` daría 403 a un `rh_consulta` que sí puede
dar de alta personal de obra. Por eso la ruta no lleva capacidad y el servicio
decide con `canCreateEmployee(acceso, tipo)`, donde el tipo ya está validado.

`MANAGE_SHARED_CATALOGS` se partió en `MANAGE_COMPANIES` y `MANAGE_CATEGORIES`
(las dos exigen `alcanceGlobal`) y apareció `CREATE_CLIENTS`, porque clientes ya
no va con ellas: un jefe de área puede dar de alta clientes.

**Pedir `administrativo` sin poder responde 403**, no crea con otro tipo ni ignora
el campo. Hay prueba.

**Ampliación confirmada (2026-08-21): quien puede crear a alguien de un tipo puede
también editarlo.** La matriz §8.2 dejaba la edición sólo en `rh_admin`, y eso
significaba que un `rh_consulta` o un `jefe_area` capturaba personal de obra y
después **no podía corregir su propio error de dedo**: tenía que pedírselo a un
administrador. Por eso las capacidades se renombraron —`MANAGE_FIELD_EMPLOYEES` y
`MANAGE_ADMIN_EMPLOYEES`, no `CREATE_*`— y `canManageEmployeeType` gobierna el alta
y la edición.

Lo que **no** se abrió, y es deliberado:

- **Cambiar el `tipo` a `administrativo`** exige poder crear administrativos: si
  no, un `jefe_area` daría de alta a un peón y luego lo "ascendería".
- **La baja del sistema sigue siendo de `rh_admin`** (`DEACTIVATE_EMPLOYEES`).
  Corregir datos y sacar a alguien del sistema no son la misma decisión.
- El alcance no cambia: un `jefe_area` sólo alcanza a la gente de **sus áreas**, así
  que editar a alguien de otra área responde `404`, como el listado.

---

## D-33 · La adscripción es obligatoria en el alta, salvo para el administrador de plataforma

**El hueco que se cierra.** El alcance se deriva de las adscripciones. Un empleado
creado sin adscripción no pertenece a ninguna empresa y por lo tanto **no es
visible para nadie**, ni para quien lo acaba de crear: queda huérfano hasta que
alguien más lo adscriba. El front lo detectó antes de implementarlo.

**Decisión.** `POST /empleados` crea persona **y** adscripción en una
**transacción**: o las dos, o ninguna. La adscripción es obligatoria para
`rh_admin`, `rh_consulta` y `jefe_area`; sólo el administrador de plataforma
—que ve todo— puede omitirla, porque él sí puede estar llenando nada más el
catálogo compartido.

**Desviación de la propuesta del front:** ellos la dejaban opcional también para
`rh_admin`. Se exige, porque un `rh_admin` sin `alcanceGlobal` que omita la
adscripción crea una persona que **él mismo no puede ver ni editar**. Es el mismo
problema que vinieron a reportar, un nivel más abajo.

**Y un nivel más abajo todavía:** un `jefe_area` tiene que indicar al menos un
área **de las suyas**. Si no, la persona nace fuera de su filtro de áreas y
tampoco la ve. Áreas ajenas → `403` diciendo cuáles son las suyas; ninguna área →
`400` explicando por qué.

Se descartó la alternativa de `POST /adscripciones` abierto a los tres niveles:
son dos pasos donde el primero deja basura si el segundo falla, y obliga a la
interfaz a hacer _rollback_ a mano.

---

## D-34 · Duplicados: 409 con candidatos, y la CURP no se puede forzar

**El riesgo.** Con tres niveles capturando personal y la CURP opcional (D-28), el
mismo peón se va a capturar dos veces con el nombre ligeramente distinto. El
índice único no lo evita cuando la CURP viene vacía.

**Decisión**, la que propuso el front:

- **Con CURP repetida** → `409 CURP_DUPLICADA`, con el candidato en
  `data.candidatos`. **No se puede forzar**: la CURP es la identidad de la
  persona; permitir el duplicado rompería el propósito del catálogo.
- **Sin CURP** → se busca por nombre normalizado (sin acentos ni mayúsculas) más
  `fechaNacimiento` si viene, y se responde `409 POSIBLE_DUPLICADO` con los
  candidatos en vez de crear a ciegas. Si de verdad es otra persona, la petición
  lo dice con `confirmarDuplicado: true`.

**Qué se expone de un candidato, y qué no.** `_id`, `nombre`, `curp`,
`fechaNacimiento`, `tipo`, `activo` y **`yaEstaEnTuEmpresa`**. No se listan las
empresas donde trabaja: el catálogo es compartido a propósito, pero _dónde más
trabaja alguien_ no es información de otra empresa. `yaEstaEnTuEmpresa` es lo
único que la interfaz necesita para elegir entre «ya la tienes» y «existe en el
grupo, ¿la adscribo?».

**Consecuencia en el contrato:** un error ahora puede llevar datos. `AppError`
acepta `data` y el envelope lo devuelve en vez de `null`. Sin eso, la lista de
candidatos no cabía en la respuesta.

---

## D-35 · Dos detalles del contrato que el front había pedido distinto

**`activo`, no `activa`.** El ejemplo de `POST /empresas` que mandó el front usaba
`"activa": true`. Se responde **`activo`**, como el modelo autoritativo y como
todas las demás colecciones (`cliente.activo`, `empleado.activo`,
`adscripcion.activo`). Un solo nombre en toda la API vale más que la concordancia
de género en una colección; hay que avisarles porque una UI que lea `activa`
falla en silencio.

**`categorias.tipo` no existía y se agregó.** No está en `modelo-datos.md` §5.4;
lo pidió el front para poblar el desplegable del alta según el tipo de persona
(`GET /categorias?tipo=mano_de_obra`). Tiene sentido: "Auxiliar contable" no es un
puesto de obra y ofrecerlo ahí sólo produce capturas mal hechas. Además se valida
la coherencia: dar de alta a alguien de obra con una categoría administrativa
responde `400`. Si esa validación estorba, se quita en una línea — pero entonces
el desplegable filtrado deja de significar algo.

---

## D-36 · «Eliminar» un cliente es desactivarlo, y por ahora no hay borrado real

**Decisión.** `PATCH /clientes/:id/estado` con `{ activo: false }`. No existe
`DELETE /clientes/:id`.

**Por qué.** El modelo lo pone como convención transversal (§4): _nada se borra,
todo es baja lógica_. Un cliente arrastra carteras, proyectos e historial, y un
expediente es un registro de auditoría: borrar la fila deja referencias huérfanas
que nadie puede interpretar después.

**Por qué tampoco un borrado "sólo si no tiene nada colgando", que sería
razonable.** El caso real existe —un cliente capturado por error en un catálogo
**global**, que todo el grupo ve— y la guarda natural sería «bórralo sólo si no
está en ninguna cartera ni tiene proyectos». Pero `carteras` y `proyectos` **no
existen todavía**, así que hoy esa guarda se cumpliría siempre y el endpoint
borraría cualquier cosa. Se implementa cuando haya algo que comprobar; mientras
tanto, desactivar resuelve el caso sin riesgo.

**Pendiente marcado en el código.** `#assertSePuedeDesactivar` está vacío a
propósito en `clientService`, con el TODO de la regla del spec §6.2: _desactivar
falla si el cliente tiene proyectos en curso_. Queda en el servicio del cliente
—no en el de proyectos— para que se llene donde se busca.

**Permisos.** Alta, edición y baja las hacen `rh_admin` y `jefe_area` (corrección
D-32), no `rh_consulta`. Se aplicó el mismo criterio que en el personal: quien
puede crear puede corregir y desactivar. Leer el catálogo lo puede cualquiera con
sesión, porque puebla los selectores de proyectos y carteras.

**Alcance, pendiente y visible.** Según §8.1 el listado debería mostrar sólo «los
clientes de las carteras de mis empresas». Sin `carteras` eso no se puede filtrar,
así que hoy cualquiera con sesión ve el catálogo completo. **Cuando exista, el
front va a ver menos clientes que ahora**: está avisado en la guía para que no lo
lea como un bug.
