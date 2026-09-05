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

> **Al día de hoy (31 ago 2026) ni siquiera hay patrón.** Aquel `nombre` era el
> del usuario del backend prestado, y esa colección desapareció (D-27). Lo que
> valida el servidor es el **nombre del empleado**, y sólo mide su largo: entre
> 3 y 120 caracteres, recortado, sin filtrar un solo carácter
> (`src/validations/employeeValidation.js`). La regla, escrita donde se busca,
> está en `INTEGRACION-FRONTEND.md` §7.

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

**Decisión.** Se aplica la corrección que Urbacames confirmó al front: dar de
alta personal de obra no es exclusivo de `rh_admin` —lo hacen también
`rh_consulta` y el `jefe_area`—, y dar de alta clientes tampoco.

> **Aquí había una tabla, y sobraba.** Era la segunda del proyecto y contradecía
> a la de `modelo-datos.md` §8.2: cuando esta decisión amplió la edición (abajo),
> §8.2 no se actualizó, y quedó diciendo durante meses que sólo `rh_admin` podía
> editar personal. Se quitó el 31 ago 2026: **la tabla vigente es la de §8.2**,
> es la única, y una prueba de `tests/unitarias/docs.test.js` la compara celda
> por celda contra `PERMISSION_MATRIX`. Lo que sigue aquí es el porqué, que es
> lo que le toca a una decisión.

**Lo que implica en el código.** El alta de personal **no se puede autorizar con
un middleware fijo** en la ruta: depende del `tipo` que viene en el cuerpo. Un
`requireCapability` en `POST /empleados` daría 403 a un `rh_consulta` que sí puede
dar de alta personal de obra. Por eso la ruta no lleva capacidad y el servicio
decide con `canManageEmployeeType(acceso, tipo)`, donde el tipo ya está validado.

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

---

## D-37 · Las carteras se implementaron antes que los proyectos, porque son su requisito

**Contexto.** Se pidió «proyectos». No se pueden hacer sin `carteras`: la regla
del spec §6.4 dice que **el cliente de un proyecto tiene que estar en la cartera
activa de la empresa del proyecto**, y sin la colección no hay nada contra qué
validar. Implementar proyectos sin esa regla habría dejado proyectos que violan la
invariante en cuanto la cartera existiera, y el flujo del front —«elige un cliente
de tu cartera»— no se puede construir.

**Decisiones de diseño de la cartera:**

- **El alta y el listado viven bajo la empresa** (`/empresas/:id/clientes`),
  porque la cartera se lee y se llena siempre desde una empresa concreta. Las
  operaciones sobre un vínculo que ya existe van en `/carteras/:id`, que se
  identifica solo.
- **Volver a meter un cliente que se sacó lo REACTIVA** y responde `200`, no
  `201`: el índice único lo impide y, sobre todo, duplicarlo perdería las notas y
  el contacto que ya tenía.
- **Sacar un cliente falla si la empresa tiene proyectos con él** (spec §6.3):
  dejar un proyecto con un cliente fuera de la cartera rompe la regla que hace
  válido al proyecto.
- El contacto de la cartera puede diferir del del catálogo global, que es la razón
  de que la relación tenga datos propios.

---

## D-38 · La fecha de cierre de un proyecto es auditoría, no un campo

**Decisión.** `PATCH /proyectos/:id` **rechaza** `fechaFinEstimada` con un `400`
que dice «usa POST /proyectos/:id/aplazar, que exige motivo». Mover el cierre pasa
sólo por `/aplazar`, que valida fecha posterior a la vigente, exige motivo de 10+
caracteres y **guarda el aplazamiento en el historial** con quién y cuándo.

**Por qué rechazarlo en vez de aceptarlo en silencio.** Un proyecto que se retrasa
tres veces cuenta una historia; un campo sobrescrito no cuenta ninguna. El spec lo
pide explícitamente y el mensaje de error enseña la ruta correcta, así que el front
lo descubre en la primera llamada.

`registradoPor` guarda el **nombre**, no sólo el id, por lo mismo que en los
documentos: el histórico tiene que seguir legible si la persona se va.

**Finalizar cierra las asignaciones abiertas** con la misma fecha, en una
transacción. Una asignación activa en un proyecto terminado contradice la regla de
que no se asigna a proyectos finalizados, y dejaría gente «en obra» para siempre en
los reportes. **Reabrir NO las devuelve**: volver a poner a alguien en la obra es
una decisión, no un efecto secundario — el mensaje de la respuesta lo dice.

**Quitar una categoría que alguien asignado está usando falla** (`400` con cuántas
personas la tienen), en vez de dejar asignaciones apuntando a una categoría que el
proyecto ya no habilita.

> Ese último párrafo **ya no aplica desde D-82**: el proyecto dejó de habilitar
> puestos, así que no hay lista de la que quitar nada. Lo demás de esta decisión
> —el cierre como auditoría— sigue vigente.

---

## D-39 · `idAString`: las referencias populadas no se serializan con `.toString()`

**El bug.** `POST /proyectos/:id/asignaciones` devolvía
`empleadoId: "[object Object]"`. La causa: el `toJSON` hacía
`ret.empleadoId.toString()`, y cuando la consulta pobló ese camino
(`.populate('empleadoId')`) el valor ya no es un `ObjectId` sino el documento
entero — cuyo `toString()` es `"[object Object]"`.

**Decisión.** `utils/ids.js` con `idAString` / `idsAString`, usados en el `toJSON`
de **todos** los modelos con referencias. Responden lo mismo esté populado o no,
así que el contrato deja de depender de cómo se hizo la consulta.

**Por qué en todos y no sólo donde falló.** El mismo error estaba latente en
carteras (`clienteId` se pobla en el listado) y podía aparecer en cualquier
consulta futura que agregara un `populate`. Es una clase de bug, no un caso.
Cubierto en `tests/unitarias/text.test.js`.

---

## D-40 · Los dos pendientes que dependían de carteras y proyectos, resueltos

Los dos se dejaron a medias a propósito porque faltaba la colección de la que
dependían, y los dos se reportaron. Ya están cerrados.

### `GET /clientes` está acotado por cartera

Antes devolvía el catálogo del grupo a cualquiera con sesión, porque sin
`carteras` no había con qué filtrar. Ahora, según modelo-datos §8.1, devuelve **los
clientes de las carteras activas de las empresas visibles**. El administrador de
plataforma sigue viendo todo: administra el catálogo.

**Con una salida explícita, y hace falta:** `?catalogoCompleto=true` devuelve el
catálogo global y **exige poder administrar clientes** (`rh_admin`, `jefe_area`);
`rh_consulta` recibe `403`. Sin ella, quien va a meter un cliente a su cartera no
puede comprobar si ya existe en el grupo y acaba creando el duplicado que el
catálogo compartido viene a evitar. Es un permiso que ya tenían de hecho —pueden
dar de alta clientes globales—, así que no abre nada nuevo.

`GET /clientes/:id` sigue el mismo criterio: visible si está en una cartera propia,
o si quien pregunta administra clientes. Fuera de eso, **404**.

### `GET /empresas` ya trae los conteos reales

`clientes` cuenta la **cartera activa** y `proyectosActivos` los proyectos
**en curso** —no todos—, con tres agregaciones en paralelo, una por contador.
`alertasPendientes` **sigue en `null`** porque el módulo de alertas no existe:
`0` diría «no tiene ninguna» y sería mentira. Cuando exista, se llena sin cambiar
la forma.

---

## D-41 · Expedientes: uno por persona, checklist por unión y almacenamiento en R2

### El expediente es de la persona, no del vínculo

Una colección `records` con **`empleadoId` único**. Alguien adscrito a dos empresas
tiene **un** expediente, no dos: su INE es la misma en las dos.

De ahí sale la regla del checklist: **es la unión de las plantillas de todas sus
adscripciones activas**. `requerido` se resuelve con **OR** (si una empresa lo pide,
hace falta) y `vigenciaMeses` con **MIN** (gana la más estricta). `resolveTemplate`
elige la plantilla por cinco niveles de especificidad —de empresa+área+contrato a
la global—, así que una empresa puede endurecer un requisito sin tocar las demás.

La consecuencia práctica: al darle una adscripción nueva a alguien, su checklist
puede crecer, y `sincronizar` agrega los renglones que falten **sin tocar lo ya
entregado**. Nunca borra un documento que existe, aunque deje de ser requerido:
pasa a `requerido: false` y ahí se queda.

El expediente se crea **en la misma transacción que el alta** (`POST /empleados`),
no en un job ni a la primera consulta. Un empleado sin expediente es un agujero:
no sale en los faltantes ni en los reportes. `asegurarParaEmpleado` es idempotente
y absorbe el `11000` de la carrera, porque el índice único es la garantía real.

### Se reusó el servicio de R2 de Talentlink, con cuatro cambios

`src/services/storageService.js` conserva la estructura de
`talentlink-backend/src/services/r2Service.js` —`@aws-sdk/client-s3` +
`s3-request-presigner`, URLs firmadas con caducidad— y cambia:

1. **La clave nunca lleva el nombre original del archivo**, sino
   `expedientes/{empleadoId}/{tipo}/v{version}-{uuid}.{ext}`. Un nombre subido por
   el usuario es una ruta que él controla; el nombre real se guarda como metadato.
2. **Driver `memoria`** cuando no hay credenciales: las pruebas y el desarrollo
   local corren sin bucket, con el mismo contrato.
3. **Validación por magic bytes**, no por la extensión ni por el `Content-Type`
   —los dos los pone el cliente—. PDF, JPG, PNG y WEBP.
4. **HEIC se rechaza a propósito**, y con mensaje propio: Chrome no lo muestra, así
   que un expediente lleno de HEIC no se puede revisar. Es la foto que manda por
   defecto un iPhone, así que el mensaje pide convertirla en vez de decir sólo «tipo
   no permitido».

Un documento nuevo **versiona**: la v1 queda con `reemplazadaEn`, la v2 entra al
frente y se limpia el rechazo anterior. No se borra nada; el archivo viejo sigue en
el bucket y su URL se puede pedir.

**`claveAlmacenamiento` es `select: false` y `toJSON` la quita.** Es la ubicación
real del archivo: al front le toca pedir una URL firmada, que caduca y **queda en la
bitácora**. `access_logs` se escribe en **cada** emisión de URL, no en cada consulta
del expediente: la obligación de la LFPDPPP es sobre quién accedió al documento.

### El bucket se comparte: `R2_PREFIX`

El bucket `cames-files` es de la misma cuenta de Cloudflare que el de talentlink
(`humenta-cv/cvs`), y los expedientes viven en una carpeta suya:
`cames-files/employes-files/`. De ahí `R2_PREFIX`, que se le pone delante a toda
clave nueva y admite barras de sobra sin producir `//`.

El id de cuenta es el **subdominio del endpoint S3**, no algo del bucket:
`https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com/<R2_BUCKET>`. Es el mismo para
todos los buckets de la cuenta.

La clave completa —prefijo incluido— se guarda en `claveAlmacenamiento`, así que
cambiar el prefijo después **no pierde** los archivos ya subidos: los viejos
siguen resolviéndose por su clave guardada. Lo que no se debe hacer es mover
objetos en el bucket sin actualizar la base.

`npm run r2:check` hace el ciclo completo con un objeto de prueba —escribir,
firmar, leer, borrar— y traduce los errores de S3 al problema de configuración
que los causa. Un token de sólo lectura conecta bien y falla en la primera subida
real, que es el peor momento para enterarse.

### El bug que esto costó, y por qué la prueba tenía que subir dos veces

Al reemplazar un documento se **borraba la clave de las versiones anteriores**: el
archivo quedaba en R2 pero inalcanzable para siempre — justo lo que el versionado
existe para evitar. La causa es `select: false`: se leía el expediente sin pedir la
clave y al guardar, Mongoose reescribía el arreglo de versiones completo y escribía
`null` en lo que nunca se cargó.

Las pruebas no lo veían porque subían **una** versión y pedían esa misma; la v1 sólo
se corrompe cuando llega la v2. Lo destapó la prueba en vivo. El arreglo:
`CAMPOS_OCULTOS` en **toda** lectura que después vaya a guardar, y una prueba de
regresión que sube dos veces y verifica en la base que las dos claves siguen ahí y
son distintas.

La lección general: `select: false` protege la lectura, **no** la escritura. En
cualquier modelo con un campo oculto dentro de un arreglo, leer-modificar-guardar lo
pierde si no se pidió.

### `avanceExpediente` en el renglón de empleados

Los dos últimos campos que quedaban en `null` «hasta que existan los expedientes»
ya se llenan: el cruce se hace **dentro de la página** del `$facet` —25 renglones,
no la colección— y proyecta **sólo `requerido`, `estatus` y `vigenciaHasta`**. Los
archivos no entran: en una agregación `select: false` no aplica y la clave del
bucket se filtraría (D-27). El porcentaje se deriva al leer, igual que en el
expediente.

Un detalle que se ve raro y es correcto: `avance.porcentaje` cuenta sólo lo
**validado**, así que mientras no exista `POST …/validar` se queda en 0% aunque
estén todos los archivos. Se le documentó al front, con qué pintar mientras tanto.

### Vigencias

`contrato` **hereda** la `fechaTerminoContrato` más próxima de sus adscripciones
temporales; los demás documentos usan `hoy + vigenciaMeses` de la plantilla, y el
front puede mandar `vigenciaHasta` explícita. `expiring` / `expired` y el `avance`
**se derivan al leer**, nunca se guardan (D-04).

---

## D-42 · Las plantillas dicen qué es obligatorio, no qué se puede subir

**El reporte.** «No se puede cargar ningún documento, y eso depende de las
plantillas.» Tenía razón, y había dos cosas distintas debajo.

### La causa real: las plantillas de la base no tenían `activo`

`#checklistQueLeToca` consultaba `ChecklistTemplate.find({ activo: true })`. Las
cuatro plantillas base de la base de desarrollo venían del **modelo anterior**
—con `clienteId`, sin `empresaId` ni `activo`—, así que ese filtro devolvía
**cero** plantillas: todo expediente nacía con `documentos: []`, y sin renglones no
había nada que subir. La semilla no las arreglaba porque es idempotente **por
`clave`**: las veía existir y no las tocaba.

Tres arreglos, porque cada uno tapa un agujero distinto:

1. **La consulta ahora es `{ activo: { $ne: false } }`**, que es exactamente la
   regla que ya aplicaba `resolveTemplate` (`p.activo !== false`). Tenerlas
   distintas era el bug: el dominio toleraba el campo ausente y la consulta no.
2. **La semilla sanea las plantillas base del modelo anterior**: les pone
   `activo: true` y les quita `clienteId`. No toca `documentos`, que es donde
   puede haber ediciones de un `rh_admin`. Ojo con Mongoose: el `$unset` de un
   campo que ya no está en el esquema **se descarta en silencio** sin
   `{ strict: false }`.
3. **Un expediente que quedó vacío se rellena al leerlo.** Si tiene renglones no
   escribe nada; sólo actúa en el caso roto, porque la causa siempre se corrige
   después de que el expediente ya existe. `sincronizar` estaba escrito y no lo
   llamaba nadie.

### El error de diseño: el checklist no puede vetar una subida

Subir un tipo que no estuviera en el checklist resuelto respondía `400`. Está mal,
y el reporte lo señala: la plantilla define qué es **obligatorio**, no qué se
**permite guardar**. Un documento que ninguna empresa exige sigue siendo un
documento que RH necesita en el expediente.

Ahora **se acepta cualquiera de los 12 tipos del catálogo**; si no estaba en el
checklist, entra como renglón con `requerido: false`. El tipo se sigue validando
contra el catálogo —no es texto libre—, y `syncChecklist` ya conservaba los
renglones con versiones, así que no se pierden al re-sincronizar.

El efecto secundario importante: **ninguna falla de plantillas puede volver a
bloquear la carga de documentos**. Antes, un checklist vacío dejaba el expediente
inservible; ahora, en el peor caso, todo entra como no requerido y el avance se
corrige cuando las plantillas se arreglan.

### Lo que NO se hizo: subir primero y clasificar después

Se pidió «subir cualquier documento y luego asignarle el tipo». No se implementó, y
la razón es que resuelve un problema que ya no existe: con lo de arriba, la subida
nunca falla por el tipo, y el tipo se elige en el mismo diálogo. Un buzón de
documentos sin clasificar añade un estado nuevo —archivos que no cuentan para
ningún avance, que no caducan y que nadie revisa— y hay que decidir quién los
limpia.

Si de todas formas hace falta guardar cosas fuera del catálogo (una carta, un
permiso), lo que corresponde es un tipo `otro` con nombre libre, y eso sí es un
cambio de contrato: **está pendiente de decidir**, no descartado.

### Y un script

`npm run db:expedientes` crea y re-sincroniza el expediente de **todos** los
empleados. Hace falta para las personas dadas de alta antes de que el módulo
existiera: sin `record`, el renglón de la tabla sale sin avance hasta que alguien
abre su expediente. Idempotente y no borra nada.

---

## D-43 · Un solo endpoint para validar y rechazar: `POST …/revisar`

El spec (§6.5) proponía dos rutas, `…/validar` sin cuerpo y `…/rechazar` con
`{ motivo }`. Se implementó así primero y se corrigió a una sola ruta,
`POST /expedientes/:id/documentos/:tipo/revisar`, con `{ aprobado, motivo? }`:
son la misma acción —cerrar una revisión pendiente— con dos resultados, no dos
acciones distintas, y el front tiene un solo lugar del que colgar el botón de
"Aprobar/Rechazar" en vez de pegarle a dos rutas según el caso. **Desviación
del spec, documentada aquí como pide `CLAUDE.md`.**

`REVIEW_DOCUMENTS` ya existía en la matriz (§8.2) y entonces sólo la tenía
`rh_admin` —quien sube (`rh_consulta` también puede) no es necesariamente quien
revisa—. La ruta reutiliza esa capacidad tal cual, sin negociar nada nuevo.
**Doce días después D-44 la amplió a `rh_consulta`**; la matriz vigente es la de
`modelo-datos.md` §8.2, no este renglón.

Revisa `versiones[0]` (la última subida), no un número de versión explícito: no
tiene sentido revisar una versión vieja que ya fue reemplazada, y pedir el número
sólo abriría la puerta a hacerlo por error. El candado es el estatus del
documento: sólo actúa si está `in_review`; `pending` (nada subido) o ya revisado
(`validated` o `rejected`) responden `400`.

`motivo` se exige (10+ caracteres) sólo cuando `aprobado: false`, con
`.if(body('aprobado').equals('false'))` en el validador — mismo mínimo que el
spec le pedía a `…/rechazar`. Al aprobar se limpia cualquier `motivoRechazo`
colgado de una entrega anterior; al rechazar, `motivoRechazo` es el `motivo` que
mandaron. Para levantar un rechazo, la persona sube una entrega nueva (vuelve a
`in_review`) y se revisa otra vez — no hay una acción de "deshacer rechazo".

---

## D-44 · `rh_consulta` también revisa documentos

**Corrección confirmada con Urbacames.** `REVIEW_DOCUMENTS` era exclusivo de
`rh_admin`; ahora también la tiene `rh_consulta` (la analista de RH), que ya
podía subir documentos (`UPLOAD_DOCUMENTS`) pero no revisar los suyos ni los de
nadie más. El `jefe_area` sigue sin poder: no sube ni revisa.

El "administrador general de la plataforma" que se pidió sumar **ya podía**: es
`rh_admin` con `acceso.alcanceGlobal: true` (D-21), y `alcanceGlobal` no acota
`REVIEW_DOCUMENTS` en la matriz —sólo lo hacen las capacidades marcadas
`'global'`, como `manageCompanies`—, así que cualquier `rh_admin` ya revisaba,
tenga o no alcance de plataforma. El cambio real de este ajuste es sólo la fila
de `rh_consulta`.

---

## D-45 · `GET /expedientes` paginado, y adscripciones con sus rutas

Cierran los dos últimos pendientes que quedaban dentro de "expedientes" y de
"empresas y vínculos" (backend-spec §6.3 y §6.5).

### `GET /expedientes`: `estatus` se resuelve en memoria, no en Mongo

Es el mismo candado que ya impone modelo-datos.md §9.1 para el listado de
empleados: **"el avance no se calcula en el pipeline"**. `estatus` (el semáforo:
`incomplete` / `complete` / `expiring` / `expired`) depende de `hoy` y de la
vigencia de cada documento, así que filtrar por él en una agregación de Mongo
significaría duplicar esa lógica en un pipeline —justo lo que la nota pide
evitar, y lo que ya costó un bug (D-41) cuando se intentó algo parecido con
`select: false`.

**Solución:** se resuelve el alcance y los demás filtros (`busqueda`,
`empresaId`, `area`, `tipo`) reutilizando `employeeService.list` **sin paginar
todavía** —con un tope interno alto (2 000, ver `LIMITE_PARA_FILTRAR_POR_ESTATUS`
en `recordService.js`)—, se calcula el avance de cada quien con la misma función
que usa el resto del sistema (`computeProgress`), se filtra por `estatus` si lo
pidieron, y **se pagina al final, en memoria**.

`employeeService.list` gana un parámetro interno, `limitePorPagina`, que **no es
parte del contrato HTTP**: `employeeController.list` arma `filtros` campo por
campo desde `req.query` y no lo incluye, así que nadie puede pedirlo por la ruta
pública. Existe sólo para que `recordService.list` pueda pedir "todo lo que hay
que evaluar", no una página de 100.

**Orden por defecto: el más urgente primero**, no alfabético. `RECORD_STATUS_SEVERITY`
—`expired` < `incomplete` < `expiring` < `complete`— ya estaba declarada en
`constants/statuses.js` sin que nadie la usara todavía; es justo el orden que
pide un listado de RH: lo vencido antes que lo completo. `?orden=nombre_asc` o
`nombre_desc` lo cambian a alfabético, igual que en `/empleados`.

### Adscripciones: alta, edición y baja de UNA empresa

`GET/POST /empresas/:id/adscripciones` vive bajo la empresa, y `PATCH
/adscripciones/:id` y `/estado` identifican el vínculo por sí mismo — mismo
patrón que carteras (D-37). Reactivar en vez de duplicar cuando la persona ya
tuvo adscripción a esa empresa y se dio de baja, por la misma razón que en
carteras: el índice único lo impide, y duplicar perdería el historial.

