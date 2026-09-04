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
- [ ] **Apaguen el menú con `AuthUser.permisos`, no con `nivelAcceso`.** Desde la
      #45 la sesión trae las casillas ya resueltas y el rol de quien entró.
      Deducirlas del nivel deja de funcionar en cuanto exista el primer rol que
      no sea uno de los tres de siempre, y ése es justo el punto del cambio.
- [ ] **Tiren su copia de la matriz de permisos y lean `GET /permisos`.** Desde
      la #44 el servidor la manda entera —40 casillas con su sección, su etiqueta
      y qué exigen, más las que trae quien entró—. Mantenerla a mano ya les costó
      un caso en el que las dos listas dicen cosas distintas, y a partir de la #45
      las casillas van a cambiar sin que nadie despliegue el front.
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

### 2026-09-04 16:26:22 · backend · La #45: los roles son datos, y se eligen al crear un usuario

**Leído de ustedes**: `HANDOFF-FRONTEND.md` del 4 sept (sin entradas nuevas
desde la #43).

**Hecho.** Un rol dejó de estar escrito en el código y pasó a ser **un dato**: un
nombre y las casillas que trae marcadas. Los tres de siempre siguen ahí —se
siembran al arrancar **derivándolos de la matriz**, así que dicen exactamente lo
que decían— y a partir de ahora se pueden crear los que hagan falta sin
programar ni desplegar. Rutas, forma exacta y errores en `plan/handoff/45.md`;
el porqué, en D-93.

**Lo que pueden usar hoy, aunque su tarea sea la #47:**

- **`AuthUser` trae `permisos[]` y `rol`.** Los permisos vienen **ya resueltos**
  —el efecto de `alcanceGlobal` aplicado—, así que es lo que debe apagar el menú
  y los botones, en lugar de deducirlos de `nivelAcceso`. `nivelAcceso` y
  `alcanceGlobal` **siguen viajando sin cambios**.
- **`GET /roles`** ya responde, y cada renglón trae `personas`: cuánta gente lo
  tiene. Es para avisar **antes** de que alguien intente borrar uno en uso, que
  responde 409.
- **`GET /empleados/:id/acceso`** (ruta nueva) dice **de dónde le viene cada
  permiso** a alguien: `origen` es `'rol'` o `'excepcion'`, y no hay tercer caso.

**Tres cosas al pintarlo:**

- **Un rol de sistema no se renombra ni se da de baja, pero SÍ se le cambian los
  permisos.** Escondan el botón de renombrar, no el de editar: son el punto de
  partida, no una jaula.
- **`todosLosPermisos: true`** lo trae sólo el de Administrador de RH. Con esa
  bandera las casillas individuales no significan nada — muéstrenlo como «todo»,
  y no como 41 palomitas.
- **Cambiar un rol le cambia los permisos a su gente en la siguiente petición**,
  sin que vuelva a entrar. El token no guarda permisos. Si su pantalla cachea lo
  que trae la sesión, conviene refrescarla al volver del editor de roles.

**Y una que les toca decidir en la #47:** las excepciones por persona **sólo
suman**. No hay «el rol menos algo» y no lo va a haber, para que «¿por qué ve
esto?» siempre tenga respuesta. Si alguien pide quitarle una casilla a una
persona concreta, la respuesta es un rol nuevo — vale la pena que la pantalla lo
diga en vez de dejar buscar el interruptor.

**Con migración**, y **no bloquea el despliegue**: quien no tenga rol sigue
resolviéndose por su `nivelAcceso`, así que nadie se queda sin permisos mientras
tanto.

**Qué necesitamos de ustedes:** la #47, después de la #46 (rol distinto por
empresa). Ojo con esto al diseñar: **`permisos` es hoy una lista plana y en la
#46 pasa a depender de la empresa**. No la aten a una sola forma todavía.

### 2026-09-04 15:14:23 · backend · La #44: ver es un permiso, y son 40 casillas

**Leído de ustedes**: `HANDOFF-FRONTEND.md` del 4 sept (la #43 cerrada, con el
monto y el bimestre ya pintados en la línea de reportes bimestrales).

**Hecho.** Los 20 permisos de siempre se abrieron en **40 casillas repartidas en
diez secciones**, y **ver dejó de ser gratis**: proyectos, contratos, SIROC,
maquinaria, incidencias, clientes, empresas y el personal de la obra ya no se
leen con sólo tener sesión. Además `manageProjects` —que autorizaba seis módulos
distintos— se quedó sólo con la obra. Todo el detalle, en `plan/handoff/44.md`;
el porqué, en D-92.

**A nadie le cambió nada hoy, y hay una prueba que lo sostiene.** Los tres
niveles conservan exactamente lo que podían: las casillas de ver nacieron
encendidas donde la lectura era libre, y las que salieron de otra heredaron su
fila con el valor exacto. `permissionsParity.test.js` congela la matriz anterior
entera y falla si una sola respuesta se mueve.

**Tres cosas que sí les tocan:**

- **`GET /permisos` manda el catálogo, y su copia a mano sobra.** Devuelve las 40
  casillas con etiqueta, sección, subsección y `requiere`, las 10 secciones en
  orden, y **`tengo`** con las que trae quien entró —ya resueltas, incluyendo el
  efecto de `alcanceGlobal`—. Es lo que debe apagar el menú y los botones. Hoy
  sus dos listas ya difieren en un caso; ésta no puede.
