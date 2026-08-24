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
