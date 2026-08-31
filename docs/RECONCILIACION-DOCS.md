# Reconciliación de la documentación — 31 ago 2026

**Qué se hizo:** `modelo-datos.md` y `backend-spec.md` existían dos veces, una en
cada repo, y ya no decían lo mismo. Aquí queda **una sola versión de cada uno, la
de este repo**, contrastada contra lo que el código hace de verdad.

Este informe es el registro de la decisión, diferencia por diferencia. No hay que
leerlo para trabajar; hay que leerlo para **auditar por qué un párrafo se quedó y
otro se fue**.

- Copias comparadas: `cames-files-manager-backend/docs/` contra
  `cames-files-manager/docs/`, ambas del 30 ago 2026.
- Contraste contra el código: `npm run esqueleto` — 14 colecciones, 243 campos,
  41 índices (19 únicos), 65 rutas.
- Lo que impide que se vuelva a desfasar: `tests/unitarias/docs.test.js`.

---

## 0. La premisa de la tarea era falsa

La tarea decía: «la copia buena hoy es la del frontend: tiene la cadena de la
obra (D-68 a D-72) que la de backend no tiene». **Ya no era cierto al empezar.**

|                 | `modelo-datos.md`               | `backend-spec.md`    |
| --------------- | ------------------------------- | -------------------- |
| Este repo       | D-68 … **D-73**, 14 colecciones | D-71, D-72, **D-73** |
| Copia del front | D-68 … D-72                     | D-71, D-72           |

La copia del front es la foto del 28 ago: dice «el front todavía asume el modelo
anterior», habla de 12 colecciones y lista como «por construir» las
adscripciones, las alertas y R2, que llevan días respondiendo. **La
reconciliación fue hacia este repo**, cosechando de la del front lo que sólo
estaba allá.

Aviso para quien venga después: el `CLAUDE.md` del repo del front todavía dice
que su copia es la buena y que el traspaso está a medias. **Eso ya no es cierto**
y es trabajo suyo corregirlo — anotado en
[`HANDOFF-BACKEND.md`](./HANDOFF-BACKEND.md).

---

## 1. Diferencias entre las dos copias

Cada renglón: qué decía la copia del front, qué se decidió y por qué.

### `modelo-datos.md`

| #   | Lo que sólo tenía la copia del front                                                                    | Decisión                                                           | Por qué                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | «El front todavía asume el modelo anterior; no se ha tocado, a petición del cliente»                    | **Descartado**                                                     | Falso desde el 29 ago: el front ya migró. La versión de aquí lo dice y conserva §11 como historia, no como pendiente                                                                                                                                                                                                                 |
| 2   | Tabla de colecciones con nombres en español (11 filas)                                                  | **Descartado; la idea ya está incorporada**                        | Las columnas «Naturaleza» y «Pertenece a» valían y están en la tabla de aquí, con las **14** colecciones, el nombre real de MongoDB y el enlace a su §5. Los nombres en español eran del contrato, no de la base: confundían las dos capas                                                                                           |
| 3   | `curp: { required: true, unique: true }`                                                                | **Descartado**                                                     | Describe un esquema que no existe. El código la tiene **opcional** con índice único **parcial** (`$type: 'string'`, D-28). La decisión de exigirla desde el alta sigue abierta: `ESTADO.md` #2                                                                                                                                       |
| 4   | Nota «La CURP es obligatoria y es la clave de identidad»                                                | **Incorporada a medias**                                           | «Es la clave de identidad» se queda: es el porqué del modelo. «Es obligatoria» se va, por lo del renglón anterior                                                                                                                                                                                                                    |
| 5   | `faltantes = pending o rejected`, «un rechazado cuenta como faltante»                                   | **Descartado como regla del backend, conservado como divergencia** | El código cuenta sólo los `pending` (`src/utils/domain/progress.js`, con prueba). La versión de aquí ya documenta que el front cuenta distinto y que **el número que ve el usuario es el del backend**. Es una diferencia de comportamiento **sin decidir**, no un error de documentación: no se resuelve reescribiendo un documento |
| 6   | Lista de índices sin `numeroEmpleado` ni los de `contratos`, y con `bitacora_accesos` por `access_logs` | **Descartado**                                                     | Desfasada. La de aquí trae los 41 índices que el extractor encuentra en el código                                                                                                                                                                                                                                                    |
| 7   | §12 con las seis preguntas abiertas                                                                     | **Descartado**                                                     | Cuatro ya están cerradas. La tabla de aquí dice **cómo quedó cada una** y añade la séptima —los datos de nómina— que es la que hoy bloquea al front                                                                                                                                                                                  |
| 8   | Enlaces a `flujo-expedientes.md`, `backend-actual.md`, `mocks.md`                                       | **Ya incorporados**                                                | Están en la tabla «en el repo del front», que dice explícitamente que se leen allá y no se copian                                                                                                                                                                                                                                    |

