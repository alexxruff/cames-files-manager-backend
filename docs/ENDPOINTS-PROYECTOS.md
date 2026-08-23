# Carteras, proyectos y asignaciones

Referencia de los **14 endpoints nuevos** para el equipo de front. Ningún endpoint
anterior cambió.

Base: `/api/v1`. Envelope, códigos y convenciones generales: ver
[`INTEGRACION-FRONTEND.md`](./INTEGRACION-FRONTEND.md).

## Índice

| #   | Endpoint                                                                   | Quién                    |
| --- | -------------------------------------------------------------------------- | ------------------------ |
| 1   | `GET /empresas/:id/clientes`                                               | sesión                   |
| 2   | `POST /empresas/:id/clientes`                                              | `rh_admin` · `jefe_area` |
| 3   | `PATCH /carteras/:id`                                                      | `rh_admin` · `jefe_area` |
| 4   | `PATCH /carteras/:id/estado`                                               | `rh_admin` · `jefe_area` |
| 5   | `GET /proyectos`                                                           | sesión                   |
| 6   | `GET /proyectos/:id`                                                       | sesión                   |
| 7   | `POST /proyectos`                                                          | `rh_admin` · `jefe_area` |
| 8   | `PATCH /proyectos/:id`                                                     | `rh_admin` · `jefe_area` |
| 9   | `POST /proyectos/:id/aplazar`                                              | `rh_admin` · `jefe_area` |
| 10  | `POST /proyectos/:id/finalizar`                                            | `rh_admin` · `jefe_area` |
| 11  | `POST /proyectos/:id/reabrir`                                              | `rh_admin` · `jefe_area` |
| 12  | `POST /proyectos/:id/categorias/clonar`                                    | `rh_admin` · `jefe_area` |
| 13  | `GET /proyectos/:id/asignables` · `GET`/`POST /proyectos/:id/asignaciones` | ver cada uno             |
| 14  | `PATCH /asignaciones/:id/salida`                                           | asignar a proyectos      |

> **Orden obligado para probar.** Un proyecto no se puede crear si su cliente no
> está antes en la cartera de la empresa:
>
> `POST /empresas` → `POST /categorias` → `POST /clientes` →
> **`POST /empresas/:id/clientes`** → `POST /proyectos` → `POST /empleados` →
> `GET /proyectos/:id/asignables` → `POST /proyectos/:id/asignaciones`

---

## 1. Carteras — qué clientes usa cada empresa

El cliente vive en el catálogo global (`/clientes`); la **cartera** es el vínculo
con una empresa concreta. Su contacto puede diferir del del catálogo.

### `GET /empresas/:id/clientes`

Cualquiera con sesión. Puebla el selector de cliente al crear un proyecto.

Query: `?activo=true|false` (sin él, devuelve todos).

```jsonc
// data
{
  "cartera": [
    {
      "_id": "…",
      "empresaId": "…",
      "clienteId": "…",
      "contactoNombre": "Luis Alvarado",
      "contactoEmail": null,
      "contactoTelefono": null,
      "notas": "Paga a 30 días",
      "activo": true,
      "createdAt": "…",
      "updatedAt": "…",
      "cliente": {
        "_id": "…",
        "nombre": "Grupo Alvarado",
        "rfc": "GAL210101AB1",
        "activo": true
      }
    }
  ]
}
```

`404` si la empresa no es suya.

### `POST /empresas/:id/clientes` → `201`

```jsonc
{
  "clienteId": "…",
  "contactoNombre": null,
  "contactoEmail": null,
  "contactoTelefono": null,
  "notas": null
}
// data: { "cartera": { … } }
```

**Si ese cliente ya había estado en la cartera y se sacó, se reactiva el vínculo
existente y la respuesta es `200`, no `201`** (`message`: «volvió a la cartera»).
No se duplica: conserva las notas y el contacto que tenía.

| Código | Cuándo                                                   |
| ------ | -------------------------------------------------------- |
| `409`  | `code: CARTERA_DUPLICADA` — ya está activo en la cartera |
| `400`  | El cliente está desactivado en el catálogo global        |
| `404`  | El cliente no existe, o la empresa no es suya            |
| `403`  | `rh_consulta`                                            |

### `PATCH /carteras/:id`

Acepta **sólo** `contactoNombre`, `contactoEmail`, `contactoTelefono`, `notas`.

