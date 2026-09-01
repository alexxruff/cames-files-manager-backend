# Bitácora del backend — para el equipo del front

**Lo que el backend ya entregó, lo que necesita del front y los bugs que
encontró.** Es la mitad de una conversación de dos: la otra está en
`~/Documents/projects/cames-files-manager/docs/HANDOFF-FRONTEND.md`.

Quien lea esto desde el front: aquí está lo que ya responde el servidor y lo que
quedó pendiente de su lado. **Esta se lee, no se copia** — no hay mirrors, y por
eso no hay nada que pueda quedarse viejo.

---

## Cómo funciona

1. **Cada quien es dueño de sus archivos, en su propio repo.** El front escribe
   los suyos en `cames-files-manager/docs/`; nosotros los nuestros aquí.
   **Nadie edita los del otro y nadie los copia.**
2. **El primero que termina una tarea la escribe en su bitácora**, con **fecha y
   hora al segundo** (ver «Formato de una entrada»). El otro la lee antes de
   empezar la suya.
3. **Los bugs se avisan por aquí**, aunque sean del otro lado — sobre todo si
   son del otro lado.
4. **Esto se mantiene corto a propósito.** Al cerrar una tarea grande, sus
   entradas se colapsan a un renglón en «Cerrado» y el detalle baja a donde vive
   de verdad: el `ENDPOINTS-*.md` del recurso,
   [`DECISIONES.md`](./DECISIONES.md) o [`ESTADO.md`](./ESTADO.md). **Y se le
   avisa al otro que se recortó.** Si este archivo pasa de ~150 líneas, tocaba
   recortar hace rato.

### Qué es de quién

| Del backend — vive aquí                                                                  | Del front — lo suyo que me sirve a mí                                          |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `modelo-datos.md` — el esquema de Mongo y su porqué                                      | `backend-actual.md` — nuestras trampas, tal como les pegan                     |
| `backend-spec.md` — el contrato HTTP: envelope, códigos, rutas                           | `SOLICITUD-BACKEND-ALTAS.md` — lo que nos piden, y los bugs que nos encuentran |
| `ARQUITECTURA-DATOS.md` — qué colecciones hay HOY y qué se rompe al tocarlas             | `HANDOFF-FRONTEND.md` — su mitad de esto                                       |
| `ENDPOINTS-*.md` (proyectos, adscripciones, alertas, importación, áreas, expedientes)    | `flujo-expedientes.md` — el documento de Urbacames, la fuente del alcance      |
| `CONTRATO-API.md`, `INTEGRACION-FRONTEND.md`, `CAMBIOS-FRONTEND*.md` — nuestras entregas | `roadmap.md` — qué está hecho de su lado                                       |
| `DECISIONES.md`, `PLAN-*.md`, `ESTADO.md`, `RUMBO.md` — nuestra cocina                   | `mocks.md` — qué siguen simulando                                              |

Su repo tiene más (`design-tokens.md`, `skills.md`…), pero es cocina suya y no
se lee desde aquí. La columna de la derecha es corta a propósito: lo que
necesito, no su inventario.

### Formato de una entrada

El encabezado es **`AAAA-MM-DD HH:MM:SS · lado · título`**, con hora local (CST,
`-0600`) y **al segundo**. No es pedantería: los dos lados escriben el mismo día
sobre las mismas cosas, y sin la hora no hay forma de saber si lo que estoy
leyendo es anterior o posterior a lo que acabo de hacer. La hora es la del
momento en que se **cierra** el trabajo, no la de la entrada.

Debajo, tres cosas: **qué se hizo**, **qué necesita el otro** y **qué se leyó
suyo, de qué fecha**. Corto: si necesita más de diez renglones, el detalle va en
un documento y aquí queda el enlace.

---

## Pendientes para el front

- [ ] **Revisen la validación del nombre en el formulario de alta: puede estar
      bloqueando altas legítimas.** El servidor acepta **entre 3 y 120
      caracteres y no filtra ningún carácter** —acentos, ñ, apóstrofos y guiones
      pasan—. Si su formulario valida 2-50 caracteres o un patrón de letras,
      **hoy está rechazando gente que el servidor daría de alta**, y lo sufre
      quien captura: la petición nunca sale del navegador, así que de nuestro
      lado no queda rastro y nadie se entera. No es una corrección de
      documentación: es revisar si la interfaz está tirando altas buenas. La
      regla, en [`INTEGRACION-FRONTEND.md`](./INTEGRACION-FRONTEND.md) §7.
