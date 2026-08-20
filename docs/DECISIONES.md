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