### `backend-spec.md`

| #   | Lo que sólo tenía la copia del front                                                          | Decisión           | Por qué                                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9   | Aviso «este archivo es una copia espejo»                                                      | **Descartado**     | Es justo lo que esta tarea elimina                                                                                                                                                                                                                                   |
| 10  | «Toda la lógica está implementada y probada **en el front** y debe replicarse en el servidor» | **Descartado**     | Ya está de los dos lados. Lo que importa —quién manda cuando difieren— lo dice la versión de aquí: manda el backend                                                                                                                                                  |
| 11  | Tabla «qué existe hoy» con alertas, R2, áreas, contratos e importación como pendientes        | **Descartado**     | Cinco piezas que llevan días respondiendo                                                                                                                                                                                                                            |
| 12  | Árbol de carpetas con `alcanceMiddleware.js`, `utils/dominio/`, `validations/`                | **Descartado**     | Nombres que no existen: son `scopeMiddleware.js` y `utils/domain/`, y no hay `validations/`. La versión de aquí trae los reales y la nota de por qué el código va en inglés                                                                                          |
| 13  | Fechas sueltas («25 ago 2026») donde aquí hay decisiones (D-51, D-53, D-54)                   | **Descartado**     | La fecha no se puede seguir hasta el porqué; el número de decisión sí                                                                                                                                                                                                |
| 14  | Enlaces a `backend-actual.md` como detalle de áreas y adscripciones                           | **Descartado**     | El detalle vive aquí: `ENDPOINTS-AREAS.md` y `ENDPOINTS-ADSCRIPCIONES.md`                                                                                                                                                                                            |
| 15  | «Esquemas de Mongoose de las 12 colecciones»                                                  | **Descartado**     | Son 14, y hay una prueba que lo comprueba contra los modelos registrados                                                                                                                                                                                             |
| 16  | `POST /categorias` sin mención de `tipo`                                                      | **Descartado**     | Hoy `tipo` es obligatorio al crear un puesto y `GET` acepta `?tipo=`                                                                                                                                                                                                 |
| 17  | Renglón «Casos borde cubiertos — `src/utils/__tests__/`, `src/mocks/__tests__/`»              | **✅ Incorporado** | Es lo único que la copia del front tenía y aquí faltaba: dice **dónde está probada su mitad del comportamiento**, que es lo primero que se quiere abrir cuando el avance o el semáforo no coinciden. Los dos directorios existen; se verificaron antes de escribirlo |

