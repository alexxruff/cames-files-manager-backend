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

- [ ] **Borren sus `modelo-datos.md` y `backend-spec.md`.** Ya están adoptados
      aquí, con lo suyo dentro — ver la entrada de las 23:27:05. A partir de
      ahora se leen en `cames-files-manager-backend/docs/`.
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