- [ ] **Borren el aviso de «no abrir modelo-datos §8.2» de su `backend-actual.md`.**
      Ya no hay nada de qué avisar: §8.2 es la única tabla de permisos, dice lo
      que el servidor hace y una prueba la sostiene. Es el parche que pusieron
      mientras las dos tablas se contradecían.
- [ ] **Borren sus `modelo-datos.md` y `backend-spec.md`.** Ya están adoptados
      aquí, con lo suyo dentro — ver la entrada de las 23:27:05, y la
      reconciliación completa del 31 ago en
      [`RECONCILIACION-DOCS.md`](./RECONCILIACION-DOCS.md). A partir de ahora se
      leen en `cames-files-manager-backend/docs/`.
- [ ] **Corrijan su `CLAUDE.md`, en dos lugares.** Dice «el traspaso está a
      medias … **la copia buena es la de aquí** —la suya no tiene nada de D-68 a
      D-72—», y antes remite a sus `docs/modelo-datos.md` y `docs/backend-spec.md`
      como los autoritativos. **Ya no es cierto:** su copia es la foto del 28 ago
      —12 colecciones, sin D-73, con las alertas y R2 como «por construir»— y
      quien la lea creyéndole va a implementar contra el modelo viejo. Su propio
      texto dice que esto se corrige «hasta que backend avise en su bitácora que
      adoptó la nuestra»: **este aviso es ése**. Háganlo antes de borrar nada.
- [ ] **`faltantes` no se cuenta igual de los dos lados.** Aquí son sólo los
      `pending`; su `src/utils/expediente.ts` suma también los `rejected`. **El
      número que ve el usuario es el nuestro** —el `avance` viaja en la
      respuesta—, así que hoy sólo diverge la capa simulada, y el semáforo sale
      igual en los dos. Digan cuál quieren y se empareja; nos parece más honesto
      el suyo, pero es cambio de contrato y no lo hacemos solos.
      Detalle en [`modelo-datos.md` §6.3](./modelo-datos.md).
- [ ] **`/usuarios` sigue respondiendo `410`** y se borra el día que dejen de
      llamarla. Avisen cuando su código ya no la toque.
- [ ] **¿Les hace falta `GET /empleados/:id/adscripciones` suelta?** El detalle
      del empleado ya las trae embebidas y nos inclinamos a no hacerla.

**Sabido y sin arreglar, de nuestro lado:** «Axis 3» (Urbanizadora Cames / KAAB)
sigue en producción sin `registroPatronalId` ni `registroObraId`, y dos
proyectos más en local. Son datos de prueba anteriores a D-69 y ustedes ya los
pintan como dato pendiente, así que no bloquea; se limpian con la carga real.

**Lo que sigue de nuestro lado**, por si quieren ir preparando pantallas:
métricas, reportes, plantillas de checklist, el árbol de `/organizacion` y el
job diario de vigencias. El orden, en [`ESTADO.md`](./ESTADO.md).

---

## Bitácora

### 2026-09-01 10:22:52 · backend · La migración del SIROC corrió en LOCAL: sus dos contratos de prueba cambiaron solos

**Leído de ustedes**: `HANDOFF-FRONTEND.md` del 31 ago 22:36:33.

**Esto no es un bug.** Si al abrir contratos ven algo distinto a ayer, es esto.

Corrió `npm run migrate:siroc-vigencia`, que quita `siroc.vigenciaHasta` de los
contratos que la traían — el campo de la entrada anterior. Tocó **los dos
contratos con SIROC de la base local**, y ahora su vigencia se deriva en vez de
leerse:

| Contrato | SIROC           | Qué responde ahora                                         |
| -------- | --------------- | ---------------------------------------------------------- |
| 1        | `SIR-2026-0001` | `al_dia`, vigencia al **2026-10-31**, 60 días, 1 pendiente |
| 2        | `SIR-2026-0002` | `vencida` desde el **2026-05-01**, 123 días, 4 pendientes  |

El 2 sale rojo y pidiendo actualización. Es correcto: se registró el 2026-03-01,
nadie lo ha refrendado, y el contrato sigue `en_curso` hasta el 2026-12-31.

**Sólo en local.** En Fly **no** ha corrido, y el código de la corrección tampoco
está desplegado: contra producción siguen viendo lo de antes, con el campo
guardado. Cuando se despliegue lo avisamos aquí.

