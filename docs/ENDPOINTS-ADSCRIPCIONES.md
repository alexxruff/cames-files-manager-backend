# Adscripciones: vincular a alguien que ya existe a una empresa

Referencia de los **4 endpoints nuevos**. Nada más cambió.

Base: `/api/v1`. Envelope, códigos y convenciones generales:
[`INTEGRACION-FRONTEND.md`](./INTEGRACION-FRONTEND.md).

| #   | Endpoint                           | Quién              |
| --- | ---------------------------------- | ------------------ |
| 1   | `GET /empresas/:id/adscripciones`  | quien ve empleados |
| 2   | `POST /empresas/:id/adscripciones` | `rh_admin`         |
| 3   | `PATCH /adscripciones/:id`         | `rh_admin`         |
| 4   | `PATCH /adscripciones/:id/estado`  | `rh_admin`         |

> **Adscribir ≠ dar de alta.** `POST /empleados` crea a la persona y su primera
> adscripción, en un solo paso. Estos 4 endpoints son para lo que viene
> **después**: sumarle otra empresa, moverla de área o de contrato, o darla de
> baja de una empresa sin tocar las demás.
>
> **Exclusivo de `rh_admin`.** Ni `rh_consulta` ni `jefe_area` pueden llamarlos
> — mover gente entre empresas del grupo es una decisión de RH.

---

## 1. Las adscripciones de una empresa

### `GET /empresas/:id/adscripciones`

Query, todos opcionales:

| Parámetro     | Valores                            | Default      |
| ------------- | ---------------------------------- | ------------ |
| `activo`      | `true` \| `false` \| `todos`       | `true`       |
| `area`        | área de la adscripción             | —            |
| `tipo`        | `administrativo` \| `mano_de_obra` | —            |
| `categoriaId` | id de la categoría                 | —            |
| `orden`       | `numero_asc` \| `numero_desc`      | `numero_asc` |

**Antes, sin `activo`, traía todo mezclado; ahora el default es `true` (sólo
activas) — sin mezclar (D-51).** `false` trae **sólo** las dadas de baja; para
ver las dos, hay que pedirlo explícito con `todos`.

`tipo` y `categoriaId` son de la **persona**, no de la adscripción (D-51).
`orden` compara `numeroEmpleado` como texto (no numérico): con el archivo de
nómina, que rellena con ceros a la izquierda, coincide con el orden numérico.
Las adscripciones capturadas a mano sin `numeroEmpleado` (`null`) van primero en
`numero_asc` y al final en `numero_desc`.

```jsonc
// data
{
  "adscripciones": [
    {
      "_id": "…",
      "empresaId": "…",
      "empleadoId": "…",
      "areas": ["obra"],
      "numeroEmpleado": null, // nuevo (D-46): el ID de la nómina
      "departamento": null, // nuevo (D-46): tal como lo dice la nómina
      "tipoContrato": "indeterminado",
      "fechaIngreso": "2026-01-15",
      "fechaTerminoContrato": null,
      "datosPendientes": [], // nuevo (D-46): ver la nota de abajo
      "activo": true,
      "motivoBaja": null,
      "fechaBaja": null,
      "empleado": {
        "_id": "…",
        "nombre": "Roberto Aguilar Sosa",
        "tipo": "mano_de_obra",
        "activo": true
      }
    }
  ]
}
```

El jefe de área sólo ve las adscripciones de **sus propias áreas** en esa
empresa; si además filtra por `area`, se queda dentro de las suyas.

---

## 2. Adscribir a alguien que ya existe

### `POST /empresas/:id/adscripciones`

```jsonc
{
  "empleadoId": "…",
  "areas": ["obra"], // obligatorio para tipo administrativo
  "tipoContrato": "indeterminado",
  "fechaIngreso": "2026-09-01",
  "fechaTerminoContrato": null // sólo si el contrato es temporal
}
```

- **`201`** si es una adscripción nueva.
- **`200`** si la persona **ya había estado** adscrita a esa empresa y se le
  reactiva la que existía (no se crea una segunda). El mensaje lo dice.
- **`409`** si ya está adscrita **y activa**: no puedes adscribirla dos veces a
  la misma empresa a la vez.
- Re-sincroniza el checklist de su expediente: si la nueva empresa pide
  documentos que la anterior no pedía, aparecen en su expediente.

### Errores

