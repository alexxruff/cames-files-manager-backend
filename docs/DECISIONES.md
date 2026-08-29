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

`REVIEW_DOCUMENTS` ya existía en la matriz (§8.2) y sólo la tiene `rh_admin` —
quien sube (`rh_consulta` también puede) no es necesariamente quien revisa. La
ruta reutiliza esa capacidad tal cual, sin negociar nada nuevo.

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
