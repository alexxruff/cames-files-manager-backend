# Carteras, proyectos y asignaciones

Referencia de los **23 endpoints** de este dominio para el equipo de front.

> **Actualizado hasta la Fase 8 (D-70 a D-72).** Trae **contratos y SIROC** (§4,
> que faltaban en este documento), el endpoint `GET /asignaciones/:id` y **dos
> campos nuevos** en cada `Asignacion`. Nada de lo anterior cambió de forma: todo
> es aditivo. Lo único que se comporta distinto es el `message` del alta de
> asignaciones, que ahora puede traer un aviso — ver «Coherencia del registro
> patronal» en §3.

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
| 14  | `GET /asignaciones/:id`                                                    | sesión                   |
| 15  | `PATCH /asignaciones/:id/salida`                                           | asignar a proyectos      |
| 16  | `GET /proyectos/:id/contratos`                                             | sesión                   |
| 17  | `POST /proyectos/:id/contratos`                                            | `rh_admin` · `jefe_area` |
| 18  | `PATCH /contratos/:id`                                                     | `rh_admin` · `jefe_area` |
| 19  | `PUT /contratos/:id/siroc`                                                 | `rh_admin` · `jefe_area` |
| 20  | `DELETE /contratos/:id/siroc`                                              | `rh_admin` · `jefe_area` |
| 21  | `POST /contratos/:id/finalizar`                                            | `rh_admin` · `jefe_area` |
| 22  | `POST /contratos/:id/reabrir`                                              | `rh_admin` · `jefe_area` |
| 23  | `PATCH /contratos/:id/estado`                                              | `rh_admin` · `jefe_area` |

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

  /**
   * Obligatorios desde D-69. Se MANDAN como id y se LEEN de las dos formas: el
   * id crudo, y el subdocumento resuelto contra su dueño —la empresa para el
   * patronal, el cliente para el de obra—. El número no se guarda duplicado en
   * el proyecto: se resuelve al leer, como `empresaNombre`.
   */
  registroPatronalId: string | null
  registroObraId: string | null
  registroPatronal: RegistroResuelto | null
  registroObra: RegistroResuelto | null

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