**Lo único que les queda de la #9**: quitar `vigenciaHasta` del formulario del
SIROC. Su entrada de las 22:36 daba la tarea por buena, pero es de **antes** de
la corrección de las 23:35 — que no habían leído todavía. No corre prisa y no
rompe nada: `PUT /contratos/:id/siroc` lo sigue aceptando y lo ignora.

### 2026-08-31 23:35:02 · backend · El SIROC ya no tiene fecha final, y el contrato vencido sí pide actualización

**Leído de ustedes**: `HANDOFF-FRONTEND.md` del 31 ago 19:24:10.

**Qué se hizo.** Dos correcciones sobre la tarea #9, salidas de probarla:

1. **`siroc.vigenciaHasta` desapareció.** Del aviso se capturan **su número y su
   fecha de registro, y nada más**: su vigencia son siempre dos meses desde ahí
   —o desde la última actualización— y ya venía derivada en
   `seguimientoSiroc.vigenciaPeriodoHasta`. Pedirla además hacía que se tecleara
   ahí la fecha de fin del contrato, y el contrato acababa mostrando una vigencia
   que el seguimiento no usaba y que lo contradecía.
2. **Un contrato que se pasó de su `fechaFin` y que nadie finalizó ahora sí exige
   la actualización.** Antes respondía `no_requiere` —«la ventana ya cubre lo que
   queda del contrato»— sin mirar que ese contrato ya había quedado atrás. Para
   el IMSS la obra sigue abierta y el aviso vence igual. Era el caso más común de
   todos, porque las obras se alargan y nadie corre a finalizarlas.

**Qué necesita el front.** Una cosa: **quiten `vigenciaHasta` del formulario del
SIROC.** No corre prisa y no rompe nada mientras tanto —`PUT /contratos/:id/siroc`
lo sigue aceptando y lo **ignora**—, pero ya no se guarda ni vuelve en la
respuesta. Y al pintar «faltan N actualizaciones», usen
`actualizacionesPendientes`, no la resta: en un contrato vencido
`actualizacionesRequeridas` puede ser `0` y `pendientes` valer `1`.

El detalle, en `plan/handoff/9.md` (encabezado «Corrección del 2026-08-31») y en
[`ENDPOINTS-PROYECTOS.md`](./ENDPOINTS-PROYECTOS.md) §4.1. El porqué, en
[`DECISIONES.md`](./DECISIONES.md) D-76.

### 2026-08-31 22:08:33 · backend · Tarea #9: el SIROC se actualiza cada 2 meses, y el aviso ya viene calculado

**Leído de ustedes**: `HANDOFF-FRONTEND.md` del 31 ago 19:24:10 (tarea #8 cerrada,
`fase` capturándose en dos casillas).

**Qué se hizo.** El aviso de obra **se refrenda cada dos meses conservando el
mismo número**. Se guarda sólo el hecho —`siroc.actualizaciones: [{ fecha, nota }]`—
y **todo contrato viaja ahora con `seguimientoSiroc`**: cuántas actualizaciones
pide (predichas desde `fechaInicio`/`fechaFin`), cuántas lleva, cuándo cumple los
dos meses la ventana vigente, `estado`
(`sin_siroc | no_requiere | al_dia | por_vencer | vencida`) y un `mensaje` en
español listo para pintar. Derivado en cada lectura, como todo lo demás: no hay
nada que marcar ni apagar. Dos rutas nuevas,
`POST /contratos/:id/siroc/actualizaciones` y
`DELETE /contratos/:id/siroc/actualizaciones/ultima`.

**Qué necesita el front.** Es **aditivo**: nada de lo que consumen cambió de
forma. Cuando pinten la tarea #10, tres cosas que ahorran errores:

1. **`requiereActualizacion` es `true` sólo con `estado: 'vencida'`.**
   `por_vencer` avisa 5 días antes, pero todavía no se debe nada.
2. **La ventana corre desde la última actualización** —o desde `fechaRegistro`—,
   **no desde el inicio del contrato**: un SIROC tramitado tarde vence tarde.
3. **No cacheen `seguimientoSiroc`**: el mismo contrato responde distinto mañana.

El detalle petición por petición, en `plan/handoff/9.md` y en
[`ENDPOINTS-PROYECTOS.md`](./ENDPOINTS-PROYECTOS.md) §4.1. El porqué, en
[`DECISIONES.md`](./DECISIONES.md) D-76.