**Exclusivo de `rh_admin`** (`MANAGE_AFFILIATIONS`, ya existía en la matriz y
ya lo probaba `permissions.test.js`: "adscribir sigue siendo exclusivo de
rh_admin"). Adscribir a alguien que ya existe es distinto de darlo de alta:
mover gente entre empresas del grupo es una decisión de RH, no de quien
gestiona personal de obra.

**Crear o editar una adscripción re-sincroniza el checklist** de la persona
(`recordService.sincronizar`), porque el checklist es la unión de sus
adscripciones activas (D-41): cambiar de área o de tipo de contrato puede
cambiar qué documentos le tocan.

**Dar de baja de una empresa cierra sus asignaciones abiertas a proyectos de
ESA empresa**, con el mismo criterio que finalizar un proyecto (D-38): seguir
"en obra" de una empresa de la que ya no depende no tiene sentido y lo dejaría
ahí para siempre en los reportes. Se resuelve buscando los proyectos de esa
empresa y cerrando (`activo: false`, `fechaSalida`) las asignaciones de esa
persona en esos proyectos, en la misma transacción que la baja. **No** toca sus
asignaciones en otras empresas del grupo: sigue trabajando ahí.

**El motivo es obligatorio sólo al dar de baja**, igual que en clientes y
proyectos; reactivar no lo pide.

### Lo que no se implementó

`GET /empleados/:id/adscripciones` se deja **pendiente a propósito**: el
`RenglonEmpleado` ya trae `adscripciones[]` embebidas en `GET /empleados/:id` y
en todo lo que devuelve ese renglón, así que la ruta aparte sería exactamente la
misma información con otro nombre. Si el front necesita paginar las
adscripciones de alguien con muchas empresas, se implementa entonces.

---

## D-46 · Importación de colaboradores desde el .xlsx de nómina

**Decisión.** Dos endpoints —`POST /empleados/importar/previsualizar` y
`POST /empleados/importar`— que dan de alta personal a partir del reporte de
nómina, y que se pueden volver a correr con el mismo archivo tantas veces como se
quiera sin duplicar a nadie.

Se implementó sobre el archivo real (`docs/Colaboradores_20260824.xlsx`,
145 colaboradores de Maquinaria Cames). El plan completo, con el análisis del
archivo, está en `PLAN-IMPORTACION-XLSX.md`.

### Tres capas, y la de en medio es pura

| Archivo                              | Qué hace                                          |
| ------------------------------------ | ------------------------------------------------- |
| `utils/spreadsheet.js`               | .xlsx → filas con valores planos. Sabe de FORMATO |
| `utils/domain/employeeImport.js`     | fila → persona + adscripción. **Puro**            |
| `employees/employeeImportService.js` | compara contra la base y aplica                   |

La de en medio es pura a propósito: los 19 puestos, los 5 tipos de contrato, los
3 estatus y **las fechas** se prueban sin levantar Mongo, y son justo lo que se
equivoca al cambiar el formato del reporte.

### La trampa que este módulo podía reintroducir: D-09

`exceljs` entrega cada fecha como un `Date` a **medianoche UTC** del día civil
correcto. Extraerla con `getFullYear()/getMonth()/getDate()` —lo primero que uno
escribe— devuelve el **día anterior** en un servidor al oeste de Greenwich, y
México lo está: se comprobó contra el archivo real, y salían corridas **las 280
fechas**. Se extrae en UTC (`toISOString().slice(0, 10)`) y hay una prueba que
recorre los 366 días de un año bisiesto para que no vuelva.

### La empresa se elige, y el RFC del archivo se valida contra ella

El reporte trae la empresa y su RFC en el encabezado (`EMPRESA | MAQUINARIA
CAMES`, `RFC | MCA180611HF1`). Se compara con el RFC de la empresa destino:

- Coinciden → adelante.
- **No coinciden → `409 RFC_DISTINTO`**, con la previsualización completa en
  `data`. Para continuar hay que reenviar con `confirmarRfcDistinto`.
- La empresa no tiene RFC capturado → aviso, no bloqueo.

Es lo que evita meter a los 145 de Maquinaria Cames en la empresa equivocada, que
es un error caro de deshacer: 145 personas, 145 adscripciones y 145 expedientes.

### Contratos temporales sin fecha de término: `datosPendientes`

**El problema.** 99 de las 145 personas tienen contrato temporal y el archivo **no
trae fecha de término**. La adscripción la exige, porque de ahí sale la vigencia
del documento `contrato` (D-41). O se rechazaban 99 de 145, o entraban sin ella.

**La solución.** `affiliations.datosPendientes: [String]`. Mientras contenga
`'fechaTerminoContrato'`, el `pre('validate')` del modelo omite **esa** regla y
sólo ésa. Dos candados para que no sea una puerta trasera:

1. `datosPendientes` **no está** en la lista blanca de
   `updateAffiliationValidation`: no se puede poner desde `PATCH
/adscripciones/:id`. Sólo lo escribe el importador.
2. En cuanto la fecha se captura, el pendiente **se borra solo**. Se limpia en el
   `pre('validate')` del modelo y no en el servicio, para que valga por cualquier
   camino —el `PATCH`, otra importación o un script— y no sólo por el que se
   acordó de quitarlo.

Consecuencia que hay que asumir: mientras esté pendiente, el documento `contrato`
de esas 99 personas no deriva vigencia. La lista es lo que permite cerrarlo.

### Quién gana cuando el archivo y la base no coinciden

No es una regla, son dos, y la diferencia es deliberada:

| Qué                     | Quién manda                                   |
| ----------------------- | --------------------------------------------- |
| La **persona**          | La base. El archivo sólo **rellena** lo vacío |
| La **relación laboral** | El archivo                                    |

La persona no se pisa porque el export de nómina se queda viejo: si RH corrigió
un nombre o un teléfono en la plataforma, volver a subir el archivo del mes
pasado no debe deshacer la corrección. La adscripción sí, porque es el sistema de
nómina el que sabe con qué contrato está alguien y cuánto gana.

Dos excepciones dentro de la adscripción: `areas` sólo se rellena si está vacía
—el archivo no trae áreas, se deducen del departamento, y una curada a mano vale
más que una deducida—, y `fechaTerminoContrato` no se toca porque el archivo no
la trae.

**El puesto tampoco se cambia al re-importar.** Mover el `tipo` de una persona
arrastra la coherencia con la categoría y la regla de «un administrativo necesita
área»; un cambio de puesto en el archivo se **reporta** y se aplica a mano.

### Cómo se reconoce a alguien que ya existe

**CURP → RFC → número de empleado dentro de esa empresa.** Los 145 traen CURP y
RFC, así que el tercero es sólo una red para cuando la CURP se capturó mal (y
avisa cuando se usa). Si la CURP apunta a una persona y el RFC a otra, la fila es
un error: no se adivina.

La CURP es obligatoria en el importador aunque el modelo la permita nula (D-28).
Es la llave de la re-importación: sin ella, subir el archivo dos veces duplicaría
a las 145 personas — que es exactamente lo que este módulo tiene que evitar.

### Lo que la re-importación NUNCA toca

El acceso a la plataforma, el expediente y sus documentos, y las adscripciones a
**otras** empresas. Y **que alguien desaparezca del archivo no lo da de baja**: el
archivo no es autoridad para eso.

### La estandarización de puestos ya la resolvía el modelo

No hizo falta nada nuevo: `Category` tiene índice único sobre
`nombreNormalizado`, y `normalize()` quita acentos, mayúsculas y espacios de más.
`Peon`, `Peón`, `PEON` y `"Residente "` —con el espacio que trae el archivo—
colapsan solos a la misma categoría, y la segunda importación la reutiliza.

Si el puesto ya existe **con otro tipo**, manda el catálogo: es un dato que
alguien decidió, contra una deducción por palabras del puesto
(`PALABRAS_MANO_DE_OBRA`). El resultado de cada puesto sale en la
previsualización, para revisarlo antes de aplicar.

**Si el puesto está desactivado, la fila se rechaza.** Desactivar una categoría es
una decisión —«este puesto ya no se usa»— y `categoryService.setEstado` sólo
permite desactivar la que nadie tiene, así que no es un descuido. Asignarle 60
personas en silencio desharía esa decisión sin que nadie se enterara; reactivarla
sola, igual. Se rechazan esas filas con un mensaje que dice qué hacer, y las demás
se importan.

### `Departamento` no son todos departamentos

`Axis Zapopan`, `Axis 3`, `Plenares`, `Kulkana` y `FlexPark` son **obras** — 53 de
las 145 filas. No hay área equivalente, y mapearlas a una sería inventar el dato:
el área cae al valor por defecto del tipo (`obra` / `administracion`) y el nombre
original se conserva en `affiliations.departamento`, que es donde de verdad dice
en qué obra está la persona. Cuando existan proyectos de verdad, de ahí sale la
asignación — que es una decisión, no un efecto secundario de importar un archivo.

### La nómina se guarda y NO se expone

`affiliations.nomina` guarda los 15 campos del reporte: salario diario, las tres
partes del SBC, base de cotización, registro patronal, banco, sucursal y cuenta.
Van en la adscripción porque son de la relación con **esa** empresa.

**Ninguna respuesta de la API los devuelve.** El `toJSON` de la adscripción los
omite y el campo va con `select: false`, las dos cosas: la lección de D-27 es que
`select: false` solo no basta, porque las agregaciones lo ignoran. Hay una prueba
que verifica que el listado de adscripciones no contenga el salario ni la cuenta.

**Por qué no se exponen todavía:** salario, SBC y número de cuenta son datos
personales sensibles bajo la LFPDPPP, y hoy los vería **cualquiera que pueda ver
la adscripción**, incluido `jefe_area` en sus áreas. El sistema ya tiene el
mecanismo para acotarlo —capacidades y bitácora de accesos, como los documentos
sensibles—, pero **quién puede verlos es una decisión de negocio que no está
tomada**. Guardarlos sin exponerlos deja el dato capturado y la decisión abierta;
es la única de las dos cosas que se puede hacer sin adivinar. Queda como decisión
abierta en `ESTADO.md`.

### El archivo no se guarda

Se procesa en memoria y no va a R2 ni a disco. Trae CURP, NSS, salarios y cuentas
bancarias de 145 personas: conservarlo sería un segundo lugar del que se pueden
filtrar, y para eso ya está la base. Por lo mismo **el archivo real no es un
fixture del repo**: las pruebas generan archivos con la misma estructura y los
mismos casos borde (`tests/helpers/nominaWorkbook.js`), y hay una prueba extra que
usa el real **si está presente** y se salta si no.

Se valida por _magic bytes_ (`PK\x03\x04`), no por extensión, igual que los
documentos del expediente. `esLibroExcel` vive en `spreadsheet.js` y **no** se
agregó a `utils/fileTypes.js` a propósito: ahí están los tipos que se aceptan como
documento del expediente, y un .xlsx no debe volverse subible como documento por
un efecto colateral de esta función.

### Sin estado intermedio entre previsualizar y aplicar

El archivo se manda las dos veces, y las dos pasan por el mismo `#analizar`: es lo
que garantiza que lo que se ve antes de aplicar sea lo que va a pasar. Con 34 KB
no vale la pena una colección de importaciones pendientes que además habría que
limpiar — y que sería otra copia de los datos sensibles.

### Una transacción por persona, no una para las 145

Persona + adscripción + expediente, igual que `POST /empleados` y por la misma
razón (D-33): sin la adscripción nadie la ve. Pero **una transacción por fila**,
no una sola para todo el archivo: así una fila que reviente no tumba las otras
144, y el resumen puede decir con precisión qué pasó con cada una. Una fila que
falla al aplicar sale en `conError` con su motivo, no se reporta como importada.

### El permiso, y la desviación que trae

Se exigen **dos capacidades, las dos exclusivas de `rh_admin`**:
`MANAGE_AFFILIATIONS` (importar mueve gente entre empresas) y
`MANAGE_ADMIN_EMPLOYEES` (buena parte de los 145 es personal administrativo). Ni
`rh_consulta` ni `jefe_area`: un alta masiva sobre el catálogo compartido no es
trabajo suyo.

**Desviación anotada:** la importación crea las categorías que falten, y crear una
categoría a mano exige `alcanceGlobal` (`MANAGE_CATEGORIES`, D-32). Aquí no se
exige. El puesto llega en una columna del archivo, no es una decisión de catálogo,
y pedir al administrador de plataforma para importar la nómina de una empresa
dejaría la función inservible.

### Antes de importar en un entorno que ya existe

`affiliations` gana un índice **único parcial** sobre `(empresaId,
numeroEmpleado)`: es lo que hace fiable la tercera llave de reconocimiento. En
producción `autoIndex` está apagado, así que hay que correr **`npm run
db:indices`** antes de la primera importación. Sin él la importación funciona,
pero nada impediría dos adscripciones con el mismo número de empleado en la misma
empresa.

### Lo que este módulo deja fuera a propósito

- **No crea empresas.** La empresa destino se elige.
- **No crea accesos a la plataforma.** Los 145 entran como personas sin login;
  dar acceso sigue siendo `POST /empleados/:id/acceso`, uno por uno.
- **No asigna a proyectos**, aunque el departamento diga `Axis Zapopan`.
- **No borra a nadie.**

---

## D-47 · Alertas: cumpleaños y documentación, derivadas y sin estado

**Decisión.** `GET /alertas` con dos familias —documentos del expediente y
cumpleaños—, **derivadas en cada consulta**. No hay colección de alertas, no hay
endpoint para marcarlas y no hay job que las limpie.

### Lo que se pidió, y por qué la arquitectura ya lo resolvía

Se pidió que las alertas «se remuevan o se desactiven cuando se resuelven». Con
alertas almacenadas eso sería un campo `resuelta`, alguien que se acuerde de
escribirlo en los seis lugares que cambian un documento, y una bandeja que miente
el día que alguien se olvide. Derivándolas **no hay nada que remover**: sube el
documento que faltaba y la alerta ya no existe en la lectura siguiente; pasa el
cumpleaños y sale sola de la ventana.

Es la regla #6 del contrato y D-04, que ya valían para `expiring`, `expired` y
`avance`. Este módulo no las estrena, las aprovecha. Hay una prueba por familia
que recorre el cambio de estado de punta a punta —subir, validar, volver a pedir
la bandeja— justo para dejar constancia de que no quedó nada encendido.

### Las dos familias

| `origen`     | Sale de                               | Se resuelve                        |
| ------------ | ------------------------------------- | ---------------------------------- |
| `documento`  | El estatus efectivo de cada documento | Subiendo, validando o renovando    |
| `cumpleanos` | `empleados.fechaNacimiento`           | Con el calendario: nadie la cierra |

`documento` cubre los cuatro tipos que ya tenía el dominio: `vencido`,
`documento_rechazado`, `por_vencer` y `documento_faltante`. Se implementaron los
cuatro y no sólo el faltante: son **un solo camino de código**, ya estaban
probados, y un documento vencido es tan «documentación que hace falta» como uno
que nunca se subió. El front elige con `?tipo=`.

### El cumpleaños, que no es un problema que resolver

`cumpleanos` es lo único de la bandeja que nadie tiene que arreglar, así que va
con la **severidad más baja**: nunca debe empujar hacia abajo un documento
vencido. Hay una prueba de eso.

**Ventana configurable, 7 días por defecto** (`DIAS_ALERTA_CUMPLEANOS`, tope 60).
Siete alcanza para organizar algo y no tanto como para que el aviso se vuelva
ruido; con una ventana muy ancha, media plantilla estaría siempre en la bandeja.
La interfaz puede ensancharla por consulta con `?diasCumpleanos=`, sin tocar la
configuración del servidor.

**El 29 de febrero se celebra el 28 en los años no bisiestos.** `nextAnniversary`
usa el mismo criterio de fin de mes que `addMonths` en vez de saltar al 1 de
marzo. Sin eso, quien nació un 29 de febrero no aparecería nunca en tres de cada
cuatro años. Va con prueba, igual que el cruce de fin de año.

**Sin fecha de nacimiento no hay alerta.** 10 de las 145 personas del archivo de
nómina no la traen (D-46) y adivinarla no es una opción.

### `empresas[]` en plural, no `empresaId`

El spec §6.6 pedía un `empresaId` en el sobre de la alerta. **No se puso.** El
expediente es de la PERSONA y se comparte entre las empresas del grupo (D-41), así
que quien está adscrito a dos no tiene un `empresaId` — elegir uno de los dos sería
inventar de cuál es la alerta. El sobre lleva `empresas[]` con las adscripciones
activas visibles y `areas[]` con la unión de sus áreas. Para acotar por empresa
está `?empresaId=`, que filtra a la gente **antes** de derivar.

### El alcance no se reimplementa

`alertService` no consulta `records` por su cuenta: parte de
`employeeService.list`, que ya resuelve el alcance por empresa y por área con su
agregación (D-45). Así es imposible que una alerta hable de alguien que quien
pregunta no puede ver, y no hay una segunda copia de esa lógica que se pueda
desincronizar. `jefe_area` recibe sólo alertas de su gente, y lo garantiza esa
agregación, no el módulo de alertas.

**El permiso es `VIEW_EMPLOYEES`, los tres niveles**: una alerta no dice nada que
su dueño no pueda ver ya en el expediente. No expone archivos ni URLs firmadas, así
que no toca la restricción de documentos sensibles de `jefe_area`.

### El resumen se calcula antes de filtrar

`resumen` es el contador de la campanita y cuenta **todas** las alertas visibles,
no las que quedaron después del filtro que la pantalla trae puesto. Si se
calculara sobre lo filtrado, el número del badge cambiaría al cambiar de pestaña.
Hay una prueba de eso.

### El bug que esto costó: no se puede esparcir un subdocumento de Mongoose

`resolveDocument` hace `{ ...documento, estatus: ... }`. Con un **subdocumento de
Mongoose** eso copia sus internos (`$__`, `_doc`) y **no los campos del esquema**:
el documento llega sin `tipo`, sin `requerido` y sin `estatus`, `effectiveStatus`
no encuentra nada que resolver y la bandeja sale **siempre en cero, sin ningún
error**. Los servicios que ya existían no lo notaron porque `recordService` pasa
`.toObject()`.

Se arregló en los dos lados a propósito: `alertService` pide `.lean()` —lo correcto
y además más rápido— y `resolveDocument` ahora normaliza antes de esparcir, para
que el próximo que llame a la función no se queme en silencio.

### Lo que este módulo deja fuera

- **Alertas de proyecto** (`proyecto_por_finalizar`, `proyecto_vencido`, spec §6.6).
  Son otra familia y no se pidieron; el sobre ya está preparado para sumarlas con
  su `origen`.
- **El correo diario.** `GET /alertas` es la bandeja de la interfaz; el job que
  manda un resumen por persona sigue pendiente (§8 del spec) y puede reusar
  `deriveAlerts` tal cual.
- **Marcar, posponer o descartar una alerta.** Requeriría el estado que esta
  decisión evita a propósito. Si hace falta «no me lo recuerdes hasta el lunes»,
  se implementa como un aplazamiento por usuario y documento —no como un
  `resuelta`—, para que la alerta siga siendo derivada.

---

## D-48 · La bandeja de alertas se agrupa por empleado y se pagina

**Decisión.** `GET /alertas` devuelve **un renglón por persona** y **25 por
página** por defecto. `?agrupar=ninguno` da la lista plana, también paginada.

### El problema, con números reales

Con los 145 colaboradores importados (D-46) y una docena de documentos requeridos
cada uno, la bandeja plana daba **731 alertas** —729 de ellas
`documento_faltante`— y los cinco primeros renglones eran de la misma persona,
uno por documento. Una lista así no se puede usar: no cabe en pantalla, no se
puede recorrer, y esconde el dato que de verdad importa —**a cuánta gente le falta
algo**— detrás de un número inflado por la multiplicación.

El tope de 1000 con `truncado` que traía D-47 no resolvía nada: recortaba sin
ordenar la conversación. Se quitó; **la paginación lo sustituye**.

### Se pagina en memoria, igual que los expedientes

Las alertas son derivadas: no existen como documentos, así que no hay nada que
paginar en la base. Se derivan todas las de la gente visible, se filtran, se
agrupan y **se corta la página al final** — el mismo patrón que `recordService.list`
con `estatus` (D-45), y por la misma razón: replicar la derivación en un pipeline
de Mongo duplicaría la lógica de vigencias, que es justo lo que modelo-datos §9.1
pide evitar.

### Qué lleva el grupo, y por qué eso y no menos

El renglón tiene que pintarse y ordenarse **sin abrirse**, así que el grupo lleva:

| Campo           | Para qué                                                |
| --------------- | ------------------------------------------------------- |
| `tipo`          | El **más grave** del grupo: define el color del renglón |
| `diasRestantes` | Los del más urgente: ordena y se muestra                |
| `total`         | El contador de la fila                                  |
| `resumen`       | Conteo por tipo, para chips dentro de la fila           |
| `mensaje`       | Frase lista para pintar                                 |
| `alertas[]`     | El detalle, para desplegar **sin otra petición**        |

`tipo` y `diasRestantes` se toman de la **primera** alerta del grupo, sin volver a
recorrer nada: la lista llega ya ordenada por `ordenarAlertas`, así que la primera
de cada grupo es por construcción la más grave y la más urgente.

`alertas[]` va incluido a propósito. Una persona tiene una docena de alertas como
máximo, así que una página de 25 grupos son ~300 alertas: cabe de sobra, y evita
una petición por cada fila que el usuario despliega.

### El mensaje del grupo

Con **una sola** alerta se reusa su propio mensaje, que ya es específico («Falta
subir CURP.»). Con varias se cuenta por tipo («1 documento vencido, 1 rechazado y
2 por subir.»), porque repetir «Falta subir X» doce veces es exactamente el
problema que la agrupación resuelve. El cumpleaños se añade al final como frase
aparte: no es un documento y no debe contarse con ellos.

### Tres magnitudes, no una

- `total` — lo que se pagina: **personas** agrupado, **alertas** en plano.
- `totalAlertas` — siempre las alertas que cumplen el filtro.
- `totalEmpleados` — siempre las personas con al menos una.

Las tres van siempre, porque el encabezado necesita decir «731 pendientes en 147
personas» y con una sola no se puede. Y `total` cambia de significado según el
modo justo para que el cálculo de páginas del front sea siempre `total /
porPagina`, sin condicionales.

### `resumen` sigue calculándose antes de filtrar por tipo

Es el contador de las pestañas: **no cambia al paginar** ni al elegir una pestaña.
`empresaId`, `area` y `empleadoId` sí lo afectan, porque acotan a la gente antes
de derivar y eso es lo que se espera del selector de área. Hay pruebas de las dos
cosas.

### Es un cambio incompatible, y está asumido

La llave de la respuesta pasó de `data.alertas` a `data.grupos` en el modo por
defecto. El front tenía la pantalla construida contra la forma plana, así que hay
que ajustarla — está anotado arriba en `ENDPOINTS-ALERTAS.md`. Se prefirió eso a
añadir un `?agrupar=empleado` opcional que dejara el defecto roto: la lista plana
de 731 renglones no es una opción razonable para nadie, y un defecto que nadie
debería usar no debería ser el defecto.

---

## D-49 · Contraseña temporal: la que puso otro no sirve para trabajar

**Decisión.** Cuando un administrador da acceso o repone una contraseña, y en el
administrador inicial del bootstrap, la contraseña queda marcada como
**temporal**: la sesión existe, pero **la plataforma responde `403` a todo** hasta
que la persona ponga una contraseña que sólo ella conoce.

### El agujero que cierra

Tres situaciones dejaban una credencial conocida por alguien que no es su dueño:

1. `POST /empleados/:id/acceso` — el administrador escribe la contraseña inicial.
2. `POST /empleados/:id/acceso/restablecer-password` — la repone.
3. El **administrador inicial** (D-21), que nace con `BOOTSTRAP_ADMIN_PASSWORD`
   (`1234` por defecto) escrita en el `.env`.

El tercero era el peor: el único aviso era una línea de `logger.warn` y una nota
en `CLAUDE.md`. Una instalación podía quedarse **para siempre** con `1234` y nadie
se enteraba. Ahora no se puede usar el sistema sin cambiarla.

### Dónde vive la marca, y por qué no en `credentials`

`empleados.acceso.passwordTemporal`, no `credentials`. **No es material secreto**
—decir «tienes que cambiar tu contraseña» no revela nada— y se consulta en **cada
petición autenticada** para bloquear el paso.

Es exactamente el argumento que ya documenta `credentialModel` para
`passwordActualizadaEn`: el secreto está aislado en `credentials` (D-27), pero lo
que `protect` necesita en el camino caliente vive en el empleado para que la
autenticación siga siendo **una sola consulta**. Meterla en `credentials` habría
duplicado la consulta de cada petición del sistema para ahorrar un booleano.

### `403`, no `401`

La sesión **es válida** y el token sirve: lo que falta es un requisito, no la
identidad. Un `401` haría que el front cerrara la sesión y volviera al login,
donde la persona entraría otra vez con la contraseña temporal — un bucle. El
`403` lleva `code: 'PASSWORD_TEMPORAL'` para que el front pueda redirigir sin
adivinar por el texto.

Y `AuthUser` trae `passwordTemporal`, así que el front puede mandar a la pantalla
de cambio **al iniciar sesión**, sin esperar el rebote de la primera pantalla.

### Las tres cosas que sí funcionan

`POST /auth/cambiar-password` (la salida), `GET /auth/me` (para saber quién es y
ver el estado) y `POST /auth/logout` (nadie debe quedar atrapado). Son
exactamente las rutas protegidas de `authRoutes`, así que ese router **no lleva el
middleware** y no hace falta una lista de excepciones.

`cambiar-password` **sigue exigiendo `passwordActual`** y las reglas de
complejidad. Una contraseña temporal no es una puerta abierta: es una credencial
de un solo uso que sólo sirve para reemplazarse.

### Se aplica router por router, y el candado es una prueba

`requirePasswordDefinitiva` va en el `router.use(protect, …)` de cada recurso —diez
routers— y no dentro de `protect`, para que `protect` no tenga que conocer rutas
exentas.

Eso se puede olvidar en un recurso nuevo, así que el candado no es la disciplina:
`passwords.test.js` recorre el **inventario de rutas derivado del router**
(`GET /api/v1`) y exige `403 PASSWORD_TEMPORAL` en todas, salvo las tres de la
salida. Un recurso nuevo sin el middleware hace fallar esa prueba sin que nadie
tenga que acordarse — mismo patrón que `inventario.test.js`.

### Qué NO cambia

- **Editar el acceso** (nivel, alcance, correo) no vuelve temporal la contraseña:
  no la toca.
- Las sesiones abiertas se siguen invalidando al reponer la contraseña, como antes.
- Las pruebas que crean sesiones con la fábrica no se ven afectadas: el valor por
  defecto es `false`, porque ahí la contraseña la «pone» la propia persona.

### Lo que esto deja fuera

- **Recuperación por correo** (`/auth/recuperar`, `/auth/restablecer`). Sigue
  reservada en `RUTAS_PENDIENTES` y en `credentials` (`resetToken`,
  `resetExpiraEn`). Exige un servicio de correo, que el repo todavía no tiene.
  Con esto, el camino de «olvidé mi contraseña» es: se le pide a un `rh_admin`,
  que la repone, y la persona la cambia en su primer acceso — que ya es seguro.
- **Caducidad de la contraseña temporal.** Hoy no expira: si nadie la cambia, la
  cuenta se queda bloqueada para todo lo demás, que es el lado seguro del fallo.
  Si se quisiera, sería un `resetExpiraEn` sobre la credencial.
- **Caducidad periódica de contraseñas.** No se implementó y no la recomiendo:
  obliga a la gente a rotar entre variantes previsibles.

## D-50 · `numeroEmpleado` también se pide al dar de alta a mano

**Decisión.** `adscripcion.numeroEmpleado` — el campo que D-46 agregó para la
columna `ID` del archivo de nómina — es **obligatorio** en `POST /empleados`
cuando se manda `adscripcion`. Único **dentro de la empresa** (mismo índice que
usa la importación); si ya está en uso, `409 NUMERO_EMPLEADO_DUPLICADO` con el
número en el mensaje.

### Por qué

D-46 sólo lo llenaba el importador; a mano quedaba en `null` para siempre, y
Urbacames lo usa como el identificador operativo de la persona en esa empresa —
lo necesitan también para quien se da de alta fuera del archivo de nómina.

### Dónde sí y dónde no

- **`POST /empleados`** (el alta y su primera adscripción, D-33): obligatorio.
- **`POST /empresas/:id/adscripciones`** (sumarle a alguien que ya existe una
  segunda empresa, D-45): **sigue sin pedirse**, a propósito — no hay evidencia de
  que haga falta ahí y se prefirió no ampliar el contrato sin necesidad concreta.
  Si se necesita, es una decisión aparte.
- **No es editable.** Ni `PATCH /adscripciones/:id` ni ningún otro camino lo
  tocan después de creado — mismo candado que ya tenía por D-46. Una corrección
  hoy exige re-importar esa fila.

### La validación de duplicado va ANTES de la transacción

Igual que la CURP: se busca primero con `Affiliation.findOne({ empresaId,
numeroEmpleado })` y se responde `409` con un mensaje legible, en vez de dejar que
la transacción reviente con el índice único y que el manejador genérico de
`E11000` intente adivinar el campo — con un índice compuesto (`empresaId +
numeroEmpleado`) habría señalado `empresaId`, que no es el problema.

## D-51 · Las tablas de empleados ordenan y filtran por número, categoría y tipo

**Decisión.** `GET /empleados` y `GET /empresas/:id/adscripciones` —las dos
tablas de empleados que usa el front, una general y otra por empresa— ganan:

- `orden=numero_asc` / `numero_desc`, sobre `numeroEmpleado` (D-46, D-50).
- `categoriaId` como filtro, en los dos.
- `tipo` como filtro en `GET /empresas/:id/adscripciones` (ya existía en `GET
/empleados`).

### Por qué `numero_asc` es el default en un endpoint y no en el otro

`GET /empresas/:id/adscripciones`: cada renglón **es** una adscripción, con un
único `numeroEmpleado`. Ahí `numero_asc` pasa a ser el default (antes ordenaba
por `createdAt` descendente sin que ningún doc lo prometiera como contrato) —
es lo que pidió Urbacames: la tabla llega ordenada por número.

`GET /empleados`: cada renglón es una **persona**, que puede tener una
adscripción por empresa y por lo tanto un `numeroEmpleado` distinto en cada una.
Cambiar el default ahí habría sido ambiguo — ¿el número en cuál empresa? Se deja
`nombre_asc` como estaba, y `numero_asc`/`numero_desc` como opción **que exige
`empresaId`**: sin acotar a una empresa, no hay un único valor por el que
ordenar. Pedirlo sin `empresaId` responde `400` con `errors[0].path:
"empresaId"`, no un orden inventado.

### `numeroEmpleado` ahora se proyecta en `GET /empleados`

El `$project` dentro del `$lookup` a `affiliations` no lo incluía —nadie lo
había necesitado ahí— y sin proyectarlo tampoco se podía ordenar por él. Es
aditivo: no cambia nada de lo que ya devolvía.

### `categoriaId` y `tipo` son de la persona, no de la adscripción

En `GET /empresas/:id/adscripciones` no hay un `categoriaId` ni un `tipo` en el
propio documento de `Affiliation` — se resuelven primero contra `employees`
(`Employee.find({ tipo, categoriaId }).select('_id')`) y el resultado acota
`empleadoId`. Es la misma idea que ya usaba `#areasDelJefe` para acotar por
área, aplicada a estos dos filtros nuevos.

### El orden compara texto, no número

`numeroEmpleado` es un `String` libre (D-46), no queda garantizado que sea
numérico. Se ordena como texto: con el archivo de nómina, que rellena con ceros
a la izquierda (`'0001'`, `'0002'`…), coincide con el orden numérico. Traducirlo
a número habría sido inventar una garantía que el campo no tiene.

## D-52 · `activo` reemplaza a `incluirInactivos`: tres estados, nunca mezclados

**Decisión.** `GET /empleados`, `GET /expedientes` (que reutiliza los filtros
de `/empleados`, D-45) y `GET /empresas/:id/adscripciones` cambian su filtro de
alta/baja de un booleano "incluye también" a un parámetro `activo` de tres
valores excluyentes: `'true'` (default) sólo activos, `'false'` **sólo** los
dados de baja, `'todos'` los dos juntos.

### El problema que resolvió

`incluirInactivos=false` (default) ya filtraba bien: sólo activos. Pero
`incluirInactivos=true` no significaba "dame los de baja", significaba "no
filtres nada" — devolvía activos e inactivos **mezclados**. No había forma de
pedir exclusivamente a los que ya se fueron; había que traer todo y filtrar en
el front. Urbacames lo pidió explícito: por defecto sólo activos, y si se pide
la baja, sólo la baja.

### Por qué no se llama `estatus`

`GET /expedientes` ya usa `estatus` para el semáforo del documento
(`incomplete`/`complete`/`expiring`/`expired`), y el archivo de nómina también
usa esa palabra para `'Alta'|'Baja'|'Reingreso'` (D-46). Reutilizarla para
"activo o de baja" habría sido una tercera acepción de la misma palabra en el
mismo sistema. `activo` no colisiona con nada y ya era el nombre exacto del
campo en los dos modelos (`Employee.activo`, `Affiliation.activo`).

### `GET /empleados`: `activo` es de la PERSONA, no de la adscripción

`match.activo` (la persona, baja del sistema) es el único que cambia con el
parámetro. El filtro sobre las adscripciones del `$lookup` (`filtroEmpresas`)
sigue exigiendo `activo: true` **sólo cuando `activo === 'true'`** — para
`'false'` y `'todos'` NO se restringe, a propósito: dar de baja del sistema
(`PATCH /empleados/:id/estado`) no cierra las adscripciones (son cosas
distintas, ver el comentario de `Affiliation.activo`), así que alguien
system-baja casi siempre conserva una adscripción que nunca se cerró. Exigirla
activa también en modo `'false'` habría escondido justo a quien ese filtro
busca encontrar, o peor: para un `rh_admin` con alcance acotado (donde el
`$match` de "al menos una adscripción visible" es obligatorio, no condicional),
lo habría sacado del listado por completo.

### `GET /empresas/:id/adscripciones`: mismo nombre, otro campo

Aquí `activo` filtra `Affiliation.activo` (la adscripción a **esa** empresa),
no la persona — es lo que ya hacía antes de esta decisión, sólo le faltaba el
default excluyente. Mismo nombre de parámetro en los dos endpoints, cada uno
sobre el campo que le corresponde a su documento.

### `busqueda` ahora también encuentra por número de empleado

`GET /empleados?busqueda=` sólo comparaba `nombreNormalizado`. Urbacames pidió
que también funcione con el número de la nómina. Como `numeroEmpleado` vive en
la adscripción y no en la persona, el `$match` por texto no se puede resolver
en la primera etapa del pipeline (antes del `$lookup`, donde vivía la búsqueda
por nombre): se mueve a un `$match` con `$or` **después** de cruzar las
adscripciones, comparando `nombreNormalizado` o `adscripciones.numeroEmpleado`.
Con la notación de punto, Mongo compara contra cualquier elemento del arreglo:
basta que UNA adscripción visible tenga ese número.

### Efecto en otros llamadores internos

`recordService.list` (`GET /expedientes`) y `alertService.#entradas` reutilizan
`employeeService.list` — los dos se actualizaron para mandar `activo` en vez de
`incluirInactivos`. `alertService` manda `activo: 'true'` fijo: un dado de baja
no genera alertas de documentación ni de cumpleaños.

## D-53 · Ordenar por número de empleado ya NO exige `empresaId`

> **Actualizado por D-54.** La regla del mínimo y el máximo que se describe abajo
> dejó de hacer falta cuando el número pasó a ser de la persona: hay un solo valor
> por renglón y el orden es un `$sort` directo. Lo que sigue vigente es que
> `numero_asc`/`numero_desc` no piden `empresaId` y que los que no tienen número
> van al final.

**Decisión.** `GET /empleados?orden=numero_asc|numero_desc` funciona **con o sin**
`empresaId`. Revierte la mitad de D-51 que respondía `400` pidiendo una empresa.

### Por qué se revierte

D-51 razonó que sin `empresaId` no había "un único valor por el que ordenar" —
cierto— y de ahí concluyó que había que rechazar la petición. El front pidió lo
contrario: la tabla **general** es la que más se ordena por número, y ahí no hay
empresa seleccionada. Un `400` en la columna que la gente va a picar primero no
es una salvaguarda, es un endpoint que no sirve para su caso principal.

### La regla que colapsa el arreglo a un valor

Ordenar un arreglo no es ambiguo si se dice cuál elemento manda:

- `numero_asc` → el **menor** número de la persona.
- `numero_desc` → el **mayor**.

Es exactamente lo que hace MongoDB al ordenar por un campo de arreglo, sólo que
escrito a mano (`$addFields` con `$min`/`$max` sobre `adscripciones.numeroEmpleado`)
para poder mandar los nulos al final. Siempre sobre las adscripciones **ya
recortadas al alcance**: el orden no puede depender de un número de una empresa
que el usuario no ve.

Con `empresaId` el arreglo trae un solo elemento, el mínimo y el máximo son ese
número, y el orden es idéntico al de D-51. Nadie que ya usara el parámetro nota
el cambio.

### Los que no tienen número van al final, en los dos sentidos

`numeroEmpleado` es opcional (`default: null`) y quien no tiene ninguna
adscripción visible tampoco tiene número. Sin cuidarlo, `numero_asc` los pondría
arriba —los nulos son lo más chico en Mongo— y la tabla abriría con puros
renglones vacíos. Un campo auxiliar (`sinNumero: 0|1`) los empuja al final tanto
en ascendente como en descendente: en una tabla ordenada por número, el que no
tiene número es siempre lo último que interesa.

### Sigue comparando texto

No cambia lo de D-51: `numeroEmpleado` es un `String` libre y se ordena como
texto. Con los ceros a la izquierda del archivo de nómina coincide con el orden
numérico.

## D-54 · `numeroEmpleado` es de la PERSONA, único en todo el grupo

**Decisión.** El número de trabajador se mueve de `affiliations` a `employees`.
Deja de ser único por empresa y pasa a serlo en todo el grupo. Se captura en
`POST /empleados` —**obligatorio, con o sin adscripción**— y se corrige en
`PATCH /empleados/:id`, que antes no lo aceptaba por ningún camino.

### El problema

D-46 lo puso en la adscripción porque el archivo de nómina se importa **empresa
por empresa** y ahí el número es único dentro de esa empresa. De ahí salieron dos
consecuencias que el front reportó como defectos, y lo eran:

1. **El alta exigía elegir empresa para poder capturar el número.** Sin empresa
   —el alta del administrador de plataforma, que llena el catálogo— el campo no
   existía: un número único "por empresa" no tiene dónde vivir si no hay empresa.
2. **El número no se podía corregir.** Ni en `PATCH /empleados/:id` (no era campo
   de la persona) ni en `PATCH /adscripciones/:id` (bloqueado a propósito por
   D-46 y D-50). Un error de captura obligaba a re-importar la fila.

### Por qué del grupo y no por empresa

Se preguntó explícitamente antes de mover nada, porque las dos lecturas eran
defendibles y llevaban a implementaciones distintas. Urbacames confirmó que la
numeración de nómina es **una sola para el grupo**: dos personas no comparten
número aunque estén en empresas distintas.

Eso es lo que hace correcto el índice único global (parcial, sobre
`{ numeroEmpleado: { $type: 'string' } }`, igual que la CURP y por lo mismo: con
`default: null` el campo existe y un índice disperso no lo omitiría). Si algún día
dos empresas del grupo repitieran numeración, esta decisión es la que hay que
revisar — no el índice.

### Lo que gana el importador, y lo que cambia

La tercera llave de reconocimiento (CURP → RFC → número) deja de buscarse "dentro
de esta empresa" y se busca en el catálogo completo: ahora **reconoce a quien se
importó primero en otra empresa del grupo**, que antes se duplicaba.

Dos cambios que van con eso:

- **El número pasa de autoritativo a rellenable.** El archivo lo escribe si la
  persona no tiene, pero **no lo pisa**. Desde que se puede corregir a mano,
  pisarlo en cada re-importación desharía la corrección y cambiaría la identidad
  con la que el importador reconoce a la persona.
- **Choque de número = error de fila, no `E11000` a medio camino.** Si la CURP
  identifica a alguien y el número de esa fila lo tiene un tercero, la fila se
  rechaza con un mensaje que nombra al tercero, y las demás siguen.

### Dónde viaja ahora en las respuestas

En `empleado`, porque es de la persona:

- `GET /empleados` → `empleados[].empleado.numeroEmpleado`. **Ya no está** en
  `adscripciones[].numeroEmpleado`.
- `GET /empresas/:id/adscripciones` → `adscripciones[].empleado.numeroEmpleado`.
  **Ya no está** en la raíz del renglón.

Se consideró dejarlo también en la raíz de la adscripción para no tocar al front,
y se descartó: el documento ya no tiene ese campo, y un espejo invitaría a
mandarlo en `PATCH /adscripciones/:id`, que responde `400`. Es una corrección
mecánica en dos lecturas y evita una confusión permanente.

### El 409 no nombra a quien no puedes ver

El número es único en el grupo, así que el choque puede venir de una empresa que
quien pregunta no ve. Si esa persona está en su alcance, el mensaje la nombra
(«ya lo tiene Roberto Aguilar»); si no, dice que está en uso en el grupo y nada
más. Decir el nombre sería filtrar la nómina de otra empresa, y el alcance se
respeta también en los mensajes de error.

### El orden por número se simplificó

D-53 tenía que colapsar el arreglo de adscripciones a un valor (mínimo en
ascendente, máximo en descendente) porque una persona traía varios números. Con
uno solo por persona es un `$sort` directo. Lo único que sobrevive es el campo
auxiliar `sinNumero`, que manda al final a quien no tiene — los nulos son lo más
chico en Mongo y si no la tabla abriría con renglones vacíos.

`GET /empresas/:id/adscripciones` ordena **en memoria**: el campo es de un
documento poblado y Mongo no ordena por eso. No pesa — ese listado no está
paginado y ya traía todas las filas para formatearlas.

### Migrar lo que ya está capturado

`npm run migrate:numeros` (`scripts/migrateEmployeeNumbers.js`) copia
`affiliations.numeroEmpleado` → `employees.numeroEmpleado`. Lee el campo con el
driver crudo, porque ya no está en el esquema y Mongoose lo ignoraría. Es
idempotente, acepta `--dry-run`, y **no escribe los dos conflictos que el modelo
nuevo no admite**: una persona con números distintos en dos empresas (gana el de
la adscripción activa más antigua) y dos personas con el mismo número (gana la
primera). Los reporta para resolverlos a mano.

No borra nada: el campo viejo se conserva como respaldo hasta que se corra con
`--limpiar`, que es lo único destructivo y va aparte a propósito. Después,
`npm run db:indices` crea el índice nuevo y borra el de `affiliations`.

## D-55 · La `Baja` del archivo alcanza también a la persona, no sólo a la empresa

**Decisión.** Cuando el `Estatus` de la nómina dice `Baja` y a esa persona **no le
queda ninguna adscripción activa**, la importación le da de baja también **del
sistema** (`employees.activo = false`). `Alta` y `Reingreso` siguen siendo
activos, y un `Reingreso` reactiva a la persona **si su baja la había puesto una
importación**.

### El defecto

El `Estatus` siempre se leyó bien —`alta`/`reingreso` → activo, `baja` →
inactivo— y la adscripción quedaba cerrada, con motivo y fecha. Lo que no se
tocaba era la persona, y ahí la baja se perdía: quedaba en **tierra de nadie**.

| `GET /empleados`            | Alguien importado en `Baja` |
| --------------------------- | --------------------------- |
| `activo=true` (por defecto) | no sale — correcto          |
| `activo=false` (las bajas)  | **no salía** ← el defecto   |
| `activo=todos`              | salía, con `activo: true`   |

El filtro pensado para "los que ya se fueron" los excluía —la persona figuraba
activa— y el de activos también —no tiene adscripción vigente—. La pantalla de
bajas salía vacía después de importar una nómina con bajas, que es justo lo que
reportó el front.

### Por qué "sin ninguna adscripción activa" y no "dice Baja"

`modelo-datos.md` §5b.1 dice que dar de baja una adscripción **no** da de baja al
empleado, y que si era la única "es razonable proponer también la baja global,
pero es una decisión de quien la ejecuta, no automática". Eso sigue siendo cierto
para `PATCH /adscripciones/:id/estado`, que se hace persona por persona.

Aquí quien ejecuta **es el archivo de nómina**, que ya es la autoridad sobre la
relación laboral (D-46). La condición no es "la fila dice Baja" sino "con ésta no
le queda ninguna empresa": alguien de baja en Edificación que sigue en
Infraestructura **no** se da de baja del sistema, y la fila lo dice en un aviso.
Es una desviación anotada de §5b.1, acotada al importador.

### La vuelta es más estrecha que la ida

Un `Reingreso` reactiva a la persona **sólo si `motivoBaja` es el del importador**.
Una baja capturada a mano —un despido— no la deshace un archivo de nómina: para
esa se conserva el aviso de siempre, ahora diciendo que la baja fue manual. Sin
esa asimetría, volver a subir el export mensual resucitaría a quien RH dio de
baja por causa.

### Se delega en `employeeService.setEstado`

No se escribe el documento a mano: esa ruta ya desactiva el acceso a la
plataforma en la misma transacción y **se niega a dejar al sistema sin
administrador global**. Si una fila intentara dar de baja al último admin, cae en
error con su motivo y las demás siguen — que es lo correcto.

### Se ve antes de aplicar

`#marcarEstadoDeLaPersona` corre en el análisis, que comparten la previsualización
y la importación (D-46), así que el cambio de estado aparece en `avisos` y en
`cambios: ['activo']` **antes** de escribir nada. Una fila que sólo cambia el
estado de la persona deja de contar como `sin_cambios` y pasa a `actualizar`: si
no, el resumen diría que no pasa nada mientras la persona se da de baja.

## D-56 · El cambio de `Estatus` se ve en el renglón, no sólo en el resumen

**Decisión.** `cambios` de un renglón de `yaExisten` incluye **`'estatus'`** cuando
el alta/baja del archivo no coincide con la que está registrada en esa empresa, y
el renglón trae un aviso con el antes y el después.

### El defecto

D-55 hizo que la baja se aplicara bien, y el resumen la contaba
(`seDanDeBaja`, `seReactivan`). Pero la lista `cambios` —lo que el front pinta
como «qué cambió en esta persona»— no la incluía: `#cambiosDeAdscripcion` sólo
recorría `CAMPOS_ADSCRIPCION_AUTORITATIVOS`, y `activo` no está ahí porque el alta
y la baja no se escriben con una asignación, pasan por
`affiliationService.setEstado` (que además cierra las asignaciones abiertas, D-38).

El resultado se veía al re-subir el archivo:

| Caso                                   | `accion`      | `cambios` antes |
| -------------------------------------- | ------------- | --------------- |
| Alta → Baja, era su única empresa      | `dar_de_baja` | `['activo']` ¹  |
| **Alta → Baja, sigue en otra empresa** | `dar_de_baja` | **`[]`**        |
| Baja → Reingreso                       | `reactivar`   | `['activo']` ¹  |

¹ y sólo por casualidad: era el cambio de la PERSONA que agregó D-55, no el de la
adscripción.

El segundo renglón llegaba a la pantalla de revisión **sin ningún dato cambiado**
aunque su estatus sí cambió: la persona seguía activa —tiene otra empresa— y el
cambio de la adscripción no se listaba.

### `estatus` y `activo` son dos cosas distintas

Se usan dos nombres a propósito, y no uno solo:

- **`estatus`** — alta o baja **en esa empresa**. Es el nombre de la columna del
  archivo, que es lo que la persona está revisando.
- **`activo`** — alta o baja **del sistema**, la persona completa (D-55).

Colapsarlos en `activo` habría hecho imposible distinguir «se fue de esta
empresa» de «se fue del grupo», que es justo la diferencia que el modelo sostiene
desde el principio.

### El aviso lleva el antes y el después

`cambios` dice **qué** campo cambió; el aviso dice **de qué a qué**, en español y
mostrable tal cual: _«El estatus cambió: estaba de alta en Maquinaria Cames y el
archivo la trae como "Baja"»_. Es la información que hace revisable la
previsualización sin abrir el Excel al lado.

### Lo que sigue igual

Re-subir el mismo archivo sin cambios deja `accion: 'sin_cambios'`, `cambios: []`
y `avisos: []`. La detección de cambios no se volvió ruidosa: sólo dejó de callar
el único que faltaba.

## D-57 · El archivo no pisa lo que se corrigió a mano: se pregunta

**Decisión.** La importación compara el archivo nuevo contra **lo que trajo el
archivo anterior** (`affiliations.payrollSnapshot`). Lo que cambió en la
plataforma después de esa importación se considera **captura manual y gana**: el
archivo no lo pisa, el renglón lo reporta en `conflictos`, y para que gane el
archivo hay que pedirlo por persona en `forzarArchivoPara`.

Además, los datos de la **persona** que difieren se reportan en `diferencias`.
Esos nunca se pisan (D-46), así que no hay nada que decidir — pero hasta ahora se
callaban.

### Por qué hace falta guardar lo del archivo anterior

Sin historial, dos situaciones distintas son indistinguibles:

| Archivo anterior | Plataforma | Archivo nuevo | Qué pasó                          |
| ---------------- | ---------- | ------------- | --------------------------------- |
| `Alta`           | `Alta`     | `Baja`        | **el archivo** trae la novedad    |
| `Alta`           | `Baja`     | `Alta`        | **alguien** la dio de baja a mano |

En las dos el archivo dice algo distinto de lo que está guardado. Sólo comparando
contra lo que dijo el archivo la vez pasada se sabe cuál es cuál: lo que difiere
de la base es cambio del archivo, y lo que difiere entre la base y el documento
es cambio a mano. Por eso el snapshot, y no un `updatedAt` — que dice _cuándo_ se
tocó el registro, no _qué_ decía el archivo.

### Sólo tres campos, y por qué sólo esos

`estatus`, `tipoContrato` y `fechaIngreso`. Son los únicos donde el choque es
real: el importador los escribe **y** existe una ruta para cambiarlos a mano.
`departamento` y `nomina` sólo los escribe el importador; `areas` sólo se rellena
si está vacía; los campos de la persona nunca se pisan. Guardar más sería
contabilidad que nadie consulta.

### Gana la plataforma, y la vuelta atrás no existe

El default es conservar lo capturado porque **es lo que no se puede recuperar**:
el archivo se vuelve a subir cuando se quiera; una corrección hecha a mano, si se
pisa, se perdió. Elegir es explícito y por persona (`forzarArchivoPara`, ids de
la previsualización), no un interruptor global: aceptar el archivo para uno no
debería aceptarlo para los otros 144.

### Sigue preguntando mientras siga divergente

El snapshot guarda **lo que dijo el archivo, no lo que se aplicó**. Si el
conflicto se resuelve a favor de la plataforma, el mes siguiente el archivo vuelve
a traer lo mismo y el conflicto vuelve a aparecer. Es deliberado: la discrepancia
sigue ahí y callarla la escondería. Si algún día molesta, lo que falta es un
«ya lo revisé» explícito por campo, no borrar el registro.

### Sin snapshot, manda el archivo

Las adscripciones anteriores a esta versión, y las creadas a mano, no tienen
contra qué comparar: se comportan como siempre, el archivo manda. El registro se
escribe en **toda** importación —incluidas las filas `sin_cambios`—, así que la
primera vez que se re-suba el archivo el historial queda armado y a partir de ahí
la detección funciona. Inventar un conflicto donde no se sabe habría sido peor
que no detectarlo.

### Dos bugs que salieron al probarlo

1. **`cambiosPersona` servía para dos cosas.** Era a la vez la lista de etiquetas
   de la respuesta y la lista de campos que `#rellenarPersona` **copia** del
   archivo. El `'activo'` que agregó D-55 acababa en `empleado.activo = undefined`
   y la invariante del modelo rechazaba el guardado pidiendo el motivo de la baja.
   Ahora la etiqueta va en `cambiosDeEstado`, aparte. Estaba latente desde D-55:
   sólo no reventó porque el orden de las operaciones lo tapaba.
2. **La baja del sistema se colaba por la puerta de atrás.** Con el estatus en
   conflicto —el archivo dice alta, la plataforma dice baja— la persona se quedaba
   sin adscripción activa y D-55 le daba de baja del sistema, tomando justo la
   decisión que se acababa de dejar en manos del usuario. Ahora, si el estatus no
   se aplica, el renglón no decide nada sobre la persona.

## D-58 · Las áreas son un catálogo administrable, no un enum del código

**Decisión.** `AREAS` deja de ser una lista fija en `constants/areas.js` y pasa a
la colección **`areas`**, con su recurso `/areas`. El catálogo arranca con nueve
áreas base, el archivo de nómina da de alta las que no conoce como **temporales**,
y se dan de baja sin borrarlas.

### El problema

La columna `Departamento` del archivo no trae áreas de la organización: 53 de las
145 filas de Urbacames traen una **obra** (`Axis Zapopan`, `Axis 3`, `Plenares`).
El importador las traducía con un mapa fijo escrito en el código, y lo que no
estaba en el mapa caía a un área por defecto inventada (`obra` para el personal de
campo, `administracion` para el resto) que no decía nada del archivo: todas las
obras acababan en la misma área.

Agregar un área —o una obra nueva— exigía editar el código y desplegar. Eso no es
un catálogo, es una constante.

### Las nueve base

`Dirección`, `Recursos Humanos (RH)`, `Finanzas`, `Operaciones (Maquinaria)`,
`Operaciones (Urbanizadora)`, `Costos y Presupuestos`, `Comercial`, `Tesorería`,
`Contabilidad`. Las dio Urbacames. No se pueden dar de baja: son el esqueleto.

### `clave` y `nombre` son cosas distintas

`clave` es el valor del **contrato** —lo que se guarda en `adscripciones.areas`,
lo que viaja en `req.areasPorEmpresa` y lo que compara el front— y es
**inmutable**: cambiarla dejaría huérfana a cada adscripción que la guarda.
`nombre` es lo que se muestra y sí se corrige.

Las claves de las base van escritas a mano y no derivadas del nombre, porque
tienen que coincidir con lo que ya está guardado: `Recursos Humanos (RH)` tiene
que seguir siendo `recursos_humanos`. Las demás sí se derivan (`Axis Zapopan` →
`axis_zapopan`).

### Áreas temporales

Un `Departamento` que no coincide con ninguna área del catálogo **se da de alta
como temporal**, y la fila lo avisa. Es el mismo trato que ya reciben los puestos
(D-46): el dato viene del archivo, no es una decisión de catálogo, y rechazar la
fila por un departamento nuevo dejaría la importación inservible.

El aviso por renglón sale **sólo la primera vez**, cuando el área se crea.
Repetir «es un área temporal» en cada renglón y en cada importación serían 145
avisos al mes que nadie lee; para eso está el aviso general del archivo («usa 3
áreas temporales: …») y `GET /areas?temporal=true`.

**Quién las cierra: RH.** `rh_admin` y `rh_consulta` pueden dar de baja las
temporales sin ser administradores de plataforma, porque quien sabe que la obra
terminó son ellos. No alcanza para tocar el resto del catálogo, que sigue siendo
del administrador de plataforma como las empresas y las categorías.

### Dar de baja no es borrar, y no se hace con gente dentro

El área conserva su registro y se puede reactivar; sólo deja de ofrecerse. Y **no
se da de baja un área que alguien tiene asignada**: responde `400` diciendo
cuántas personas la tienen. Mismo candado que las categorías (D-32) y por la
misma razón: sin él, un jefe de área dejaría de ver a su gente sin que nadie se
enterara.

Si el archivo trae gente en un área **dada de baja**, se **reactiva** y se avisa:
RH la cerró porque la obra terminó y el archivo dice que hay gente ahí otra vez.
Dejarla cerrada habría dejado a esas personas en un área que ningún desplegable
ofrece.

### Las áreas del modelo anterior no se mapean a mano

`obra`, `administracion`, `proyectos`, `compras`, `ventas` y `mantenimiento` no
están en la lista nueva, y hay gente con ellas. **Las corrige el archivo** al
re-importar la nómina (decisión del cliente): la columna `Departamento` reasigna
a cada persona.

Mientras tanto entran al catálogo como NO base y **activas** —sólo las que de
verdad tengan gente—, para que nadie pierda su área ni un jefe de área deje de ver
a los suyos. Cuando el archivo las deje sin nadie, RH las da de baja. Se descartó
sembrarlas ya dadas de baja: habría dejado a esa gente sin área visible desde el
primer arranque, antes de que nadie pudiera subir el archivo.

### `areas` pasa a ser un campo donde manda el archivo

Antes el importador **sólo rellenaba** las áreas vacías («una curada a mano vale
más que una deducida»). Eso ya no sirve: si el archivo no puede reasignar, no
puede corregir las áreas del modelo anterior, que es justo lo que se le pidió.

Ahora las escribe, pero pasa por el candado de D-57: si alguien curó el área a
mano, es **conflicto** y no se pisa hasta que se pida con `forzarArchivoPara`. Las
dos cosas a la vez — el archivo corrige, la captura manual se respeta.

### Una fila sin `Departamento` se queda sin área

Antes se le inventaba una. Ahora se queda sin ninguna y se marca en
`datosPendientes: ['areas']`, que es lo que permite listar después a quién hay que
asignársela. `datosPendientes` ya existía para la fecha de término (D-46) y hace
exactamente esto: relajar una invariante dejando el pendiente a la vista.

### La validación se movió de las rutas al servicio

`isIn(AREAS)` no puede consultar la base. Las rutas validan sólo el **formato** de
la clave y `areaService` valida contra el catálogo, que es donde se puede dar un
mensaje útil («Estas áreas están dadas de baja: Axis 3») y distinguir «no existe»
de «está de baja».

Con una diferencia deliberada entre guardar y filtrar: **guardar** exige un área
activa; **filtrar** (`?area=`) admite también las dadas de baja, porque a esas
todavía hay gente asignada y es justo a quien hay que encontrar para reasignar.

### Migrar

`npm run migrate:areas` (con `--dry-run`). Siembra el catálogo, registra cualquier
área en uso que no conozca ninguna de las dos listas —para que ninguna adscripción
apunte a un área inexistente, que a partir de aquí impediría editarla— y reporta
cuánta gente tiene cada área fuera de las base. **No reasigna a nadie.** Después,
`npm run db:indices`: la colección estrena dos índices únicos.

## D-59 · `tipo` se deriva del puesto: ni se captura ni se filtra

**Decisión.** `tipo` (`administrativo` / `mano_de_obra`) deja de mandarse en
`POST /empleados` y `PATCH /empleados/:id`, y desaparece como filtro (`?tipo=`)
de `/empleados`, `/expedientes` y `/empresas/:id/adscripciones`. **Sale de la
categoría**, que ya lo trae. Sigue en el modelo y en la respuesta.

### El malentendido que lo destapó

Al pedir el catálogo de áreas (D-58), el cliente aclaró que las áreas venían a
**reemplazar el filtro de `tipo`** de la tabla — no a sumarse a él. La tabla
quedó con «Todas las áreas» y «Mano de obra» al lado, que es justo la
duplicación que se quería quitar.

### Por qué NO se elimina el campo

Se planteó quitarlo del todo y se descartó, porque `tipo` no es una etiqueta:
es **lo que decide quién puede gestionar a quién**. `rh_consulta` y `jefe_area`
sólo dan de alta y editan `mano_de_obra`; a un administrativo sólo lo toca
`rh_admin` (modelo-datos §8.2). Las áreas no cubren eso: dicen _dónde_ trabaja
alguien, no qué permiso hace falta para gestionarlo. Borrar el campo habría
obligado a redefinir la matriz de permisos entera.

También filtra el desplegable de puestos (`GET /categorias?tipo=`), que sigue
siendo útil: «Auxiliar contable» no se ofrece en un alta de obra.

### La redundancia que sí había

El alta pedía `tipo` **y** `categoriaId`, y cada categoría **ya trae su `tipo`**.
Eran dos fuentes para el mismo dato, con una comprobación
(`assertUsableParaTipo`) para que no discreparan — y el importador ya resolvía el
empate a favor del catálogo (D-46).

Ahora hay una sola fuente:

- **Alta**: se resuelve la categoría primero y de ahí sale el tipo. Va antes del
  chequeo de permiso, porque el permiso depende del tipo.
- **Edición**: **cambiar de puesto es lo que cambia el tipo**. Mover a alguien de
  «Peón» a «Auxiliar contable» lo convierte en administrativo, y por eso exige el
  mismo permiso que crear uno y la misma invariante (un administrativo necesita
  área en cada adscripción).
- `assertUsableParaTipo` desapareció: comprobar que el tipo capturado coincida
  con el de la categoría no puede fallar cuando el tipo **sale** de la categoría.
  La sustituye `categoryService.usable`.

### Mandar `tipo` en el `PATCH`: depende de si es el mismo

Se distinguen dos cosas que al principio traté como una sola:

- **El valor que ya tiene** → se ignora y la edición sigue. Es lo que manda un
  formulario que devuelve el empleado completo, y no hay nada que rechazar:
  mandar el valor actual no cambia nada. Rechazarlo habría roto **toda** edición
  hasta que el front se desplegara, y front y backend se despliegan por separado.
- **Un valor distinto** → `400` con `path: 'categoriaId'`: _«El tipo se deriva del
  puesto: para dejarlo en "administrativo" manda la categoriaId que
  corresponda»_. Eso sí es intentar cambiarlo por la puerta equivocada.

En el `POST` simplemente se ignora.

### El filtro se va, pero sin romper a quien lo mande

`?tipo=` deja de existir en los tres listados de personas. No responde `400`: el
parámetro se ignora y devuelve todo, para que un front que todavía lo mande no se
quede con una tabla vacía sin explicación.

**Cuidado con `GET /alertas?tipo=`**: ahí `tipo` es el tipo de ALERTA, no el de
la persona. No se tocó.

## D-60 · Trabajar en un área no es dirigirla: la jefatura se asigna

**Decisión.** El alcance de un `jefe_area` deja de derivarse de las áreas de su
propia adscripción y pasa a un campo explícito, `adscripciones.dirigeAreas`, que
se asigna desde configuración. `req.areasPorEmpresa` lo lee de ahí.

### El problema

`applyScope` armaba el alcance con las `areas` de la adscripción del usuario. O
sea: poner a alguien en Contabilidad **porque ahí trabaja** le daba, de paso,
visión sobre todo Contabilidad. Dos cosas distintas —dónde trabajas y qué
diriges— guardadas en el mismo campo.

Se destapó discutiendo el catálogo de áreas: el cliente lo dijo con otras
palabras — «una cosa es el área de cada empleado y otra muy diferente son los
administradores de la plataforma». El resto del modelo ya separaba bien los dos
ejes (los datos de RH por un lado, `empleados.acceso` por otro); éste era el
único punto donde se contaminaban.

### `dirigeAreas` no es un subconjunto de `areas`

A propósito. Un director puede dirigir Contabilidad sin estar adscrito a ella, y
alguien puede trabajar en un área sin dirigirla — que es el caso normal y el que
estaba mal. Lo único que se exige es tener adscripción a la empresa, porque es
donde vive el dato.

**Es por empresa**, como todo lo demás de la relación laboral: dirigir
Contabilidad en Urbanizadora no da alcance sobre la Contabilidad de Maquinaria.

Varios jefes por área y varias áreas por jefe: las dos cosas se permiten.

### Ruta y permiso aparte de la adscripción

`PATCH /adscripciones/:id/jefaturas`, con capacidad propia
(`MANAGE_AREA_LEADERSHIP`, sólo `rh_admin`) en vez de `MANAGE_AFFILIATIONS`.
Aunque el dato viva en la adscripción, **no es la relación laboral: es quién ve a
quién**. Con la misma capacidad, corregir una fecha de ingreso y repartir
visibilidad habrían costado lo mismo.

Se manda la **lista completa**, no un agrega/quita: `[]` le quita la jefatura. Es
lo que permite a la pantalla guardar lo que muestra sin llevar la cuenta de qué
cambió.

`GET /empresas/:id/jefaturas` es la vista de configuración: entra por el ÁREA y
trae **todas** las activas, también las que nadie dirige — que es la mitad de
para qué sirve. Se arma leyendo las adscripciones, así que no hay un segundo
lugar donde el dato pueda desincronizarse.

### Migrar es obligatorio, y va antes del despliegue

`npm run migrate:jefaturas` (con `--dry-run`). Copia `areas` → `dirigeAreas` en
las adscripciones activas de quien tiene acceso `jefe_area`: deja el alcance
**exactamente como estaba**.

Sin ella, al desplegar **todos los jefes de área dejan de ver a nadie** —
`areasVisibles` devuelve `[]` y el listado responde vacío. No toca a `rh_admin`
ni a `rh_consulta`: no usan `areasPorEmpresa`, y darles jefaturas que nadie pidió
sería inventar permisos. Es idempotente y sólo escribe donde `dirigeAreas` está
vacío, así que no deshace una reasignación posterior.

Deja el estado anterior tal cual **a propósito**: el punto del cambio es que RH
revise en configuración quién debe dirigir qué, y es probable que varios de los
que hoy dirigen su propia área no debieran.

## D-61 · Apagar, no suspender: el pool muerto que cerraba la sesión

**Síntoma.** Tras un rato sin usar la plataforma, recargar se quedaba pensando
mucho tiempo y después obligaba a iniciar sesión otra vez.

**Decisión.** Tres cambios: `auto_stop_machines` pasa de `'suspend'` a `'stop'`,
`/ready` comprueba la base **de verdad** con un `ping`, y `socketTimeoutMS` baja
de 45s a 10s.

### La cadena completa

No era un problema de sesiones. El JWT dura 12h y no había expirado.

1. Sin tráfico, Fly **suspendía** la máquina: congela la VM con su memoria
   intacta, incluido el pool de conexiones a Atlas.
2. Al volver, la VM se reanudaba con esos sockets **abiertos en su memoria pero
   muertos del otro lado** — Atlas los había cerrado hacía rato.
3. La primera consulta se iba contra uno de esos sockets y esperaba
   `socketTimeoutMS`: **45 segundos**. Eso era «se queda pensando mucho tiempo».
4. `protect` consulta la base para validar la sesión. Al fallar, el error subía
   como **500**.
5. El front, que trata cualquier fallo de la petición de sesión como «no
   autenticado», mandaba al login. Eso era «me hace iniciar sesión de nuevo».

### `suspend` es la modalidad equivocada para esto

`suspend` sirve para un proceso que puede congelarse y descongelarse sin
consecuencias. **Una aplicación que mantiene un pool de conexiones a una base
externa no es ese caso**: lo que se restaura es un pool que ya no existe.

Con `stop` el proceso muere y arranca limpio: `connect()` corre de nuevo y las
conexiones son reales. Cuesta unos segundos más de arranque en frío —el
despliegue mostró ~8s contra ~1s— y a cambio funciona. Para un panel interno de
RH ese intercambio es obvio.

Alternativa si esos segundos molestan: `min_machines_running = 1`, que la deja
encendida siempre. Se paga aunque nadie la use, y no se eligió por eso.

### `/ready` mentía, y era la sonda del orquestador

`connectionState()` lee `mongoose.connection.readyState`, una bandera **local**.
Tras reanudar seguía diciendo `conectado` con todos los sockets muertos, así que
el health check de Fly daba verde mientras cada petición real se colgaba. Una
sonda de readiness que no comprueba nada es peor que no tenerla: manda tráfico a
un proceso que no puede atenderlo.

Ahora hace un `ping` real contra la base, acotado a 3s para que la sonda no se
cuelgue ella misma, y la respuesta trae `responde: true|false`. La ruta llama a
`database.ping()` a través del módulo y no desestructurado, para no quedarse con
una referencia congelada al importar — que además es lo que permite probar el
camino del 503.

### 45s era demasiado para fallar

`retryReads` viene en `true`, así que el driver reintenta la consulta y la
segunda **sí** funciona: el problema no era que fallara para siempre, era cuánto
tardaba en rendirse la primera. Con 10s el reintento ocurre dentro de lo que
cualquier cliente HTTP tolera.

### Lo que le toca al front

**Cerrar sesión sólo con `401`.** Un `500` o un timeout significan «el servidor
no contestó», no «tu sesión no vale». Con esta corrección el caso deja de
dispararse, pero cualquier caída momentánea vuelve a sacar a todo el mundo
mientras el front trate los dos igual.

## D-62 · El renglón del empleado devuelve la adscripción completa

**Decisión.** `adscripciones[]` en `GET /empleados`, `GET /empleados/:id` y el
expediente devuelve además `departamento`, `datosPendientes`, `motivoBaja` y
`fechaBaja`. Es aditivo: no cambia nada de lo que ya salía.

### Qué se estaba perdiendo

El renglón se arma a mano en `#formatearRenglon`, no con el `toJSON` de la
adscripción, y llevaba nueve de los trece campos del contrato. Los cuatro que
faltaban no eran menores:

- **`departamento`** — el archivo de nómina lo llena en **las 145 filas**. Es el
  texto original («Axis Zapopan», «Operaciones») y no se veía por ningún lado
  salvo en `/empresas/:id/adscripciones`.
- **`datosPendientes`** — es cómo RH sabe qué le falta capturar a esa persona.
  Sin él, el pendiente existe en la base y nadie lo ve.
- **`motivoBaja` y `fechaBaja`** — por qué y cuándo dejó **esa empresa**, que es
  distinto de la baja del sistema que ya venía en `empleado`.

Salió al validar, contra el archivo real, si la importación guardaba todas las
columnas. Guardaba las 30; el problema era el otro extremo — parte de lo
guardado no se devolvía.

### `nomina` sigue fuera

Las trece columnas de nómina (salario, SBC, banco, sucursal, cuenta) se guardan
en `affiliations.nomina` con `select: false` y **no se exponen**. No es un
descuido: falta decidir quién puede verlas (D-46, LFPDPPP). El cliente lo
resolverá junto con los permisos por sección.

### Lo que viene después, y por qué conviene no adelantarlo

El cliente pidió que el acceso deje de ser tres niveles fijos y pase a **roles
configurables**: todos con un acceso base, y desde configuración se define qué
secciones ve cada rol — incluidos los que se creen después. Eso reemplaza a
`nivelAcceso` y a la matriz de capacidades del código, así que **la visibilidad
de la nómina se resuelve ahí**, no con un permiso suelto ahora. Anotado para
diseñarlo entero.

## D-63 · `nomina` se parte: el origen no es el criterio, la sensibilidad sí

**Decisión.** Las 13 columnas del archivo que no son identidad ni contrato se
reparten en dos: **`condiciones`** (8 campos, se serializan) y **`nomina`**
(7 campos, siguen sin exponerse).

| `condiciones` — se muestran | `nomina` — no se exponen |
| --------------------------- | ------------------------ |
| `tipoRegimen`               | `salarioDiario`          |
| `turno`                     | `sbcParteFija`           |
| `registroPatronal`          | `sbcParteVariable`       |
| `baseCotizacion`            | `sbcTopeUMA`             |
| `zonaSalario`               | `banco`                  |
| `tipoPrestacion`            | `sucursal`               |
| `periodicidadPago`          | `cuenta`                 |
| `teletrabajador`            |                          |

### El error que corrige

Todas venían de la misma hoja de cálculo, así que acabaron en el mismo
subdocumento — y como ese subdocumento guarda salarios y cuentas bancarias, es
`select: false` y no se serializa. Resultado: ocho campos que **no tienen nada de
sensible** quedaron invisibles por vecindad.

El régimen del IMSS, el turno, el registro patronal o si alguien cotiza sobre
base fija no son datos que haya que restringir bajo LFPDPPP. Son condiciones de
la relación laboral, como el tipo de contrato o la fecha de ingreso, que se
muestran desde siempre.

**Agrupar por dónde viene el dato en vez de por qué protección necesita** fue el
error. La división nueva es por sensibilidad, que es el criterio que importa.

### Lo que queda pendiente sigue igual

Los siete de `nomina` son importes y datos bancarios y **siguen sin exponerse**
hasta que se decida quién puede verlos. Eso se resuelve con los roles
configurables que pidió el cliente, no con un permiso suelto (ver D-62).

### Migrar

`npm run migrate:condiciones` (con `--dry-run`). **Copia**, no mueve: el original
se conserva bajo `nomina` hasta correrlo con `--limpiar`. Lee con el driver crudo
porque los ocho campos ya no están en `payrollSchema` y Mongoose los ignoraría.
Idempotente: sólo escribe donde `condiciones` está vacío.

Sin la migración, los datos ya importados no se ven — el importador escribe en el
sitio nuevo, pero lo de agosto está bajo `nomina`.

## D-64 · Las empresas se pueden editar y dar de baja, y llevan sus registros patronales

**Decisión.** `Company` gana `registrosPatronales: string[]` —uno o varios— y el
recurso estrena `PATCH /empresas/:id` y `PATCH /empresas/:id/estado`.

### El hueco

Una empresa sólo se podía **crear y consultar**. No había ruta que la editara ni
que la diera de baja, aunque el modelo ya tenía `activo`. Si alguien capturaba
mal el RFC, no había forma de arreglarlo desde la API.

Los demás catálogos sí lo tenían —clientes con `PATCH /clientes/:id` y su
`/estado`, categorías y áreas con el suyo—. Empresas quedó a medias
probablemente por ser lo primero que se hizo.

### Varios registros patronales, no uno

Una empresa puede tener registro patronal por entidad o por clase de riesgo. Y
hay una razón concreta en estos datos: **el archivo de nómina ya trae uno por
persona** (`adscripciones.condiciones.registroPatronal`, D-63). Con un solo campo
en la empresa no habría dónde guardar los demás, y la relación entre el registro
de la persona y el de su empresa quedaría sin poder comprobarse nunca.

Se guardan en mayúsculas y **sin repetidos**, y eso se fuerza en un
`pre('validate')` del modelo y no en el servicio: así vale por cualquier camino
—alta, edición o un script— y no sólo por la ruta que se acuerde de limpiarlos.

**No se exige ninguno.** Las empresas que ya existen no lo tienen, y hacerlo
obligatorio dejaría inválido lo que ya está guardado.

### Se reemplaza la lista, no se acumula

`PATCH` con `registrosPatronales` manda la **lista completa**: agregar uno es
mandar los que ya estaban más el nuevo, y `[]` los deja sin ninguno. Misma regla
que las jefaturas (D-60), y por lo mismo: permite a la pantalla guardar lo que
muestra sin llevar la cuenta de qué cambió.

### La baja se bloquea si la empresa tiene algo dentro

No se da de baja una empresa con **gente adscrita** o **proyectos abiertos**: `400`
diciendo cuántos de cada uno. Mismo candado que las categorías y las áreas, y por
la misma razón — una empresa inactiva deja de ser visible y de aceptar
importaciones, así que su gente quedaría en un limbo que nadie ve.

`activo` no se toca desde `PATCH /empresas/:id`: cae en la lista de campos no
editables con la pista de que use `/estado`. Cambiar un nombre y esconder a
sesenta personas no deberían costar lo mismo.

### Ambas exigen administrador de plataforma

`MANAGE_COMPANIES`, igual que crear. Una empresa afecta a todo el grupo.

### Pendiente relacionado

Queda abierto si un registro patronal debe ser **único entre empresas**. Un
registro del IMSS pertenece a un solo patrón, así que en teoría sí — pero no se
puso índice único sin confirmarlo, porque bloquearía casos legítimos que este
equipo conoce mejor que yo.

## D-65 · Los registros patronales dejan de ser cadenas y pasan a tener identidad

**Decisión.** `companies.registrosPatronales` pasa de `[String]` a
**subdocumentos con `_id`**, con sus rutas de alta, edición y baja. Es la Fase 1
del plan de obra y contratos (`PLAN-OBRA-CONTRATOS.md`).

### Por qué se rehace algo de anteayer

D-64 los guardó como cadenas, y para lo que se pidió entonces —guardarlos— estaba
bien. En cuanto el **proyecto tiene que apuntar a uno**, deja de servir: no se
puede referenciar una posición de un arreglo de cadenas, y corregir un dígito
rompería la referencia sin que nada falle.

Con `_id` propio la referencia sobrevive a que se corrija el número. Por eso
**el número sí es editable**: es justo para lo que sirve la identidad.

### Subdocumentos, no colección aparte

No tienen vida fuera de su empresa, no se comparten y la empresa ya se carga
donde hacen falta. El `_id` de un subdocumento es un ObjectId real y único, así
que `projects.registroPatronalId` se podrá indexar igual; lo único que se pierde
es `populate`, que aquí no hace falta.

### Único dentro de la empresa, libre entre empresas

La invariante va en un `pre('validate')` del modelo y no en el servicio, para que
valga por cualquier camino —alta, edición o un script— y no sólo por la ruta que
se acuerde de comprobarlo. Entre empresas distintas **no se bloquea**: no hay
evidencia de que sea imposible y un índice equivocado frenaría trabajo real.

### Rutas

```
POST  /empresas/:id/registros-patronales             idempotente por número
PATCH /empresas/:id/registros-patronales/:rpId       número y descripción
PATCH /empresas/:id/registros-patronales/:rpId/estado
```

Sub-recurso bajo la empresa, como el acceso de un empleado, y con el mismo
permiso que editarla (`MANAGE_COMPANIES`).

`PATCH /empresas/:id` **deja de aceptar** `registrosPatronales`: responde `400`
con la pista de la ruta nueva.

### La migración es lo que más valor da

`npm run migrate:registros-patronales` hace dos cosas:

1. Convierte las cadenas que existan en subdocumentos.
2. **Los saca del archivo de nómina.** Cada adscripción ya guarda el registro de
   su persona en `condiciones.registroPatronal` (D-63): agrupando por empresa
   salen los que de verdad usa, sin capturar nada.

En los datos reales eso lleva a Maquinaria CAMES **de 1 a 4** registros
—`H67-29973-10-5` (13 personas), `Z61-14090-10-9` (2) y `H68-39212-10-5` (2)—
que nadie había capturado. Se les pone una descripción que dice de dónde salieron.

### Lo que queda para fases siguientes

La baja de un registro patronal **todavía no comprueba nada**, porque aún nadie
lo referencia. Cuando el proyecto lo haga (Fase 3), aquí entra el candado de «no
se da de baja uno que un proyecto en curso esté usando».

## D-66 · Registros de obra en el cliente

**Decisión.** `clients.registrosObra` — subdocumentos con `_id`, uno o varios por
cliente, con sus rutas de alta, edición y baja. Es la Fase 2 del plan
(`PLAN-OBRA-CONTRATOS.md`).

Simétrico a los registros patronales (D-65) y por las mismas razones: el proyecto
tendrá que **apuntar a uno**, así que necesita identidad propia; el número es
editable porque quien lo referencia apunta al `_id`; y se dan de baja con
`activo`, nunca se borran.

### No confundirlo con el registro patronal

Son ramas distintas del modelo, y mezclarlas es el error que este trabajo intenta
evitar:

|                       | Pertenece a | Da al proyecto       | Origen de                      |
| --------------------- | ----------- | -------------------- | ------------------------------ |
| **Registro patronal** | la EMPRESA  | su contexto patronal | —                              |
| **Registro de obra**  | el CLIENTE  | su obra              | **los SIROC** de sus contratos |

El SIROC **no** sale del registro patronal.

### Rutas y permiso

```
POST  /clientes/:id/registros-obra
PATCH /clientes/:id/registros-obra/:roId
PATCH /clientes/:id/registros-obra/:roId/estado
```

Con `MANAGE_CLIENTS` —`rh_admin` y `jefe_area`—, **no** el permiso de plataforma:
son dato operativo del cliente, no configuración del grupo. Ahí está la
diferencia con los registros patronales, que sí son de plataforma porque afectan
a toda la empresa.

### El alcance no acota aquí, y es correcto

Quien administra clientes ve el **catálogo completo** (D-40): es compartido, y
acotarlo por cartera le impediría registrar la obra de un cliente que todavía no
ha metido a su cartera. Se comprobó al escribir la prueba, que partía de la
premisa contraria.

De paso salió que `getById` y el buscador de registros consultaban el cliente dos
veces; la comprobación de alcance se extrajo a `#assertEnAlcance` y ahora es una.

### Sin migración

No hay datos: el concepto no existía. Los 5 clientes actuales quedan con
`registrosObra: []`.

## D-67 · El proyecto referencia su registro patronal y su registro de obra

**Decisión.** `projects` gana `registroPatronalId` y `registroObraId`, **opcionales
por ahora**, con las validaciones de pertenencia. Es la Fase 3 del plan
(`PLAN-OBRA-CONTRATOS.md`).

### Las dos reglas que no se pueden dejar al front

- El **registro patronal** debe ser de la **EMPRESA** del proyecto, y estar activo.
- El **registro de obra** debe ser del **CLIENTE** del proyecto, y estar activo.

Son ramas distintas del modelo y confundirlas es justo lo que este trabajo evita.
Se comprueban en el servicio, que es donde se puede consultar la base y nombrar
el dueño en el mensaje: _«Ese registro patronal no es de Maquinaria CAMES»_.

### Opcionales a propósito

Los tres proyectos que ya existen no los tienen, y exigirlos los dejaría
inválidos: cualquier `save()` sobre ellos —aplazar, finalizar, editar— fallaría.
Se vuelven obligatorios en la Fase 4, después de poblarlos. Es el orden seguro de
siempre: opcional → poblar → obligatorio.

### Se devuelven resueltos, no sólo el id

La respuesta trae `registroPatronal` y `registroObra` completos (número,
descripción, activo) además del id. **No se guarda el número en el proyecto**:
eso crearía dos verdades. Se resuelve al leer, igual que `empresaNombre`, y para
eso el `populate` ahora trae también los subdocumentos.

### Cambiar de cliente limpia el registro de obra

El que había era del cliente anterior. Se pone en `null` salvo que en la misma
petición venga uno nuevo, que se valida contra el cliente **que va a quedar**, no
contra el que tenía.

### El candado que quedó pendiente en las fases 1 y 2

Ahora que alguien los referencia, ya hay qué comprobar: **no se da de baja un
registro que un proyecto EN CURSO esté usando** (`400` diciendo cuántos). Los
proyectos **finalizados no estorban**: su registro es historia y debe poder
cerrarse. Aplica a los dos, en `companyService` y en `clientService`.

### Índices

`projects.registroPatronalId` y `projects.registroObraId`, que es lo que hace
barata la pregunta «¿qué proyectos usan este registro?» antes de darlo de baja.

### Sin migración

Los campos nacen en `null`. Poblar los tres proyectos existentes es la Fase 4, y
no hay dato del cual derivarlos: hay que elegirlos.

## D-68 · Un registro sin número no se emite nunca

**Síntoma.** El front encontró en local un registro patronal **sin número**, con
sólo `_id`, `descripcion: null` y `activo: true`. Sospecharon de una fila en
blanco del archivo de nómina o de la migración.

**No era ninguna de las dos.** Era una base **a medio migrar**.

### Qué pasaba

El documento seguía guardado en el formato de D-64 —`["R13-77767-10-5"]`, un
arreglo de cadenas— porque la migración de D-65 no se había corrido en ese
entorno. Al leerlo con el esquema nuevo, Mongoose intenta convertir la cadena en
subdocumento, no encuentra dónde ponerla, y produce uno **sin `numero`**.

El dato no se perdía: seguía intacto en el documento crudo, y
`npm run migrate:registros-patronales` lo recupera —de hecho lo recuperó, y de
paso sumó los tres de la nómina.

### La corrección

Que la migración esté pendiente es un estado transitorio y legítimo; **emitir un
registro roto por contrato, no**. `toJSON` descarta los que no tengan número, en
`companies` y por simetría en `clients`.

Así, un entorno a medio migrar devuelve **menos** registros, nunca uno
malformado. El front puede confiar en que `numero` es siempre una cadena.

### Lo que no se cambió, y por qué

La migración **ya saltaba** las filas sin número —tanto en la agregación como al
normalizar— así que no había nada que arreglar ahí. Y el `POST` tampoco: exige
entre 3 y 30 caracteres. Ninguno de los dos podía crear esto.

### La lección

Un cambio de forma en un campo persistido deja el sistema en dos estados
—migrado y sin migrar— y **los dos tienen que devolver algo válido**. Aquí la
lectura no se defendía del estado viejo. Vale para las fases que quedan: cuando
la 4 vuelva obligatorios los registros del proyecto, los tres proyectos sin ellos
son ese mismo estado intermedio.

## D-69 · El registro patronal y el de obra pasan a ser obligatorios

**Decisión.** `POST /proyectos` exige `registroPatronalId` y `registroObraId`, y
`PATCH` puede cambiarlos pero **no vaciarlos**. Es la Fase 4 del plan.

### Obligatorio en los NUEVOS, no en los que ya existen

En el modelo, `required` es una **función de `this.isNew`** en vez de `true`.
Así ningún proyecto puede nacer sin ellos —por la ruta, por un script o por donde
sea— y a la vez los que ya están guardados se pueden seguir aplazando,
finalizando y editando.

Marcarlos obligatorios a secas habría dejado inválidos los proyectos anteriores,
y cualquier `save()` sobre ellos habría fallado. Es exactamente la trampa de
D-68: **un cambio de forma deja el sistema en dos estados y los dos tienen que
funcionar.** Es la segunda vez en dos días, así que vale como patrón: cuando un
campo se vuelve obligatorio sobre datos existentes, `required: () => this.isNew`.

### `PATCH` los cambia, no los vacía

Un proyecto sin registro patronal o sin registro de obra dejó de ser un estado
válido; admitir `null` en la edición sería la puerta de atrás para volver a
crearlo.

### Cambiar de cliente ahora exige su registro de obra

En D-67 se limpiaba el registro de obra al cambiar de cliente, porque el que
había era del anterior. Con los campos obligatorios eso ya no vale: el proyecto
quedaría en un estado prohibido. Ahora hay que **mandar los dos en la misma
petición**, y si no viene el registro, `400` con `path: 'registroObraId'`.

### Los proyectos anteriores: una herramienta, no una decisión automática

`npm run proyectos:incompletos` **reporta y no escribe nada**. Por cada proyecto
incompleto dice su empresa, su cliente, cuántas asignaciones tiene, qué le falta
y qué candidatos hay. Después se elige:

- `--rellenar` — le pone el **primer registro activo** de su empresa y su cliente.
  Es una elección arbitraria: sólo tiene sentido con datos de prueba. Con
  proyectos reales hay que asignarlos a mano, porque de eso depende a qué obra
  pertenece cada uno.
- `--borrar` — lo elimina con sus asignaciones. Destructivo y sin vuelta atrás.

Elegir es del cliente, no del script. Y **no corre prisa**: esos proyectos siguen
funcionando gracias al `required` condicional.

En local reporta 3 incompletos, y algo que conviene notar: **sus clientes no
tienen ningún registro de obra activo**, así que `--rellenar` no podría
completarlos todavía. Hay que crear los registros primero.

### La fábrica de pruebas los crea sola

`crearProyecto` ahora prepara el registro patronal y el de obra si no se le pasan,
y los devuelve. Hacer que cada prueba los montara a mano habría convertido en
ruido lo que casi nunca es el objeto de la prueba.

## D-70 · Contratos con el SIROC embebido

**Decisión.** Colección `contracts`, un contrato por fase, con el SIROC dentro y
único en todo el sistema. Es la Fase 5 del plan.

### Contrato y fase son la misma entidad (G1)

Cada fase de una obra tiene exactamente un contrato, y un proyecto de un solo
contrato no tiene fases. **Dos entidades 1:1 obligatorias son una sola con dos
nombres**; `nombre` cubre la etiqueta ('Fase 1', 'Cimentación') y es opcional
justamente porque el proyecto de un contrato no la necesita.

### Colección propia, SIROC embebido

Los contratos crecen sin tope, se agregan con el tiempo y hay que consultarlos
solos: colección. El SIROC es 1:1 con el contrato y no tiene ciclo de vida
propio: embebido. Es el mismo criterio que separa `assignments` de
`aplazamientos`. Si algún día el SIROC necesita historial, se gradúa entonces.

### El `numero` lo asigna el servidor

Es una secuencia dentro del proyecto, no un dato que se captura. Dejar que lo
mandara el cliente sólo produce huecos y choques contra el índice único. El alta
lo calcula como `max + 1` **contando también los dados de baja** —reusar un
número chocaría— y reintenta si dos altas simultáneas calculan el mismo.

### `estado` y `activo` son cosas distintas, y por eso van por rutas distintas

`finalizado` es un contrato que terminó bien; `activo: false` es uno capturado
por error o cancelado. Confundirlos borraría la diferencia entre una obra
completada y una que nunca existió.

- `POST /contratos/:id/finalizar` · `/reabrir` → `estado`, igual que en proyectos.
- `PATCH /contratos/:id/estado` → `activo`, igual que en el resto del catálogo.

Es la única colisión de nombres del contrato de la API: `/estado` mueve `activo`
mientras existe además un campo llamado `estado`. Se conservan las dos
convenciones porque cada una ya es la del recurso al que se parece, y romper
cualquiera de las dos sorprendería más que documentarlo.

### El SIROC es único GLOBAL (G4)

Índice único **parcial** sobre `contracts.siroc.numero`, por `$type: 'string'` y
no `sparse`: el contrato nace sin SIROC y `siroc` queda en `null`, así que el
campo puede existir valiendo nulo y `sparse` haría chocar entre sí a todos los
contratos sin SIROC. Es la misma trampa que en el resto del modelo.

Repetirlo responde **409 `SIROC_DUPLICADO` con el contrato y el proyecto que ya
lo tienen**, no un error de base de datos: quien captura necesita saber dónde
está el choque. Se consulta antes de escribir sólo para poder decirlo; la
garantía real la sigue dando el índice, y la carrera la atrapa el `catch`, que
vuelve a consultar y produce el mismo 409. Se comprobó anulando la consulta
previa: el índice atrapa el choque igual.

### `DELETE /contratos/:id/siroc` — no estaba en el plan y hacía falta

Con el número único global, un SIROC capturado en el contrato equivocado deja ese
número bloqueado **para siempre**: corregirlo en el contrato correcto sería
imposible porque chocaría consigo mismo. Quitarlo también libera el registro de
obra del proyecto, que estaba trabado por él.

### Los candados de G3 miran el CAMBIO, no la presencia

| Campo del proyecto   | Se bloquea cuando                    |
| -------------------- | ------------------------------------ |
| `registroPatronalId` | hay ≥1 contrato activo               |
| `registroObraId`     | hay ≥1 contrato activo **con SIROC** |
| `clienteId`          | hay ≥1 contrato activo               |
| `empresaId`          | siempre                              |

El registro de obra se traba **antes** que el patronal, y con un umbral distinto:
basta un SIROC, porque el aviso ante el IMSS ya salió con esa obra. Sin SIROC
todavía se corrige.

Y el detalle que importa: comparan contra el valor actual, no contra "vino en el
cuerpo". El formulario del front manda el proyecto entero, así que bloquear por
presencia habría vuelto inmodificable hasta el nombre — la misma clase de error
que D-68 y D-69, ahora en la escritura en vez de la lectura.

## D-71 · Coherencia del registro patronal: avisa, no bloquea

**Decisión.** Asignar a alguien a un proyecto cuyo registro patronal no es el
suyo **se permite**, y la respuesta lo advierte. Y la cadena
`empleado → empresa → registro patronal → proyecto → registro de obra` se
resuelve al leer, sin guardar un solo id nuevo. Es la Fase 6 del plan.

### Por qué aviso y no candado (G2)

El archivo de nómina dejó a Maquinaria CAMES con **144 personas repartidas en
cuatro registros patronales**: `R13-77767-10-5` (127), `H67-29973-10-5` (13),
`H68-39212-10-5` (2) y `Z61-14090-10-9` (2). Bloquear la asignación cuando el
registro de la persona no es el del proyecto haría inasignables a casi todos en
casi todas las obras, y el trabajo es legítimo: mover a alguien de registro es un
trámite ante el IMSS, no un error de captura.

Bloquear tampoco arreglaría el dato: sólo escondería el problema detrás de un 400. El aviso lo deja a la vista, con los dos números, y quien lo lee decide.

La asignación responde **201, no 4xx**, porque se hizo. El aviso viaja en
`data.avisos` y se repite en `message`, para que salga en la interfaz aunque el
front todavía no lea el campo nuevo.

### Tres estados, no dos: `null` no es `false`

`registroPatronalCoincide` vale `true`, `false` o `null`, y el tercero es
**«no se pudo comparar»**: la adscripción de esa persona no trae registro
patronal, cosa normal en quien se dio de alta a mano y no vino del archivo. Es la
misma convención de `rfcCoincide` en la importación (D-46), y por la misma razón:
«no coincide» y «no se sabe» llevan a acciones distintas —una es un trámite, la
otra es capturar un dato que falta— y colapsarlas en `false` haría que la
segunda se leyera como la primera.

Los dos casos avisan, con mensajes distintos. El de «no se pudo comprobar» se
incluyó a sabiendas de que hoy sale seguido: una adscripción sin registro patronal
es un dato incompleto, y callarlo lo perpetúa.

### La comparación ignora guiones, espacios y mayúsculas

`R13-77767-10-5`, `R13 77767 10 5` y `r13777671 05` **son el mismo registro**. Se
comparan sólo letras y dígitos, en mayúsculas. Sin eso, el aviso saldría en masa
por diferencias de tecleo y la gente aprendería a ignorarlo, que es la peor
manera de perder una advertencia.

Es una normalización **de comparación, no de almacenamiento**: el texto se guarda
tal como se capturó. La adscripción trae el registro como cadena libre (`B2` del
plan) y corregir eso es la Fase 7.

### La cadena se resuelve al leer

`GET /asignaciones/:id` es nuevo y devuelve `trazabilidad` con los cinco eslabones
resueltos. **No se persiste ningún id en la asignación** (plan §C5): desde ella ya
se llega a todo cruzando proyecto y adscripción, y duplicarlos crearía dos
verdades —corregir el registro patronal de la adscripción no actualizaría las
asignaciones ya hechas, y el dato quedaría mintiendo justo en el reporte para el
que existe.

Se lee **con sesión, sin capacidad propia**: mirar quién está en la obra no es lo
mismo que moverlo, igual que `GET /proyectos/:id/asignaciones`. El alcance no se
comprueba sobre la asignación sino sobre **su proyecto**, que es quien tiene
empresa; fuera de alcance responde 404.

### El aviso también en el listado, no sólo al asignar

El aviso del alta lo ve quien captura, una vez. Lo que RH necesita después es
abrir la obra y encontrar a los que cotizan en otro registro sin entrar uno por
uno, así que cada renglón de `GET /proyectos/:id/asignaciones` trae
`registroPatronalEmpleado` y `registroPatronalCoincide`. Cuesta **una consulta
más** a `affiliations` por listado, no una por renglón.

Esa consulta **no filtra por `activo`** a propósito: el listado incluye
asignaciones cerradas, y a esa gente se le pudo dar de baja de la empresa;
excluirlas dejaría el renglón histórico sin el dato que justo se quiere ver.

### `findRegistry` es una sola función para los dos registros

El registro patronal de la empresa y el de obra del cliente son el mismo
subdocumento `{ _id, numero, descripcion, activo }` y el front los pinta igual.
Estaban resueltos con un método privado de `projectService`; pasaron a
`utils/domain/registries.js` y ahora los usan los dos servicios. Dos copias de un
formateador de contrato son dos formatos que derivan.

## D-72 · La adscripción se vincula a su registro patronal

**Decisión.** `affiliations.registroPatronalId` apunta al catálogo de su empresa,
y el número deja de compararse como cadena suelta cuando el vínculo existe. Es la
Fase 7 del plan, la que el propio plan marcaba como opcional.

### El vínculo convive con el texto; no lo reemplaza

`condiciones.registroPatronal` **se queda**, y cada campo tiene su papel:

| Campo                          | Qué es                                  |
| ------------------------------ | --------------------------------------- |
| `registroPatronalId`           | el vínculo validado contra el catálogo  |
| `condiciones.registroPatronal` | lo que dijo el archivo de nómina, crudo |

Es el mismo reparto que ya existe entre `areas` (el dato modelado) y
`departamento` (el texto original del archivo, D-46). Borrar el texto perdería el
único rastro de lo que **no** resuelve —y el plan dice explícitamente que lo que
no resuelva se reporta y se queda nulo—, además de romper la comparación que el
importador usa para detectar cambios del archivo.

### El vínculo manda, pero la comparación no cambió

Lo que cambió es **de dónde sale el número**: si la adscripción está vinculada, el
número viene del catálogo de la empresa —canónico y garantizado a existir—; si no,
del texto. La comparación de D-71 sigue siendo la misma función sobre dos números.

Esto importa porque la fase es **gradual**: M3 deja en nulo lo que no resuelve, y
mientras haya adscripciones sin vincular las dos rutas tienen que dar un resultado
válido. Es la lección de D-68 y D-69 —un cambio de forma deja el sistema en dos
estados y los dos tienen que responder algo correcto—, aplicada por tercera vez.

Efecto secundario que sí se nota: una adscripción vinculada **siempre** coincide o
no coincide de forma exacta, porque los dos números salen del mismo arreglo. Los
falsos avisos por diferencias de tecleo desaparecen conforme se vincula la gente.

### El importador vincula, pero no crea registros patronales

Cruza el número del archivo contra el catálogo de la empresa, normalizado igual
que la comparación. Lo que no resuelve **se reporta con el número y a cuánta gente
afecta**, y se queda nulo.

No los crea, a propósito: dar de alta un registro patronal es del administrador de
plataforma (D-65), y crearlos desde un archivo saltaría ese permiso. La migración
M2 sí los creó, pero fue una corrida única, con `--dry-run` y una persona
mirando — no es lo mismo que una ruta que cualquier `rh_admin` puede disparar
subiendo un archivo.

El aviso dice qué hacer: agregar el registro y volver a importar. Y eso **funciona
de verdad**, que es la parte que costó: el vínculo se llena en `#aplicar`, junto al
snapshot, y no en `#aplicarAdscripcion`. Re-subir el mismo archivo produce filas
`sin_cambios`, que nunca llegan a `#aplicarAdscripcion`; ponerlo ahí habría hecho
que el aviso prometiera algo que no pasaba. Es exactamente el mismo motivo por el
que `#refrescarSnapshot` ya vivía ahí (D-57).

### Nunca pisa un vínculo que ya está

Ni el importador ni la migración sobrescriben un `registroPatronalId` existente:
los dos filtran por nulo. El archivo trae el número como texto, pero el vínculo es
una decisión que alguien pudo corregir desde `PATCH /adscripciones/:id`, y
deshacerla en silencio en cada importación sería el peor de los dos mundos.

Por eso tampoco está en `CAMPOS_ADSCRIPCION_AUTORITATIVOS`.

### `PATCH /adscripciones/:id` acepta `registroPatronalId`, y `null` desvincula

Sin una forma de corregirlo a mano, lo que M3 no resolviera se quedaría roto para
siempre. `null` o `''` desvinculan — el mismo razonamiento que llevó a agregar
`DELETE /contratos/:id/siroc` en D-70.

Se valida contra la empresa de **esa** adscripción, que no se puede cambiar: no
hay forma de acabar apuntando al catálogo de otra empresa.

### Sin índice, por ahora

`registroPatronalId` **no se indexó**. Ninguna consulta filtra por él: se escribe,
y se resuelve en memoria contra la empresa que ya está cargada. Un índice sobre él
sólo cargaría escrituras en la colección que más escribe el importador —145
renglones por archivo— a cambio de nada. Cuando exista «quién cotiza en este
registro patronal», el índice llega con esa consulta y con su
`npm run db:indices`.

### La regla de «es de esta empresa y está activo» ahora vive en un solo lugar

`companyService.assertRegistroPatronalUsable` la comparten el proyecto (D-67) y la
adscripción. Estaba duplicada como método privado de `projectService`; dos copias
habrían derivado —una aceptando un registro dado de baja y la otra no— y nadie lo
habría notado hasta ver los datos.

---

## D-73 · `tipo` sale del puesto y lo sustituye el área — DECIDIDO, SIN IMPLEMENTAR

> ⚠️ **Nada de esto está en el código todavía.** Se registra ahora para que
> nadie construya encima de `categorias.tipo` creyendo que se queda, y para que
> el front sepa que su selector «Aplica a» va de salida. Mientras no se
> implemente, **manda lo que dice D-59**: el campo existe, es obligatorio y el
> alta lo usa.

**Decisión.** `categorias.tipo` (`administrativo` / `mano_de_obra`) **deja de
existir**. Lo que hoy expresa el tipo pasa a expresarlo el **área**, que ya es un
catálogo administrable desde D-58.

### Qué lo destapó

El alta de un puesto en el front sigue pidiendo «Aplica a: Mano de obra /
Administrativo», y ese desplegable ya no debería estar: cuando las áreas dejaron
de ser un enum cerrado (D-58) y absorbieron el filtro de la tabla (D-59), el tipo
se quedó como el resto de una división que las áreas ya hacen mejor y con más
grano. «Administrativo» y «mano de obra» son dos cajones para nueve áreas.

### Esto revierte la mitad de D-59

D-59 **decidió conservar el campo**, y conviene ser explícito sobre qué de
aquel razonamiento sigue en pie y qué no:

| Argumento de D-59 para conservarlo                                 | Sigue valiendo                                                                     |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Filtra el desplegable de puestos (`GET /categorias?tipo=`)         | **No.** Lo hará el área: «Auxiliar contable» se ofrece en Contabilidad, no en Obra |
| **Decide quién puede gestionar a quién** (`canManageEmployeeType`) | **Sí, y es el problema sin resolver**                                              |

### Lo que hay que resolver antes de tocar código

`tipo` no es una etiqueta: es lo que hoy decide el permiso.
`canManageEmployeeType` (`src/utils/permissions.js`) manda a
`MANAGE_ADMIN_EMPLOYEES` o a `MANAGE_FIELD_EMPLOYEES` según el tipo del
empleado, y de ahí cuelga que `rh_consulta` y `jefe_area` den de alta personal de
obra pero no administrativos (modelo-datos §8.2). Con nueve áreas en lugar de dos
tipos, **la matriz de permisos hay que redefinirla**, y hay dos caminos:

1. **Marcar las áreas.** Cada área dice si su gente la gestiona cualquiera o sólo
   `rh_admin`. Es un campo nuevo en `areas` y conserva la matriz tal cual.
2. **Permisos por área.** El nivel de acceso declara qué áreas puede gestionar.
   Más fino y más cercano a `RUMBO.md`, pero rehace la matriz entera.

**No está decidido cuál**, y hasta que lo esté el cambio no se puede empezar: es
la parte que rompe seguridad si se improvisa.

### Alcance del cambio, para dimensionarlo

- `categorias.tipo`: fuera del esquema, del alta, de la edición y de `?tipo=`.
- `empleados.tipo`: se deriva de la categoría (D-59), así que se va con ella.
- `canManageEmployeeType` y la matriz de §8.2: rehacerlas según lo que se decida.
- El front: quitar «Aplica a» del alta de puestos, y el `tipo` de los renglones.
- Datos: las categorías existentes se quedan sin tipo; hay que decidir a qué área
  se mapea cada una, o si el puesto pasa a no declarar nada y el área la pone la
  adscripción.

### Lo que NO cambia

`tipoContrato` de la adscripción (`obra_determinada`, `indeterminado`…) no tiene
nada que ver con esto, pese al nombre parecido. Se queda igual.

## D-74 · `GET /version` es pública, y sólo dice qué commit corre

**Decisión.** Hay una ruta sin sesión que contesta qué versión está desplegada:

```json
{ "schemaVersion": 1, "service": "cames-api", "commit": "…40 hex", "builtAt": "…Z" }
```

Cuatro campos, y la construcción de la imagen **falla** si `CAMES_GIT_COMMIT` o
`CAMES_BUILD_TIME` faltan o vienen malformados.

**Por qué pública.** El momento en que hace falta es exactamente el momento en
que no hay sesión: acaba de desplegarse algo, el front ve un comportamiento
raro, y la pregunta es «¿qué quedó arriba?». Detrás de un login, la respuesta
llega tarde y por el canal equivocado. Es la misma razón por la que `/health`,
`/ready` y el inventario son públicos.

**Por qué sólo cuatro campos.** Una ruta de versión sin límite escrito se
convierte en un volcado de diagnóstico: primero `NODE_ENV`, luego la versión de
Node, luego «nada más el nombre del bucket». El límite es _identidad de release_:
qué código corre y desde cuándo. Nada de entorno, configuración, dependencias,
nombres de máquina ni valores de `env`. Hay una prueba que lo sostiene
(`tests/integracion/version.test.js`).

**Por qué `no-store`.** Es lo único que la ruta no puede permitirse: una
respuesta cacheada de esto afirma con toda seriedad que corre un commit que ya
no corre.

**El invariante, y hasta dónde llega.** En un **release** —cualquier imagen
construida, cualquier entorno desplegado— `commit` y `builtAt` nunca están
ausentes, malformados, en `"unknown"` ni en `null`. Los dos se hornean en la
imagen y el `Dockerfile` los valida con `grep -Eq`, así que una imagen sin ellos
no llega a existir.

**Fuera de un release, `null` es la respuesta correcta.** Correr `npm run dev` o
la suite sin metadatos de construcción es legítimo y nada lo impide: el
invariante es del artefacto desplegado, no del entorno de trabajo. Quien
desarrolla nunca tiene que fabricarse un commit para arrancar.

**Por qué se valida al construir y no al arrancar.** Validar al arrancar
convertiría un dato ausente en un ciclo de reinicios en producción; validar al
construir convierte el mismo error en una construcción que no sale.

**Por qué `null` y no `"unknown"`.** `null` dice «aquí no hay release», y sólo
puede verse fuera de uno. `"unknown"` se vería igual en un release mal
construido que en uno bien construido. Y dejar el campo en `undefined` lo
borraría del JSON: cambiaría la forma de la respuesta en vez de su valor, que es
el fallo más difícil de notar del lado de quien la consume.

**Efecto de lado.** El esquema de entorno se movió a `src/config/env.schema.js`,
sin efectos —ni dotenv, ni `process.env`, ni validación, ni `process.exit`— para
que se pueda LEER qué exige el backend sin dispararlo (`npm run env:requisitos`,
`scripts/printEnvRequirements.js`). `src/config/env.js` sigue haciendo todo lo
que hacía; sólo dejó de ser el único que sabe la forma.

**Estado.** La ruta existe y funciona. El `Dockerfile` que exige e inyecta
`CAMES_GIT_COMMIT` y `CAMES_BUILD_TIME` todavía no está commiteado, así que hoy
en producción los dos campos son `null`. Se activan cuando se adopte el camino
de despliegue guiado que vive en `cames-ops`.

---

## D-75 · La fase es un campo del contrato, aparte de su nombre

**Decisión.** El contrato tiene **dos etiquetas opcionales y distintas**:
`nombre`, cómo se llama el contrato ('Contrato 001-A'), y `fase`, el alias con el
que la obra lo nombra ('Fase 1', 'Cimentación'). Se mandan las dos en el alta, se
editan por `PATCH /contratos/:id`, y cualquiera de ellas se vacía mandando `""` o
`null` —vuelven a `null`, nunca a cadena vacía (regla 5).

**Contrato y fase siguen siendo la misma entidad** (G1, D-70). No hay colección
`phases`, ni un `faseId`, ni una tabla de unión: si cada fase tiene exactamente
un contrato, dos colecciones serían la misma fila partida en dos. Lo que cambió
no es el modelo, son los nombres: **son dos, no uno**.

**Por qué no bastó `nombre`.** Nació documentado como «la etiqueta de la fase», y
mientras la obra sólo decía «Fase 1» alcanzaba. Pero el contrato también tiene su
propio nombre —el que trae el papel firmado—, y con un solo campo quien captura
tenía que elegir cuál de los dos perdía, o meter los dos en una cadena
(`'Contrato 001-A — Fase 1'`) que después nadie puede volver a separar para
filtrar ni para agrupar.

**Por qué no se renombró `nombre` a `fase`.** Era la alternativa limpia, y se
descartó: el front ya manda y muestra `nombre`, y renombrarlo obliga a migrar los
contratos existentes y a coordinar el cambio en los dos lados para no romper lo
que hoy funciona. Agregar un campo opcional no rompe a nadie: los contratos
anteriores salen con `"fase": null`.

**Por qué `fase` no es único ni obligatorio.** Dos fases de proyectos distintos se
llaman «Fase 1» todo el tiempo, y dentro de un mismo proyecto el orden ya lo
lleva `numero`, que sí es único y lo asigna el servidor. Un índice único sobre
una etiqueta que la gente escribe a mano sólo produciría `409` en capturas
legítimas. Y obligatoria no puede ser: un proyecto de un solo contrato **no tiene
fases**, que es justo lo que dice G1.

**Qué NO cambió.** El SIROC, `numero`, `estado`, `activo` y los candados del
proyecto (G3) siguen igual. `fase` es una etiqueta: no traba nada, no deriva nada
y no entra en ninguna consulta de alcance.

---

## D-76 · El SIROC se actualiza cada dos meses, y el aviso se deriva

**Decisión.** El aviso de obra ante el IMSS **se refrenda cada dos meses
conservando el mismo número**. Lo único que se guarda es el hecho —qué día se
refrendó— en `siroc.actualizaciones: [{ fecha, nota }]`. Todo lo demás
—cuántas actualizaciones pide el contrato, cuántas lleva, cuándo cumple los dos
meses la ventana vigente y si ya urge— es `seguimientoSiroc`, **derivado en cada
lectura** (`src/utils/domain/siroc.js`) y presente en toda respuesta de contrato.

**Por qué una lista dentro del SIROC y no un SIROC por periodo.** Porque el
número no cambia: actualizarlo es refrendar el mismo aviso, no sacar otro. Un
documento por periodo obligaría a repetir el número —que es **único global**
(G4)— y el índice único lo rechazaría; relajar ese índice para permitirlo
destruiría la garantía que hace útil al SIROC. La renovación es una fecha más
dentro del aviso que ya existe.

**Por qué nada de esto se guarda calculado.** Es la regla #6, y aquí se ve por
qué: un `requiereActualizacion` guardado sería falso al día siguiente sin que
nadie tocara nada, y haría falta un job diario para mantenerlo. Derivado, el
aviso aparece solo al cumplirse los dos meses y **desaparece solo** el día que se
captura la renovación. No hay nada que marcar ni que apagar.

**Cuántas actualizaciones pide un contrato** son las ventanas de dos meses que
hacen falta para cubrir `fechaInicio → fechaFin`, **menos la primera**, que ya la
cubre el SIROC original. Un contrato de dos meses justos pide cero; uno de seis,
dos. Se responde desde el alta, antes de que exista el SIROC: la predicción sale
de las fechas que capturó el usuario, que es justo lo que pidió el cliente.

**La ventana corre desde la última actualización —o desde `fechaRegistro`—, no
desde el inicio del contrato.** Un SIROC tramitado un mes tarde vence un mes
tarde: contar desde `fechaInicio` pediría refrendos que el IMSS no exige todavía,
y quien captura dejaría de creerle a los avisos.

**`por_vencer` avisa; sólo `vencida` exige.** El umbral es `DIAS_ALERTA_SIROC`,
5 días por defecto —el trámite no es un clic— y es inclusivo: el día justo en que
se cumplen los dos meses todavía es `por_vencer`, y se vence al siguiente. Es la
misma convención que `documentStatus` (D-04), y romperla aquí habría dado dos
semáforos que se comportan distinto en la misma pantalla.

**Un contrato finalizado o dado de baja deja de pedir**, igual que uno cuya
ventana vigente ya cubre su `fechaFin`: el aviso acompaña a la obra, y pedir el
refrendo de una obra terminada sería ruido permanente en la bandeja. Desde D-84
también deja de pedir **el que pasó su `fechaFin`**, lo cierre alguien o no.

**~~Pero «la ventana cubre su `fechaFin`» sólo vale mientras el contrato siga
dentro de sus fechas.~~ REVERTIDO POR D-84.** Aquí se decidió que un contrato
pasado de su `fechaFin` y no finalizado **sigue pidiendo refrendos**, porque para
el IMSS la obra sigue abierta. Era una deducción nuestra, y el cliente contestó lo
contrario: **la fecha de fin es el techo del cálculo**, y lo que le falta a ese
contrato es que alguien lo cierre. Con la regla de aquí, toda obra terminada que
nadie cerró se quedaba en rojo para siempre. Ver **D-84** para lo que vale hoy,
incluida la desaparición del `actualizacionesRequeridas: 0` con
`actualizacionesPendientes: 1` que este párrafo justificaba.

**El aviso no tiene fecha final, y por eso no se captura.** `siroc.vigenciaHasta`
existió como campo opcional y fue un error: su vigencia son siempre dos meses
desde el registro —o desde la última actualización—, así que el dato ya se sabe.
Al pedirlo, quien capturaba tecleaba ahí la fecha de fin del contrato, y el
contrato quedaba mostrando una vigencia que el seguimiento no usaba y que lo
contradecía. Del aviso se capturan **su número y su fecha de registro**, y ya. El
campo se quita de los datos que ya existen con `npm run migrate:siroc-vigencia`;
`PUT /contratos/:id/siroc` lo **sigue aceptando y lo ignora**, para que el front
pueda quitarlo del formulario sin quedarse sin registrar SIROCs mientras tanto.

**Corregir el SIROC conserva sus actualizaciones** (`PUT`), porque son del mismo
aviso; quitarlo entero (`DELETE`) se las lleva. Y se puede deshacer **sólo la
última** actualización: una fecha mal tecleada corre la ventana y hace que el
contrato calle avisos que debería dar, mientras que borrar una de en medio
reescribiría la historia.

**Qué NO se hizo.** Estas alertas **no entran en `GET /alertas`**: esa bandeja es
de documentos y cumpleaños de personas, y el SIROC cuelga de un contrato. Meterlo
ahí pedía un `origen` nuevo y una entrada sin `empleadoId`, que es la llave con
la que el front agrupa toda esa pantalla. Si se quiere, se decide aparte.

---

## D-77 · El SIROC de la obra se ve en el expediente, y se deriva al leer

**Contexto.** Quien trabaja en una obra está cubierto por el aviso de obra
—el SIROC— de esa obra, y RH necesita verlo donde mira a la persona: en su
expediente. Hasta aquí, el SIROC sólo se veía desde el contrato.

**Decisión.** El detalle del expediente trae una llave `obras` con un renglón
por asignación activa, y en cada uno el proyecto, el contrato, su SIROC y el
`seguimientoSiroc` que ya calcula D-76.

**Vincular NO es guardar un id.** La cadena `empleado → asignación activa →
proyecto → contrato → siroc` ya está completa en la base: guardar el eslabón
final sería un dato derivado —contra la regla #6— y se desincronizaría en cuanto
alguien refrende el aviso o cierre una fase. Es el mismo criterio de D-71, que
resolvió la trazabilidad de la asignación sin guardar un solo id nuevo. Por eso
esta decisión **no cambia ningún esquema y no lleva migración**.

**Cuál de las fases cubre a la gente.** Un proyecto tiene varios contratos —sus
fases— y cada uno puede traer su propio aviso. La asignación apunta al proyecto,
no al contrato, así que hay que elegir:

1. El contrato cuya ventana `fechaInicio`–`fechaFin` **contiene el día de la
   consulta**, bordes incluidos. Si dos fases se traslapan, la que empezó después.
2. Si ninguno la contiene, **el último que estuvo activo** —el de `fechaFin` más
   reciente ya pasada, aunque esté `finalizado`—. La obra terminó, pero el aviso
   bajo el que trabajó esa persona sigue siendo un dato de su expediente, y
   dejarlo en blanco borraría eso.

Fuera quedan los contratos con `activo: false` (capturados por error o
cancelados, D-70) y los que están **enteros por delante**: ésos ni cubren hoy ni
cubrieron nunca a nadie, así que un proyecto donde sólo hay fases futuras no
aporta SIROC todavía.

La respuesta dice `vigente: true|false` para distinguir los dos casos, en vez de
dejar que el front lo deduzca comparando fechas con hoy. Misma razón por la que
`seguimientoSiroc` trae su `mensaje` ya escrito (D-25).

**Sólo en el detalle.** `GET /expedientes` —el listado paginado— no lo trae:
son dos consultas más por renglón y ese listado pagina de a 100. Si algún día
hace falta ahí, se resuelve en lote para toda la página, no por fila.

**Alcance.** Un proyecto de una empresa fuera de `empresasVisibles` no sale en
la lista y el expediente responde `200` igual. No hace falta capacidad nueva:
quien puede ver el expediente puede ver bajo qué aviso trabaja esa persona.

**Qué NO se hizo.** El renglón del empleado en `/empleados` sigue con
`asignaciones: []` —codificado vacío desde antes de esto—, y las alertas del
SIROC siguen sin aparecer en `GET /alertas`: las dos cosas van aparte.

---

## D-78 · Se aceptan Word, Excel y CSV, y el contrato dice qué se puede previsualizar

**Contexto.** Hasta aquí sólo se aceptaban PDF, JPG, PNG y WEBP, con un criterio
explícito: que cualquiera del equipo pudiera abrir lo que otro subió. En la
práctica el criterio dejaba fuera trabajo real —los registros de obra, los avisos
de SIROC y los contratos llegan en Word y en Excel—, y la consecuencia no era que
la gente convirtiera los archivos: era que no los subía.

**Decisión.** `utils/fileTypes.js` acepta además **DOC, DOCX, XLS, XLSX y CSV**,
y aplica **en todo el backend**, también en los documentos del expediente. La
detección sigue siendo **por contenido**:

- **DOCX y XLSX** son ZIP. Se distinguen buscando `word/document.xml` o
  `xl/workbook.xml` dentro del buffer: los nombres de las entradas viajan sin
  comprimir, así que no hay que descomprimir nada. Un `.zip` cualquiera **no**
  pasa.
- **DOC y XLS** comparten contenedor OLE2. Decide el nombre del flujo interno
  (`WordDocument` o `Workbook`, en UTF-16LE); la extensión sólo desempata cuando
  ninguno aparece.
- **CSV es la excepción y hay que decirlo**: es texto plano, no tiene firma que
  lo distinga de cualquier otro texto. Se exige que el nombre declare `.csv` **y**
  que el contenido sea texto de verdad (sin bytes de control, decodifica como
  UTF-8). Es el único tipo donde la extensión pesa, y se acepta porque lo que
  entra es texto y **nunca se sirve `inline`**.

**Lo que sustituye al criterio viejo: `previsualizable`.** Cada archivo devuelve
esa bandera en el contrato, y lo que no se previsualiza se firma **siempre como
`attachment`**, sin que el front tenga que pedirlo. Así el equipo sigue sin
toparse con un visor en blanco: un DOCX se descarga, y eso es una acción que la
interfaz puede ofrecer bien. HEIC sigue fuera —ahí no hay nada que descargar que
sirva— y el mensaje del `415` lo explica aparte.

**El mensaje del 415 se centralizó** en `mensajeTipoNoPermitido`: son nueve tipos
y enumerarlos a mano en cada servicio garantizaba que una lista se quedara vieja.

**Cómo se descarga.** Con el nombre del **dato**, no el del archivo original: el
registro de obra `OB-2026-0145` baja como `OB-2026-0145.pdf` y no como
`escaneo (2) final_v3.pdf`. Lo decidió el cliente en la tarea #13, y aplica a
todos los adjuntos administrativos (D-79). Los documentos del expediente
conservan su nombre original, que ahí sí es información.

**Sin migración**: los archivos que ya existen son PDF e imágenes, todos
previsualizables, y la bandera se deriva del `mime` guardado.

---

## D-79 · El registro de obra lleva su papel adjunto, y se reemplaza en vez de versionarse

**Contexto.** Tarea #13. El número del registro de obra es el dato, pero quien lo
captura tiene el documento escaneado en la mano y no tenía dónde ponerlo.

**Decisión.** `clients.registrosObra[]` gana un subdocumento `archivo`
—`models/attachmentSchema.js`, reutilizable por el SIROC y por el contrato—, y
las rutas de alta y edición del registro aceptan `multipart/form-data` con el
campo `archivo`, **opcional**. Las mismas rutas siguen aceptando `application/json`
sin archivo: multer deja pasar lo que no es multipart, así que el front no tiene
que cambiar lo que ya manda.

**Se reemplaza, no se versiona.** Al contrario del expediente, donde el
versionado es el requisito de trazabilidad: aquí el archivo es una copia del
papel que respalda un número, volver a escanearlo es la operación normal, y el
objeto anterior se borra de R2 en cuanto el nuevo quedó guardado. Se sube al
almacenamiento primero y a la base después —si la base falla se limpia el objeto
recién subido—, y el anterior se borra al final, cuando ya nadie lo referencia.

**`claveAlmacenamiento` NO va `select: false`,** al revés que en el expediente
(D-41). El motivo es la forma de guardar: un cliente se escribe entero cada vez
que se toca cualquiera de sus registros, así que un campo no cargado se guardaría
vacío y el archivo quedaría inalcanzable. Lo que impide que la clave se filtre es
el `toJSON`, que enumera campos uno por uno y nunca la incluye — y hay prueba.

**Sólo el de obra.** `findRegistry` resuelve los dos registros —el patronal de la
empresa y el de obra del cliente— con la misma forma, y ahí `archivo` es la única
asimetría: se pide con `{ conArchivo: true }` y sin eso la llave **no aparece**.
Devolverla siempre habría metido un `archivo: null` en el registro patronal, que
es un cambio de contrato que nadie pidió.

**El enlace se deriva al leer**, como todo lo demás (regla #6): cada lugar que
devuelve un registro de obra —el cliente, su listado, el detalle del proyecto y
la cadena de la asignación— trae `archivo.url` firmada a 10 minutos. Firmar es
cómputo local, no una llamada a R2, así que hacerlo por renglón no cuesta una
petición. Y como caduca, `GET /clientes/:id/registros-obra/:roId/archivo` emite
uno fresco sin recargar el cliente entero.

**Subir con un número que ya existía guarda el archivo en ese registro.** El alta
es idempotente por número (D-66); descartar el archivo en silencio porque el
número ya estaba sería la peor de las dos salidas.

**Permisos.** Adjuntar y reemplazar exige administrar clientes (`rh_admin` o
`jefe_area`), lo mismo que el registro. **Abrirlo sólo pide sesión y alcance**:
quien puede leer el número puede ver el papel que lo respalda. Fuera de alcance, 404.

**Sin migración**: campo nuevo y opcional; los registros que ya existen quedan
con `archivo: null`.

**Qué NO se hizo.** No hay forma de **quitar** el archivo dejando el registro sin
él —no se pidió—, ni bitácora de accesos como la del expediente: el registro de
obra no es un dato personal.

## D-80 · El SIROC lleva su aviso escaneado, y cada renovación su propio acuse

**Contexto.** Tarea #15. El SIROC se captura como número y fecha (D-76), pero
quien lo registra tiene el aviso del IMSS en la mano, y cada dos meses vuelve del
IMSS con **otro papel**: el acuse del refrendo.

**Decisión.** Dos adjuntos, no uno. `contracts.siroc.archivo` es el aviso
original y `contracts.siroc.actualizaciones[].archivo` el acuse de esa renovación
concreta, los dos con el `attachmentSchema` de D-79 y los dos **opcionales**.
`PUT /contratos/:id/siroc` y `POST /contratos/:id/siroc/actualizaciones` aceptan
`multipart/form-data` con el campo `archivo`; las dos siguen aceptando
`application/json` sin archivo, así que lo que el front ya manda no cambia.

**Por qué separados y no uno que se reemplaza.** Refrendar el aviso no sustituye
al anterior: el número es el mismo (D-76) pero el papel es nuevo, y lo que se
enseña si el IMSS revisa es la **serie completa** de acuses. Un solo archivo que
el refrendo pisara borraría justo la prueba de que se estuvo refrendando.

**Corregir el aviso no tira ningún papel.** `PUT /siroc` reemplaza el SIROC
entero, así que hay que decir explícitamente qué sobrevive: sobreviven las
renovaciones —ya lo hacían (D-76)— **y ahora también los archivos**, el del aviso
y el de cada acuse. Sólo se reemplaza el del aviso si la petición trae uno nuevo,
y entonces el anterior se borra de R2. Corregir un dígito mal tecleado no puede
costar el escaneo.

**Quitar se lleva el papel.** `DELETE /siroc` borra de R2 el aviso y todos sus
acuses —nada los referenciaría después—, y
`DELETE /siroc/actualizaciones/ultima` borra el suyo y sólo el suyo.

**El acuse se puede poner después, y por eso hay un `PUT` aparte.** El papel
sellado casi siempre llega días después de ir al IMSS, así que capturar el
refrendo y adjuntar su acuse son dos momentos distintos —seis veces al año por
obra—. Sin una ruta propia, la única salida era **deshacer la actualización y
volver a capturarla** con el papel, y eso mueve la ventana de dos meses y con ella
todos los avisos de vencimiento: el arreglo lo pagaba el semáforo.
`PUT /contratos/:id/siroc/actualizaciones/:indice/archivo` toca **sólo el
archivo**, sirve para cualquiera de las renovaciones —las de en medio no se podían
tocar de ninguna manera— y **no exige que el contrato siga en curso**, porque el
acuse tardío es justamente el caso. Es `PUT` y no `POST` porque el recurso es el
archivo de esa posición y esto lo reemplaza entero; comparte camino con el `GET`
que ya lo lee.

**Las renovaciones se direccionan por posición, no por id.** No tienen `_id`
(D-76) y dárselo ahora obligaría a migrar las que ya están capturadas —y mientras
tanto Mongoose les inventaría uno distinto en cada lectura—, así que el acuse de
la renovación `n` se pide como
`GET /contratos/:id/siroc/actualizaciones/:indice/archivo`. El índice es estable:
el arreglo sólo crece y sólo se puede quitar la última.

**Dónde sale el enlace.** Donde ya salía el SIROC: en todos los contratos del
proyecto y en las **obras del expediente** de quien está asignado a ellas (D-77).
Firmado a 10 minutos y derivado al leer (regla #6); `GET /contratos/:id/siroc/archivo`
emite uno fresco sin recargar el proyecto entero.

**El nombre de descarga es el del dato** (D-78): el aviso baja como
`<número de SIROC>.pdf` y cada acuse como
`<número de SIROC>-actualizacion-<fecha>.pdf`, para que en la carpeta de
descargas se distingan solos.

**Claves en R2.** Todo lo del aviso de un contrato cuelga de
`siroc/{contratoId}/`: `aviso-{uuid}.{ext}` y `actualizacion-{uuid}.{ext}`.

**Permisos.** Adjuntar exige gestionar proyectos, lo mismo que capturar el SIROC.
**Abrir el papel sólo pide sesión y alcance**: quien puede leer el número del
aviso puede ver el aviso. Fuera de alcance, 404.

**Sin migración**: campos nuevos y opcionales; los SIROC que ya existen quedan con
`archivo: null`, y sus renovaciones también.

**Qué NO se hizo.** No hay forma de **quitar** un archivo dejando el SIROC sin él
—no se pidió—. Tampoco un `PUT /siroc/archivo` simétrico para el aviso: reenviar
`PUT /siroc` con el número y la fecha que ya tiene lo resuelve —el 409 excluye al
propio contrato— y el front ya lo hace así. El límite de subida era de 10 MB; lo subió
la tarea #17 (D-81), y el aviso escaneado se benefició de paso.

## D-81 · El contrato lleva su papel, y el tope de subida sube para todos menos la nómina

**Contexto.** Tarea #17. El contrato firmado es el documento que respalda todo lo
demás —fechas, fases, SIROC—, y no tenía dónde ponerse. Y venía con un segundo
problema: el front avisó que sus contratos rebotaban, porque un contrato de obra
escaneado pasa de 20 MB con facilidad y el tope eran 10.

**Qué limitaba de verdad.** Sólo multer, con `MAX_UPLOAD_BYTES`. Se revisó lo
demás antes de tocar nada: el `express.json`/`urlencoded` de 1 MB **no ve el
multipart** —ese cuerpo lo lee multer—, Fly no impone tope de cuerpo y R2 admite
muchísimo más. Un solo número, en un solo sitio.

**El tope sube a 30 MB, y la importación de nómina se queda en 10.** Subirlo
parejo era lo simple —y es lo que quiere el front, que valida del lado del
navegador con una constante—, pero las dos rutas de `/empleados/importar` comen
del mismo middleware y ahí el archivo grande no es un archivo grande: `exceljs`
abre el libro entero en memoria y lo expande a objetos, así que un `.xlsx` de
30 MB —que es un ZIP— se convierte en cientos de MB de estructuras, contra los
512 MB de la VM (`fly.toml`). Y nadie lo necesita: un reporte de nómina real pesa
cientos de KB. Así que `recibirArchivo` se factorizó en `crearReceptor(maxBytes)`,
el general quedó en `MAX_UPLOAD_BYTES` (30 MB) y la importación en
`MAX_IMPORT_UPLOAD_BYTES` (10 MB), con su propio `recibirArchivoHasta`. El `413`
dice **el tope que aplicó en esa ruta**, no una cifra global que sería mentira en
la mitad de los casos.

De paso lo ganan el expediente, el registro de obra y el aviso del SIROC, que
compartían el tope viejo. El otro riesgo del tope alto —memoria: multer guarda en
RAM y `Buffer.concat` pica al doble— sale sobrado con 30 MB: son ~60 MB de pico
por subida en vuelo sobre los ~80 MB de base de Node.

**El archivo del contrato es UNO y se reemplaza**, al revés que el del SIROC
(D-80), que son dos porque cada refrendo produce papel nuevo. Aquí no: el
contrato firmado es uno, volver a escanearlo es la operación normal, y vale el
criterio de D-79 —subir a R2 primero, base después, y el anterior se borra cuando
la base ya no lo referencia—.

**Se adjunta con el `PATCH` de siempre, sin ruta nueva.** `POST
/proyectos/:id/contratos` lo acepta al capturar, y `PATCH /contratos/:id` acepta
`multipart` con **sólo** el archivo y ningún campo — eso último es lo importante:
las fechas se teclean el día que se firma y el escaneo llega después, así que
adjuntarlo tarde es el caso normal, no la excepción. Es la lección de la #15, que
tuvo que reabrirse para agregar justo esa ruta al acuse del refrendo. La
validación de edición dejó de exigir cuerpo cuando viene un archivo; con cuerpo
vacío **y** sin archivo sigue siendo `400`.

**El id del contrato se genera antes de escribirlo.** La clave en R2 cuelga de él
(`contratos/{contratoId}/contrato-{uuid}.{ext}`) y el papel se sube antes que la
base, así que al alta se crea el `ObjectId` a mano y se le pasa a `Contract.create`.
Los reintentos por choque de número reutilizan el mismo id: lo que choca es el
ordinal, no el documento.

**El nombre de descarga es el del dato** (D-78), pero aquí el dato no es un
número: `nombre` y `fase` son los dos opcionales (D-75). Se cae al que haya y, si
no hay ninguno, al ordinal —`Contrato 2.pdf`—, que siempre existe.

**Dónde sale el enlace.** Donde ya salía el contrato: en el listado del proyecto,
en cada respuesta que devuelve un contrato y en las **obras del expediente**
(D-77), junto al SIROC que ya iba ahí. Firmado a 10 minutos y derivado al leer
(regla #6); `GET /contratos/:id/archivo` emite uno fresco sin recargar el
proyecto.

**Permisos.** Adjuntar y reemplazar exige gestionar proyectos, lo mismo que
capturar el contrato. **Abrir el papel sólo pide sesión y alcance.** Fuera de
alcance, 404.

**Sin migración**: campo nuevo y opcional; los contratos que ya existen quedan con
`archivo: null`.

**Qué NO se hizo.** No hay forma de **quitar** el archivo dejando el contrato sin
él —no se pidió, y reemplazarlo cubre el error de captura—. Tampoco se versiona,
por lo mismo que en D-79.

---

## D-82 · El proyecto ya no habilita puestos, y a la obra va quien haga falta

**Contexto.** Tarea #20. Un proyecto guardaba `categorias`: el subconjunto del
catálogo de puestos con el que se podía trabajar en esa obra. Era obligatorio
—sin al menos uno el proyecto no nacía— y el alta lo pedía como una parrilla de
23 casillas, que es lo primero que se ve al crear un proyecto.

**Qué hacía de verdad.** Dos cosas, y sólo dos: `GET /proyectos/:id/asignables`
filtraba a la gente cuya categoría base estuviera habilitada, y `POST
/proyectos/:id/asignaciones` devolvía `400` cuando no lo estaba. Nada más colgaba
de ahí: ni el expediente, ni el checklist, ni las alertas, ni los contratos.

**Decisión.** El campo desaparece del proyecto: del esquema, del alta, de la
edición y de la respuesta. Con él se van las dos reglas y la ruta `POST
/proyectos/:id/categorias/clonar`, que existía sólo para copiar esa lista de un
proyecto a otro.

**Por qué.** La lista prometía un control que la operación no quiere: a una obra
va quien haga falta el día que hace falta, y quién pertenece a la empresa lo dice
la **adscripción**, que es el dato que sí se mantiene al día porque sale de la
nómina. El puesto habilitado era una segunda lista que había que recordar
actualizar para poder asignar a alguien, y cuando estorbaba se agregaba la
categoría al vuelo, así que no filtraba nada: sólo añadía un paso. La regla que
importa —no poner en una obra de Empresa 1 a alguien que no trabaja para Empresa
1— la impone la adscripción y se queda intacta, igual que el alcance del jefe de
área, que sigue viendo sólo a su gente.

**La asignación conserva su `categoriaId`.** Es cosa distinta: el puesto con el
que esa persona figura **en esa obra**, y es lo que la tabla de personal muestra.
Lo que cambia es que ya no se valida contra una lista del proyecto, y que el
campo pasa a ser **opcional en el alta**: si no viene, se guarda el de la propia
persona, que en `empleados` es obligatorio. El front actual lo manda —lo saca del
mismo selector de asignables— y sigue funcionando sin tocar nada.

**Consecuencia visible.** El selector de asignables ahora incluye a **todo** el
personal adscrito y activo de la empresa, administrativos incluidos, y también a
quien consulta si está adscrito ahí. Es lo pedido: cualquier empleado de la
empresa se puede asignar al proyecto.

**Migración.** `npm run migrate:categorias-proyecto` hace `$unset` del campo en
los proyectos que ya existen. No es urgente —el esquema ya no lo lee, así que un
proyecto viejo con la lista guardada se edita y se finaliza igual—, pero sin
correrla el campo se queda de basura en la colección y reaparece el día que
alguien mire la base cruda. Las asignaciones **no se tocan**.

**Qué NO se hizo.** No se tocó el catálogo de `categorias`, que sigue siendo el
puesto de cada persona en `empleados` y en cada asignación. Y no se dejó la ruta
de clonar respondiendo `410`, como se hizo con `/usuarios`: aquella la llamaba un
front en producción que no podía migrar de inmediato; ésta la limpia la tarea #21
en la misma entrega, así que un `410` habría sido código muerto desde el día uno.

---

## D-83 · El archivo sube directo al almacenamiento; el servidor sólo da permiso y registra

**Contexto.** Tarea #22. Subir un contrato de 12 MB a producción **nunca
terminaba**. La causa no estaba en el código: el archivo viajaba del navegador a
Fly y de ahí a R2, y ese primer tramo iba a 7 KB/s. Medido, con el mismo archivo
y el mismo servidor:

| Camino                                           | Subida           |
| ------------------------------------------------ | ---------------- |
| Del equipo a Cloudflare                          | 1 046 000 B/s    |
| Del equipo a la máquina, por túnel WireGuard     | 927 000 B/s      |
| Del equipo a la máquina, por `cames-api.fly.dev` | 7 000–17 000 B/s |
| Lo mismo desde otra red y otro operador          | 15 271 B/s       |

No era el navegador (`curl` fallaba igual), ni HTTP/2, ni IPv6, ni el proveedor
de internet, ni la máquina: por el túnel el archivo entero subía en 13 segundos.
Era el borde público de Fly, sólo de subida. A 7 KB/s, 12 MB tardan media hora y
Node corta la petición a los cinco minutos con un `408`.

**Decisión.** El archivo deja de pasar por el servidor. `POST /subidas` emite una
**URL firmada de un solo uso** contra R2; el navegador sube ahí —a Cloudflare,
donde ya medimos 1 MB/s—; y después llama a la **ruta de siempre** con
`subidaId` en el cuerpo, que es la que registra el adjunto. Vale para los cinco
destinos: expediente, contrato, aviso del SIROC, acuse de un refrendo y registro
de obra.

**Por qué no esperar a que Fly arregle su ruta.** Hay que abrirles el ticket, y
se abrió. Pero mientras el archivo pase por nuestro servidor dependemos de que
ese camino esté bueno, y hoy el tráfico de México entra por Virginia sin que
nadie nos avise. Esto quita la dependencia entera, no este mal día.

**Se confirma por la ruta del recurso, no por una ruta nueva.** `PATCH
/contratos/:id` con `{ subidaId }` hace lo mismo que con `multipart`. Así las
reglas de negocio —versiones del expediente, vigencias, el candado del SIROC, el
reemplazo del papel— se quedan donde estaban, con sus permisos y sus mensajes, y
el front migra cambiando el cuerpo de peticiones que ya hace. **Las rutas
`multipart` siguen funcionando**: se apagarán cuando el front no las use.

**Lo que sostiene que esto no reste seguridad.** El bucket sigue privado y sin
URL pública. El permiso se emite **después** de comprobar capacidad y alcance con
las mismas reglas de la ruta que confirmará —incluido el 404 de siempre, para que
pedirlo no revele lo que la confirmación escondería—. La URL vale para **una
clave, un método y quince minutos**, y **el tamaño va firmado**: subir algo más
grande invalida la firma, que es lo que sustituye al tope de multer. Y la
validación por contenido no se pierde: al confirmar se piden a R2 los **primeros
4 KB** del objeto para reconocer su firma —ese tramo es el rápido, cuesta
milisegundos— antes de registrar nada.

**El archivo aterriza en `pendientes/` y de ahí se mueve.** Nada llega a
`expedientes/`, `contratos/`, `siroc/` o `registros-obra/` sin haber pasado la
comprobación de tipo. Lo que no se confirma no existe para el sistema: nadie
puede pedirlo, porque cada apertura sigue pasando por una firma nuestra. Eso deja
toda la basura posible bajo un solo prefijo, que es lo que sabe barrer
`npm run limpiar:subidas` —y, si se configura, una regla de ciclo de vida de R2—.

**El permiso es un documento, no un token firmado.** Colección `uploads`, corta
de vida. Un JWT habría evitado la colección, pero **de un solo uso** exige
estado: sin él, el mismo permiso valdría hasta caducar. Guarda además quién pidió
subir qué, que es rastro útil el día que sobre un archivo en el bucket.

**Lo declarado no se cree.** El nombre, el tipo y el tamaño que manda el
navegador se guardan para mostrarlos y para firmar, pero al confirmar se
comparan contra el objeto real: tamaño distinto → `400`; contenido de un tipo no
permitido → `415`, y el objeto se borra ahí mismo junto con su permiso.

**Prerrequisito que no es código.** El bucket necesita política **CORS** para el
origen del front, con `PUT`. Se configuró el 2 sep 2026 en Cloudflare
(`https://cames-expedientes.fly.dev` y `http://localhost:5174`). Sin eso el
navegador no puede subir, y no hay nada en este repo que lo arregle.

**`GET` no se abrió en esa política, a propósito.** El front abre los archivos
**navegando** a la URL firmada (`window.open`), y una navegación no dispara CORS.
Haría falta el día que quiera leer el archivo con `fetch` para pintarlo dentro de
la página.

**Qué NO se hizo.** La **importación de nómina** se queda por `multipart`: ahí el
servidor no guarda el archivo, lo **lee** —`exceljs` abre el libro entero—, así
que sacarlo del camino no ahorra nada y complicaría la única ruta con un tope
distinto (D-81). Tampoco se subieron los archivos por partes (_multipart upload_
de S3): con 30 MB de tope, una sola petición basta.

---

## D-84 · La fecha de fin del contrato es el techo del SIROC, y el contrato sin cerrar se señala por lo que es

**Contexto.** Un contrato de obra del 1 de enero al 2 de mayo pide su aviso y dos
actualizaciones. Se capturan las dos, la obra se acaba y **nadie entra a marcarlo
como finalizado** — que es lo normal: nadie corre a cerrar papeles. El 2 de julio
se cumplen dos meses del último refrendo y el contrato aparece en rojo pidiendo
una tercera, con «venció hace 62 días». Si alguien la registra para quitarse el
rojo de encima, dos meses después pide una cuarta, y así indefinidamente. El
contador quedaba además diciendo «3 actualizaciones, 2 previstas».

Esto **revierte un párrafo de D-76**, el que decía que un contrato pasado de
fecha «sigue en curso para el IMSS y su aviso vence igual». Era una deducción
nuestra y no era la del cliente: Urbacames dice que la fecha de fin del contrato
es el límite del cálculo. Es también la respuesta a la segunda pregunta que
`propuestas/2026-09-01-backend-siroc-registro-tardio.md` dejó abierta. La
primera —desde dónde se predice cuando el SIROC se tramita tarde— **sigue
abierta**: aquí no se toca.

**Decisión 1: pasada `fechaFin`, el SIROC no acumula refrendos nuevos — pero el
techo corta la cuenta, no la borra.** La cuenta de pendientes termina en
`fechaFin`; lo que quede por debajo de ese techo es deuda de cuando el contrato
seguía en curso y **se sigue debiendo**. Dos salidas, según esa cuenta:

- **Queda deuda** (`actualizacionesPendientes > 0`): `estado: 'vencida'`,
  `requiereActualizacion: true`, los pendientes que faltaron hasta `fechaFin` y
  el mensaje «El SIROC requiere actualización desde el AAAA-MM-DD: venció hace N
  días, con el contrato todavía en curso. Regístrala con la fecha en que se
  presentó, a más tardar el AAAA-MM-DD.». Al capturarla con fecha de entonces la
  ventana rebasa el fin, la cuenta da cero y el contrato queda en paz solo.
- **No queda deuda**: `estado: 'no_requiere'`, `actualizacionesPendientes: 0`,
  `requiereActualizacion: false` y `diasParaActualizacion: null`, con el mensaje
  «El contrato terminó el AAAA-MM-DD: su SIROC ya no requiere actualizaciones.».

`vigenciaPeriodoHasta` **sí se sigue diciendo** en los dos casos: hasta dónde
llegó el aviso es un hecho del expediente. El día justo de `fechaFin` todavía
cuenta como dentro, como todos los bordes del proyecto (D-04).

La primera versión de esta decisión respondía `no_requiere` pasada la fecha
**sin mirar la cuenta**, y el front lo cazó al consumirla (revisión del 3 sept):
deshacer el último refrendo de un contrato ya terminado lo hacía desaparecer —«Sin
refrendos pendientes · 1/2»— cuando ese refrendo se debía antes de que el
contrato acabara. «No acumula _más_» no es «no debe nada».

**Por qué no basta con taparlo en la pantalla.** El front puede dejar de ofrecer
el botón, pero el servidor seguía diciendo «vencido» y seguía aceptando el
registro por API, así que las **obras del expediente** (D-77) daban la misma
alarma equivocada en la ficha de una persona. Y sin tope en el servidor nada
limitaba cuántos refrendos se le podían colgar a un contrato. La serie de acuses
del SIROC es lo que se enseña en una revisión del IMSS: si el sistema pide
refrendos que la obra no necesitaba, alguien los captura para apagar el rojo y
esa historia deja de corresponder con lo que de verdad se tramitó.

**Decisión 2: registrar una actualización de más se rechaza**, con
`400` y un mensaje que dice qué hacer: «El contrato terminó el AAAA-MM-DD y su
SIROC ya no requiere actualizaciones: finaliza el contrato, o corrige su fecha de
fin si la obra sigue». Se mira la fecha **de la actualización** y no el día de
hoy: capturar tarde un refrendo que sí se tramitó dentro del contrato es lo
normal —el papel llega después— y eso tiene que seguir entrando. Es también
**la única forma de pagar la deuda** de la decisión 1: con fecha de entonces, a
más tardar `fechaFin`; sin fecha se asume hoy y el `400` la rechaza.

**Decisión 3: `actualizacionesPendientes` se cuenta desde el aviso, no desde la
predicción.** Era `requeridas − registradas`, con un `Math.max(…, 1)` encima para
que «vencida» no saliera junto a «0 pendientes». Ahora son las ventanas de dos
meses que faltan **de `vigenciaPeriodoHasta` a `fechaFin`**, y como
`vigenciaPeriodoHasta` ya incorpora cada refrendo presentado, la contradicción
desaparece sola en vez de parchearse: se llega al estado `vencida` sólo si la
ventana no alcanza el fin, y entonces hay 1 o más pendientes por construcción.

De paso, **`no_requiere` ya nunca viene con pendientes**. Un contrato finalizado
o dado de baja decía «no requiere» y «2 pendientes» a la vez, porque la cuenta
vieja se colaba desde la predicción; ahora las tres razones de `no_requiere`
—cerrado, pasado de fecha sin deuda, o la ventana cubre el fin— responden `0`.
Y **sin SIROC**, un contrato sigue debiendo lo que sus fechas preveían aunque ya
haya pasado la fecha —la predicción ya terminaba en `fechaFin`—; sólo cerrarlo
lo apaga.

Es también lo que hace que **mover las fechas recalcule solo**, que es lo que más
va a pasar porque las obras se alargan y se recortan:

| Se edita `fechaFin`   | Qué pasa                                                   |
| --------------------- | ---------------------------------------------------------- |
| Se aplaza             | Vuelve a pedir, **desde donde va el aviso**, no desde cero |
| Se recorta            | Deja de pedir lo que los refrendos ya alcanzan a cubrir    |
| Se recorta por debajo | 0 pendientes, sin números negativos y sin borrar nada      |

**`actualizacionesRequeridas` se queda como está**: la predicción que sale de las
fechas del contrato, respondida desde el alta y antes de que exista el SIROC. Al
recortar la fecha puede quedar **por debajo de `actualizacionesRegistradas`**, y
eso **no es un error ni una cuenta rota**: esos avisos se presentaron de verdad
ante el IMSS y no se borran. Se dicen los dos números como lo que son —lo que hay
y lo que las fechas preveían— sin pintarlo como una falta.

**Decisión 4: el cabo suelto se señala por su nombre, en `seguimientoContrato`.**
Un contrato que pasó su fecha y sigue abierto **sí es un pendiente**, sólo que no
del SIROC. Callarlo del todo dejaría en verde una ficha que nadie revisó;
señalarlo con el aviso del SIROC es lo que se hacía y es lo que estaba mal. Así
que va aparte, derivado al leer como todo (regla #6), en toda respuesta de
contrato:

```json
{
  "estado": "terminado_sin_cerrar",
  "diasDesdeFin": 61,
  "requiereCierre": true,
  "mensaje": "Este contrato terminó el 2026-05-02 hace 61 días y sigue abierto: finalízalo, o corrige su fecha de fin si la obra sigue."
}
```

`estado` es uno de `por_iniciar`, `en_curso`, `terminado_sin_cerrar`,
`finalizado` y `baja`. La **baja manda sobre las fechas** (D-70): un contrato
capturado por error no es uno que haya que cerrar. `diasDesdeFin` es un hecho y
se dice esté cerrado o no; `requiereCierre` sólo es `true` en
`terminado_sin_cerrar`, que es la única fila que pide acción.

**Por qué `no_requiere` y no un estado nuevo del SIROC.** `ESTADOS_SIROC` es un
enum del contrato que el front compara con igualdad estricta: agregarle un valor
obliga a manejarlo en todos lados para no romperse, y el significado ya existía
—no hay nada que actualizar—. El rojo, cuando toca, lo pone `seguimientoContrato`.

**Sin migración.** Todo esto se deriva al leer: no hay un solo dato guardado que
cambie de forma, y el mismo contrato responde distinto mañana sin que nadie corra
nada.

**Qué NO se hizo.** `seguimientoContrato` **no se agrega a las obras del
expediente** (`GET /expedientes/:id/obras`, D-77): ahí se consulta bajo qué aviso
trabajó alguien, y un «cierra este contrato» es ruido en la ficha de una persona
—además, `vigente: false` ya dice que la obra pasó—. Tampoco se tocó `GET
/alertas`: el SIROC nunca entró en esa bandeja (D-76), así que no había nada que
apagar ahí.

---

## D-85 · Tres rangos de fechas que fija Urbacames: el refrendo espera, el SIROC va pegado al inicio y el contrato cabe en el proyecto

**Contexto.** Al probar la tarea #27 el front registró el SIROC y su
actualización **el mismo día** y el servidor lo aceptó: la ventana de dos meses
se corrió sin que el IMSS hubiera pedido nada. De la misma revisión salieron
otros dos huecos: el aviso se podía fechar en cualquier día y el contrato en
cualquier fecha, dentro o fuera de su proyecto. Urbacames fijó los tres rangos.
Entró con la #28 a pedido del usuario, no como tarea aparte.

**Regla 1: un refrendo no se fecha antes de un mes y 25 días del movimiento
anterior** —el registro del aviso, o la última actualización—. La cuenta es
`addMonths(base, 1)` más 25 días: mismo día del mes siguiente, recortado a fin
de mes, con **la misma aritmética que la vigencia**, para que las dos puntas den
el mismo día (1 ene → 26 feb; 31 ene → 28 feb → 25 mar). Son cinco días antes de
que venza, que es cuando el seguimiento ya marca `por_vencer`. El `400` dice
desde qué día sí: «El SIROC se registró el AAAA-MM-DD: la siguiente actualización
no puede fecharse antes del AAAA-MM-DD».

**Regla 2: `fechaRegistro` del SIROC cae entre `contrato.fechaInicio` y siete
días después**, los dos incluidos: el aviso se presenta al arrancar la obra. El
`400` dice el rango. De paso **deja casi sin objeto la decisión abierta #19 de
`ESTADO.md`** —desde dónde se predice cuando el SIROC se tramita tarde—: con
siete días de holgura, la predicción desde `fechaInicio` y el vencimiento desde
`fechaRegistro` ya no pueden describir calendarios distintos.

**Regla 3: las fechas del contrato caben en las del proyecto**, de
`proyecto.fechaInicio` a `fechaFinReal ?? fechaFinEstimada`, bordes incluidos.
Dos `400` distintos, uno por punta, cada uno con la fecha del proyecto que lo
acota.

**Se comprueban en el servicio, no en el esquema, y sólo sobre lo que entra.**
Es la parte que importa: **lo ya capturado no se toca**. Una invariante en
`contractModel` habría reprobado al guardar cualquier contrato viejo con fechas
fuera de rango —al cambiarle el nombre, al adjuntarle el papel—, y una migración
para «arreglarlos» reescribiría fechas que alguien capturó a conciencia. Así que:

- El refrendo mínimo se mira **sólo sobre el que se registra**; los que ya están
  se quedan como están, aunque vayan pegados.
- `fechaRegistro` se revisa **sólo si cambia**: corregir el número de un SIROC
  viejo reenvía la misma fecha, y eso pasa.
- En el `PATCH` del contrato se revisan **sólo las fechas que vienen**: mover la
  de fin no reprueba la de inicio si es anterior a la regla.

**Sin migración**, por lo mismo.

**Qué NO se hizo.** No se movieron las fechas de los proyectos: si un proyecto
se acorta después, sus contratos no se reprueban solos —lo ya capturado— y nada
avisa. Si hace falta, es una alerta aparte.

---

## D-86 · La maquinaria es un catálogo por empresa, su imagen es sólo imagen, y la escribe quien gestiona proyectos

**Contexto.** Urbacames pidió (3 sept 2026) un catálogo de **maquinaria y
equipo de trabajo** por empresa, con la idea de asignar cada máquina a un
trabajador y que quede en la obra donde él está. La tarea #30 es el catálogo;
la asignación (#31) y las incidencias (#34) vienen después. Detalle en
`cames-ops/plan/propuestas/2026-09-03-maquinaria.md`.

**Es por empresa, no del grupo.** Los cuatro catálogos que ya existen —clientes,
categorías, áreas, empleados— son compartidos porque la persona es global y
puede estar en dos empresas (D-32). La máquina no: está en el patio de una
empresa, y el número con el que la conocen sólo tiene sentido dentro de ella. Por
eso `machines.empresaId` es obligatorio, el listado y el alta cuelgan de
`/empresas/:id/maquinas`, y el alcance es el de la empresa: fuera de él la
máquina no existe (404). Ni siquiera hay un `GET /maquinas` global: no hay
pantalla que lo necesite y sería un listado sin dueño.

**Tres datos y nada más.** `identificador`, `modelo` e `imagen`. Es lo que
pidieron y es lo que cabe en la primera pantalla; marca, tipo, serie y los
papeles de la máquina entran después como campos nuevos. Lo que **no** va a
entrar en esta colección es dónde está o quién la tiene: eso es la asignación
(#31), que toma la obra de la asignación del trabajador y se resuelve al leer.
Un `empleadoId` aquí sería un derivado guardado (regla #6).

**El identificador es único dentro de la empresa** y se compara sobre su forma
normalizada —sin acentos, sin mayúsculas, espacios colapsados— con el mismo
`normalize` de los nombres. Se guarda además tal como lo tecleó quien la dio de
alta. Chocar responde `409 MAQUINA_DUPLICADA` con `data.maquina`, la que ya está,
para que el front pueda abrirla desde el aviso, igual que hace con el proyecto
duplicado. Entre empresas sí se repite: cada una puede tener su `ECO-12`.

**La imagen es el adjunto de siempre con una restricción nueva.** Reutiliza
`attachmentSchema`, `attachmentIntake` y las dos formas de subir —`multipart` y
subida directa, con el destino `maquina` (D-83)—, se reemplaza y no se versiona
(D-79), y baja con el nombre del dato (`ECO-12.png`, D-78). La diferencia:
**sólo admite JPG, PNG y WEBP.** Los demás adjuntos aceptan Office y PDF porque
son papeles; ésta es una foto para reconocer la máquina, y un PDF ahí no es un
formato raro, es un error. `attachmentIntake` ganó `soloImagenes`, que rechaza
con 415 **después** de reconocer el tipo —el mensaje dice qué llegó— y, en la
subida directa, borra el objeto y el permiso como con cualquier tipo no
permitido.

**Escribe quien gestiona proyectos.** No hay capacidad nueva: la maquinaria es
de la obra, y quien decide qué obra existe y qué contratos tiene decide también
qué máquinas hay. `MANAGE_PROJECTS` la tienen `rh_admin` y `jefe_area`;
`rh_consulta` consulta. Lee cualquiera con sesión y alcance, sin capacidad:
igual que los contratos.

**Sin paginar.** El catálogo más grande del grupo cabe en una pantalla y la
pantalla lo quiere entero para buscar en él; se ordena por identificador con
orden natural (`ECO-2` antes que `ECO-10`). Si alguna empresa pasa de unos
cientos, se pagina entonces con los mismos `pagina`/`porPagina` de los demás.

**Sin migración.** La colección nace vacía.

**Qué NO se hizo.** No se agregó el conteo de máquinas a los `conteos` de
`GET /empresas`: nadie lo pidió y la tarjeta de empresa no lo pinta. Y no se
decidió qué pasa con la máquina cuando el trabajador sale de la obra: es de la
#31. **La propuesta decía «se libera sola» y NO fue lo que se decidió**: ver
D-87.

---

## D-87 · La máquina va a la obra del trabajador, y cuando él se va pierde a la persona, no la obra

**Contexto.** Tarea #31, 3 sept 2026, continuación de D-86. Una máquina se le
asigna a un trabajador y con eso queda en la obra donde él está; hay que poder
responder quién la tiene, qué máquinas hay en cada obra, y cuánto tiempo la ha
usado cada quien. La propuesta está en
`cames-ops/plan/propuestas/2026-09-03-maquinaria.md`.

**La obra no se captura: sale de la asignación del trabajador.** Es la regla que
pidió Urbacames y la que decide todo lo demás. `POST /maquinas/:id/asignacion`
recibe `empleadoId`; el servidor busca las asignaciones activas de esa persona en
proyectos **de la empresa de la máquina** y toma de ahí la obra. `proyectoId` en
el cuerpo **sólo desempata** cuando hay varias, y tiene que ser una de las suyas:
nunca decide por su cuenta, igual que `empresaId` nunca decide alcance. Si está
en varias y no lo mandan, la respuesta es `400 OBRA_REQUERIDA` **con la lista de
obras** en `data.obras`, para que la pantalla pregunte en vez de adivinar; si no
está en ninguna, 400 diciendo que hay que asignarlo a la obra primero.

La alternativa —capturar la obra aparte— se descartó por lo que permite: una
máquina en una obra donde su operador no está, que es justo lo que el pedido
prohíbe. El `asignacionId` queda guardado como trazabilidad de **de dónde salió**
esa obra.

**Una colección nueva, `machine_assignments`, y el trabajador es anulable.** Un
tramo es «esta máquina, en esta obra, con esta persona, entre estas dos fechas».
El campo que parece un detalle y es la decisión entera: **`empleadoId` puede ser
`null`**, y eso significa «en la obra, sin trabajador». Sin ese estado no se
podría cumplir la regla de abajo.

**La máquina pierde al trabajador, no la obra.** Es la corrección explícita de
Urbacames sobre la propuesta, que decía que la máquina «se libera sola» y vuelve
al patio. No: cuando al operador lo dan de baja (`PATCH /empleados/:id/estado`) o
sale de la obra (`PATCH /asignaciones/:id/salida`), el tramo se cierra
—`baja_de_trabajador` o `salida_de_obra`— y **se abre otro en la misma obra con
`empleadoId: null`**, dentro de la misma transacción. Una excavadora no vuelve al
patio porque su operador ya no esté; sigue ahí hasta que alguien la mueva. Las
dos respuestas devuelven `maquinasLiberadas` y lo dicen en su `message`, porque
quien cierra la asignación es quien puede hacer algo al respecto, en ese momento.

Sacarla de la obra es **una decisión a mano**: `POST /maquinas/:id/devolucion` la
regresa al patio, o se le asigna a otra persona. Ese «a mano» es el punto: el
sistema no adivina dónde acabó la máquina.

**La excepción es la baja de la máquina.** `PATCH /maquinas/:id/estado` con
`activo: false` **sí** cierra el tramo del todo (`baja_de_maquina`) y no abre
otro: una máquina fuera de servicio no está en ninguna obra ni con nadie. Se
consideró bloquear la baja hasta devolverla; se descartó porque obliga a un
trámite para registrar algo que ya pasó, y el motivo del cierre deja el rastro
igual.

**Una máquina con una sola persona a la vez, impuesto por la base.** Índice único
**parcial** `{ maquinaId }` sobre `activo: true`, el mismo patrón de
`assignments`: permite el histórico —muchos tramos cerrados de la misma máquina—
e impide dos vigentes. Asignarla a otra persona cierra el tramo anterior con
`reasignacion` y lo devuelve en `liberada`, con el aviso para mostrar. Al revés
no hay límite: una persona puede traer varias máquinas.

**Los días se calculan al leer** (`utils/domain/machineTime.js`, regla #6). Cada
tramo dice cuántos días duró y el vigente **cuenta hasta hoy**, así que crece
solo y no hay nada que cerrar para saber cuánto va. Son **días naturales
inclusivos** —entregada y devuelta el mismo día es 1 día, no 0—, que es como los
cuenta quien renta maquinaria; y el día del cambio de manos lo cuentan los dos
trabajadores, porque ese día la tuvieron ambos. `porTrabajador` suma por persona,
de más a menos días, y los tramos sin trabajador aparecen en la historia pero **no
le suman días a nadie**.

**La máquina sigue sin guardar dónde está.** `asignacion` viaja en todas las
respuestas de máquinas y se resuelve con una sola consulta por listado; en
`machines` no se guardó ni `empleadoId` ni `proyectoId`. Hay una prueba que lo
comprueba: dos verdades sobre dónde está una máquina se desincronizan siempre, y
la que se quedaría vieja es la de la máquina.

**Sin migración.** La colección nace vacía y ningún dato existente cambia de
forma.

**Qué NO se hizo.** No se toca la máquina cuando el **proyecto** se finaliza: las
máquinas se quedan en la obra terminada hasta que alguien las devuelva, y sí se
impide llevar una máquina nueva a un proyecto finalizado. No hay listado global
de tramos ni filtro por rango de fechas: la historia se pide por máquina. Y no
hay conteo de máquinas en `GET /proyectos` ni en `GET /empresas`; si la pantalla
lo quiere, se agrega.

---

## D-88 · Las incidencias de la máquina, con un catálogo de tipos del grupo y el trabajador derivado de la historia

**Contexto.** Tarea #34, 3 sept 2026, tercera de la cadena de maquinaria (D-86,
D-87). A una máquina se le levantan incidencias —una falla, un golpe, un
servicio— de un tipo elegido de una lista que ellos alimentan, con una
descripción y la fecha en que sucedió; se resuelven poniéndoles la fecha en que
se atendieron. La propuesta está en
`cames-ops/plan/propuestas/2026-09-03-maquinaria.md` § incidencias.

**El catálogo de tipos es del grupo, no de cada empresa.** Es la decisión que
pedía la tarea. Una «falla hidráulica» es la misma en Maquinaria CAMES que en
Urbanizadora, y partir la lista por empresa obligaría a alimentar dos veces lo
mismo para después no poder sumar los reportes. Va con los otros catálogos
compartidos —clientes, categorías, áreas—, en su propia colección
`incident_types`, con `nombre` único sobre la forma normalizada.

**Lo escribe quien gestiona proyectos, y no exige `alcanceGlobal`.** Ésta sí es
una desviación consciente de la regla «los catálogos compartidos exigen
alcanceGlobal» de `CLAUDE.md`. El motivo es de uso, no de arquitectura: el tipo
se agrega en el momento de capturar una incidencia que no encaja en ninguno —«una
incidencia sin tipo es señal de que falta un tipo, no de que sobra la
incidencia»—, y quien está ahí es quien gestiona la obra, no el administrador de
plataforma. Pedirle que abra un ticket para poder capturar una falla habría
terminado en un tipo cajón de sastre. La capacidad es `manageProjects`, la misma
de la máquina y del proyecto: `rh_admin` y `jefe_area` escriben, `rh_consulta`
consulta.

**Dar de baja un tipo en uso SÍ se permite** — a diferencia de las categorías y
las áreas, donde se bloquea. Ahí la baja dejaría a una persona con un puesto o un
área que ya no existe; aquí no deja nada inconsistente: la incidencia vieja
conserva su tipo por id, lo sigue mostrando y sale con `tipo.activo: false` para
que la pantalla lo pueda señalar. Bloquearla obligaría a arrastrar para siempre
un tipo mal capturado. Los sembrados (`esBase`) no se dan de baja, como en los
demás catálogos.

**El tipo se referencia, nunca se copia.** Renombrarlo corrige el nombre en toda
la historia —que es lo que se espera de una corrección de ortografía— y darlo de
baja no toca lo ya capturado. Copiar el nombre en la incidencia habría roto las
dos cosas a la vez: los nombres viejos se quedarían mal escritos y no habría
forma de reagrupar.

**Quién tenía la máquina y en qué obra NO se guarda: se deriva al leer.** Es la
decisión de fondo. `machine_incidents` sólo sabe de qué máquina es y qué día pasó;
el trabajador y la obra salen de cruzar `fechaIncidencia` con los tramos de
`machine_assignments` de esa máquina (`utils/domain/machineIncidents.js`, funciones
puras, regla #6). Una incidencia capturada hoy sobre algo que pasó hace un mes
señala a quien la traía **hace un mes**, no a quien la trae ahora; y si mañana se
corrige la historia, las incidencias viejas dejan de mentir solas. Guardar un
`empleadoId` al capturar habría sido teclear dos veces lo mismo, con la copia
condenada a quedarse vieja.

Tres desenlaces posibles, y los tres son información: con trabajador y obra; **en
la obra pero sin operador** (`empleadoId: null`, el estado que deja D-87); o
`sinAsignar: true`, la máquina estaba en el patio. El `contexto` viaja además con
un `texto` ya armado para mostrar. **El día del cambio de manos lo cubren dos
tramos** —ese día la tuvieron los dos— y la incidencia se le atribuye a **quien la
recibió**: es quien la tenía al final del día.

**`fechaResolucion: null` es el estado «abierta».** No hay bandera aparte que
pueda contradecirlo, igual que `activo` no decide si un tramo está vigente por su
cuenta. `abierta` y `dias` —lo que lleva abierta, o lo que tardó en cerrarse— se
derivan al leer con la misma cuenta de días naturales inclusivos de D-87. La fecha
de la incidencia puede ser **de días atrás pero nunca del futuro**: se captura
cuando se entera quien captura. Una incidencia ya resuelta no se vuelve a
resolver (`409 INCIDENCIA_YA_RESUELTA`) y **no hay reapertura**: si se resolvió
mal, se levanta otra, que es lo que de verdad pasó.

**Se puede levantar una incidencia sobre una máquina dada de baja**, al revés que
asignarla. Muchas veces la incidencia es justo el motivo de la baja y se captura
después de darla; prohibirlo sólo lograría que no se capturara.

**Los contadores no se filtran.** `GET /maquinas/:id/incidencias?estado=` filtra
la lista, pero `abiertas` y `resueltas` van siempre del total: la pantalla tiene
que poder decir «2 abiertas» mientras el usuario mira las resueltas.

**Siete tipos base, sembrados al arrancar** (`services/seedIncidentTypes.js`, y a
mano con `npm run seed:tipos-incidencia`). Sin tipos no se puede levantar ninguna
incidencia, así que una base recién creada tiene que traer con qué empezar. Es
idempotente y **no deshace un renombre**, igual que la semilla de áreas.

**Sin migración.** Las dos colecciones nacen vacías y ningún dato existente cambia
de forma.

**Qué NO se hizo.** No se guarda **quién** levantó ni quién resolvió la incidencia
—no se pidió, y agregarlo después no rompe nada—. No se puede editar ni reabrir
una incidencia ya levantada. No hay listado global de incidencias ni filtro por
tipo o por rango de fechas: se piden por máquina. `GET /maquinas/:id` **no** trae
un contador de incidencias abiertas: la ficha las pide aparte, y si la pantalla lo
quiere en el listado del catálogo, se agrega. Y las incidencias no entran a
`GET /alertas`: la bandeja es de documentación y cumpleaños (D-47).

---

## D-89 · El refrendo del SIROC se llama «reporte bimestral», pero las llaves no cambian

**Contexto.** Tarea #38, 3 sept 2026, a pedido de Urbacames. Lo que el código
llama «actualización» del SIROC ellos lo llaman **reporte bimestral**: es el
nombre del trámite ante el IMSS, y en pantalla decir «actualización» hace pensar
en corregir un dato, no en presentar un papel cada dos meses. El front cambia sus
etiquetas en la tarea #37; esto es la otra mitad, la de los textos que salen de
aquí.

**Qué cambió.** Los ~25 mensajes en español que ve el usuario. Los cuatro estados
del seguimiento (`utils/domain/siroc.js`), los mensajes de validación del modelo y
de las rutas, y los errores y confirmaciones de registrar, deshacer, adjuntar y
abrir el acuse. «El SIROC está al día. La próxima actualización toca el X» pasó a
«…El próximo reporte bimestral toca el X»; «Esa actualización del SIROC no
existe» a «Ese reporte bimestral del SIROC no existe», y así.

Cambió también **el nombre con el que baja el acuse**:
`<número>-actualizacion-<fecha>.pdf` pasó a `<número>-reporte-bimestral-<fecha>.pdf`
(D-80 documentó el anterior). Ese nombre **se arma al leer** y no es la clave de
almacenamiento, así que los acuses que ya estaban en R2 bajan con el nombre nuevo
sin tocar un solo objeto. La clave sigue siendo `siroc/{contratoId}/actualizacion-{uuid}.{ext}`:
renombrarla habría obligado a mover archivos para no ganar nada, porque nadie la ve.

**Qué NO cambió, y es la mitad de la decisión.** Las llaves de la respuesta
—`siroc.actualizaciones[]`, `actualizacionesRequeridas`, `actualizacionesRegistradas`,
`actualizacionesPendientes`, `ultimaActualizacion`, `requiereActualizacion`—, la
ruta `POST /contratos/:id/siroc/actualizaciones` y el destino de subida
`siroc-actualizacion`. Son **contrato con el front**: renombrarlas rompe la
pantalla el mismo día, obliga a un cambio coordinado en los dos repos y a
reescribir cada documento, y el usuario no gana nada porque **nunca ve una
llave**. El vocabulario del negocio vive en el texto; el del código, en las
llaves, y ésa es la misma separación de idiomas que rige todo el proyecto
(`CLAUDE.md` § Idiomas).

Si algún día se quieren renombrar de verdad, es otra tarea: una sola, coordinada,
con el front migrando a la vez y las dos formas conviviendo un tiempo.

**Los mensajes de log no cambiaron.** No los ve el usuario, y son lo que uno
busca en Fly cuando algo falla: dejarlos con la palabra vieja mantiene rastreable
todo lo que ya está escrito en los registros de producción.

**«Registro inicial» se quedó igual.** El primer movimiento no es un reporte
bimestral: es el alta del aviso de obra. Lo confirmó Urbacames en la misma
petición.

**Sin migración.** No se guardó nunca ninguno de estos textos: se arman al leer.

## D-90 · El contrato con monto, su historia de modificaciones, y eliminarlo

**Contexto.** Tarea #39, 3 sept 2026, a pedido de Urbacames
(`cames-ops/plan/propuestas/2026-09-03-contratos-modificaciones.md`). Tres cosas
que llegaron juntas porque se estorbaban entre sí: el contrato no guardaba
**cuánto se va a cobrar**; lo que se repacta con el cliente —aplazó la obra,
cambió el precio, se anexaron requerimientos— no tenía dónde quedar; y lo único
que había para corregir era **editar**, que se confundía con modificar y borraba
lo anterior sin dejar rastro.

### El monto

Un solo número, en pesos y **con el IVA incluido**: no se desglosa subtotal ni
impuesto, porque lo que se firma y lo que se cobra es la cifra completa
(decisión del usuario, 3 sept). Es **obligatorio al dar de alta**.

Y aun así el esquema **no lo declara `required`**. Los contratos capturados antes
de esto no lo tienen, y un `required` en el modelo haría fallar cualquier
`save()` sobre ellos —registrar su SIROC, finalizarlos, darlos de baja— por un
dato que nadie les pidió el día que se capturaron. La obligación vive en la
validación del alta, que es donde de verdad aplica. `null` es «no se capturó» y
**no es lo mismo que `0`**, que es una cifra que alguien tecleó: por eso no se
inventó un cero al migrar, y por eso no hay migración.

### La modificación, y por qué el contrato sigue teniendo una sola verdad

Cada modificación trae **fechas y monto nuevos** y **su propio convenio
escaneado**, más el motivo y la `fechaAcuerdo` —el día en que se firmó, que casi
nunca es hoy—. Desde que se registra, lo que vale es lo nuevo.

Lo que se guarda es esto: `modificaciones[]` con lo pactado en cada una,
`original` con los términos del alta —`null` mientras no haya ninguna—, y **los
campos del contrato pisados con los vigentes**. La alternativa era dejar
`fechaInicio`/`fechaFin`/`monto` congelados en lo original y hacer que todo el
mundo mirara la última modificación; se descartó porque el techo del SIROC
(D-84), las obras del expediente (D-77), los candados del proyecto (G3) y el
listado leen esos campos desde hace meses, y cada uno de ellos habría tenido que
aprender qué es una modificación para seguir respondiendo lo mismo. Con esta
forma **ninguno se enteró**: hay una verdad vigente y su pasado, no dos versiones
compitiendo.

`historia` —la línea del tiempo que sale en la respuesta— **se deriva al leer**
(regla #6) y dice `modificado: false` con `entradas: []` cuando no hubo ninguna:
un contrato que se cumplió como se pactó no tiene historia que mostrar, **y lo
dice él**, para que la pantalla no tenga que deducirlo de un arreglo vacío. La
última entrada lleva `vigente: true` y sus valores son exactamente los campos del
contrato.

**El convenio es opcional al capturar**, como el acuse del reporte bimestral
(D-80) y por la misma razón: el papel firmado llega días después que el acuerdo,
y exigirlo obligaría a no capturar nada mientras tanto. Se adjunta luego con
`PUT /contratos/:id/modificaciones/:indice/archivo`, que toca **sólo el
archivo**. El papel del contrato original **no se toca nunca**: sigue en
`contrato.archivo`, y los dos se abren.

**Se deshace sólo la última**, como en los refrendos: el contrato vuelve a los
términos de la anterior o, si era la única, a los del alta, y entonces se queda
otra vez sin historia. Borrar una de en medio dejaría al contrato con términos
que nadie pactó.

**No se modifica un contrato finalizado ni uno dado de baja.** Lo que se repacta
se repacta sobre algo vivo; el mensaje dice cuál de las dos salidas destraba cada
caso, porque reabrir no es reactivar y desde fuera no se adivina.

### Editar desaparece, eliminar aparece

`PATCH /contratos/:id` responde **410**, no 404, y dice en qué tres se repartió:
`POST /modificaciones` para repactar, `PUT /archivo` para el papel —que antes
viajaba justamente en ese `PATCH` (D-81), y sin ruta propia se habría quedado sin
salida—, y `DELETE` para recapturar. 404 diría «esto nunca existió»; lo que pasó
es que se movió, y el front lo descubre en la primera llamada. Corregir el
`nombre` o la `fase` también pasa por eliminar y volver a capturar: son datos del
alta, no algo que se repacte.

**Eliminar borra de verdad**, y es lo único en todo el modelo que lo hace: el
documento, su SIROC, sus reportes bimestrales, sus modificaciones y **todos sus
objetos de R2**. Se puede eliminar un contrato que ya tiene todo cargado —es
justo el caso que lo motiva: se capturó en el proyecto equivocado y hay que
rehacerlo—. La respuesta dice qué se llevó, que es con lo que la pantalla
confirma y advierte.

Libera **los dos números**. El del SIROC es único en todo el sistema (G4): sin
esto, un aviso capturado en el contrato equivocado dejaba ese número muerto para
siempre y no había forma de registrarlo donde iba. Y el del contrato dentro del
proyecto: `#siguienteNumero` pasó de «el último más uno» al **hueco libre más
bajo**, porque quien elimina para recapturar espera recuperar su número, no el
siguiente. Los **dados de baja siguen ocupando el suyo** —existen— y eso no
cambió.

Lo puede quien gestiona proyectos (`manageProjects`: `rh_admin` y `jefe_area`),
la misma capacidad que da de alta un contrato — decisión del usuario, 3 sept.
`rh_consulta` no. **No pide nada más**: la confirmación explícita es de la
pantalla, y meterle una segunda llave a la API no habría evitado el error que
esto viene a arreglar.

**La baja se quedó igual.** `activo: false` es un contrato que existió y se
canceló: sigue en la historia del proyecto y se reactiva. La diferencia con
eliminar la explica la pantalla; aquí son dos rutas distintas a propósito, como
`finalizar` y la baja lo son desde D-70.

**Sin migración.** Los contratos que ya existen leen `monto: null`,
`modificaciones: []` e `historia: { modificado: false, entradas: [] }` sin tocar
un solo documento.

## D-91 · El reporte bimestral dice cuánto y de qué bimestre, y sigue sin editarse

**Contexto.** Tarea #42, 3 sept 2026, a pedido de Urbacames
(`cames-ops/plan/propuestas/2026-09-03-reporte-bimestral-con-monto-y-bimestre.md`).
Un reporte bimestral del SIROC guardaba tres cosas —la fecha en que se presentó,
una nota libre y el acuse escaneado (D-76, D-80)— y le faltaban dos que sí están
en el papel: **el monto al que hace referencia ese bimestre** y **de qué bimestre
es**.

### Dos montos que conviven y no se miran

`contrato.monto` es el total de la obra, IVA incluido (D-90);
`siroc.actualizaciones[n].monto` es la cifra de esos dos meses. Son números
distintos, en el mismo documento, y ninguno se deriva del otro: nadie dijo que la
suma de los bimestres tenga que dar el total del contrato —una obra se repacta
(D-90), se aplaza, se recorta—, así que **no se cuadran ni se comparan**. Se
guardan los dos y se enseñan los dos.

El del reporte **no es obligatorio**, al revés que el del contrato, y por la
misma razón que el acuse es opcional (D-80): del IMSS se vuelve con la fecha en
el momento y el papel con la cifra llega después. Exigirlo obligaría a no
capturar nada mientras tanto, que es justo lo que se quiso evitar entonces.

`null` es «no se capturó» y **no es lo mismo que `0`**, que sería un bimestre
reportado en ceros — la misma distinción de D-90 y por lo mismo. En el servicio
eso es un `??` y no un `||`: con `||`, un cero tecleado se habría guardado como
«sin dato». Los reportes anteriores a esto salen todos en `null` y **no hay
migración**: no hay cifra que inventarles, y una inventada sería peor que ninguna.

### El bimestre es texto, aunque a veces sea un número

Se guarda **tal como se teclea**: `'3'`, `'2026-3'`, `'mayo-junio'`. Quien
captura lo nombra como venga en el papel y el papel no obliga a una forma.

Podría haber sido un número —el bimestre del año, de 1 a 6— y se descartó: se
habría perdido el año en `'2026-3'` y habría que rechazar `'mayo-junio'`, que es
como lo dice media oficina. Un tipo mixto tampoco: obligaría al front a mirar de
qué tipo llegó cada uno. Así que **es `String` siempre**, y un número que llegue
en el JSON se convierte a cadena en la validación, para que la respuesta tenga
una sola forma. El único límite es que quepa en 40 caracteres.

### Se sigue sin poder editar un reporte

**No se agregó ninguna ruta para corregirlos** — decisión del usuario, 3 sept. Un
reporte mal capturado se deshace con `DELETE …/siroc/actualizaciones/ultima` y se
vuelve a registrar, que es exactamente lo que ya se hacía con una fecha
equivocada. Una ruta de edición habría sido la cuarta forma de tocar un refrendo
—capturarlo, deshacerlo, ponerle el acuse— y la única que puede cambiar una fecha
sin que se note que la ventana de dos meses se movió.

Lo que sí implica, y la pantalla tiene que decirlo (tarea #43): **sólo se deshace
el último**, así que corregir uno de en medio obliga a deshacer los que vinieron
después y recapturarlos con sus acuses. Deshacer y recapturar mueve la ventana
mientras tanto, pero al volver a poner la misma fecha vuelve a donde estaba.

Como corolario, `PUT …/siroc/actualizaciones/:indice/archivo` sigue tocando
**sólo el archivo**: ni la fecha, ni la nota, ni el monto, ni el bimestre.

### Lo que había que no romper

Corregir el número del aviso con `PUT /siroc` reconstruye a mano el arreglo de
refrendos —es la forma de conservarlos cuando cambia el número (D-76)— y copiaba
sólo fecha, nota y archivo. Sin tocar eso, **corregir un dedazo del número habría
borrado el monto y el bimestre de todos sus reportes**, en silencio. Ahora los
copia también, y hay una prueba que lo fija.

## D-92 · Un permiso por sección, y ver también es un permiso

**Contexto.** Tarea #44, 4 sept 2026, a pedido de Urbacames
(`cames-ops/plan/propuestas/2026-09-04-usuarios-con-permisos-por-seccion.md`).
Se pidió poder crear más usuarios que los tres perfiles de RH que existen
—contador, auxiliar de operaciones, los cuatro de Finanzas— y marcar al crearlos
a qué secciones entra cada uno. Se revisaron seis perfiles contra el código y
**tres eran imposibles**, cada uno por un motivo distinto. Esta decisión resuelve
los dos primeros; el tercero —que los roles sean dato y no código— es la #45.

### Ver no era un permiso, y esconder el menú no protege nada

Ocho de las trece secciones **no comprobaban nada para leerse**: proyectos,
contratos, SIROC, maquinaria, incidencias, clientes, empresas y el personal de la
obra las veía cualquiera con sesión, dentro de sus empresas. Así que «el contador
no entra a maquinaria» no se podía decir: no había permiso que apagar, y
esconderlo del menú no lo protege porque la dirección sigue respondiendo.

Ahora cada sección tiene su `viewX`. Son nueve casillas nuevas —`viewProjects`,
`viewProjectStaff`, `viewContracts`, `viewSiroc`, `viewMachines`,
`viewMachineIncidents`, `viewClients`, `viewCompanies`, más `viewAffiliations`—
y dos que se separaron de `viewEmployees`: **`viewRecords` y `viewAlerts`**. Esas
dos son las que hacen armable al auxiliar de operaciones, que ve los datos
generales de una persona **pero no su expediente**.

### Un solo permiso abría seis secciones

`manageProjects` autorizaba, además de los proyectos, **los contratos, el SIROC,
el catálogo de maquinaria, la asignación de máquinas, las incidencias y el
catálogo de tipos**. Por eso el auxiliar de operaciones —que maneja maquinaria
pero no edita proyectos— no se podía armar: quien podía lo uno podía lo otro,
forzosamente. Y el contador que ve maquinaria pero no levanta incidencias,
tampoco.

Se partió en siete: `manageProjects` se queda **sólo con la obra**, y salen
`manageContracts`, `manageSiroc`, `manageMachines`, `assignMachines`,
`manageMachineIncidents` y `manageIncidentTypes`. Por lo mismo,
`manageWorkRegistries` sale de `manageClients` y `manageEmployerRegistries` de
`manageCompanies`. Y `importEmployees` reemplaza al par
`MANAGE_AFFILIATIONS` + `MANAGE_ADMIN_EMPLOYEES` que se exigía junto: una casilla
es una casilla, y un rol no se arma marcando dos cosas que juntas significan una
tercera.

Son **40 casillas en diez secciones**, y el reparto está en `modelo-datos.md`
§8.2, que una prueba compara celda por celda contra el código.

### Nadie ganó ni perdió nada, y hay una prueba que lo sostiene

Era la condición de la tarea: partir los permisos **sin cambiarle el
comportamiento a nadie**. La regla que se siguió es mecánica y no admite criterio:

- Una casilla que **sale de otra** hereda su fila **con el valor exacto**, `'global'`
  y `'own_area'` incluidos. `manageEmployerRegistries` sigue exigiendo
  administrador de plataforma porque `manageCompanies` lo exigía.
- Una casilla de **ver una sección que se leía libre** nace en `true` para los
  tres niveles. Apagársela a alguien sería quitarle algo que hoy tiene.
- `importEmployees` responde lo que respondían **las dos juntas**: sólo
  `rh_admin`.

`tests/unitarias/permissionsParity.test.js` **congela la matriz anterior entera**
—los 20 × 3 valores escritos a mano— y el mapa de qué casilla heredó de cuál, y
falla si una sola respuesta se movió. No se reescribe para que pase: si falla,
o se rompió la paridad, o alguien decidió cambiar permisos y esa decisión se
escribe aquí primero.

Y `tests/unitarias/routeGuards.test.js` recorre el router y comprueba que
**ninguna ruta se quedó sin casilla**, con una lista corta de excepciones que
llevan escrito el motivo. Para eso `requireCapability` cuelga la capacidad de la
función que devuelve: se puede leer desde fuera qué exige cada ruta, en vez de
abrir los veinte archivos de rutas uno por uno.

### Sin permiso es 403, no 404

El 404 sigue reservado a lo que queda **fuera del alcance** de empresa o de área
(regla #7 del contrato). «No puedes hacer esto» y «esto no es tuyo» son dos
respuestas distintas a propósito: mezclarlas dejaría al front sin saber si
esconder el botón o la sección entera. Hoy además nadie puede toparse con ese 403
en las secciones nuevas, porque los tres niveles nacen con todas las casillas de
ver.

El 404 por sección apagada es otra cosa y es de la #48: ahí se apaga un **módulo
para toda una empresa**, y un módulo que su empresa no usa efectivamente no
existe. Son dos ejes distintos —el permiso es de la persona, el módulo es de la
empresa— y se componen.

### Lo que NO se tocó

- **Las áreas y las categorías se siguen leyendo con sólo tener sesión.** Llenan
  los desplegables de todos los formularios; pedirles una casilla habría roto
  media plataforma para proteger dos listas de nombres. Escribirlas sigue
  exigiendo administrador de plataforma.
- **Los catálogos del grupo se quedan como estaban** (decisión 8 del 4 sept):
  clientes y empleados bastan con el permiso; empresas, puestos y áreas siguen
  exigiendo `alcanceGlobal`.
- **El alcance no se tocó.** Quién ve los datos de qué empresa y de qué área se
  sigue derivando de las adscripciones, y `'own_area'` sigue colgando de
  `viewEmployees`: es la casilla que consultan `scopeMiddleware` y
  `employeeService`. Las demás la llevan porque describen la verdad, no porque
  filtren por su cuenta.
- **El nivel de acceso sigue siendo el de siempre.** Esto es sólo el catálogo;
  que los roles dejen de estar en el código es la #45, y el rol por empresa la
  #46. **Sin migración**: `nivelAcceso` no cambió de forma ni de valores.

### El catálogo se lee desde la API

`GET /permisos` devuelve las 40 casillas con su etiqueta en español, su sección,
su subsección y **qué otras exige** (`requiere`), más las secciones que las
agrupan y `tengo`, que dice cuáles trae quien pregunta. Existe porque el front
mantiene hoy su propia copia de la tabla escrita a mano, y las dos **ya difieren
en un caso**.

`requiere` es para la pantalla, no para el servidor: **no se comprueba al
autorizar** —cada ruta pide la casilla que le toca— sino al guardar un rol, que
es de la #45. Y la ruta pide **sólo sesión**: la lista de permisos que existen no
es dato de nadie, y quien entra necesita saber cuáles trae él para apagar su
propio menú.

### Un cambio que no era obvio: la subida directa

`uploadService` decide la capacidad **por destino** (D-83), y esos destinos
apuntaban a `MANAGE_PROJECTS` y `MANAGE_CLIENTS`. Se movieron a la casilla
nueva de cada uno —`contrato` a `manageContracts`, los dos del SIROC a
`manageSiroc`, `registro-obra` a `manageWorkRegistries`, `maquina` a
`manageMachines`—, y la regla queda escrita ahí: **la casilla del permiso de
subida es la misma que pide la ruta que después registra el adjunto**. Si dijera
menos, pedir el permiso de subida sería el rodeo para saltarse la casilla del
recurso.

## D-93 · Los roles son datos, y las excepciones sólo suman

**Contexto.** Tarea #45, 4 sept 2026, a pedido de Urbacames
(`cames-ops/plan/propuestas/2026-09-04-usuarios-con-permisos-por-seccion.md`).
D-92 partió los permisos en 40 casillas por sección, pero **los tres perfiles
seguían escritos en el código**: `nivelAcceso` era un enum cerrado y su tabla
vivía en un archivo del servidor. Agregar «contador» era tocar código y
desplegar. Esta decisión los vuelve datos.

### La colección `roles`, y lo que deliberadamente NO lleva

Un rol es un nombre y las casillas que trae marcadas. **No hay lista de permisos
negados**, y no la va a haber: la persona puede tener excepciones que **sólo
agregan** (`acceso.permisosExtra`). Con eso, «¿por qué ve esto?» siempre tiene
respuesta corta —su rol, o una excepción suya— y `GET /empleados/:id/acceso` la
contesta con el origen de cada casilla. Si existieran negaciones habría que
explicar además por qué **no** ve algo, y esa cadena no termina: el rol menos la
excepción menos la regla de la empresa menos… Fue decisión explícita del usuario
el 4 sept, y es lo que mantiene el modelo explicable.

### Los tres de siempre se DERIVAN de la matriz, no se escriben a mano

`services/seedRoles.js` los siembra en cada arranque leyendo `PERMISSION_MATRIX`.
Escribir aquí las listas a mano habría sido una **cuarta copia** de la misma
tabla —después de la matriz, la de §8.2 y la del front— y justo la que se
desincroniza en silencio, porque nadie revisa una semilla.

Por eso `PERMISSION_MATRIX` no desapareció. **Cambió de trabajo**: dejó de ser la
autoridad de cada petición y pasó a ser la semilla, y el respaldo de quien
todavía no tiene rol.

### Dos valores de la matriz que dejaron de ser valores

Un rol es una **lista de casillas marcadas**, y una lista no puede llevar tres
valores por casilla. Así que `'global'` y `'own_area'` salieron de la matriz y se
convirtieron en propiedades de otra cosa:

- **`exigeAlcanceGlobal` es del PERMISO**, en el catálogo. Que crear una empresa
  afecte a todo el grupo es una propiedad de la acción, no de quien la tiene:
  afecta al grupo lo haga quien lo haga. Son cinco casillas —empresas, registros
  patronales, áreas, puestos y los roles mismos—.
- **`soloSusAreas` es del ROL.** Antes era el valor `'own_area'`, y ya era del
  jefe de área y no de un permiso suyo: `isLimitedToOwnArea` se consultaba en
  **todo** el código con una sola capacidad, `viewEmployees`. Qué casillas se
  pueden acotar lo dice el catálogo (`acotableAAreas`), para que marcar un rol
  como «sólo sus áreas» no acote de pronto `manageProjects`, que nunca lo estuvo.

Ninguna de las dos cambia lo que puede nadie, y la prueba de paridad lo sostiene:
las cuatro celdas `'global'` eran `'global'` sólo en `rh_admin` y `false` en los
otros dos, así que el rol sembrado de `rh_admin` trae la clave y el catálogo le
sigue exigiendo el alcance encima.

### El respaldo por `nivelAcceso` no es deuda

`can()` tiene dos caminos: con rol resuelto, la respuesta sale del rol más las
excepciones; **sin rol, sale de la matriz por `nivelAcceso`, exactamente como
antes**.

Ese segundo camino se queda. Es lo que hace que la migración **no sea un
despliegue bloqueante** —si tarda un día, nadie se queda sin permisos— y que un
acceso creado por un script viejo, o un `acceso` armado a mano en una prueba,
nunca conteste `403` por un campo que nadie llenó. Como los tres roles se derivan
de esa misma matriz, los dos caminos contestan lo mismo, y hay una prueba que lo
comprueba casilla por casilla para los tres.

### El rol se resuelve en cada petición, no en el token

`protect` lo trae **poblado en la misma consulta** con la que ya releía al
empleado. Dos consecuencias:

1. **Cambiar un rol le cambia los permisos a su gente sin que vuelva a entrar.**
   El token nunca guardó permisos, y ahora tampoco: quitarle una casilla a un
   perfil cierra la ruta en la siguiente petición.
2. **`can()` sigue siendo síncrona**, que es lo que permite llamarla desde rutas,
   servicios y controladores sin volver asíncrono medio código.

### Quién arma roles

`manageRoles`, la casilla 41, y **exige ser administrador de plataforma**.
Administrar accesos **no alcanza** —decisión del usuario, 4 sept—: repartir
accesos y decidir qué puede un perfil no son el mismo trabajo, y quien hace lo
primero no debería poder inventarse permisos para sí mismo. Leer la lista sí pide
sólo `manageAccess`, porque quien da de alta a alguien necesita elegirle rol.

Nadie tenía `manageRoles` antes, porque los roles no existían: no le quita nada a
nadie. En la prueba de paridad va en su propio grupo, `NACIERON_NEGADAS`, para
que la pregunta al agregar una casilla sea la correcta —«¿de verdad no había
forma de hacer esto antes?»— y no se cuele como heredera de nada.

### Lo demás que se decidió

- **`todosLosPermisos`**, y no 41 casillas marcadas, para el rol del
  administrador de plataforma: tiene que alcanzar también los permisos que se
  agreguen después. Marcarle 41 y olvidar la 42 es exactamente el error que esto
  evita. «Todos» no significa «sin condiciones»: lo que exige alcance global se
  lo sigue exigiendo el catálogo.
- **`empresaId` existe y hoy siempre es `null`**, que significa «del grupo». Los
  perfiles que se pidieron son los mismos en las cuatro empresas. El campo está
  desde ahora para que el día que una empresa necesite uno propio no haya que
  migrar a nadie.
- **Un rol de sistema no se renombra ni se da de baja, pero sí se le cambian los
  permisos**: son el punto de partida, no una jaula.
- **Un rol en uso no se borra**, y el error dice **cuántas personas** lo tienen,
  para que se sepa el tamaño del trabajo antes de empezarlo. El listado trae ese
  conteo en cada renglón, así que la pantalla puede avisar antes de que alguien
  lo intente.
- **Un permiso que exige alcance global no se da como excepción.** No serviría de
  nada —el catálogo lo seguiría exigiendo— y dejaría en la ficha de la persona un
  permiso que no tiene. Se dice claro en vez de guardarlo mudo.
- **`nivelAcceso` sigue viajando y sigue siendo obligatorio** mientras el front
  migra: es el respaldo, y quitarlo hoy rompería a quien todavía lo lee.

### La migración

`scripts/migrateRolesDeAcceso.js` le pone a cada acceso el rol de sistema que
corresponde a su nivel. Idempotente, con `--dry-run`, y **no toca a quien ya
tenga `rolId`**: si alguien ya recibió un rol a mano, volver a correrla no se lo
pisa. Siembra los roles ella misma antes de empezar, para que sirva también en
una base donde el servidor nunca arrancó con esto.

## D-94 · El rol puede ser distinto en cada empresa, y el permiso acota el alcance

**Contexto.** Tarea #46, 4 sept 2026, a pedido de Urbacames
(`cames-ops/plan/propuestas/2026-09-04-usuarios-con-permisos-por-seccion.md`,
decisión 2 del 4 sept). Quien está adscrito a dos empresas puede necesitar
permisos distintos en cada una: jefe de área en la constructora y sólo consulta
en la de maquinaria. Cierra la cadena que abrieron D-92 y D-93.

### El campo es lo de menos

`affiliations.rolId`. La adscripción **ya es** el registro «esta persona, en esta
empresa», y ya dice qué áreas dirige ahí (D-60); el rol es un campo más, no una
colección nueva. `null` es lo normal y significa «manda su rol base».

La cadena de respaldo queda de tres eslabones, y cada uno sólo entra si falta el
anterior: **el rol de esa empresa → su rol base → su `nivelAcceso`** contra la
matriz. Quien no use el rol por empresa no nota absolutamente nada.

### Lo que sí era grande: tener un permiso dejó de ser sí/no

Hasta aquí `can(acceso, x)` no sabía de empresas, y `req.empresasVisibles` eran
«las empresas donde tengo adscripción activa». Con el rol por empresa, la
pregunta ya no es *si* tengo un permiso sino **en cuáles**. Eso toca la pieza
crítica de seguridad, con 68 lugares que leen `empresasVisibles`.

**No se tocó ninguno de los 68.** En su lugar:

1. `applyScope` calcula además `req.permisosPorEmpresa` — `{ empresaId: Set }` —
   resolviendo la cadena de arriba por adscripción, en la misma consulta, con el
   rol poblado.
2. **`requireCapability` hace dos trabajos**: si la casilla no está en ninguna
   empresa, **403**; si está en algunas, **acota `empresasVisibles` a ésas** y
   sigue.

Con eso el 404 de «lo tengo, pero no aquí» sale **por el camino de alcance que
ya existía y ya estaba probado**, sin una regla nueva en cada servicio. Y el
reparto queda donde debe: **403 es «no puedes», 404 es «no es tuyo»** (regla #7
del contrato). Acotar, nunca ampliar: es una intersección con lo que ya era
visible, y para el administrador de plataforma —`empresasVisibles: null`— no hay
nada que acotar.

El orden ya era el correcto: `applyScope` corre antes que `requireCapability` en
las rutas que llevan capacidad. Si alguna no tuviera `applyScope`, se cae al `can`
de siempre y nada se acota.

### Lo que esto NO acota, y por qué se deja así

Las tres rutas que no llevan `requireCapability`, que son las que ya tenían su
motivo escrito en `routeGuards.test.js`: el alta y la edición de empleados —que
deciden por el **tipo** de persona en el servicio—, `PATCH /areas/:id/estado` y
`POST /subidas` —que decide por el **destino**—. Las tres siguen igual que antes,
y en las tres el alcance ya se comprueba contra el recurso concreto. Meterles el
`permisosPorEmpresa` es posible y está anotado; no se hizo aquí porque no
resolvía nada que hoy esté abierto.

### Los catálogos del grupo se quedan igual, y salió gratis

Era la condición: **clientes y empleados bastan con tener el permiso en alguna
empresa; empresas, puestos y áreas siguen exigiendo `alcanceGlobal`**. No hizo
falta ninguna regla especial:

- Clientes y empleados **no llevan `empresaId`**, así que acotar
  `empresasVisibles` no les hace nada. Tener la casilla en una empresa basta,
  exactamente como antes.
- `exigeAlcanceGlobal` (D-93) no pasa por el rol: un rol puede marcar
  `manageCompanies` y quien lo tenga sigue sin poder si no es administrador de
  plataforma. Hay una prueba que lo fija.

### Las excepciones son de la persona

`acceso.permisosExtra` vale en **todas** sus empresas: se le dieron a ella, no a
su puesto en una de ellas. Es la lectura de «siguen valiendo donde se le dieron»,
confirmada al proponer la tarea. Si algún día hace falta una excepción acotada a
una empresa, es otro campo en la adscripción — y entonces sí, migración.

### Quién reparte el rol de una empresa

`PATCH /adscripciones/:id/rol`, y pide **`MANAGE_ACCESS`**.

Va en su propia ruta y no en el `PATCH` de la adscripción por lo mismo que las
jefaturas (D-60): **no es un dato de la relación laboral, es qué puede hacer**.
Y pide administrar accesos, no `MANAGE_AREA_LEADERSHIP` como se propuso al
principio: es **la misma decisión** que darle su rol base en
`/empleados/:id/acceso`, sólo que acotada a una empresa. Quien mueve gente entre
empresas no tiene por qué poder repartir permisos. Hoy las dos casillas son de
`rh_admin`, así que no cambia nada para nadie; la diferencia aparece el día que
alguien arme un rol que tenga una y no la otra, y ese día la respuesta correcta
es la restrictiva.

### La sesión dice qué trae en cada empresa

`AuthUser.empresas[]` gana `rol` y `permisos`, resueltos por la cadena completa.
El `permisos` plano de D-93 se queda como la **unión** de todas: es lo que el
front ya lee, y sirve para decidir si una sección se ofrece siquiera. Para saber
qué se puede hacer **dentro** de una empresa, el de esa empresa.

### Una trampa que costó una tarde y merece quedar escrita

`acceso` casi siempre es un **subdocumento de Mongoose**, y `{ ...acceso }` **no
copia sus campos**: devuelve `$__`, `_doc` y compañía. Con eso, `nivelAcceso` y
`permisosExtra` salían `undefined` y el respaldo por nivel contestaba que no a
todo.

Lo peor no era el error sino **cuándo se veía**: sólo fallaba si NO había rol, que
es justo el caso que el respaldo existe para cubrir. Con rol, la respuesta salía
del rol y todo parecía correcto — venía así desde D-93, donde afectaba al `origen`
de cada permiso sin que ninguna prueba lo tocara. Ahora hay `accesoPlano()`, que
copia campo por campo, y una prueba que usa un documento de Mongoose **de verdad**
en vez de un objeto plano. Las pruebas con objetos literales no habrían visto
nunca este fallo.

**Sin migración**: `rolId` es nuevo y anulable sobre adscripciones que ya existen,
y `null` significa exactamente lo de hoy.

---

## D-95 · Cada empresa decide qué módulos usa, y lo que se guarda es lo apagado

**Contexto.** Tarea #48, 4 sept 2026, a pedido de Urbacames
(`cames-ops/plan/propuestas/2026-09-04-modulos-activos-por-empresa.md`). No todas
las empresas del grupo hacen lo mismo: una constructora sin maquinaria propia
cargaba igual con la pestaña, con el catálogo vacío y con una sección que nadie
iba a abrir.

### Es un tercer eje, y conviene no confundirlo con los dos que ya había

| Eje                 | Contesta                       | Es de           |
| ------------------- | ------------------------------ | --------------- |
| Permisos (D-92/93)  | ¿qué puede hacer esta persona? | del usuario     |
| Alcance (§8.1)      | ¿sobre qué empresas y áreas?   | del usuario     |
| **Módulos activos** | ¿qué existe en esta empresa?   | **de la empresa** |

**Se componen:** una pestaña se ve si el módulo está activo en esa empresa **y**
la persona tiene la casilla. Apagar un módulo lo apaga para todos —el
administrador de plataforma incluido—; quitarle un permiso a alguien no se lo
quita a nadie más.

### Lo que se guarda es lo APAGADO, y por eso no hay migración

Los valores por omisión de los dos ejes son **opuestos a propósito**: un permiso
que nadie concedió tiene que **negar**; un módulo que nadie mencionó tiene que
**existir**. Así que `companies.modulosApagados` es la lista de lo que no se usa,
con `default: []`:

- Las 20 empresas que ya existen siguen con todo **sin tocar un solo documento**.
- Un módulo que se construya después **nace encendido en todas**, para que se
  descubra en vez de esconderse.
- El `enum` del campo son sólo los **opcionales**: apagar uno obligatorio no se
  puede expresar ni por la ruta, ni por un script, ni a mano en la base.

Lo que publica el contrato es lo contrario —`empresa.modulos`, los **activos**—,
derivado al leer: es lo que la pantalla pinta, y nadie tiene que invertir una
lista mentalmente.

### Un módulo son SECCIONES de permisos, no una lista de rutas

`src/utils/modules.js` declara siete módulos y, en cada uno, las secciones del
catálogo de permisos que agrupa (D-92). De ahí sale **una sola regla de
autorización**: la ruta pide su casilla, la casilla pertenece a una sección, la
sección a un módulo, y el módulo puede estar apagado.

Por eso **no se tocó ninguna de las quince rutas de maquinaria**:
`requireCapability`, después de autorizar, saca de `req.empresasVisibles` las
empresas que tienen apagada la sección de esa casilla. Lo demás lo hace el camino
de alcance de siempre — el mismo movimiento de D-94, con otra entrada. Una prueba
unitaria falla si alguna sección se queda sin módulo, que es el único modo de que
esto se rompa en silencio.

**Contesta 404**, no un error propio que diga «ese módulo está apagado»: lo que no
está activo **no existe** para esa empresa, que es la regla de toda la casa. Se
descartó el mensaje más explícito a sabiendas: una sola regla para toda la API
vale más que un caso especial mejor redactado.

### Las tres piezas que costaron algo

1. **El administrador de plataforma también obedece.** Su `empresasVisibles` es
   `null` = todas, y a «todas» no se le puede restar una. `applyScope` le carga
   la lista completa de ids **sólo cuando hay algo apagado en el grupo**: mientras
   nadie apague nada, no paga ni una consulta de más.
2. **`POST /subidas` no lleva `requireCapability`** —la casilla depende del
   destino del archivo—, así que el recorte lo aplica `uploadService` en cuanto
   sabe a dónde va. Sin eso, pedir el permiso de subida era el rodeo para tocar la
   imagen de una máquina de una empresa que apagó maquinaria.
3. **La pantalla de módulos NO obedece al módulo.** Se lee con `viewCompanies` y
   se cambia con `manageCompanies`: si obedeciera, una sección apagada no se
   podría volver a encender nunca.

### Antes de apagar se dice cuánto hay dentro

`GET /empresas/:id/modulos` devuelve cada módulo con su `contenido` —«1 máquina,
1 incidencia»— para que nadie lo apague creyéndolo vacío. Sólo se cuenta lo de
los **opcionales**: contar lo que no se puede apagar sería consultar por gusto.

**Apagar no borra nada.** Lo que había queda tal cual y vuelve a aparecer al
encenderlo: es un filtro de lectura, nunca una baja.

### Sólo el administrador de plataforma decide

`PATCH /empresas/:id/modulos` pide `manageCompanies`, que ya exige `alcanceGlobal`
(D-93). Va en su propia ruta y no en el `PATCH` de la empresa, como `/estado` y
los registros patronales: qué usa una empresa no es un dato que se corrija junto
al RFC.

**Sin migración.** El campo es nuevo, anulable, y su ausencia significa
exactamente lo que valía hasta hoy.