```jsonc
{ "contactoNombre": "Nuevo contacto", "notas": "Cambió de responsable" }
// data: { "cartera": { … } }
```

`400` con cualquier otro campo, indicando la ruta correcta. `404` si la cartera es
de otra empresa.

### `PATCH /carteras/:id/estado`

```jsonc
{ "activo": false }   // saca el cliente de la cartera
{ "activo": true }    // lo devuelve
```

**`400` si la empresa tiene proyectos con ese cliente** — el mensaje dice cuántos.

---

## 2. Proyectos

```ts
interface Proyecto {
  _id: string
  empresaId: string
  clienteId: string
  empresaNombre: string | null
  clienteNombre: string | null
  nombre: string
  fechaInicio: string // 'YYYY-MM-DD'
  fechaFinEstimada: string // 'YYYY-MM-DD'
  fechaFinReal: string | null
  estado: 'en_curso' | 'finalizado'
  categorias: string[] // ids de categoría habilitados en el proyecto
  aplazamientos: {
    fechaAnterior: string
    fechaNueva: string
    motivo: string
    registradoPor: string // nombre de quien lo registró
    registradoEn: string // ISO
  }[]
  /** Derivado, nunca almacenado. Negativo si ya se pasó; null si finalizado. */
  diasParaCierre: number | null
  createdAt: string
  updatedAt: string
}
```

### `GET /proyectos`

Cualquiera con sesión. Sólo los de las empresas visibles.

| Parámetro              | Valores                                                |
| ---------------------- | ------------------------------------------------------ |
| `empresaId`            | Acota dentro de lo visible; una empresa ajena da `404` |
| `clienteId`            |                                                        |
| `estado`               | `en_curso` \| `finalizado`                             |
| `busqueda`             | Nombre, parcial, ignora acentos                        |
| `pagina` / `porPagina` | Empieza en 1; 25 por defecto, máximo 100               |

```jsonc
// data
{ "total": 12, "pagina": 1, "porPagina": 25, "proyectos": [/* Proyecto[] */] }
```

Orden: **en curso primero, y dentro de ellos el que cierra más pronto.**

### `GET /proyectos/:id`

```jsonc
// data
{ "proyecto": {/* Proyecto */} }
```

`404` si el proyecto es de otra empresa.

### `POST /proyectos` → `201`

```jsonc
{
  "empresaId": "…",
  "clienteId": "…",
  "nombre": "Torre Andares — Etapa 2",
  "fechaInicio": "2026-09-01",
  "fechaFinEstimada": "2027-06-30",
  "categorias": ["…", "…"]
}
// data: { "proyecto": { … } }
```

| Código | Cuándo                                                                                                                                                                       |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | **El cliente no está en la cartera activa de esa empresa** (`path: clienteId`)                                                                                               |
| `400`  | Sin categorías, o alguna no existe o está desactivada (`path: categorias`)                                                                                                   |
| `400`  | `fechaFinEstimada` no es posterior a `fechaInicio`                                                                                                                           |
| `409`  | `code: PROYECTO_DUPLICADO` — el nombre es único **dentro de la empresa**, ignorando acentos y mayúsculas. Dos empresas del grupo sí pueden tener cada una su «Torre Andares» |
| `404`  | La empresa no es suya                                                                                                                                                        |
| `403`  | `rh_consulta`                                                                                                                                                                |

### `PATCH /proyectos/:id`

Acepta **sólo** `nombre`, `clienteId`, `fechaInicio`, `categorias`.

```jsonc
{ "nombre": "Torre Andares — Etapa 3" }
// data: { "proyecto": { … } }
```

| Código | Cuándo                                                                                                                                                                  |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | **Rechaza `fechaFinEstimada`** e indica: «usa `POST /proyectos/:id/aplazar`, que exige motivo». También rechaza `estado`, `fechaFinReal`, `empresaId` y `aplazamientos` |
| `400`  | El cliente nuevo tampoco está en la cartera                                                                                                                             |
| `400`  | Se quita una categoría que alguien asignado está usando (dice cuántas personas)                                                                                         |
| `404`  | Proyecto ajeno                                                                                                                                                          |

### `POST /proyectos/:id/aplazar`

**La única forma de mover la fecha de cierre.** Queda en el historial, con quién y
cuándo.

```jsonc
{ "fechaNueva": "2027-09-30", "motivo": "Lluvias atrasaron la cimentación" }
// data: { "proyecto": { … } }   // aplazamientos[0] es el más reciente
```