**Lo que quedó fuera, a propósito:** estas alertas **no entran en `GET /alertas`**
—esa bandeja agrupa por `empleadoId` y el SIROC cuelga de un contrato—, y no hay
listado global de «contratos que requieren actualización». Si lo quieren, se
decide aparte.

### 2026-08-31 18:39:32 · backend · El contrato tiene fase, y es un campo suyo — no una entidad nueva

**Qué se hizo.** `contracts` gana **`fase`**, una etiqueta opcional (máx. 120) que
**convive con `nombre` sin sustituirlo**: `nombre` es cómo se llama el contrato
('Contrato 001-A') y `fase` el alias con el que la obra lo nombra ('Fase 1',
'Cimentación'). Se manda en el alta, se edita por `PATCH /contratos/:id`, y se
borra mandando `""` o `null` —vuelve a `null`, nunca a cadena vacía—.

**G1 sigue en pie:** contrato y fase son la misma entidad. No hay colección
`fases`, ni `faseId`, ni rutas nuevas: el catálogo de contratos es idéntico al de
ayer. Lo único que cambió es que el documento tiene un campo más. El porqué —y
por qué **no** se renombró `nombre`— está en [`DECISIONES.md`](./DECISIONES.md)
D-75.

**Qué necesita el front.** Nada urgente, y **nada se les rompe**: `fase` es
opcional y los contratos que ya existían salen con `"fase": null`. Cuando quieran
mostrarla:

1. Sumen `fase: string | null` a su tipo `Contrato` y píntenla donde hoy pintan
   `nombre` — son dos etiquetas distintas, no elijan una.
2. En el formulario de contrato, un campo más al lado del nombre. Vacío se manda
   como `""` o se omite; las dos cosas quedan en `null`.
3. Para borrarla en la edición, manden `""` o `null` en el `PATCH`. Mandar sólo
   `fase` no toca el nombre ni las fechas.

**De paso, un arreglo chico en `nombre`.** El alta con `"nombre": ""` devolvía
`""`; ahora devuelve `null`, que es lo que la regla 5 exige y lo que el `PATCH` ya
hacía. Si mandan el campo vacío en vez de omitirlo, ya no queda cadena vacía
guardada.

El detalle petición por petición, en
[`ENDPOINTS-PROYECTOS.md`](./ENDPOINTS-PROYECTOS.md) §4.

**Qué se leyó suyo.** `HANDOFF-FRONTEND.md` del 31 ago 2026 17:07:00 (D-40
aplicado, el catálogo de clientes acotado).

### 2026-08-31 15:18:20 · backend · Una sola matriz de permisos, y su regla del nombre está de más

**Qué se hizo.** Había **dos tablas de permisos** que no decían lo mismo, y la
que se cita como oficial era la equivocada: `modelo-datos.md` §8.2 dejaba la
edición de personal sólo en `rh_admin` diez días después de que Urbacames
confirmara lo contrario. Ahora hay **una sola**, la de §8.2, sacada de
`src/utils/permissions.js`, y `tests/unitarias/docs.test.js` la compara **celda
por celda** contra el código: si vuelven a separarse, `npm test` falla. La tabla
de D-32 se quitó; ahí quedó el porqué. Ninguna respuesta del servidor cambia.

Lo que la tabla decía mal y ahora dice bien: **un `jefe_area` y un `rh_consulta`
pueden corregir a la gente de obra que ellos mismos capturaron** (no sólo darla
de alta), `rh_consulta` **revisa** documentos (D-44) y `jefe_area` **gestiona
clientes y su cartera**. Dar de baja del sistema sigue siendo de `rh_admin`.

De paso, `CONTRATO-API.md` §«Implementado hoy» gana una columna **«llave de
`data`»**: bajo qué nombre viene la carga útil de cada ruta, que hasta hoy sólo
estaba en los ejemplos de los `ENDPOINTS-*.md`.

**Qué necesita el front.** Dos cosas, las dos arriba en «Pendientes»:

1. **Revisen su validación del nombre — esto no es documentación, es un posible
   bug de su lado.** El servidor acepta 3-120 caracteres **sin patrón**; si su
   formulario valida 2-50 o exige un patrón de letras, hoy está **rechazando
   altas que el servidor aceptaría**, sin que a nosotros nos llegue nada. La
   regla real quedó en `INTEGRACION-FRONTEND.md` §7, que es donde se busca; el
   `/^[\p{L}\s'-]+$/u` de D-16 era del usuario del backend prestado y **ya no
   existe en el código**.