/** La misma forma para el registro patronal y para el de obra. */
interface RegistroResuelto {
  _id: string
  numero: string
  descripcion: string | null
  activo: boolean
}
```

**Los cuatro campos pueden venir en `null`, id incluido.** Obligatorio significa
obligatorio **al crear**: los proyectos anteriores a D-69 se quedaron sin ellos y
se siguen editando a propósito, así que ahí `registroObraId` es literalmente
`null`. Verificado contra el servidor. Píntalo como dato faltante, no como error,
y no des por hecho el id en el tipo.

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
  // Obligatorios desde D-69. OJO: el patronal sale de la EMPRESA
  // (`empresa.registrosPatronales`) y el de obra del CLIENTE
  // (`cliente.registrosObra`). Suenan parecido y son catálogos distintos.
  "registroPatronalId": "…",
  "registroObraId": "…",
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
| `400`  | El registro patronal **no es de esa empresa**, o está dado de baja (`path: registroPatronalId`)                                                                              |
| `400`  | El registro de obra **no es de ese cliente**, o está dado de baja (`path: registroObraId`)                                                                                   |
| `400`  | `fechaFinEstimada` no es posterior a `fechaInicio`                                                                                                                           |
| `409`  | `code: PROYECTO_DUPLICADO` — el nombre es único **dentro de la empresa**, ignorando acentos y mayúsculas. Dos empresas del grupo sí pueden tener cada una su «Torre Andares» |
| `404`  | La empresa no es suya                                                                                                                                                        |
| `403`  | `rh_consulta`                                                                                                                                                                |

### `PATCH /proyectos/:id`

Acepta **sólo** `nombre`, `clienteId`, `fechaInicio`, `categorias`,
`registroPatronalId` y `registroObraId`.

```jsonc
{ "nombre": "Torre Andares — Etapa 3" }
// data: { "proyecto": { … } }
```

Los dos registros **no se pueden vaciar** —son obligatorios— y se traban conforme
cuelgan contratos: ver la tabla de §4. Los candados miran el **cambio** y no la
presencia, así que reenviar el mismo id en el formulario completo sigue
funcionando.

**Cambiar de cliente obliga a mandar el `registroObraId` nuevo en la misma
petición**: el anterior era del cliente viejo y el campo no puede quedar vacío.
Omitirlo responde `400` con `path: registroObraId`.

| Código | Cuándo                                                                                                                                                                  |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | **Rechaza `fechaFinEstimada`** e indica: «usa `POST /proyectos/:id/aplazar`, que exige motivo». También rechaza `estado`, `fechaFinReal`, `empresaId` y `aplazamientos` |
| `400`  | El cliente nuevo tampoco está en la cartera                                                                                                                             |
| `400`  | El registro patronal **no es de esa empresa**, o está dado de baja (`path: registroPatronalId`)                                                                         |
| `400`  | El registro de obra **no es de ese cliente**, o está dado de baja (`path: registroObraId`)                                                                              |
| `400`  | Se cambia de cliente sin mandar el `registroObraId` nuevo                                                                                                               |
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

  /**
   * Sólo en `GET /proyectos/:id/asignaciones` (D-71).
   *
   * El registro patronal de SU adscripción en esa empresa —texto libre, tal como
   * lo trajo la nómina—, y si es el del proyecto. `null` en `coincide` significa
   * **no se pudo comparar**, y no es lo mismo que `false`.
   */
  registroPatronalEmpleado?: string | null
  registroPatronalCoincide?: boolean | null

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

Cada renglón trae `registroPatronalEmpleado` y `registroPatronalCoincide` (D-71),
para poder marcar en la tabla a quien cotiza en otro registro sin abrir uno por
uno. Los tres estados están en «Coherencia del registro patronal», abajo.

### `POST /proyectos/:id/asignaciones` → `201`

```jsonc
{ "empleadoId": "…", "categoriaId": "…", "fechaAsignacion": "2026-09-15" }
// data: { "asignacion": { … }, "avisos": string[] }
```

**`avisos` es nuevo (D-71) y casi siempre está vacío.** Cuando trae algo, el alta
**se hizo igual**: son advertencias, no errores — ver «Coherencia del registro
patronal», abajo. El primer aviso se repite en `message`, así que si ya pintas
`message` como toast no tienes que hacer nada para que se vea.

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

### Coherencia del registro patronal (D-71)

Una persona puede cotizar en un registro patronal **distinto** al del proyecto al
que se le asigna. Eso **avisa, no bloquea**: Maquinaria CAMES ya tiene 144
personas repartidas en cuatro registros patronales, y moverlas de registro es un
trámite ante el IMSS, no un error de captura.

Para el front esto significa una cosa concreta: **el alta sigue siendo `201` y hay
que tratarla como éxito**, aunque venga con aviso. No es un caso de error.

```jsonc
{
  "status": "success",
  "message": "Ana Ruiz cotiza en el registro patronal R13-77767-10-5 y este proyecto es del H67-29973-10-5. La asignación queda registrada; revisa si hay que moverla de registro.",
  "data": {
    "asignacion": {},
    "avisos": ["…"] //  [] cuando no hay nada que advertir
  }
}
```

#### `registroPatronalCoincide` tiene TRES estados

| Valor   | Significa                                                          | Cómo pintarlo                      |
| ------- | ------------------------------------------------------------------ | ---------------------------------- |
| `true`  | coinciden                                                          | nada, es lo normal                 |
| `false` | la persona cotiza en **otro** registro                             | marca de atención, no de error     |
| `null`  | **no se pudo comparar**: su adscripción no tiene registro patronal | dato faltante, distinto de `false` |

`null` **no es `false`**. Colapsarlos haría que «falta capturar un dato» se leyera
como «hay que hacer un trámite», que son acciones distintas. Es la misma
convención de `rfcCoincide` en la importación.

La comparación ignora guiones, espacios y mayúsculas: `R13-77767-10-5` y
`r13 77767 10 5` son el mismo registro. No normalices por tu cuenta.

### `GET /asignaciones/:id` — el detalle con la cadena completa

Cualquiera con sesión sobre el proyecto: mirar quién está en la obra no es lo
mismo que moverlo. `404` si el proyecto es ajeno, `400` si el id no es válido.

```jsonc
// data
{
  "asignacion": {}, // Asignacion, con empleadoNombre / categoriaNombre
  "trazabilidad": {
    "empleado": { "_id": "…", "nombre": "Ana Ruiz" },
    "empresa": { "_id": "…", "nombre": "Maquinaria CAMES" },
    "adscripcionId": "…", // el eslabón; sirve para enlazar a la adscripción
    "adscripcionActiva": true,
    "registroPatronalEmpleado": "R13-77767-10-5", // texto libre, o null
    "proyecto": { "_id": "…", "nombre": "Torre Andares" },
    "registroPatronal": {
      // el DEL PROYECTO, resuelto contra su empresa
      "_id": "…",
      "numero": "H67-29973-10-5",
      "descripcion": null,
      "activo": true
    },
    "cliente": { "_id": "…", "nombre": "Inmobiliaria X" },
    "registroObra": {
      // resuelto contra el cliente
      "_id": "…",
      "numero": "OB-0012",
      "descripcion": null,
      "activo": true
    },
    "registroPatronalCoincide": false
  },
  "avisos": ["…"]
}
```

Es la cadena `empleado → empresa → registro patronal → proyecto → registro de
obra`, **resuelta al leer**. No hay nada de esto guardado en la asignación, así
que corregir el registro patronal de una adscripción se refleja de inmediato en
todas las asignaciones ya hechas: no hace falta re-asignar a nadie ni invalidar
caché de escritura.

`registroPatronalEmpleado` y `registroPatronal` **no son lo mismo y es fácil
confundirlos**: el primero es el de la persona (texto libre de la nómina), el
segundo el del proyecto (subdocumento resuelto de la empresa).

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

---

## 4. Contratos del proyecto — que son sus fases

**Un contrato ES una fase.** Cada fase de la obra tiene exactamente un contrato, y
un proyecto de un solo contrato no tiene fases. Por eso no hay entidad «fase» ni
un campo que las relacione: `nombre` es la etiqueta ('Fase 1', 'Cimentación') y es
opcional.

### Lo que el contrato NO tiene

Antes de que lo busquen, porque son las tres suposiciones naturales:

- **No tiene `clienteId`.** El cliente es el del proyecto; un contrato no cambia
  de proyecto ni de cliente.
- **No tiene monto, importe ni moneda.** El backend no modela dinero en ninguna
  parte de la obra.
- **No tiene `empresaId`.** Sale del proyecto.

### `Contrato`

```ts
interface Contrato {
  _id: string
  proyectoId: string
  numero: number // secuencia dentro del proyecto: 1, 2, 3… LA PONE EL SERVIDOR
  nombre: string | null // etiqueta de la fase
  fechaInicio: string // 'YYYY-MM-DD'
  fechaFin: string // 'YYYY-MM-DD'
  siroc: Siroc | null // null hasta que se registre
  estado: 'en_curso' | 'finalizado'
  activo: boolean // la BAJA, que no es lo mismo que `estado`
  createdAt: string
  updatedAt: string
}