- **Rutas de lectura que antes nunca daban 403 ahora pueden darlo.** Son 21, y
  están listadas en el handoff. No les pega todavía —los tres niveles tienen
  todas las casillas de ver—, pero en cuanto exista un rol que no las traiga
  (#45) sí, y conviene que el manejo esté puesto antes.
- **`GET /areas` y `GET /categorias` NO cambiaron**: siguen pidiendo sólo sesión
  porque llenan los desplegables de todos los formularios. `GET /tipos-incidencia`
  sí pasó a pedir `viewMachineIncidents`.

**Ninguna ruta cambió de dirección, de cuerpo ni de respuesta.** La única nueva
es `GET /permisos`. **Sin migración**: `nivelAcceso` no cambió de forma ni de
valores, y los roles siguen siendo los tres de siempre — que dejen de estar en el
código es la #45, y el rol distinto por empresa la #46.

**Qué necesitamos de ustedes:** nada todavía. Su parte es la **#47**, y va
después de la #45 y la #46 a propósito, para construirse una sola vez contra el
modelo completo. Si quieren adelantar algo, lo único que ya pueden hacer es
**dejar de mantener su copia de la matriz** y leer `GET /permisos`.

### 2026-09-04 00:33:05 · backend · La #42: el reporte bimestral dice cuánto y de qué bimestre

**Leído de ustedes**: `HANDOFF-FRONTEND.md` del 3 sept 23:26:11 (la #40 cerrada,
con `PATCH /contratos/:id` ya sin llamadas de su lado — confirmado, el `410` no
le pega a nadie).

**Hecho.** Cada reporte bimestral del SIROC gana **`monto`** —lo reportado en
esos dos meses— y **`bimestre`** —a cuál corresponde—. Los dos opcionales, los
dos sólo al registrar. **No hay ninguna ruta nueva**: `POST
/contratos/:id/siroc/actualizaciones` acepta dos campos más y todas las
respuestas que ya traen el contrato los devuelven. La forma exacta, los `400` y
el cuerpo, en `plan/handoff/42.md`; el porqué, en D-91.

**Tres cosas al pintarlo:**

- **`monto: null` no es `0`.** `null` es «no se capturó» —y es lo que traen
  **todos** los reportes de antes de hoy—; `0` es un bimestre reportado en ceros.
  Dato pendiente, nunca `$0.00`. Misma regla que el `monto` del contrato en D-90.
- **`bimestre` llega siempre como cadena o `null`**, aunque manden el número `3`
  —les vuelve como `"3"`—. Se guarda tal como se teclea: `'2026-3'` y
  `'mayo-junio'` son válidos y frecuentes, así que no lo parseen.
- **No es el monto del contrato.** `contrato.monto` es el total de la obra; éste
  es la cifra de dos meses. **No se cuadran** —la obra se repacta, se aplaza— así
  que no pinten una resta ni un «faltan X».

**Y una que les toca decir en pantalla, en la #43**: **no hay ruta para corregir
un reporte ya capturado**, y es una decisión, no un pendiente. Se deshace y se
recaptura, como con una fecha. Pero **sólo se deshace el último**: corregir uno
de en medio obliga a deshacer los que vinieron después y recapturarlos **con sus
acuses**, que se borran de R2 al deshacer. Eso hay que advertirlo antes de que lo
intenten, no después.

**Sin migración.** Los reportes que ya existen devuelven las dos llaves en `null`
sin tocar un solo documento: no hay cifra que inventarles.

**Qué necesitamos de ustedes:** la #43.

### 2026-09-03 21:38:41 · backend · La #39: el contrato con monto, su historia de modificaciones, y eliminarlo

**Leído de ustedes**: `HANDOFF-FRONTEND.md` del 3 sept 14:37:04 (la #35 cerrada,
con el catálogo de tipos en la ficha de la máquina).

**Hecho.** El contrato gana **monto** —obligatorio en el alta, un número en pesos
con el IVA incluido, sin desglose—, una **historia de modificaciones** y un
**eliminar** que borra de verdad. La tabla de rutas, las formas exactas y los
mensajes de error están en `plan/handoff/39.md`, y el porqué en D-90.

**Lo que les rompe, y es una sola cosa: `PATCH /contratos/:id` responde 410.**
Editar un contrato dejó de existir porque se confundía con modificarlo. Se
reparte en tres:

- cambiar fechas o monto → `POST /contratos/:id/modificaciones` (queda en la
  historia, con su convenio escaneado)
- adjuntar el contrato escaneado → **`PUT /contratos/:id/archivo`**, que es donde
  se fue el `PATCH` de sólo archivo que usan hoy
- corregir `nombre` o `fase` → `DELETE /contratos/:id` y capturarlo de nuevo

**Dos llaves nuevas en `Contrato`**: `monto` (`number | null`) e `historia`. Van
en toda respuesta que devuelva un contrato — **menos en `obras[].contrato` del
expediente**, que sigue siendo la proyección corta de siempre. Ojo con las dos:

- **`monto: null` no es `0`.** Los contratos de antes de hoy se quedaron sin
  monto: van como dato pendiente, no como cero.
- **`historia.modificado: false` con `entradas: []`** es un contrato sin
  modificaciones, que es lo normal. **No dibujen línea del tiempo ahí**: el
  contrato lo dice para que no haya que deducirlo. Cuando sí hubo, la primera
  entrada es el original, la última trae `vigente: true` y sus valores son
  exactamente los campos del contrato — no hay dos verdades que reconciliar.

**Y `fechaFin` sigue siendo el techo del SIROC**: como la modificación pisa los
campos del contrato, todo lo que ya consumen —`seguimientoSiroc`,
`seguimientoContrato`, las obras del expediente— se recalcula solo. No hay nada
que cambiar ahí.

**Qué necesitamos de ustedes:** la #40. Y dos cosas que la API no hace y son de
la pantalla: **eliminar pide confirmación explícita** y bien diferenciada de dar
de baja —eliminar no se deshace, la baja sí—, y **quien no puede eliminar
(`rh_consulta`) no debería ver la opción**.

### 2026-09-03 16:21:22 · backend · La #38: el refrendo del SIROC se llama «reporte bimestral»

**Leído de ustedes**: `HANDOFF-FRONTEND.md` del 3 sept 12:07:45 (la #33 cerrada;
la #36, el calendario, apenas empezando).

**Hecho.** Los ~25 textos en español que el servidor manda llamando
«actualización» al refrendo del SIROC ahora dicen **reporte bimestral**: los
cuatro estados del seguimiento, los mensajes de validación, y los errores y
confirmaciones de registrar, deshacer, adjuntar y abrir el acuse. Lo pidió
Urbacames, y es la otra mitad de su #37 —las etiquetas de la línea de tiempo—.

**Tres cosas, y sólo la tercera les da trabajo:**

- **No cambió ninguna ruta ni ninguna llave.** `siroc.actualizaciones[]`,
  `actualizacionesRequeridas|Registradas|Pendientes`, `ultimaActualizacion`,
  `requiereActualizacion`, `POST …/siroc/actualizaciones` y el destino de subida
  `siroc-actualizacion` se quedan exactamente igual. Es deliberado (D-89): el
  vocabulario del negocio vive en el texto, no en las llaves, y renombrarlas les
  rompería la pantalla el mismo día sin que el usuario gane nada.
- **El texto nuevo les llega solo**, porque pintan `seguimientoSiroc.mensaje` tal
  cual en `seguimiento-siroc.tsx` y `aviso-cierre-contrato.tsx`. No hay nada que
  consumir distinto.
- **El acuse baja con otro nombre**: `SIR-2026-0001-reporte-bimestral-2026-03-05.pdf`
  en vez de `…-actualizacion-…`. Viaja en `archivo.nombreDescarga`, como siempre.
  Los acuses ya subidos también bajan con el nombre nuevo: se arma al leer y no se
  movió un archivo en R2. **Si alguna prueba suya fija ese nombre o alguno de los
  mensajes, hay que actualizarla** — es lo único que les toca de esto.

Las cadenas exactas, antes y después, están en `plan/handoff/38.md`.

**Qué necesitamos de ustedes:** nada. Cuando tomen la #37, el servidor ya dice
«reporte bimestral», así que las etiquetas y los mensajes van a concordar.
«Registro inicial» se queda con ese nombre en los dos lados.

### 2026-09-03 13:36:58 · backend · La #34: incidencias de la máquina, con su catálogo de tipos

**Leído de ustedes**: `HANDOFF-FRONTEND.md` del 3 sept 12:07:45 (la #33 cerrada,
con el vocabulario «Sin asignar» y la pregunta de los asignables).

**Hecho.** Siete rutas nuevas y dos colecciones. Sobre la máquina:
`POST /maquinas/:id/incidencias` para levantarla, `GET` para listarlas
(`?estado=abiertas|resueltas|todas`) y `POST /incidencias/:id/resolucion` para
cerrarla. Y el catálogo de tipos: `GET`/`POST /tipos-incidencia`,
`PATCH /tipos-incidencia/:id` (renombrar) y `PATCH …/:id/estado` (baja y alta).
Todo en [`ENDPOINTS-MAQUINAS.md`](./ENDPOINTS-MAQUINAS.md) §12 a §18 —que pasó
de 11 a **18 endpoints**— y en `plan/handoff/34.md`.

**Cuatro cosas que hay que saber para la #35:**

- **El trabajador y la obra NO se mandan.** El cuerpo es
  `{ tipoId, descripcion, fechaIncidencia? }` y nada más. Quién tenía la máquina
  ese día sale de cruzar la fecha con su historia, así que una incidencia
  capturada hoy sobre algo de hace un mes señala a quien la traía **entonces**.
  Viaja en `contexto`, con un `texto` ya armado para mostrar.
- **`contexto` tiene tres formas, no dos:** con trabajador y obra; con obra pero
  `empleadoId: null` (su tercer estado, el ámbar); y `sinAsignar: true`, que es
  el «Sin asignar» de ustedes. El `texto` dice «Sin asignar: la máquina estaba en
  el patio» — **si prefieren su vocabulario en pantalla, usen los campos y armen
  el suyo**; el `texto` es una comodidad, no el contrato.
- **El catálogo de tipos es del grupo, no de cada empresa**, y lo escribe quien
  gestiona proyectos (`manageProjects`), no sólo el administrador de plataforma:
  quien captura una incidencia que no encaja puede agregar el tipo ahí mismo. El
  `POST` es **idempotente** —200 si ya existía, 201 si se creó—, como las áreas.
- **Un tipo dado de baja no se ofrece, pero las incidencias viejas lo conservan**
  y salen con `tipo.activo: false`, para que lo puedan señalar. Renombrarlo
  corrige el nombre en todas. Y en el listado, `abiertas` y `resueltas` **no
  cambian con el filtro**: son del total, para que puedan decir «2 abiertas»
  mientras se ven las resueltas.

**Qué necesitamos de ustedes:** nada. Dos avisos: **no hay reapertura** —una
incidencia resuelta responde `409 INCIDENCIA_YA_RESUELTA`, y si se cerró mal se
levanta otra— y **no guardamos quién la levantó ni quién la resolvió**; si lo
quieren en pantalla, dígannoslo y se agrega, que ahora es barato.

**Recortamos, y se avisa:** las entradas de la #30 (3 sept 09:46:59) y la #31
(3 sept 11:10:02) bajaron a un renglón en «Cerrado». Su detalle vive donde tiene
que vivir: `ENDPOINTS-MAQUINAS.md` §1 a §11 y D-86/D-87. Nada de lo que decían se
perdió; esta bitácora ya iba por 750 renglones.

**Sobre los asignables que preguntaron:** nos parece bien y es el `400` el que
está haciendo de filtro, que es justo lo que describen. Propónganlo por el canal
de siempre y lo tomamos; nos inclinamos por `GET /maquinas/:id/asignables`
—acotado a la empresa de la máquina y a quien tenga obra abierta ahí— antes que
por un filtro en `/empleados`, que sería global y no sabría de qué máquina hablan.

### 2026-09-03 01:29:58 · backend · Los tres rangos de fechas de Urbacames, con la #28

**Leído de ustedes**: `HANDOFF-FRONTEND.md` del 3 sept 00:43:58.

**Hecho, dentro de la #28 como pidió el usuario.** Tres `400` nuevos, todos con
el rango en `message`, y la aritmética del refrendo es la que dijeron —
`addMonths(base, 1)` recortado a fin de mes, más 25 días; comprobado que 1 ene →
26 feb y 31 ene → 25 mar—. El SIROC va entre `fechaInicio` y siete días después,
bordes incluidos; el contrato entre `proyecto.fechaInicio` y
`fechaFinReal ?? fechaFinEstimada`, bordes incluidos.

**Lo que decidí de mi lado, y conviene que sepan:** se comprueba **en el
servicio y sólo sobre lo que entra**, nunca sobre lo ya capturado. Una
invariante en el esquema habría reprobado cualquier contrato viejo al cambiarle
el nombre. Por eso `fechaRegistro` sólo se revisa **si cambia** —corregir el
número de un SIROC viejo pasa— y en el `PATCH` sólo se revisan **las fechas que
vienen**. Sin migración.

**De rebote, la #19 de `ESTADO.md` casi se cierra:** con siete días de holgura
la predicción desde `fechaInicio` y el vencimiento desde `fechaRegistro` ya no
pueden separarse.

Detalle en `plan/handoff/28.md` § «Los tres rangos» y D-85. **Siguen 87 rutas.**

**Qué necesita el front**: nada. Sus calendarios ya acotan lo mismo; el `400` es
la red para lo que entre por API.

### 2026-09-03 00:26:33 · backend · Corregido el bug de la #28: el techo corta la cuenta, no la borra

**Leído de ustedes**: `HANDOFF-FRONTEND.md` del 3 sept 00:16:27 (el bug) y
00:01:11 (la #27 consumiendo la #28).

**Tenían razón, y la corrección es la que propusieron.** La rama de «pasado de
fecha» respondía `no_requiere` sin mirar cuántas ventanas faltaban hasta
`fechaFin`, así que deshacer un refrendo en un contrato terminado lo hacía
desaparecer. Ahora esa rama mira la cuenta primero: si queda deuda de cuando el
contrato seguía en curso, responde **`vencida` con esos pendientes** —cortados en
`fechaFin`, ni uno más aunque pasen años—, `requiereActualizacion: true` y un
mensaje propio que dice que se capture con la fecha de entonces. Sólo con la
cuenta en cero queda el `no_requiere` de antes. Su caso (01 ene–30 may, refrendo
del 02 ene, hoy 3 sep) responde `vencida` con 2 pendientes.

**Lo que no cambió:** el `400` del `POST` sigue igual —el refrendo que se debe es
de dentro del contrato y va con fecha de entonces, que su diálogo ya acota—, y
`seguimientoContrato` sigue diciendo `terminado_sin_cerrar` al lado. Los dos se
pintan a la vez, como ya lo tienen.

**Un detalle más que salió de lo mismo:** un contrato **sin SIROC** pasado de
fecha vuelve a decir los pendientes que sus fechas preveían, no `0` — la
predicción ya terminaba en `fechaFin`, así que ahí el techo no borra nada.

Detalle en `plan/handoff/28.md` (aviso al inicio y la sección «Lo que cambió»),
`ENDPOINTS-PROYECTOS.md` §4.1 con el `jsonc` del caso, y D-84 corregida.

**Qué necesita el front**: nada nuevo. Vuelvan a probar el caso del bug; la #27
puede validarse con esto.

### 2026-09-02 23:35:32 · backend · El SIROC deja de pedir refrendos pasada la fecha de fin

**Leído de ustedes**: `HANDOFF-FRONTEND.md` del 2 sept 14:40:00.

**Tarea #28, y es un cambio de comportamiento en algo que ya pintan.** Un
contrato que pasó su `fechaFin` y que nadie finalizó pedía una actualización del
SIROC **cada dos meses, para siempre**. Como nadie corre a cerrar papeles, toda
obra terminada se quedaba en rojo, y quien quería apagarlo capturaba refrendos
que el IMSS nunca pidió — justo la serie de acuses que se enseña en una revisión.
Urbacames contestó: **la fecha de fin del contrato es el techo del cálculo**.

**Qué cambia en la respuesta.** `seguimientoSiroc` no estrena campos ni valores
de enum: ese contrato pasa de `vencida` a `no_requiere`, con
`actualizacionesPendientes: 0`, `requiereActualizacion: false` y
`diasParaActualizacion: null`. **Un contrato dentro de sus fechas no cambia en
nada.**

**Y estrena bloque: `seguimientoContrato`**, en todo contrato. Ahí va el aviso que
antes daba el SIROC, pero por lo que es: `estado: 'terminado_sin_cerrar'`,
`requiereCierre: true` y un mensaje que dice qué hacer. Ese contrato **no queda
en verde**, sólo deja de pedir un trámite que nadie debe. Para pintar el aviso
basta `requiereCierre`.

**Dos trampas.** `actualizacionesPendientes` **ya no es `requeridas −
registradas`**: se cuenta desde donde llega el aviso vigente, así que editar las
fechas recalcula solo y contando los refrendos que ya hay — el `PATCH` devuelve
los dos bloques listos. Y al recortar la fecha puede quedar `registradas: 2` con
`requeridas: 0`: **no es un error de captura**, esos avisos se presentaron de
verdad, y así conviene decirlo.

**Un `400` nuevo** en `POST /contratos/:id/siroc/actualizaciones` cuando la
fecha es posterior a `fechaFin`. Se mira contra la fecha que mandan, no contra
hoy: capturar tarde un refrendo que sí cayó dentro del contrato sigue entrando.
Ante ese error, ofrezcan finalizar o editar `fechaFin`, no reintentar.

En el expediente, `obras[].seguimientoSiroc` se apaga con la misma regla — era
una alarma equivocada en la ficha de una persona. **`GET /alertas` no se tocó**:
el SIROC nunca estuvo ahí.

Detalle completo en `plan/handoff/28.md` y en `ENDPOINTS-PROYECTOS.md` §4.1; el
porqué, en D-84. Sin migración: todo se deriva al leer, así que los contratos que
hoy están en rojo se apagan solos al desplegar. **Siguen 87 rutas en pie.**

**Qué necesita el front**: pintar `seguimientoContrato.requiereCierre` donde hoy
pintan el rojo del SIROC, y dejar de leer «faltan N» como la resta. Nada bloquea:
si no tocan nada, el rojo falso desaparece igual y el bloque nuevo se ignora.

### 2026-09-02 20:51:33 · backend · Los archivos ya no pasan por el servidor

**Leído de ustedes**: `HANDOFF-FRONTEND.md` del 2 sept 14:40:00.

**Tarea #22, y sale de un bug que encontramos entre los dos.** Subir un contrato
de 12 MB a producción no terminaba nunca. Lo medimos: el tramo del equipo al
borde público de Fly va a **7 KB/s**, contra **1 MB/s** de la misma máquina a
Cloudflare. No era el navegador —`curl` fallaba igual—, ni HTTP/2, ni IPv6, ni el
operador: por un túnel directo a la máquina, el mismo archivo sube en 13
segundos. Es el edge de Fly, y sólo de subida.

**La salida es sacar el archivo de nuestro camino.** `POST /subidas` da una URL
firmada, el navegador sube **directo a R2** —donde ya medimos 1 MB/s—, y después
llama a **la ruta de siempre** con `subidaId` en el cuerpo. Vale para los cinco
adjuntos: expediente, contrato, aviso del SIROC, acuse del refrendo y registro de
obra.

**Lo importante para ustedes: es opcional.** El `multipart` de hoy sigue
funcionando en las nueve rutas, sin fecha de apagado. Migren una pantalla, vean
cómo va, y sigan.

**Tres cosas que se rompen si no se leen:** el `tamanoBytes` tiene que ser exacto
(`File.size`) porque va firmado; el `PUT` a R2 lleva el archivo **en crudo**, no
`FormData`; y la barra de progreso pasa a ser de esa petición, no de la nuestra.
Los 5 minutos de espera que pusieron para `FormData` dejan de hacer falta en este
camino.

**CORS ya está puesto** en el bucket para su origen de producción y
`localhost:5174`, sólo `PUT`. Otro puerto, avisen.

Detalle completo en `plan/handoff/22.md` y en `docs/ENDPOINTS-SUBIDAS.md`; el
porqué, con las cuatro mediciones, en D-83. **Van 87 rutas en pie.**

**Qué necesita el front**: una tarea para usarlo. No bloquea nada: hoy todo sigue
subiendo como antes —salvo los archivos grandes en producción, que es justo lo
que esto arregla—.

### 2026-09-02 16:58:04 · backend · El proyecto ya no habilita puestos

**Leído de ustedes**: `HANDOFF-FRONTEND.md` del 2 sept 14:40:00 (tarea #18).
Gracias por el dato de los 30 s de axios; queda anotado.

**Tarea #20, y les cambia el modal de proyecto.** `categorias` **desaparece**:
del `POST /proyectos`, del `PATCH` y de la respuesta. La parrilla de 23 casillas
del alta se queda sin dato al que apuntar — eso es la #21.

**Se cae una ruta**: `POST /proyectos/:id/categorias/clonar` ya no existe, así
que hay que quitar la llamada de `proyectos-service.ts` y su hook. **Van 86 rutas
en pie**, no 87.

**Mandar `categorias` en el `POST` no rompe**: sobra y se ignora, para que su
despliegue no tenga que ir al minuto con el nuestro. En el `PATCH` **sí da
`400`**: ahí la lista de campos editables siempre ha sido cerrada.

**Lo que van a notar sin tocar nada:** `GET /proyectos/:id/asignables` ahora
devuelve a **todo** el personal adscrito y activo de la empresa —administrativos
incluidos, y también a quien consulta si está adscrito ahí—, no sólo a los del
puesto habilitado. Si esa lista se les hace larga, un buscador de su lado.

**`categoriaId` al asignar pasa a opcional** y cae en el puesto de la persona.
Lo que mandan hoy sigue valiendo igual: no hay que tocarlo.

Detalle completo en `plan/handoff/20.md`; el porqué, en D-82.

**Qué necesita el front**: la tarea #21. Nada bloquea de nuestro lado.

### 2026-09-02 13:58:17 · backend · El contrato lleva su papel, y el tope de subida sube a 30 MB

**Leído de ustedes**: `HANDOFF-FRONTEND.md` del 2 sept 11:34:56 (tarea #16, con
sus tres vueltas). Gracias por la corrección de `subidoPor`.

**Lo que más les cambia (tarea #17): el tope de subida eran 10 MB y ahora son 30.** Era `MAX_UPLOAD_BYTES` y nada más —el `express.json` de 1 MB no ve el
`multipart`, Fly no impone tope y R2 admite mucho más—. Sube para **todos** los
adjuntos: contrato, expediente, registro de obra y los papeles del SIROC. Su
validación de `utils/archivos.ts` se puede subir de un tirón, **menos en un
sitio**: la **importación de nómina** se queda en **10 MB** a propósito, porque
ahí el `.xlsx` se abre entero en memoria y un archivo grande tumba el servidor en
vez de subirse. El `413` dice el tope de la ruta que rechazó, así que su
`message` ya trae la cifra correcta.

**Y el contrato ya lleva su archivo.** `Contrato` gana `archivo` —la misma forma
de siempre, `null` cuando no hay—. Se sube por las dos rutas que ya usan:
`POST /proyectos/:id/contratos` y `PATCH /contratos/:id` aceptan `multipart` con
el campo `archivo`, y las dos siguen aceptando el mismo JSON. **Un `PATCH` con
sólo el archivo y ningún campo es válido**: es la lección de la #15 —el papel
llega días después que las fechas—, así que esta vez la salida para adjuntarlo
tarde va desde el principio y no hizo falta ruta nueva. Detalle completo en
`plan/handoff/17.md`; el porqué, en D-81.

**Dónde les llega el enlace, sin pedir nada:** en todo `contrato` y en
**`obras[].contrato.archivo` del expediente**, junto al `obras[].siroc` que ya
estaba ahí.

**Una ruta nueva**, de sólo lectura y con **sesión y alcance** nada más (subir sí
exige `rh_admin`/`jefe_area`): `GET /contratos/:id/archivo`, para pedir un enlace
fresco — la `url` caduca a los 10 minutos, como ya saben. **Van 87 rutas en pie.**

**El nombre de descarga**, ojo, no es un número como en la #13 y la #15: aquí se
usa `nombre`, si no hay `fase`, y si tampoco, el ordinal → `Contrato 2.pdf`.

**Qué necesita el front**: la tarea #18. Nada bloquea de nuestro lado.

### 2026-09-02 12:07:51 · backend · El acuse de un refrendo ya capturado se puede subir después

**Leído de ustedes**: su revisión de la #15 (2 sept), la del hueco de los acuses.

**Tenían razón y está hecho.** Ruta nueva:
**`PUT /contratos/:id/siroc/actualizaciones/:indice/archivo`**, `multipart` con el
campo `archivo` —**obligatorio aquí**, es lo único que hace—, que le pone el acuse
a una renovación **ya capturada** o reemplaza el que tenga.

`PUT` y no `POST` porque el recurso es el archivo de esa posición y esto lo
reemplaza entero: comparte camino con el `GET` que ya usan para leerlo. Si
prefieren otro verbo, se cambia — es una línea del router.

- **Sirve para cualquiera**, no sólo la última: las de en medio ya se pueden tocar.
- **Toca sólo el archivo.** Ni fecha, ni nota, ni orden, ni la cuenta de refrendos,
  ni `seguimientoSiroc` — hay una prueba que compara el bloque entero antes y
  después, porque el argumento de ustedes era justamente ése.
- **Se puede aunque el contrato esté finalizado**: el acuse que llega tarde es el
  caso que resuelve.
- Reemplaza borrando el anterior de R2; mismos tipos y mismo límite que el aviso.
- **Permiso:** `rh_admin` o `jefe_area`, el mismo que capturar el refrendo. El
  `GET` de esa misma ruta sigue con sesión y alcance.
- `400` sin archivo (`errors[0].msg`), `400` si el contrato no tiene SIROC, `404`
  si la posición no existe, `415` si el tipo no va — y el refrendo se queda
  exactamente como estaba.

Detalle en `plan/handoff/15.md` §«Ponerle el acuse a un refrendo ya capturado» y en
D-80. **Van 86 rutas en pie.**

**Lo que NO se agregó:** un `PUT /siroc/archivo` simétrico para el aviso. Ustedes
ya lo resuelven reenviando el `PUT /siroc` —y su lectura del código es correcta:
`#buscarChoqueDeSiroc` excluye al propio contrato, así que no hay 409 contra sí
mismo, y el `PUT` conserva las actualizaciones con sus acuses—. Si lo quieren por
simetría, dígannos y se agrega.

**Su corrección anotada:** `Archivo.subidoPor` es `string | null`, sí — el
esquema lo permite en `null` y por eso el tipo lo dice, aunque las rutas de subida
de hoy siempre escriben un nombre (`'Sistema'` si la petición no trae usuario).
Gracias por avisar.

### 2026-09-02 10:33:24 · backend · El SIROC lleva su aviso escaneado, y cada refrendo su propio acuse

**Leído de ustedes**: `HANDOFF-FRONTEND.md` del 1 sept 16:36:01 (tarea #14).

**Qué se hizo (tarea #15).** El SIROC ya puede llevar **dos clases de archivo**:
`siroc.archivo`, el aviso escaneado, y `siroc.actualizaciones[n].archivo`, el
acuse de **ese** refrendo. Los dos opcionales. Son separados a propósito:
refrendar cada dos meses no sustituye al aviso —el número no cambia—, y lo que se
enseña si el IMSS revisa es la serie completa. `PUT /contratos/:id/siroc` y
`POST /contratos/:id/siroc/actualizaciones` aceptan `multipart` con el campo
`archivo` y **siguen aceptando el mismo JSON de siempre**. Forma exacta, errores y
permisos en `plan/handoff/15.md`; el porqué, en D-80.

**Dónde les llega el enlace, sin pedir nada:** en todo `contrato` y —esto es lo
que quizá no esperaban— en **`obras[].siroc` del expediente**
(`GET /empleados/:id/expediente`, lo de la #12). Ahí el aviso y cada acuse vienen
con su `url` firmada, así que la pantalla del expediente puede ofrecer el papel
sin ir al proyecto.

**Lo que hay que tener en cuenta:**

- **Corregir el SIROC no tira ningún papel.** `PUT /siroc` conserva el archivo del
  aviso y los de todos los refrendos; sólo reemplaza el del aviso si mandan uno
  nuevo, y entonces borra el anterior. `DELETE /siroc` se lleva todos.
- **Los refrendos se piden por posición, no por id**: no tienen `_id`.
  `GET /contratos/:id/siroc/actualizaciones/0/archivo`. El índice es estable
  porque el arreglo sólo crece y sólo se quita la última.
- **`nombreDescarga` es el del dato**, como en la #13: `SIR-2026-0001.pdf` el
  aviso, `SIR-2026-0001-actualizacion-2026-03-05.pdf` cada acuse.
- **El tope sigue en 10 MB.** Subirlo es la #17; su validación de
  `utils/archivos.ts` sigue siendo correcta hasta entonces.

Dos rutas nuevas, las dos de sólo lectura y con **sesión y alcance** nada más
(subir sí exige `rh_admin`/`jefe_area`): `GET /contratos/:id/siroc/archivo` y
`GET /contratos/:id/siroc/actualizaciones/:indice/archivo`, para pedir un enlace
fresco — la `url` de la respuesta caduca a los 10 minutos, como ya saben. **Van 85
rutas en pie.**

**Qué necesita el front**: la tarea #16. Nada bloquea de nuestro lado.

### 2026-09-01 15:41:58 · backend · El registro de obra lleva su papel, y se abrieron los tipos de archivo

**Leído de ustedes**: `HANDOFF-FRONTEND.md` del 1 sept 12:01:42.

**Qué se hizo (tarea #13).** El registro de obra del cliente ya puede llevar su
**archivo escaneado**: opcional al crearlo, reemplazable al editarlo, y con el
enlace firmado en **todos** los lugares donde ya les llega el registro —el
cliente y su listado, `proyecto.registroObra` y la cadena de
`GET /asignaciones/:id`—. Las dos rutas siguen aceptando `application/json` sin
archivo, así que **lo que mandan hoy funciona igual**. Detalle completo, con la
forma exacta y los errores, en `plan/handoff/13.md`.

**Su consulta, contestada:** el archivo se descarga con **el número del registro
de obra** (`OB-2026-0145.pdf`), no con el nombre que traía. Ya va en la cabecera
de la URL firmada; el campo `nombreDescarga` está para que lo puedan mostrar
antes de bajarlo.

**Lo que sí les cambia lo que ya tienen (D-78).** Se abrieron los tipos **en
todo el backend, expediente incluido**: además de PDF, JPG, PNG y WEBP ahora se
aceptan **DOC, DOCX, XLS, XLSX y CSV**. Con eso, cada `archivo` —el del registro
de obra y **el de cada documento del expediente**— trae
**`previsualizable: boolean`**. En `false` la URL firmada se emite **siempre como
descarga**, sin que ustedes pidan `?descargar=true`: ahí no ofrezcan visor. Si su
interfaz abre todo en un visor, ése es el punto a tocar.

**Una ruta nueva**: `GET /clientes/:id/registros-obra/:roId/archivo`, para pedir
un enlace fresco —la `url` de la respuesta caduca a los 10 minutos— sin recargar
el cliente entero. Van 83 rutas en pie.

**Qué necesita backend**: nada. El límite sigue en **10 MB** y subirlo es la
tarea #17, así que si les rebota un contrato grande, es eso y ya está en el plan.

**Aviso de recorte**: las cuatro entradas de las tareas **#9 y #11** —que ustedes
ya dieron por buenas el 1 sept 12:01:42— bajaron a dos renglones en «Cerrado». Lo
que decían sigue completo en `plan/handoff/9.md` y `plan/handoff/11.md`, en
`ENDPOINTS-PROYECTOS.md` §4.1, `ENDPOINTS-EXPEDIENTES.md` §1-2 y en D-76 y D-77.
Sigue anotado lo que quedó abierto de ahí: **faltan alertas del SIROC** en
`GET /alertas`, y se propondrá como tarea aparte.

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
| 3 sept 2026 | Tarea #31: la máquina se asigna a un trabajador y toma SU obra; cuando él se va pierde a la persona, no la obra (D-87)                                         | `plan/handoff/31.md`, [`ENDPOINTS-MAQUINAS.md`](./ENDPOINTS-MAQUINAS.md) §7-11, [`DECISIONES.md`](./DECISIONES.md) D-87                        |
| 3 sept 2026 | Tarea #30: el catálogo de maquinaria por empresa, con su imagen (D-86)                                                                                         | `plan/handoff/30.md`, [`ENDPOINTS-MAQUINAS.md`](./ENDPOINTS-MAQUINAS.md) §1-6, [`DECISIONES.md`](./DECISIONES.md) D-86                         |
| 1 sept 2026 | Tarea #11: el expediente dice bajo qué SIROC trabaja la persona (`obras`, derivado al leer, D-77)                                                              | `plan/handoff/11.md`, [`ENDPOINTS-EXPEDIENTES.md`](./ENDPOINTS-EXPEDIENTES.md) §1-2, [`DECISIONES.md`](./DECISIONES.md) D-77                   |
| 1 sept 2026 | Tarea #9: el SIROC se actualiza cada 2 meses, sin fecha final, y la migración corrió en local y en Fly                                                         | `plan/handoff/9.md`, [`ENDPOINTS-PROYECTOS.md`](./ENDPOINTS-PROYECTOS.md) §4.1, [`DECISIONES.md`](./DECISIONES.md) D-76                        |
| 29 ago 2026 | Barrida de documentación desfasada, y guardia automática de las cifras                                                                                         | `tests/unitarias/docs.test.js`; el aviso de `/organizacion` sigue en «Pendientes»                                                              |
| 29 ago 2026 | Adoptados `modelo-datos.md` y `backend-spec.md`, con la versión del front como base                                                                            | Los dos documentos, y sus encabezados dicen desde cuándo son nuestros                                                                          |
| 29 ago 2026 | Creada esta bitácora, y el reparto de documentos con el front                                                                                                  | Arriba, «Cómo funciona»                                                                                                                        |
| 29 ago 2026 | La cadena de la obra completa, sus ocho fases (D-65 a D-72): registros patronales y de obra, contratos, SIROC, candados del proyecto y coherencia con la gente | [`PLAN-OBRA-CONTRATOS.md`](./PLAN-OBRA-CONTRATOS.md), [`ENDPOINTS-PROYECTOS.md`](./ENDPOINTS-PROYECTOS.md), [`DECISIONES.md`](./DECISIONES.md) |
| 29 ago 2026 | Alertas derivadas al leer, sin nada que marcar (D-47)                                                                                                          | [`ENDPOINTS-ALERTAS.md`](./ENDPOINTS-ALERTAS.md)                                                                                               |
| 28 ago 2026 | Importación de colaboradores desde el `.xlsx` de nómina, reejecutable sin duplicar (D-46)                                                                      | [`ENDPOINTS-IMPORTACION.md`](./ENDPOINTS-IMPORTACION.md), [`PLAN-IMPORTACION-XLSX.md`](./PLAN-IMPORTACION-XLSX.md)                             |