2. **Borren el aviso de «no abrir §8.2» de `backend-actual.md`.** Era el parche
   correcto mientras las dos tablas se contradecían; ya no hace falta.

**Qué se leyó suyo.** `HANDOFF-FRONTEND.md` del 31 ago 2026 (el cierre del
traspaso de `modelo-datos.md` y `backend-spec.md`).

### 2026-08-31 13:05:14 · backend · Una sola versión de `modelo-datos.md` y `backend-spec.md`

**Qué se hizo.** Se reconciliaron las dos copias contra ésta y contra el código.
**La copia que ustedes tienen era la vieja**, no la buena: es la foto del 28 ago
—dice «el front todavía asume el modelo anterior», habla de 12 colecciones y
lista las alertas, R2, las áreas, los contratos y la importación como «por
construir»—. De ella se rescató una sola cosa, el renglón que dice dónde están
sus casos borde probados (`src/utils/__tests__/`, `src/mocks/__tests__/`), que
ahora está en las referencias del spec.

Y se corrigió lo que la nuestra decía de más. Lo que les afecta directo:

- **`GET /adscripciones` no existe** y no está pedido. La tabla «qué existe hoy»
  decía que sí. Se listan y se dan de alta por empresa
  (`/empresas/:id/adscripciones`); lo suelto es editar, dar de baja y jefaturas
  (`PATCH /adscripciones/:id`, `/estado`, `/jefaturas`).
- **Cinco rutas del catálogo estaban sin marcar y no responden**:
  `GET /empleados/:id/adscripciones`, `GET /empleados/:id/asignaciones`,
  `GET /organizacion`, `GET /dashboard/metricas` y `GET /reportes/expedientes`.
  Ahora dicen «Por construir» en su renglón.
- **`GET`/`PATCH /plantillas-checklist` faltaba en el spec.** Estaba declarada
  pendiente en el router y ustedes no tenían cómo enterarse. Ya tiene renglón.

Nada de esto cambia una sola respuesta del servidor: son documentos. Pero si
alguien de su lado programó contra el listado global de adscripciones, **no va a
existir**. El detalle, diferencia por diferencia y con lo que se descartó y por
qué, en [`RECONCILIACION-DOCS.md`](./RECONCILIACION-DOCS.md).

Para que no vuelva a pasar: `tests/unitarias/docs.test.js` ahora falla si un
documento cita una ruta que ni existe en el router ni está declarada pendiente
**y marcada como tal** en su renglón.

**Qué necesitan.** Las dos casillas de arriba: borrar sus copias y **corregir su
`CLAUDE.md`**, que todavía manda leer la suya.

**Qué se leyó suyo.** `HANDOFF-FRONTEND.md` al 2026-08-30, y sus copias de
`modelo-datos.md` y `backend-spec.md` del 2026-08-30 21:18.

### 2026-08-30 22:49:04 · backend · `GET /api/v1/version`: qué commit está corriendo

**Qué se hizo.** Ruta nueva, **pública** y sin caché
(`Cache-Control: no-store`), que dice qué release está desplegado:

```json
{
  "status": "success",
  "data": {
    "schemaVersion": 1,
    "service": "cames-api",
    "commit": "…40 hex",
    "builtAt": "2026-08-30T12:34:56Z"
  }
}
```

Cuatro campos y nada más: **no es un endpoint de diagnóstico** y no va a crecer
con `NODE_ENV` ni con nada del entorno (D-74). Los dos valores se hornean en la
imagen y la construcción falla si faltan, así que **nunca verán `"unknown"`**;
fuera de un contenedor —desarrollo— llegan en `null`.

**Qué necesitan.** Nada obligatorio. Si les sirve para el pie de página o para
un reporte de error, pídanla sin sesión y sin caché propia; el valor de `commit`
es lo que hay que pegar cuando reporten algo raro después de un despliegue.

**Qué se leyó suyo.** `HANDOFF-FRONTEND.md` al 2026-08-30.

### 2026-08-30 01:00:41 · backend · Aviso: `tipo` sale del puesto y lo sustituye el área (D-73)

**Nada cambió todavía. Es un aviso para que no construyan encima.**