| Código | Cuándo                                                |
| ------ | ----------------------------------------------------- |
| `400`  | Falta un campo, o un `administrativo` sin ningún área |
| `400`  | La persona está dada de baja del sistema              |
| `403`  | Lo intenta alguien que no es `rh_admin`               |
| `404`  | La empresa no es visible, o el empleado no existe     |
| `409`  | Ya está adscrita y activa                             |

---

## 3. Editar una adscripción

### `PATCH /adscripciones/:id`

Mismos campos que el alta, **menos** `empresaId` y `empleadoId` (no se pueden
cambiar: para eso se da de baja esta y se crea otra). También re-sincroniza el
checklist.

```jsonc
{ "tipoContrato": "obra_determinada", "fechaTerminoContrato": "2026-12-31" }
```

`400` si manda `activo` (usa el endpoint 4) o si deja a un `administrativo` sin
ningún área.

---

## 4. Dar de baja o reactivar (de esa empresa)

### `PATCH /adscripciones/:id/estado`

```jsonc
// baja
{ "activo": false, "motivo": "Termina su contrato antes de tiempo" } // mínimo 10 caracteres

// reactivar — no necesita motivo
{ "activo": true }
```

**Es la baja de UNA empresa, no de la persona.** `PATCH /empleados/:id/estado`
sigue siendo la baja del sistema completo.

Dar de baja **también cierra sus asignaciones abiertas a proyectos de esa
empresa** — no toca las que tenga en otras empresas del grupo, ahí sigue
trabajando. Igual que al finalizar un proyecto, **no se reabren solas** al
reactivar la adscripción.

### Errores

| Código | Cuándo                                                |
| ------ | ----------------------------------------------------- |
| `400`  | Da de baja sin `motivo`, o con menos de 10 caracteres |
| `403`  | Lo intenta alguien que no es `rh_admin`               |
| `404`  | La adscripción no es visible                          |

---

## Tres campos nuevos en la adscripción (D-46)

La importación desde el .xlsx de nómina agregó tres campos a **toda** respuesta
que devuelva una adscripción. Son **aditivos**: nada cambió de forma ni de
nombre, así que el front sigue funcionando sin tocarse.

| Campo             | Tipo           | Qué es                                                       |
| ----------------- | -------------- | ------------------------------------------------------------ |
| `numeroEmpleado`  | `string\|null` | El `ID` de la nómina en **esa** empresa                      |
| `departamento`    | `string\|null` | El departamento **tal como lo dice la nómina**, sin traducir |
| `datosPendientes` | `string[]`     | Datos que el importador dejó sin capturar                    |

**`numeroEmpleado` ya no es exclusivo del importador.** `POST /empleados` lo pide
como obligatorio al dar de alta a alguien (es el alta y su primera adscripción,
en un solo paso — ver `INTEGRACION-FRONTEND.md`). Sigue siendo `null` sólo cuando
la adscripción se agregó con **este** endpoint, `POST /empresas/:id/adscripciones`
(sumarle a alguien que ya existe una segunda empresa): ahí no se pide, y no hay
manera de capturarlo después — ni aquí ni en `PATCH /adscripciones/:id`.

**`departamento` no es lo mismo que `areas`.** En el archivo de Urbacames, 53 de
145 filas traen aquí una **obra** (`Axis Zapopan`, `Plenares`) y no un área.
Traducirla a un área sería inventar el dato: `areas` cae al valor por defecto del
tipo y `departamento` conserva el original, que es la única información real de
dónde está la persona. Si vas a mostrar «dónde trabaja», es este campo.

**`datosPendientes`** hoy sólo puede contener `'fechaTerminoContrato'`: el archivo
de nómina no trae fecha de término y 99 de las 145 personas tienen contrato
temporal, así que entran sin ella y marcadas. Mientras esté marcado, su documento
`contrato` **no deriva vigencia**. Es una buena señal para la interfaz: «a esta
persona le falta capturar la fecha de término». Se borra solo en cuanto se manda
la fecha por `PATCH /adscripciones/:id` — **no se puede poner** desde el `PATCH`,
sólo quitar llenando el dato.

**Lo que NO se expone.** La adscripción guarda además los datos de nómina
(salario, SBC, banco, cuenta) y **ninguna respuesta los devuelve**: son datos
personales sensibles y falta decidir quién puede verlos. Si los necesitas, dilo y
se define el permiso; no los busques en la respuesta porque no están.