| Código | Cuándo                                                         |
| ------ | -------------------------------------------------------------- |
| `400`  | `fechaNueva` no es posterior a la vigente (`path: fechaNueva`) |
| `400`  | `motivo` vacío o de menos de 10 caracteres (máximo 300)        |
| `400`  | El proyecto está finalizado — «reábrelo primero»               |

### `POST /proyectos/:id/finalizar`

```jsonc
{ "fechaFinReal": "2027-05-20" }
// data: { "proyecto": { … } }   // estado: 'finalizado', diasParaCierre: null
```

**Cierra también las asignaciones abiertas**, con esa misma fecha de salida.

`400` si la fecha es anterior al inicio, o si ya está finalizado.

### `POST /proyectos/:id/reabrir`

Cuerpo vacío. Deja `estado: 'en_curso'` y `fechaFinReal: null`.

**No reabre las asignaciones**: hay que volver a asignar al personal. `400` si el
proyecto no está finalizado.

### `POST /proyectos/:id/categorias/clonar`

```jsonc
{ "origenId": "…" }
// data: { "proyecto": { … }, "agregadas": 2 }
```

Suma las categorías del origen **sin quitar ni duplicar**. `agregadas: 0` cuando no
había ninguna nueva. `400` si el origen es el mismo proyecto; `404` si es de otra
empresa.

---

## 3. Asignaciones — el personal del proyecto

```ts
interface Asignacion {
  _id: string
  proyectoId: string
  empleadoId: string
  categoriaId: string
  fechaAsignacion: string // 'YYYY-MM-DD'
  fechaSalida: string | null
  activo: boolean
  empleadoNombre: string | null
  empleadoTipo: 'administrativo' | 'mano_de_obra' | null
  categoriaNombre: string | null
  createdAt: string
  updatedAt: string
}
```

### `GET /proyectos/:id/asignables`

El selector de personal. Requiere permiso de asignar (`rh_admin` · `jefe_area`).

```jsonc
// data
{
  "asignables": [
    {
      "_id": "…",
      "nombre": "Roberto Aguilar Sosa",
      "tipo": "mano_de_obra",
      "categoriaId": "…",
      "categoriaNombre": "Albañil",
      "areas": ["obra"]
    }
  ]
}
```

Devuelve **sólo** a quien cumple las cuatro condiciones a la vez:

1. Adscripción **activa** a la empresa del proyecto.
2. Persona activa (no dada de baja).
3. Su categoría base está **habilitada en el proyecto**.
4. No está ya asignado a ese proyecto.

Un `jefe_area` sólo ve a su gente **de sus áreas**.

### `GET /proyectos/:id/asignaciones`

Cualquiera con sesión. Query: `?activo=true|false`.

```jsonc
// data
{ "asignaciones": [/* Asignacion[] */] }
```

Las activas primero. `404` si el proyecto es ajeno.

### `POST /proyectos/:id/asignaciones` → `201`

```jsonc
{ "empleadoId": "…", "categoriaId": "…", "fechaAsignacion": "2026-09-15" }
// data: { "asignacion": { … } }
```

| Código | Cuándo                                                                            |
| ------ | --------------------------------------------------------------------------------- |
| `400`  | El empleado **no está adscrito** a la empresa del proyecto (`path: empleadoId`)   |
| `400`  | La categoría **no está habilitada** en el proyecto (`path: categoriaId`)          |
| `400`  | La persona está dada de baja                                                      |
| `400`  | El proyecto está finalizado                                                       |
| `400`  | `fechaAsignacion` anterior al inicio del proyecto                                 |
| `409`  | `code: ASIGNACION_DUPLICADA` — ya está asignado                                   |
| `403`  | Un `jefe_area` asignando gente de otra área; el mensaje dice cuáles son las suyas |
| `404`  | Proyecto ajeno, o empleado inexistente                                            |

### `PATCH /asignaciones/:id/salida`

```jsonc
{ "fechaSalida": "2026-10-31" }
// data: { "asignacion": { … } }   // activo: false
```

**Cierra, no borra**: el histórico permite responder quién estaba en la obra en una
fecha dada. Al cerrarla, esa persona vuelve a aparecer en `/asignables` y se puede
reincorporar.

`400` si la fecha es anterior a la de asignación, o si la asignación ya estaba
cerrada.
