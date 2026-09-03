# El catálogo de maquinaria

Referencia de los **18 endpoints** de la maquinaria por empresa (tareas #30, #31
y #34; D-86, D-87 y D-88) para el equipo de front. Base: `/api/v1`. Envelope, códigos y
convenciones generales: [`INTEGRACION-FRONTEND.md`](./INTEGRACION-FRONTEND.md).

> **Qué es.** Cada empresa tiene su catálogo de **maquinaria y equipo de
> trabajo**. Una máquina tiene tres datos —el identificador con el que la
> empresa la conoce, el modelo y una foto— y se da de alta, se edita, se da de
> baja y se reactiva. **Sólo se ve dentro del alcance de la empresa.** Y se
> **asigna a un trabajador**, con lo que se va a la obra donde él está: la
> máquina dice quién la tiene, la obra dice qué máquinas hay, y queda la
> historia de por dónde ha andado. Y se le **levantan incidencias** —una falla,
> un golpe, un servicio—, de un tipo elegido de un catálogo que ellos alimentan,
> que dicen solas quién tenía la máquina ese día y en qué obra.

## Índice

| #   | Endpoint                             | Quién                    |
| --- | ------------------------------------ | ------------------------ |
| 1   | `GET /empresas/:id/maquinas`         | sesión                   |
| 2   | `POST /empresas/:id/maquinas`        | `rh_admin` · `jefe_area` |
| 3   | `GET /maquinas/:id`                  | sesión                   |
| 4   | `PATCH /maquinas/:id`                | `rh_admin` · `jefe_area` |
| 5   | `PATCH /maquinas/:id/estado`         | `rh_admin` · `jefe_area` |
| 6   | `GET /maquinas/:id/imagen`           | sesión                   |
| 7   | `POST /maquinas/:id/asignacion`      | `rh_admin` · `jefe_area` |
| 8   | `POST /maquinas/:id/devolucion`      | `rh_admin` · `jefe_area` |
| 9   | `GET /maquinas/:id/historial`        | sesión                   |
| 10  | `GET /proyectos/:id/maquinas`        | sesión                   |
| 11  | `GET /empleados/:id/maquinas`        | sesión                   |
| 12  | `GET /maquinas/:id/incidencias`      | sesión                   |
| 13  | `POST /maquinas/:id/incidencias`     | `rh_admin` · `jefe_area` |
| 14  | `POST /incidencias/:id/resolucion`   | `rh_admin` · `jefe_area` |
| 15  | `GET /tipos-incidencia`              | sesión                   |
| 16  | `POST /tipos-incidencia`             | `rh_admin` · `jefe_area` |
| 17  | `PATCH /tipos-incidencia/:id`        | `rh_admin` · `jefe_area` |
| 18  | `PATCH /tipos-incidencia/:id/estado` | `rh_admin` · `jefe_area` |

«Sesión» es cualquier usuario con alcance sobre la empresa. `rh_consulta`
consulta y no escribe: la capacidad es `manageProjects`, la misma que los
proyectos y los contratos, porque la maquinaria es de la obra.

---

## La forma de una máquina

Es la misma en las seis respuestas:

```jsonc
{
  "_id": "66f1…",
  "empresaId": "66a0…",
  "identificador": "ECO-12", // tal como se tecleó
  "modelo": "CAT 320D",
  "imagen": {
    // null si no tiene
    "nombre": "foto patio (1).png", // el original, para mostrar
    "nombreDescarga": "ECO-12.png", // con el que se guarda al bajarla (D-78)
    "mime": "image/png",
    "tamanoBytes": 184320,
    "previsualizable": true, // siempre true: sólo entran imágenes
    "subidoPor": "Ana Ruiz",
    "subidoEn": "2026-09-03T15:22:04.113Z",
    "url": "https://…" // FIRMADA, caduca a los 10 minutos
  },
  "activo": true,
  // Quién la tiene y en qué obra. `null` = en el patio, disponible.
  // NO es un campo de la máquina: se resuelve al leer (D-87).
  "asignacion": {
    "_id": "6710…", // el tramo, no la máquina
    "maquinaId": "66f1…",
    "empleadoId": "66b2…", // null = en la obra, SIN trabajador
    "empleadoNombre": "Juan Pérez",
    "proyectoId": "66c3…",
    "proyectoNombre": "Fraccionamiento Sur",
    "asignacionId": "66d4…", // la asignación del trabajador de la que tomó la obra
    "fechaAsignacion": "2026-08-10",
    "fechaDevolucion": null,
    "motivoCierre": null,
    "motivoCierreTexto": null,
    "vigente": true,
    "dias": 25 // días naturales, contando hasta hoy
  },
  "createdAt": "2026-09-03T15:22:04.113Z",
  "updatedAt": "2026-09-03T15:22:04.113Z"
}
```

```ts
interface Maquina {
  _id: string
  empresaId: string
  identificador: string
  modelo: string
  imagen: Adjunto | null // el mismo `Adjunto` del contrato y del registro de obra
  activo: boolean
  asignacion: Tramo | null // null = en el patio, disponible
  createdAt: string
  updatedAt: string
}

interface Tramo {
  _id: string
  maquinaId: string
  empleadoId: string | null // null = en la obra, sin trabajador
  empleadoNombre: string | null
  proyectoId: string
  proyectoNombre: string | null
  asignacionId: string | null
  fechaAsignacion: string // 'YYYY-MM-DD'
  fechaDevolucion: string | null
  motivoCierre: MotivoCierre | null
  motivoCierreTexto: string | null // el mismo motivo, para mostrar
  vigente: boolean
  dias: number // inclusivos; el vigente cuenta hasta hoy
}

type MotivoCierre =
  | 'devolucion'
  | 'reasignacion'
  | 'baja_de_maquina'
  | 'salida_de_obra'
  | 'baja_de_trabajador'
```

**Tres estados de una máquina, y los tres se leen de `asignacion`:**

| `asignacion`           | Qué significa                                 |
| ---------------------- | --------------------------------------------- |
| `null`                 | En el patio. Disponible                       |
| con `empleadoId`       | Con esa persona, en esa obra                  |
| con `empleadoId: null` | En la obra, **sin trabajador**. Pide atención |

---

## 1. `GET /empresas/:id/maquinas`

El catálogo de la empresa. **Sin paginar**, ordenado por identificador con
orden natural (`ECO-2` antes que `ECO-10`).

| Query              | Tipo    | Por omisión | Qué hace                                                  |
| ------------------ | ------- | ----------- | --------------------------------------------------------- |
| `incluirInactivas` | boolean | `false`     | Suma las de baja. Sin esto, sólo las activas              |
| `busqueda`         | string  | —           | Por identificador **o** modelo, sin acentos ni mayúsculas |

```jsonc
// data
{
  "total": 2,
  "maquinas": [ { …Maquina }, { …Maquina } ]
}
```

- `404` si la empresa no está al alcance de la sesión. **No es `403`** y no es
  lista vacía: para esa sesión, la empresa no existe.

## 2. `POST /empresas/:id/maquinas` → `201`

Dos formas de mandarla, y las dos devuelven `{ maquina }`:

```jsonc
// application/json — sin foto, o con la foto ya subida directo a R2 (D-83)
{ "identificador": "ECO-12", "modelo": "CAT 320D", "subidaId": "…" }
```

```
// multipart/form-data — la foto viaja en el campo `archivo`
identificador = ECO-12
modelo        = CAT 320D
archivo       = <foto.png>
```

| Campo           | Tipo   | Obligatorio | Regla                                                                                  |
| --------------- | ------ | :---------: | -------------------------------------------------------------------------------------- |
| `identificador` | string |     sí      | 1–60 caracteres; **único dentro de la empresa**                                        |
| `modelo`        | string |     sí      | 1–120 caracteres                                                                       |
| `archivo`       | file   |     no      | Sólo en `multipart`. JPG, PNG o WEBP, hasta 30 MB                                      |
| `subidaId`      | string |     no      | Sólo en JSON: el permiso de `POST /subidas`, destino `maquina`, `referencia.empresaId` |

**El identificador se compara sin acentos, sin mayúsculas y con los espacios
colapsados**: `Eco 12` y `ECO 12` son la misma máquina; `ECO-12` y `ECO 12` no
(el guión cuenta). Chocar responde:

```jsonc
// 409
{
  "status": "error",
  "message": "Esa empresa ya tiene una máquina con ese identificador",
  "code": "MAQUINA_DUPLICADA",
  "errors": [{ "msg": "Ya existe una máquina con ese identificador", "path": "identificador" }],
  "data": { "maquina": { …Maquina } } // la que ya está, por si quieren abrirla desde el aviso
}
```

## 3. `GET /maquinas/:id`

La ficha: `{ maquina }`. `404` si es de una empresa fuera de alcance; las de
baja **sí** se devuelven (el catálogo las esconde, la ficha no).

## 4. `PATCH /maquinas/:id`

Identificador, modelo y/o la foto. Acepta lo mismo que el alta —JSON o
`multipart`— y **todos los campos son opcionales**, con dos reglas:

- **Mandar sólo la foto, sin ningún campo, es válido**: es cómo se le pone la
  imagen a una máquina ya dada de alta, o se cambia la que tiene. En
  `multipart` es el `archivo` solo; en JSON es `{ "subidaId": "…" }` con el
  permiso pedido para `referencia.maquinaId`.
- **Reemplazar la foto borra la anterior.** No hay versiones.

Un cuerpo vacío sin archivo es `400` «No hay nada que actualizar». `activo` y
`empresaId` no van aquí: el `400` dice por dónde va cada uno.

Responde `{ maquina }` con `message` `«Máquina actualizada»` o `«Máquina
actualizada con su imagen»`.

## 5. `PATCH /maquinas/:id/estado`

```jsonc
{ "activo": false } // la baja
{ "activo": true } // la reactivación
```

`{ maquina }`. `400` si ya estaba en ese estado. Una máquina de baja **no se
borra**: sigue en su ficha y aparece en el catálogo con `incluirInactivas=true`.
**Una máquina de baja no se puede asignar**, y si la tenía alguien, la baja
cierra su tramo: la respuesta trae `liberada` con el tramo que se cerró
(`motivoCierre: 'baja_de_maquina'`), o `null` si estaba en el patio.

## 6. `GET /maquinas/:id/imagen`

Un enlace fresco a la foto, porque la `url` que viene dentro de cada máquina
caduca a los 10 minutos y una ficha lleva abierta más que eso.

```jsonc
// data
{ "imagen": { …Adjunto, "url": "https://…" } }
```

`?descargar=true` fuerza la descarga en vez de abrirla. `404` si la máquina no
tiene imagen, o si está fuera de alcance.

---

## 7. `POST /maquinas/:id/asignacion` → `201`

Entregarle la máquina a un trabajador. **La obra no se captura**: sale de la
asignación del trabajador y no puede ser otra.

```jsonc
{
  "empleadoId": "66b2…", // requerido
  "proyectoId": "66c3…", // SÓLO si está en varias obras
  "fechaAsignacion": "2026-08-10" // opcional; por omisión, hoy
}
```

| Campo             | Tipo   | Requerido | Regla                                                                  |
| ----------------- | ------ | :-------: | ---------------------------------------------------------------------- |
| `empleadoId`      | string |    sí     | Activo, y asignado a alguna obra **de la empresa de la máquina**       |
| `proyectoId`      | string | ver abajo | Una de SUS obras. Sobra si está en una sola                            |
| `fechaAsignacion` | string |    no     | `'YYYY-MM-DD'`. No anterior a su entrada a la obra ni al tramo vigente |

```jsonc
// data
{
  "maquina": { …Maquina },      // con `asignacion` ya resuelta
  "liberada": { …Tramo } | null, // a quién se le quitó, si se le quitó a alguien
  "avisos": ["La máquina se le quitó a Juan Pérez en Obra Norte, que la tuvo 11 días."]
}
```

**Si está en varias obras y no dicen cuál**, la respuesta es `400` con la lista
para preguntar, no un adivinar:

```jsonc
// 400
{
  "status": "fail",
  "message": "Juan Pérez está en 2 obras: dinos en cuál va la máquina.",
  "code": "OBRA_REQUERIDA",
  "errors": [{ "msg": "Indica en qué obra va la máquina", "path": "proyectoId" }],
  "data": {
    "obras": [
      {
        "proyectoId": "66c3…",
        "proyectoNombre": "Obra Norte",
        "asignacionId": "66d4…",
        "fechaAsignacion": "2026-08-05"
      },
      { "proyectoId": "66c9…", "proyectoNombre": "Obra Sur", … }
    ]
  }
}
```

**Una máquina está con una sola persona a la vez.** Asignarla a alguien más la
libera de la anterior en la misma operación: `liberada` trae el tramo cerrado
(`motivoCierre: 'reasignacion'`) y `avisos[0]` el texto listo para mostrar. El
día del cambio de manos lo cuentan los dos: ese día la tuvieron ambos.

**Una persona sí puede traer varias máquinas.**

## 8. `POST /maquinas/:id/devolucion`

De vuelta al patio. Es **lo único** que saca una máquina de la obra sin llevarla
a otra.

```jsonc
{ "fechaDevolucion": "2026-08-19" } // opcional; por omisión, hoy
```

```jsonc
// data
{
  "maquina": { …Maquina }, // con `asignacion: null`: disponible
  "devuelta": { …Tramo }   // el tramo cerrado, con sus días
}
```

`400` si la máquina no está asignada, o si la fecha es anterior a la entrega.

## 9. `GET /maquinas/:id/historial`

Quién la ha usado, en qué obra, entre qué fechas y cuánto tiempo. **Los días
vienen calculados**: nadie cuenta días a mano y el tramo vigente cuenta hasta
hoy.

```jsonc
// data
{
  "maquina": { "_id": "66f1…", "identificador": "ECO-12", "modelo": "CAT 320D", "activo": true },
  "actual": { …Tramo } | null,
  "total": 3,
  "tramos": [ …Tramo ],        // del más reciente al más viejo
  "porTrabajador": [
    { "empleadoId": "66b2…", "empleadoNombre": "Juan Pérez", "tramos": 2, "dias": 31 },
    { "empleadoId": "66b7…", "empleadoNombre": "Ana Ruiz",  "tramos": 1, "dias": 10 }
  ]
}
```

`porTrabajador` va **de más a menos días**: quién la ha usado más, primero. Los
tramos **sin trabajador** aparecen en `tramos` —explican el hueco— pero no le
suman días a nadie.

## 10. `GET /proyectos/:id/maquinas`

Qué máquinas hay hoy en la obra y con quién. Ordenado por identificador con
orden natural.

```jsonc
// data
{ "total": 2, "maquinas": [ …Maquina ] } // cada una con su `asignacion`
```

## 11. `GET /empleados/:id/maquinas`

Qué máquinas trae esa persona. Si está adscrita a varias empresas, salen las de
todas — recortadas al alcance de quien pregunta.

```jsonc
// data
{ "total": 2, "maquinas": [ …Maquina ] }
```

---

## La forma de una incidencia

```ts
interface Incidencia {
  _id: string
  maquinaId: string
  empresaId: string
  tipoId: string
  tipo: { _id: string; nombre: string; activo: boolean } | null
  descripcion: string
  fechaIncidencia: string // 'YYYY-MM-DD' — cuándo PASÓ, no cuándo se capturó
  fechaResolucion: string | null // null = abierta
  notaResolucion: string | null
  abierta: boolean // === (fechaResolucion === null)
  dias: number // inclusivos: lo que lleva abierta, o lo que tardó en cerrarse
  contexto: Contexto // quién la tenía ese día. NO se teclea
  createdAt: string
  updatedAt: string
}

interface Contexto {
  sinAsignar: boolean // true = estaba en el patio
  tramoId: string | null
  empleadoId: string | null // null con tramo = en la obra, sin operador
  empleadoNombre: string | null
  proyectoId: string | null
  proyectoNombre: string | null
  fechaAsignacion: string | null
  fechaDevolucion: string | null
  texto: string // ya armado, para mostrar
}
```

**`contexto` no es un campo de la incidencia.** Se deriva al leer, cruzando
`fechaIncidencia` con la historia de asignaciones de esa máquina (D-88): por eso
una incidencia de hace un mes señala a quien la traía HACE UN MES, aunque hoy la
tenga otro, y por eso corregir la historia corrige también las incidencias.

| `contexto`                        | `texto`                                        |
| --------------------------------- | ---------------------------------------------- |
| con `empleadoId`                  | `"Juan Pérez · Obra Norte"`                    |
| con tramo pero `empleadoId: null` | `"En Obra Norte, sin operador"`                |
| `sinAsignar: true`                | `"Sin asignar: la máquina estaba en el patio"` |

El día en que la máquina cambió de manos lo cubren dos tramos —ese día la
tuvieron los dos (D-87)—: la incidencia se le atribuye a **quien la recibió**.

## 12. `GET /maquinas/:id/incidencias`

Las incidencias de la máquina, **de la más reciente a la más vieja por la fecha
en que sucedieron**. Sin paginar.

| Query    | Valores                            | Por omisión | Qué hace                       |
| -------- | ---------------------------------- | ----------- | ------------------------------ |
| `estado` | `abiertas` · `resueltas` · `todas` | `todas`     | Filtra la lista, no las cifras |

```jsonc
// data
{
  "maquina": { "_id": "66f1…", "empresaId": "66a0…", "identificador": "ECO-12", "modelo": "CAT 320D", "activo": true },
  "estado": "todas",
  "total": 3,      // las que trae ESTA respuesta, ya filtradas
  "abiertas": 2,   // siempre del total, filtre lo que filtre
  "resueltas": 1,
  "incidencias": [ { …Incidencia } ]
}
```

`abiertas` y `resueltas` **no cambian con el filtro**: la pantalla puede mostrar
«2 abiertas» mientras el usuario está viendo las resueltas.

## 13. `POST /maquinas/:id/incidencias` → `201`

```jsonc
{
  "tipoId": "66e0…",
  "descripcion": "Botó aceite por la manguera del cilindro",
  "fechaIncidencia": "2026-08-05" // opcional: sin ella, hoy
}
```

| Campo             | Tipo   | Obligatorio | Regla                                                         |
| ----------------- | ------ | :---------: | ------------------------------------------------------------- |
| `tipoId`          | string |     sí      | Del catálogo, y **activo**                                    |
| `descripcion`     | string |     sí      | 1–1000 caracteres                                             |
| `fechaIncidencia` | string |     no      | `'YYYY-MM-DD'`; puede ser de días atrás, **nunca del futuro** |

Devuelve `{ incidencia }`. **No se manda trabajador ni obra**: se derivan.

Se puede levantar sobre una máquina **dada de baja** —muchas veces la incidencia
es justo el motivo de la baja—, a diferencia de asignarla.

## 14. `POST /incidencias/:id/resolucion`

```jsonc
{
  "fechaResolucion": "2026-08-07", // opcional: sin ella, hoy
  "notaResolucion": "Se cambió la manguera" // opcional
}
```

Devuelve `{ incidencia }` ya con `abierta: false`. La fecha no puede ser anterior
a la de la incidencia ni del futuro, y una incidencia ya resuelta responde `409`
`INCIDENCIA_YA_RESUELTA` con la fecha que tiene. **No hay reapertura**: si se
resolvió mal, se levanta otra.

## 15. `GET /tipos-incidencia`

El catálogo, **compartido por todo el grupo** (D-88), ordenado por nombre.

| Query              | Tipo    | Por omisión | Qué hace                              |
| ------------------ | ------- | ----------- | ------------------------------------- |
| `incluirInactivos` | boolean | `false`     | Suma los dados de baja                |
| `busqueda`         | string  | —           | Por nombre, sin acentos ni mayúsculas |

```jsonc
// data
{
  "total": 7,
  "tipos": [
    { "_id": "66e0…", "nombre": "Falla hidráulica", "esBase": true, "activo": true }
  ]
}
```

## 16. `POST /tipos-incidencia` → `201` ó `200`

`{ "nombre": "Falla hidráulica" }`. **Idempotente por nombre**, como las áreas:
si ya existe responde `200` con el que hay (`message`: «Ese tipo de incidencia ya
existía»), no `409`. Así el formulario de la incidencia puede ofrecer «agregar
este tipo» sin preguntar antes.

Uno que existe pero está de baja **no se reactiva solo**: vuelve tal cual, y
reactivarlo es el `PATCH …/estado`.

## 17. `PATCH /tipos-incidencia/:id`

Renombrar: `{ "nombre": "Falla hidráulica (mangueras)" }`. **Corrige el nombre en
toda la historia**, porque las incidencias lo referencian por id. `409` si otro
tipo ya se llama así.

## 18. `PATCH /tipos-incidencia/:id/estado`

`{ "activo": false }` deja de ofrecerlo para incidencias nuevas; las viejas lo
conservan y lo siguen mostrando, con `tipo.activo: false` para que la pantalla lo
pueda señalar. **Un tipo en uso SÍ se puede dar de baja** —a diferencia de las
categorías y las áreas—: no deja nada inconsistente. Los **base** (`esBase:
true`, los sembrados) no se dan de baja.

---

## Cuando el trabajador se va, la máquina se queda en la obra (D-87)

La regla, y hay que pintarla: **la máquina pierde al trabajador, no la obra.**
Una excavadora no vuelve al patio porque su operador ya no esté.

Pasa en dos momentos, y en los dos el tramo se cierra y se abre otro **en la
misma obra** con `empleadoId: null`:

| Qué pasó                          | Ruta                             | `motivoCierre`       |
| --------------------------------- | -------------------------------- | -------------------- |
| El trabajador **sale de la obra** | `PATCH /asignaciones/:id/salida` | `salida_de_obra`     |
| Al trabajador lo **dan de baja**  | `PATCH /empleados/:id/estado`    | `baja_de_trabajador` |

Las dos respuestas lo dicen, para que la pantalla lo avise en el momento:

```jsonc
// data — en las dos rutas
{
  …,
  "maquinasLiberadas": [
    {
      "maquinaId": "66f1…",
      "identificador": "ECO-12",
      "modelo": "CAT 320D",
      "proyectoId": "66c3…",
      "proyectoNombre": "Obra Norte",
      "motivo": "salida_de_obra"
    }
  ]
}
```

El `message` de las dos también lo menciona. Sacarla de ahí es **una decisión a
mano**: asignarla a otra persona de esa obra, o devolverla.

La excepción es la **baja de la máquina** (`PATCH /maquinas/:id/estado`), que sí
cierra el tramo del todo: fuera de servicio no está en ninguna obra ni con nadie.

---

## La foto por subida directa (D-83)

Igual que el contrato escaneado, en tres pasos:

```
1. POST /subidas  { destino: "maquina", referencia: { empresaId } ó { maquinaId }, nombre, mime, tamanoBytes }
2. PUT <url>      la foto, directo a R2
3. POST /empresas/:id/maquinas  ó  PATCH /maquinas/:id   con { subidaId } en el cuerpo
```

`empresaId` cuando la máquina **todavía no existe** (la foto viaja en el alta);
`maquinaId` cuando ya está y se le pone o cambia la foto. Un permiso pedido con
`empresaId` **no sirve** para el `PATCH` de una máquina, ni al revés: `400` con
`errors[0].path = "subidaId"`. El paso a paso completo está en
[`ENDPOINTS-SUBIDAS.md`](./ENDPOINTS-SUBIDAS.md).

## Errores

| Código | Cuándo                                                                                                                                                                  |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | Sin `identificador` o `modelo` al dar de alta; `PATCH` sin nada; campo que no va; `activo` no booleano                                                                  |
| `400`  | `subidaId` que no es de esta máquina/empresa, ya usado, caducado, o cuyo archivo no llegó                                                                               |
| `401`  | Sin sesión                                                                                                                                                              |
| `403`  | Escribir sin `manageProjects` (`rh_consulta`)                                                                                                                           |
| `404`  | Empresa o máquina fuera de alcance; `GET …/imagen` sin foto                                                                                                             |
| `400`  | Asignar: sin `empleadoId`; a alguien de baja; a alguien sin obra en esa empresa; a una obra donde no está; a una máquina de baja; fecha anterior a su entrada a la obra |
| `400`  | `OBRA_REQUERIDA` — está en varias obras y no se dijo en cuál. Trae `data.obras`                                                                                         |
| `400`  | Devolver una máquina que no está asignada, o con fecha anterior a la entrega                                                                                            |
| `409`  | `MAQUINA_DUPLICADA` — el identificador ya está en esa empresa                                                                                                           |
| `409`  | `MAQUINA_YA_ASIGNADA` — ya la tiene esa misma persona en esa misma obra                                                                                                 |
| `400`  | Incidencia: sin `tipoId` o sin `descripcion`; tipo inexistente o **dado de baja**; fecha del futuro; resolución anterior a la incidencia                                |
| `409`  | `INCIDENCIA_YA_RESUELTA` — ya se cerró, y el mensaje dice cuándo                                                                                                        |
| `404`  | Incidencia inexistente, o de una máquina fuera de alcance                                                                                                               |
| `409`  | Tipo de incidencia: `TIPO_INCIDENCIA_DUPLICADO` al renombrar sobre uno que ya existe                                                                                    |
| `413`  | La foto pasa de 30 MB                                                                                                                                                   |
| `415`  | La «foto» no es JPG, PNG ni WEBP: un PDF, un Word, un HEIC. El mensaje dice qué llegó                                                                                   |