interface Siroc {
  numero: string // único en TODO el sistema; el servidor lo pasa a MAYÚSCULAS
  fechaRegistro: string // 'YYYY-MM-DD'
  vigenciaHasta: string | null // puede no conocerse al registrarlo
}
```

### `GET /proyectos/:id/contratos`

Cualquiera con sesión. Query: `?incluirInactivos=true` (por defecto **sólo los
activos**). Ordenados por `numero` ascendente.

```jsonc
// data
{ "contratos": [/* Contrato[] */] }
```

`404` si el proyecto es ajeno.

### `POST /proyectos/:id/contratos` → `201`

**El cuerpo completo son tres campos, y uno es opcional:**

```jsonc
{
  "nombre": "Cimentación", // opcional; null o ausente si el proyecto no tiene fases
  "fechaInicio": "2026-09-01", // obligatoria
  "fechaFin": "2026-12-31" // obligatoria
}
// data: { "contrato": { … } }
```

**No mandes `numero`**: es una secuencia dentro del proyecto y la calcula el
servidor (`max + 1`, contando también los dados de baja). Tampoco `siroc`, que va
por su propia ruta.

Ojo con la asimetría: **el alta IGNORA los campos de más en silencio** —mandar
`monto` o `clienteId` devuelve `201` y un contrato sin ellos—, mientras que
`PATCH /contratos/:id` sí los rechaza con `400`. Verificado contra el servidor.

| Código | Cuándo                                                  |
| ------ | ------------------------------------------------------- |
| `400`  | El proyecto está **finalizado**                         |
| `400`  | Falta `fechaInicio` o `fechaFin`, o no son `AAAA-MM-DD` |
| `400`  | `fechaFin` anterior a `fechaInicio` (`path: fechaFin`)  |
| `400`  | `nombre` de más de 120 caracteres                       |
| `404`  | Proyecto inexistente o ajeno                            |

### `PATCH /contratos/:id`

**Sólo `nombre`, `fechaInicio` y `fechaFin`.** Cualquier otro campo responde `400`
diciendo por dónde va:

| Si mandas    | El mensaje dice                                  |
| ------------ | ------------------------------------------------ |
| `siroc`      | usa `PUT /contratos/:id/siroc`                   |
| `estado`     | usa `POST /contratos/:id/finalizar` o `/reabrir` |
| `activo`     | usa `PATCH /contratos/:id/estado`                |
| `numero`     | el número lo asigna el servidor y no se cambia   |
| `proyectoId` | un contrato no cambia de proyecto                |

Un cuerpo vacío también es `400` («No hay nada que actualizar»).

### `PUT /contratos/:id/siroc`

**`PUT` y no `PATCH` porque reemplaza el SIROC entero.** Mandar sólo la vigencia y
dejar el número anterior sería exactamente la mezcla que produce avisos de obra a
medias. Sirve para registrarlo y para corregirlo.

```jsonc
{
  "numero": "SIR-2026-0001", // obligatorio, 3 a 40 caracteres
  "fechaRegistro": "2026-09-05", // obligatoria
  "vigenciaHasta": "2027-09-05" // opcional; null si todavía no se sabe
}
// data: { "contrato": { … } }   → 200, no 201
```

El servidor **lo guarda en mayúsculas**: si lo muestras después de capturarlo, usa
lo que devuelve la respuesta y no lo que se tecleó.

**El número es único en TODO el sistema** — no se repite entre empresas, ni entre
clientes, ni entre proyectos. Repetirlo responde `409` **diciendo dónde está el
choque**, que es lo que necesita quien captura:

```jsonc
{
  "status": "fail",
  "message": "El SIROC SIR-2026-0001 ya está registrado en el contrato 1 de Torre Andares",
  "code": "SIROC_DUPLICADO",
  "data": {
    "contratoId": "66f…",
    "contratoNumero": 1,
    "proyectoId": "66f…",
    "proyectoNombre": "Torre Andares"
  }
}
```

Ese `proyectoId` puede ser de un proyecto **que el usuario no ve** (otra empresa).
Muestra el nombre; no armes un enlace que vaya a dar `404`.

`400` también si `vigenciaHasta` es anterior a `fechaRegistro`.

### `DELETE /contratos/:id/siroc`

Lo quita y **libera el número** para poder registrarlo en el contrato correcto.
Existe justamente por eso: con el número único global, un SIROC capturado en el
contrato equivocado dejaría ese número bloqueado para siempre.

```jsonc
// data: { "contrato": { … } }   // siroc: null
```

`400` si el contrato no tenía SIROC. Quitarlo **también destraba el
`registroObraId` del proyecto**, si ningún otro contrato tiene SIROC.

### `POST /contratos/:id/finalizar` · `/reabrir`

Mueven **`estado`**, el ciclo de vida.

```jsonc
// data: { "contrato": { … } }   // estado: 'finalizado' | 'en_curso'
```

`400` si ya estaba en ese estado, y `400` al reabrir si **el proyecto** está
finalizado («Reábrelo antes de reabrir sus contratos»).

### `PATCH /contratos/:id/estado`

Mueve **`activo`**, la baja. Es la única colisión de nombres del contrato de la
API: `/estado` mueve `activo`, y existe además un campo llamado `estado`.

```jsonc
{ "activo": false }
// data: { "contrato": { … } }
```

### `estado` y `activo` no son lo mismo — y en la interfaz tampoco

|                        | Qué significa                         | Cómo se mueve                   |
| ---------------------- | ------------------------------------- | ------------------------------- |
| `estado: 'finalizado'` | el contrato **terminó bien**          | `POST /contratos/:id/finalizar` |
| `activo: false`        | se capturó **por error** o se canceló | `PATCH /contratos/:id/estado`   |

Confundirlos borraría la diferencia entre una obra completada y una que nunca
existió. Un contrato dado de baja **sale de la cuenta** que traba al proyecto: si
era el único, el proyecto vuelve a poder cambiar de cliente y de registro
patronal.

### Lo que los contratos le traban al proyecto

| Campo del proyecto   | Se bloquea cuando                    |
| -------------------- | ------------------------------------ |
| `registroPatronalId` | hay ≥1 contrato **activo**           |
| `registroObraId`     | hay ≥1 contrato activo **con SIROC** |
| `clienteId`          | hay ≥1 contrato **activo**           |
| `empresaId`          | siempre                              |

El registro de obra se traba **antes** que el patronal y con un umbral distinto:
basta un SIROC, porque el aviso ante el IMSS ya salió con esa obra.

Los candados miran el **cambio**, no la presencia: reenviar el mismo id en el
formulario completo sigue funcionando.