**Resumen de los 17 renglones: 1 incorporación (#17), 1 parcial (#4), 1 que ya
estaba incorporada de antes (#8) y 14 descartes.** Ninguna información se
perdió: los catorce descartes son versiones viejas de algo que esta copia ya
dice mejor, o afirmaciones que el código desmiente.

---

## 2. Diferencias entre la documentación y el código

Todo lo de aquí salió de cruzar los dos documentos contra `npm run esqueleto` y
contra el inventario que deriva el router. **Todo está corregido.**

### Rutas

| #   | Qué decía                                                                                                                                                                              | Qué pasa de verdad                                                                                                               | Corrección                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 18  | «`/adscripciones` (listado global, alta, edición y baja) — **Implementado y conectado**»                                                                                               | **No existe.** El router sólo tiene `PATCH /adscripciones/:id`, `/estado` y `/jefaturas`; se listan y se dan de alta por empresa | Renglón reescrito: qué hay de verdad, y una línea aparte diciendo que el listado global no existe **ni está pedido**                                        |
| 19  | El catálogo de §6 listaba `GET /empleados/:id/adscripciones`, `/empleados/:id/asignaciones`, `/organizacion`, `/dashboard/metricas` y `/reportes/expedientes` como cualquier otra ruta | Las cinco están **declaradas pendientes** en el router y responden `404`                                                         | Las cinco marcadas **«Por construir»** en su propio renglón. Estaban en `RUTAS_PENDIENTES` desde hace tiempo: el código lo sabía y el documento no lo decía |
| 20  | `GET`/`PATCH /plantillas-checklist`, declarada pendiente en el router, **no aparecía en el spec**                                                                                      | El front no tenía cómo enterarse de que falta                                                                                    | Renglón nuevo en §6.5, marcado «Por construir»                                                                                                              |
| 21  | «`POST /auth/recuperar` y `/restablecer` siguen pendientes»                                                                                                                            | La segunda es `POST /auth/restablecer`                                                                                           | Escrita completa. Un tramo suelto no se puede cruzar contra el router                                                                                       |

### Campos

| #   | Qué decía `modelo-datos.md`                                                                 | Qué dice el código                                                                                                    | Corrección                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 22  | `empleados.acceso.password` embebido en el subdocumento                                     | **La contraseña no está ahí**: vive en `credentials`, aparte (D-27), porque las agregaciones ignoran `select: false`  | Quitado del bloque, con el comentario que dice dónde vive y por qué. Era la corrección más urgente: el `CLAUDE.md` advierte de no re-embeberla y el esquema del documento invitaba justo a eso |
| 23  | `acceso.ultimoAccesoEn`                                                                     | No existe en `empleados`. El último acceso lo lleva la credencial; lo que sí existe es `acceso.passwordActualizadaEn` | Sustituido, con la nota de dónde está el último acceso                                                                                                                                         |
| 24  | `empleados` terminaba en `activo`                                                           | Existen además `motivoBaja`, `fechaBaja` y `nombreNormalizado`                                                        | Agregados                                                                                                                                                                                      |
| 25  | `categorias` sin `tipo`, con una nota debajo diciendo «el esquema de arriba se quedó corto» | `tipo` es **obligatorio**                                                                                             | Metido en el bloque. La nota se queda, recortada: explica que está de salida (D-73)                                                                                                            |
| 26  | `plantillas_checklist` sin `clave`, y `areas` con `enum: AREAS`                             | `clave` existe (D-24) y `areas` **ya no** lleva enum: las áreas son una colección desde D-58                          | Los dos corregidos                                                                                                                                                                             |
| 27  | `adscripciones` sin `nomina` ni `payrollSnapshot`                                           | Los dos existen                                                                                                       | Agregados como comentario, diciendo qué guardan y por qué no se devuelven                                                                                                                      |

### Lo que se revisó y estaba bien

- **`CONTRATO-API.md`**: 100 rutas citadas, todas vivas. No se tocó.
- **`ARQUITECTURA-DATOS.md`**: sin rutas inventadas; sus cifras ya las vigila
  `docs.test.js`.
- Los enums de `backend-spec.md` §4 contra `src/constants/`: los 12 documentos,
  los 8 sensibles, los 2 que caducan, los estatus y los niveles de acceso,
  exactos.
- El árbol de carpetas de §3 y los esquemas de `empresas`, `clientes`,
  `proyectos`, `contratos`, `expedientes`, `carteras` y `asignaciones`.

---

## 3. El candado

Corregir los documentos una vez no sirve de nada: se vuelven a desfasar en la
siguiente entrega. `tests/unitarias/docs.test.js` ya comparaba las **cifras**
contra el código; ahora compara también las **rutas**, con tres desenlaces:

| La ruta citada…                                                                     | Resultado                                |
| ----------------------------------------------------------------------------------- | ---------------------------------------- |
| existe en el router                                                                 | pasa                                     |
| no existe, pero está en `RUTAS_PENDIENTES` **y** el renglón la marca como pendiente | pasa                                     |
| cualquier otra cosa                                                                 | **falla**, con archivo y número de línea |

Las dos condiciones del caso de en medio son a propósito: que el código sepa que
una ruta falta no sirve de nada si quien lee la tabla no lo ve. Hay una tercera
prueba al revés —una ruta pendiente en el código que ningún documento menciona—,
que es la que destapó lo de `/plantillas-checklist` (#20).

Cubre `backend-spec.md`, `modelo-datos.md` y `CONTRATO-API.md`.

---

## 4. Lo que quedó fuera

- **No se tocó el repo del front.** Sus dos copias siguen ahí; borrarlas es su
  tarea #3. Lo que necesitan para hacerla está en
  `cames-ops/plan/handoff/2.md`.
- **`INTEGRACION-FRONTEND.md` no entra en el candado.** Su tabla de migración
  cita rutas muertas a propósito (`GET /users`, `POST /auth/register`) para decir
  «antes esto, ahora aquello». Distinguirlas exige una regla de exclusión que hoy
  no vale lo que cuesta; ese documento ya tiene su propio candado, el de §9.
- **La divergencia de `faltantes` sigue abierta** (#5). Es comportamiento, no
  documentación: se cierra cuando el front diga con cuál se quedan.
- **Los datos de nómina siguen sin exponerse.** Decisión abierta #10 de
  `ESTADO.md`; esta tarea no la toca.
- **`modelo-datos.md` no se reescribió.** Sigue siendo el diseño y su porqué, con
  sus derivas anotadas. Para saber qué hay hoy, `ARQUITECTURA-DATOS.md`.