Su alta de puestos sigue pidiendo «Aplica a: Mano de obra / Administrativo».
Ese selector **va a desaparecer**: cuando las áreas dejaron de ser un enum
cerrado (D-58) y absorbieron el filtro de la tabla (D-59), `categorias.tipo` se
quedó como el resto de una división que las áreas ya hacen mejor —dos cajones
para nueve áreas—.

**Por ahora no lo quiten.** El campo sigue siendo obligatorio al crear un puesto
y sigue filtrando el desplegable del alta; el front está bien como está. Lo
avisamos aquí antes de tocarlo.

**Por qué no lo hacemos ya:** de `tipo` cuelga quién puede gestionar a quién
—`rh_consulta` y `jefe_area` dan de alta personal de obra pero no
administrativos—, y con nueve áreas en vez de dos tipos esa matriz hay que
redefinirla. Hay dos caminos (marcar cada área, o permisos por área) y **no está
decidido cuál**. Es la parte que rompe seguridad si se improvisa, así que el
cambio no empieza hasta que se decida.

El alcance completo, con lo que toca de cada lado, está en D-73.

**Lo que necesitamos de ustedes:** nada aún. Cuando se decida el camino les
pasamos el contrato nuevo con tiempo.

### 2026-08-30 00:50:15 · backend · Corregido el bug de `seed:admin` que reportaron el 21 ago

**Leímos `SOLICITUD-BACKEND-ALTAS.md` (395 líneas, 21 ago 2026)**, que estaba
dirigido a nosotros y no se había revisado desde entonces. De los tres puntos:

- **La categoría base sin `tipo`, que les dejaba vacío el desplegable de
  administrativos** — resuelto a medias, y por eso **seguía roto**. `tipo` pasó a
  ser obligatorio en el esquema y `bootstrapAdmin` ya lo mandaba, pero
  `scripts/seedAdminUser.js` no: con la base vacía, `npm run seed:admin`
  reventaba con un `ValidationError` y no sembraba nada. Corregido, con la
  aserción que faltaba en `tests/integracion/bootstrap.test.js`.
- **El mensaje que interpolaba `undefined`** — ya no existe; el `tipo` obligatorio
  eliminó ese camino.
- **Dar de baja empresas y empleados** — hecho: `PATCH /empresas/:id/estado` y
  `PATCH /empleados/:id/estado`.

Si quedaba algo más vivo de ese documento, dígannoslo: lo damos por cerrado.

**Leído de ustedes:** `SOLICITUD-BACKEND-ALTAS.md` del 21 ago 2026 y
`HANDOFF-FRONTEND.md` del 29 ago 23:15:00.

---

## Cerrado

| Fecha       | Tarea                                                                                                                                                          | Dónde quedó el detalle                                                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 29 ago 2026 | Barrida de documentación desfasada, y guardia automática de las cifras                                                                                         | `tests/unitarias/docs.test.js`; el aviso de `/organizacion` sigue en «Pendientes»                                                              |
| 29 ago 2026 | Adoptados `modelo-datos.md` y `backend-spec.md`, con la versión del front como base                                                                            | Los dos documentos, y sus encabezados dicen desde cuándo son nuestros                                                                          |
| 29 ago 2026 | Creada esta bitácora, y el reparto de documentos con el front                                                                                                  | Arriba, «Cómo funciona»                                                                                                                        |
| 29 ago 2026 | La cadena de la obra completa, sus ocho fases (D-65 a D-72): registros patronales y de obra, contratos, SIROC, candados del proyecto y coherencia con la gente | [`PLAN-OBRA-CONTRATOS.md`](./PLAN-OBRA-CONTRATOS.md), [`ENDPOINTS-PROYECTOS.md`](./ENDPOINTS-PROYECTOS.md), [`DECISIONES.md`](./DECISIONES.md) |
| 29 ago 2026 | Alertas derivadas al leer, sin nada que marcar (D-47)                                                                                                          | [`ENDPOINTS-ALERTAS.md`](./ENDPOINTS-ALERTAS.md)                                                                                               |
| 28 ago 2026 | Importación de colaboradores desde el `.xlsx` de nómina, reejecutable sin duplicar (D-46)                                                                      | [`ENDPOINTS-IMPORTACION.md`](./ENDPOINTS-IMPORTACION.md), [`PLAN-IMPORTACION-XLSX.md`](./PLAN-IMPORTACION-XLSX.md)                             |
