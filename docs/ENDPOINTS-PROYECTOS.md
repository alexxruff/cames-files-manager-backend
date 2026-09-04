# Carteras, proyectos y asignaciones

Referencia de los **36 endpoints** de este dominio para el equipo de front.

> **Actualizado hasta D-90.** Lo último, y es lo que más cambia la pantalla del
> contrato: **el contrato tiene monto** —obligatorio en el alta, un número en
> pesos con el IVA incluido—, **se le registran modificaciones** con fechas y
> monto nuevos y su propio convenio escaneado, y **se puede eliminar**, que borra
> todo rastro. A cambio, **`PATCH /contratos/:id` ya no existe**: responde `410`
> y dice cuál de las tres rutas nuevas hace cada cosa. Todo en §4.4. Antes de eso, **D-83.** Todas las rutas de este documento que aceptan un
> archivo —el contrato, el aviso del SIROC y el acuse de un refrendo— aceptan
> ahora, **como alternativa al `multipart`**, un JSON con `subidaId`: el archivo
> se sube directo a R2 y el servidor sólo lo registra. Es aditivo y el
> `multipart` sigue igual; el paso a paso está en
> [`ENDPOINTS-SUBIDAS.md`](./ENDPOINTS-SUBIDAS.md). Antes de eso, **D-82.** Lo último: **el proyecto ya no habilita puestos**
> (§2). `categorias` desaparece del alta, de la edición y de la respuesta; la
> ruta `POST /proyectos/:id/categorias/clonar` **ya no existe**; y el selector de
> asignables devuelve a todo el personal adscrito y activo de la empresa, sea
> cual sea su puesto. `categoriaId` del alta de asignaciones pasa a **opcional**:
> si no se manda, se guarda el puesto de la propia persona. Antes de eso, el
> **contrato escaneado** (§4.3): un
> endpoint nuevo para pedir su enlace, `archivo` dentro de `Contrato`, y el
> **tope de subida arriba, de 10 a 30 MB** —lo que pidieron: un contrato de obra
> pasa de 20—. `POST /proyectos/:id/contratos` acepta ahora `multipart` (y, desde
> D-90, el papel se adjunta después con `PUT /contratos/:id/archivo`). Ojo: el tope de la **importación de
> nómina** se queda en 10 MB, y sólo ése. Antes de eso, el **archivo del SIROC**
> (§4.2): el
> aviso escaneado y el acuse de cada refrendo, tres endpoints nuevos —dos para
> pedir un enlace fresco y uno para **ponerle el acuse a un refrendo ya
> capturado**— y `archivo` dentro de `Siroc` y de cada `SirocActualizacion`. Es
> aditivo: `PUT /contratos/:id/siroc` y `POST …/actualizaciones` siguen aceptando
> el mismo JSON de siempre. Antes de eso, la actualización del SIROC cada dos
> meses (§4.1, D-76) trajo dos endpoints y el bloque `seguimientoSiroc` en
> **todo** `Contrato`. Y antes, la Fase 8 (D-70 a D-72) trajo
> contratos y SIROC, `GET /asignaciones/:id` y dos campos nuevos en cada
> `Asignacion`; el único comportamiento distinto sigue siendo el `message` del
> alta de asignaciones, que puede traer un aviso — ver §3.

Base: `/api/v1`. Envelope, códigos y convenciones generales: ver
[`INTEGRACION-FRONTEND.md`](./INTEGRACION-FRONTEND.md).

## Índice

| #   | Endpoint                                                   | Quién                    |
| --- | ---------------------------------------------------------- | ------------------------ |
| 1   | `GET /empresas/:id/clientes`                               | sesión                   |
| 2   | `POST /empresas/:id/clientes`                              | `rh_admin` · `jefe_area` |
| 3   | `PATCH /carteras/:id`                                      | `rh_admin` · `jefe_area` |
| 4   | `PATCH /carteras/:id/estado`                               | `rh_admin` · `jefe_area` |
| 5   | `GET /proyectos`                                           | sesión                   |
| 6   | `GET /proyectos/:id`                                       | sesión                   |
| 7   | `POST /proyectos`                                          | `rh_admin` · `jefe_area` |
| 8   | `PATCH /proyectos/:id`                                     | `rh_admin` · `jefe_area` |
| 9   | `POST /proyectos/:id/aplazar`                              | `rh_admin` · `jefe_area` |
| 10  | `POST /proyectos/:id/finalizar`                            | `rh_admin` · `jefe_area` |
| 11  | `POST /proyectos/:id/reabrir`                              | `rh_admin` · `jefe_area` |
| 12  | `GET /proyectos/:id/asignables`                            | sesión                   |
| 13  | `GET /proyectos/:id/asignaciones`                          | sesión                   |
| 14  | `POST /proyectos/:id/asignaciones`                         | asignar a proyectos      |
| 15  | `GET /asignaciones/:id`                                    | sesión                   |
| 16  | `PATCH /asignaciones/:id/salida`                           | asignar a proyectos      |
| 17  | `GET /proyectos/:id/contratos`                             | sesión                   |
| 18  | `POST /proyectos/:id/contratos`                            | `rh_admin` · `jefe_area` |
| 19  | `PATCH /contratos/:id` — **410 desde D-90**                | —                        |
| 31  | `DELETE /contratos/:id`                                    | `rh_admin` · `jefe_area` |
| 32  | `PUT /contratos/:id/archivo`                               | `rh_admin` · `jefe_area` |
| 33  | `POST /contratos/:id/modificaciones`                       | `rh_admin` · `jefe_area` |
| 34  | `DELETE /contratos/:id/modificaciones/ultima`              | `rh_admin` · `jefe_area` |
| 35  | `GET /contratos/:id/modificaciones/:indice/archivo`        | sesión                   |
| 36  | `PUT /contratos/:id/modificaciones/:indice/archivo`        | `rh_admin` · `jefe_area` |
| 20  | `PUT /contratos/:id/siroc`                                 | `rh_admin` · `jefe_area` |
| 21  | `DELETE /contratos/:id/siroc`                              | `rh_admin` · `jefe_area` |
| 22  | `POST /contratos/:id/siroc/actualizaciones`                | `rh_admin` · `jefe_area` |
| 23  | `DELETE /contratos/:id/siroc/actualizaciones/ultima`       | `rh_admin` · `jefe_area` |
| 24  | `GET /contratos/:id/siroc/archivo`                         | sesión                   |
| 25  | `GET /contratos/:id/siroc/actualizaciones/:indice/archivo` | sesión                   |
| 26  | `PUT /contratos/:id/siroc/actualizaciones/:indice/archivo` | `rh_admin` · `jefe_area` |
| 27  | `POST /contratos/:id/finalizar`                            | `rh_admin` · `jefe_area` |
| 28  | `POST /contratos/:id/reabrir`                              | `rh_admin` · `jefe_area` |
| 29  | `PATCH /contratos/:id/estado`                              | `rh_admin` · `jefe_area` |
| 30  | `GET /contratos/:id/archivo`                               | sesión                   |

> **Orden obligado para probar.** Un proyecto no se puede crear si su cliente no
> está antes en la cartera de la empresa:
>
> `POST /empresas` → `POST /clientes` → **`POST /empresas/:id/clientes`** →
> `POST /proyectos` → `POST /categorias` → `POST /empleados` →
> `GET /proyectos/:id/asignables` → `POST /proyectos/:id/asignaciones`
>
> La categoría ya no la pide el proyecto (D-82), pero **sí cada empleado**.

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
  /**
   * El papel escaneado del registro, cuando lo hay (D-79). **Sólo en
   * `registroObra`**: el patronal no lleva archivo y la llave **ni siquiera
   * aparece** en él, así que su forma es la de siempre. En un registro de obra
   * sin papel, `null`.
   *
   * La `url` está firmada y **caduca a los 10 minutos**: para un enlace fresco,
   * `GET /clientes/:id/registros-obra/:roId/archivo`. Forma completa en
   * `CONTRATO-API.md` §«El archivo del registro de obra».
   */
  archivo: {
    nombre: string
    nombreDescarga: string // `<numero>.<ext>`, con el que se guarda
    mime: string
    tamanoBytes: number
    previsualizable: boolean // false en Word, Excel y CSV: hay que descargarlo
    subidoPor: string | null
    subidoEn: string // ISO
    url: string
  } | null
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
  "fechaFinEstimada": "2027-06-30"
}
// data: { "proyecto": { … } }
```

| Código | Cuándo                                                                                                                                                                       |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | **El cliente no está en la cartera activa de esa empresa** (`path: clienteId`)                                                                                               |
| `400`  | El registro patronal **no es de esa empresa**, o está dado de baja (`path: registroPatronalId`)                                                                              |
| `400`  | El registro de obra **no es de ese cliente**, o está dado de baja (`path: registroObraId`)                                                                                   |
| `400`  | `fechaFinEstimada` no es posterior a `fechaInicio`                                                                                                                           |
| `409`  | `code: PROYECTO_DUPLICADO` — el nombre es único **dentro de la empresa**, ignorando acentos y mayúsculas. Dos empresas del grupo sí pueden tener cada una su «Torre Andares» |
| `404`  | La empresa no es suya                                                                                                                                                        |
| `403`  | `rh_consulta`                                                                                                                                                                |

### `PATCH /proyectos/:id`

Acepta **sólo** `nombre`, `clienteId`, `fechaInicio`, `registroPatronalId` y
`registroObraId`. Mandar `categorias` da `400`: es un campo que ya no existe
(D-82).

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

Devuelve **sólo** a quien cumple las tres condiciones a la vez:

1. Adscripción **activa** a la empresa del proyecto.
2. Persona activa (no dada de baja).
3. No está ya asignado a ese proyecto.

**El puesto ya no filtra** (D-82): salen administrativos y mano de obra por
igual, y también quien consulta si está adscrito a esa empresa. `categoriaId` y
`categoriaNombre` siguen viajando en cada renglón, para pintarlos en la lista.

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
// `categoriaId` es OPCIONAL desde D-82: sin él se guarda el puesto de la
// persona, el mismo que trae el selector de asignables.
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
un campo que las relacione: la fase es **un campo del propio contrato**.

Lo que sí son dos son los nombres (D-75): `nombre` es cómo se llama el contrato
('Contrato 001-A') y `fase` el alias con el que la obra lo nombra ('Fase 1',
'Cimentación'). Los dos son opcionales y ninguno se deriva del otro. Los
contratos anteriores a este cambio salen con `"fase": null`.

### Lo que el contrato NO tiene

Antes de que lo busquen, porque son las tres suposiciones naturales:

- **No tiene `clienteId`.** El cliente es el del proyecto; un contrato no cambia
  de proyecto ni de cliente.
- **No tiene `empresaId`.** Sale del proyecto.
- **Sí tiene `monto` desde D-90**, y es lo único que el backend modela como
  dinero: un número en pesos, el total **con IVA incluido**. No hay subtotal,
  impuesto ni moneda — es siempre MXN.

### `Contrato`

```ts
interface Contrato {
  _id: string
  proyectoId: string
  numero: number // secuencia dentro del proyecto: 1, 2, 3… LA PONE EL SERVIDOR
  nombre: string | null // nombre del contrato
  fase: string | null // etiqueta de la fase: 'Fase 1', 'Cimentación'
  fechaInicio: string // 'YYYY-MM-DD' — el VIGENTE (§4.4)
  fechaFin: string // 'YYYY-MM-DD' — el VIGENTE, y el techo del SIROC
  monto: number | null // pesos, IVA incluido. null = nunca se capturó (§4.4)
  historia: HistoriaContrato // la línea del tiempo, derivada al leer (§4.4)
  siroc: Siroc | null // null hasta que se registre
  archivo: Archivo | null // el contrato escaneado, ver §4.3
  estado: 'en_curso' | 'finalizado'
  activo: boolean // la BAJA, que no es lo mismo que `estado`
  seguimientoSiroc: SeguimientoSiroc // derivado al leer; SIEMPRE viene, ver §4.1
  seguimientoContrato: SeguimientoContrato // derivado al leer; SIEMPRE viene, ver §4.1
  createdAt: string
  updatedAt: string
}

interface HistoriaContrato {
  modificado: boolean // false → este contrato NO tiene historia que mostrar
  entradas: EntradaHistoria[] // [] cuando `modificado` es false
}

interface EntradaHistoria {
  tipo: 'original' | 'modificacion'
  indice: number | null // null en la original; en la modificación, su posición
  fechaAcuerdo: string | null // el día en que se firmó el convenio
  motivo: string | null
  fechaInicio: string // 'YYYY-MM-DD'
  fechaFin: string // 'YYYY-MM-DD'
  monto: number | null // null sólo en la original de un contrato anterior a D-90
  archivo: Archivo | null // el contrato escaneado, o el convenio de esa modificación
  vigente: boolean // true en la última: sus valores son los del contrato
}

interface Siroc {
  numero: string // único en TODO el sistema; el servidor lo pasa a MAYÚSCULAS
  fechaRegistro: string // 'YYYY-MM-DD'; la ÚNICA fecha del aviso — no hay final
  actualizaciones: SirocActualizacion[] // los refrendos de cada 2 meses; [] al nacer
  archivo: Archivo | null // el aviso escaneado, ver §4.2
}

interface SirocActualizacion {
  fecha: string // 'YYYY-MM-DD'
  nota: string | null // folio del acuse, quién fue… máximo 200 caracteres
  monto: number | null // lo reportado ESE bimestre (D-91); null ≠ 0
  bimestre: string | null // SIEMPRE cadena: '3', '2026-3', 'mayo-junio'
  archivo: Archivo | null // el acuse de ESTE refrendo, ver §4.2
}

interface Archivo {
  nombre: string // el del archivo original, para mostrar
  mime: string
  tamanoBytes: number
  subidoPor: string | null // el NOMBRE de quien lo subió
  subidoEn: string // ISO
  previsualizable: boolean // false → ofrece descargar, no un visor
  nombreDescarga: string // con el que se guarda: 'SIR-2026-0001.pdf', 'Fase 1.pdf'
  url: string // firmada; CADUCA A LOS 10 MINUTOS
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

**El cuerpo completo son cinco campos, y dos son opcionales:**

```jsonc
{
  "nombre": "Contrato 001-A", // opcional; null, "" o ausente → null
  "fase": "Fase 1", // opcional; null, "" o ausente → null
  "fechaInicio": "2026-09-01", // obligatoria
  "fechaFin": "2026-12-31", // obligatoria
  "monto": 1500000.5 // obligatorio desde D-90: pesos, IVA incluido
}
// data: { "contrato": { … } }
```

`nombre` y `fase` se recortan, y el vacío se guarda como `null`: mandar `"   "`
devuelve `null`, nunca cadena vacía. (Hasta el 31 ago 2026 el alta con
`"nombre": ""` devolvía `""`; era un incumplimiento de la regla 5 y ya no pasa.)

**No mandes `numero`**: es una secuencia dentro del proyecto y la calcula el
servidor. Es el **hueco libre más bajo**: los dados de baja siguen ocupando el
suyo, pero el de un contrato **eliminado** queda libre y el siguiente alta lo
reusa (D-90). Tampoco mandes `siroc`, que va por su propia ruta.

También acepta `multipart/form-data` con el **contrato escaneado** en el campo
`archivo`, opcional (§4.3). Sin archivo, el JSON de siempre funciona igual.

Ojo: **el alta IGNORA los campos de más en silencio** —mandar `clienteId`
devuelve `201` y un contrato sin él—, mientras que
`POST /contratos/:id/modificaciones` sí los rechaza con `400`.

| Código | Cuándo                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------ |
| `400`  | El proyecto está **finalizado**                                                                  |
| `400`  | Falta `fechaInicio` o `fechaFin`, o no son `AAAA-MM-DD`                                          |
| `400`  | `fechaFin` anterior a `fechaInicio` (`path: fechaFin`)                                           |
| `400`  | `fechaInicio` antes del inicio del proyecto, o `fechaFin` después de su fin (D-85, en `message`) |
| `400`  | `nombre` o `fase` de más de 120 caracteres                                                       |
| `400`  | Falta `monto`, es negativo o no es un número (`El monto del contrato es requerido`)              |
| `404`  | Proyecto inexistente o ajeno                                                                     |

**Las fechas del contrato caben en las del proyecto** (D-85): de
`proyecto.fechaInicio` a `fechaFinReal ?? fechaFinEstimada`, bordes incluidos.
Los dos `400` traen la fecha del proyecto que acota, en `message`:

- `La fecha de inicio del contrato no puede ser anterior al inicio del proyecto (2026-09-01)`
- `La fecha de fin del contrato no puede ser posterior al fin del proyecto (2027-03-01)`

### `PATCH /contratos/:id` → `410`

**Editar un contrato ya no existe** (D-90). Responde `410` con
`code: 'RUTA_MOVIDA'` y un `message` que nombra las tres rutas que lo sustituyen.
No toca nada: el contrato se queda como estaba.

| Lo que hacías con el `PATCH` | Lo que se hace ahora                                        |
| ---------------------------- | ----------------------------------------------------------- |
| cambiar fechas               | `POST /contratos/:id/modificaciones` — queda en la historia |
| adjuntar el papel escaneado  | `PUT /contratos/:id/archivo`                                |
| corregir `nombre` o `fase`   | `DELETE /contratos/:id` y capturarlo de nuevo               |

Se quitó porque **editar se confundía con modificar**: repactar el plazo o el
precio es un hecho nuevo que debe quedar registrado, y el `PATCH` lo borraba sin
dejar rastro.

### `PUT /contratos/:id/archivo`

Sube el **contrato escaneado**, o reemplaza el que tenga. Es lo que quedó del
`PATCH` para adjuntar el papel: el escaneo casi nunca está a la mano el día que
se capturan las fechas.

- `multipart/form-data` con el archivo en el campo `archivo`, **o**
- JSON `{ "subidaId": "…" }` con un permiso de destino `contrato` (D-83).

`200` con `{ "contrato": { … } }` y `message` = `Contrato escaneado guardado`. El
anterior se borra de R2: es uno solo y se reemplaza, no se versiona.

| Código | Cuándo                                                              |
| ------ | ------------------------------------------------------------------- |
| `400`  | Ni archivo ni `subidaId` (`Envía el archivo en el campo "archivo"`) |
| `403`  | No gestiona proyectos                                               |
| `404`  | Contrato inexistente o ajeno                                        |
| `413`  | Pasa de 30 MB                                                       |
| `415`  | Tipo no aceptado (D-78)                                             |

Toca **sólo el archivo del contrato original**. El convenio de una modificación
es suyo y va por su propia ruta.

### `POST /contratos/:id/modificaciones` → `201`

Registra que **se repactó** el contrato: el cliente aplazó la obra, cambió el
precio, se anexaron requerimientos. Desde aquí valen las fechas y el monto
nuevos, **para todo** —incluido el techo del SIROC—, y los que había bajan a la
historia con su papel.

```jsonc
{
  "fechaInicio": "2026-01-01", // obligatoria
  "fechaFin": "2026-12-31", // obligatoria
  "monto": 2100000.5, // obligatorio
  "motivo": "El cliente aplazó la obra", // opcional, ≤ 300 caracteres
  "fechaAcuerdo": "2026-03-20" // opcional; sin ella, hoy. No puede ser futura
}
// data: { "contrato": { … } }  ← con `historia` ya actualizada
```

Los tres primeros son obligatorios **siempre**: una modificación es el nuevo
estado completo de lo pactado, no un parche de un campo. Acepta también
`multipart` con el **convenio modificatorio** en `archivo`, o `subidaId` con
destino `contrato-modificacion`; es **opcional**, como el acuse de un refrendo,
porque el papel firmado llega días después.

| Código | Cuándo                                                                              |
| ------ | ----------------------------------------------------------------------------------- |
| `400`  | Falta alguna de las tres, o `monto` no es un número / es negativo                   |
| `400`  | `fechaFin` anterior a `fechaInicio`                                                 |
| `400`  | Las fechas se salen de las del proyecto (D-85, la fecha va en `message`)            |
| `400`  | `fechaAcuerdo` futura (`La fecha del acuerdo no puede ser futura`)                  |
| `400`  | El contrato está **finalizado** (reábrelo) o **dado de baja** (reactívalo)          |
| `400`  | Mandaste `nombre`, `fase`, `numero` o `siroc` — el mensaje dice qué hacer con ellos |
| `403`  | No gestiona proyectos                                                               |
| `404`  | Contrato inexistente o ajeno                                                        |

### `DELETE /contratos/:id/modificaciones/ultima`

Deshace **la última**, como el último reporte bimestral del SIROC: el contrato
vuelve a los términos de la modificación anterior o, si era la única, a los del
alta —y entonces `historia.modificado` vuelve a `false`—. El convenio de esa
modificación se borra de R2; el del contrato original, no.

`400` si no hay ninguna (`Ese contrato no tiene modificaciones registradas`).

### `GET` / `PUT` `/contratos/:id/modificaciones/:indice/archivo`

El **convenio modificatorio** de una modificación concreta, direccionada por
**posición** —el `indice` que viene en cada entrada de `historia`—.

- `GET` devuelve `{ "archivo": { …, "url" } }` con un enlace fresco;
  `?descargar=true` fuerza la descarga. Sólo pide sesión y alcance.
- `PUT` le pone el convenio a una modificación **ya capturada**, o reemplaza el
  que tenga, sin tocar fechas ni monto. `multipart` campo `archivo`, o
  `subidaId`. Pide gestionar proyectos.

`404` `Esa modificación no existe` si el índice no existe, y
`Esa modificación no tiene convenio adjunto` si aún no le han subido el papel.

### `DELETE /contratos/:id`

**Borra el contrato de verdad**, con su SIROC, sus reportes bimestrales, sus
modificaciones y **todos sus archivos**. No se puede deshacer. Es para el
contrato que se capturó mal —en el proyecto equivocado, o con el SIROC de otro— y
hay que rehacer.

```jsonc
// 200 · message: "Contrato eliminado"
{
  "eliminado": {
    "_id": "66f...",
    "numero": 1,
    "nombre": "Contrato 001-A",
    "fase": null,
    "sirocNumero": "SIR-2026-0001", // o null
    "reportesBimestrales": 2,
    "modificaciones": 1,
    "archivos": 4
  }
}
```

Libera **el número de SIROC** —que es único en todo el sistema, y sin esto quedaba
bloqueado para siempre— y **el número del contrato** dentro del proyecto.

**No es dar de baja.** `PATCH /contratos/:id/estado` con `activo: false` deja el
contrato existiendo, en el listado con `incluirInactivos=true` y reactivable; eso
es historia y se queda. La pantalla tiene que dejar clarísima la diferencia y
**pedir confirmación explícita** antes de eliminar.

| Código | Cuándo                                             |
| ------ | -------------------------------------------------- |
| `403`  | No gestiona proyectos (`rh_consulta`, por ejemplo) |
| `404`  | Contrato inexistente o ajeno                       |

### `PUT /contratos/:id/siroc`

**`PUT` y no `PATCH` porque reemplaza el SIROC entero.** Mandar sólo la fecha y
dejar el número anterior sería exactamente la mezcla que produce avisos de obra a
medias. Sirve para registrarlo y para corregirlo.

**Del aviso se capturan dos datos y ya**, y ninguno es una fecha final (D-76):

```jsonc
{
  "numero": "SIR-2026-0001", // obligatorio, 3 a 40 caracteres
  "fechaRegistro": "2026-09-05" // obligatoria; la ÚNICA fecha del SIROC
}
// data: { "contrato": { … } }   → 200, no 201
```

**Quita `vigenciaHasta` del formulario.** El aviso vale dos meses contados desde
`fechaRegistro` —o desde la última actualización—, así que su vigencia no es un
dato que alguien teclee: viene derivada en
`seguimientoSiroc.vigenciaPeriodoHasta`, y es la que dispara el aviso de que hay
que refrendar. Mientras el campo siga en la pantalla, mandarlo **no rompe nada**:
el servidor lo ignora, no lo guarda y no lo devuelve.

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

`400` si `fechaRegistro` no viene o no es `AAAA-MM-DD`, y también si quedara
**después** de una actualización ya registrada.

**`fechaRegistro` va pegada al inicio del contrato** (D-85): entre
`contrato.fechaInicio` y siete días después, los dos incluidos — el aviso se
presenta al arrancar. Fuera de ahí, `400` con el rango en `message`:
`La fecha de registro del SIROC debe estar entre el 2026-09-01 y el 2026-09-08:
el aviso se presenta al arrancar el contrato`. Se revisa **sólo si la fecha
cambia**: corregir el número de un SIROC viejo reenvía su misma fecha y pasa.

### `DELETE /contratos/:id/siroc`

Lo quita y **libera el número** para poder registrarlo en el contrato correcto.
Existe justamente por eso: con el número único global, un SIROC capturado en el
contrato equivocado dejaría ese número bloqueado para siempre.

```jsonc
// data: { "contrato": { … } }   // siroc: null
```

`400` si el contrato no tenía SIROC. Quitarlo **también destraba el
`registroObraId` del proyecto**, si ningún otro contrato tiene SIROC.

## 4.1 El SIROC se actualiza cada dos meses (D-76)

El aviso de obra **se refrenda cada dos meses conservando el mismo número**. No es
un SIROC nuevo: `siroc.numero` no cambia nunca al actualizarlo, y lo que crece es
`siroc.actualizaciones`.

Todo `Contrato` trae `seguimientoSiroc` — **siempre, con SIROC o sin él**. Se
**deriva en cada lectura**: no hay nada que marcar ni apagar, y el mismo contrato
responde distinto mañana. No lo caches.

```ts
interface SeguimientoSiroc {
  periodoMeses: 2
  actualizacionesRequeridas: number // predichas desde fechaInicio/fechaFin
  actualizacionesRegistradas: number // el contador de SIROC actualizados
  actualizacionesPendientes: number // las que faltan DE VERDAD; ojo, no es la resta
  ultimaActualizacion: string | null // 'YYYY-MM-DD'
  vigenciaPeriodoHasta: string | null // cuándo cumple los 2 meses; null sin SIROC
  diasParaActualizacion: number | null // negativo si ya pasó; null sin SIROC
  requiereActualizacion: boolean // true SÓLO con estado 'vencida'
  estado: 'sin_siroc' | 'no_requiere' | 'al_dia' | 'por_vencer' | 'vencida'
  mensaje: string // en español, listo para pintar tal cual
}
```

| `estado`      | Cuándo                                                                                     | Qué pintar                 |
| ------------- | ------------------------------------------------------------------------------------------ | -------------------------- |
| `sin_siroc`   | El contrato todavía no tiene SIROC                                                         | Nada urgente               |
| `no_requiere` | Finalizado, dado de baja, **pasado de su `fechaFin` sin deuda**, o la ventana cubre el fin | Nada del SIROC             |
| `al_dia`      | Faltan más de 5 días (umbral del servidor, configurable)                                   | Verde, con la fecha        |
| `por_vencer`  | Faltan 5 días o menos; el día justo entra aquí, no en `vencida`                            | Aviso, sin bloquear        |
| `vencida`     | Pasaron los dos meses, dentro de sus fechas **o con deuda de entonces**                    | Alerta: hay que actualizar |

**`requiereActualizacion` es `true` sólo con `vencida`.** `por_vencer` avisa con
anticipación, pero todavía no se debe nada — si el semáforo usa el booleano y el
texto usa `estado`, van a decir cosas distintas a propósito.

### La `fechaFin` del contrato es el techo (D-84) — **cambió**

**Un contrato que pasó su `fechaFin` ya no acumula actualizaciones nuevas.** Antes
pedía una cada dos meses, para siempre, y toda obra terminada que nadie cerró se
quedaba en rojo. Ahora la cuenta **se corta en `fechaFin`** y, si no queda nada
por cubrir, cae en `no_requiere` con:

```jsonc
{
  "estado": "no_requiere",
  "actualizacionesPendientes": 0,
  "requiereActualizacion": false,
  "diasParaActualizacion": null, // ya no hay una cuenta atrás que pintar
  "vigenciaPeriodoHasta": "2026-07-01", // hasta dónde llegó el aviso: eso SÍ viene
  "mensaje": "El contrato terminó el 2026-05-02: su SIROC ya no requiere reportes bimestrales."
}
```

**Pero el techo corta la cuenta, no la borra.** Si el aviso dejó de cubrir antes
de que el contrato terminara, lo que se debía entonces **se sigue debiendo**:
responde `vencida` con los pendientes que faltaron hasta `fechaFin` —ni uno más,
por mucho que pase el tiempo— y este mensaje:

```jsonc
{
  "estado": "vencida",
  "actualizacionesPendientes": 2, // del 2 de marzo al 30 de mayo, y ahí se corta
  "requiereActualizacion": true,
  "diasParaActualizacion": -185,
  "mensaje": "El SIROC requiere su reporte bimestral desde el 2026-03-02: venció hace 185 días, con el contrato todavía en curso. Regístralo con la fecha en que se presentó, a más tardar el 2026-05-30."
}
```

Ese refrendo **se captura con la fecha de entonces**: el `POST` sin `fecha` asume
hoy y lo rechaza con el `400` de abajo. Al presentarlo, si su fecha más dos meses
rebasa `fechaFin`, la cuenta da `0` y el contrato queda en `no_requiere` solo.
Deshacer el último refrendo de un contrato ya terminado **vuelve a pedirlo**, por
la misma cuenta.

**El día justo de `fechaFin` todavía cuenta como dentro.** Y **un contrato dentro
de sus fechas no cambia en nada**: si su aviso cumplió los dos meses y la obra
sigue, hay que refrendarlo aunque ya tenga capturados todos los que sus fechas
preveían.

Ese contrato **no queda en verde**: lo que le falta es que alguien lo cierre o
corrija sus fechas, y eso viene aparte, en `seguimientoContrato` (abajo). Es de
ahí de donde sale el aviso ahora, no del SIROC.

Los cuatro cálculos que conviene no repetir en el front:

- **`actualizacionesRequeridas`** son las ventanas de dos meses que hacen falta
  para cubrir `fechaInicio → fechaFin`, **menos la primera**, que ya la cubre el
  SIROC original. Un contrato de dos meses justos pide **cero**; uno de seis,
  **dos**. Es la **predicción del plan**, y sale desde el alta, antes de que
  exista el SIROC.
- **`actualizacionesPendientes` NO es `requeridas − registradas`.** Son las
  ventanas que faltan **de `vigenciaPeriodoHasta` a `fechaFin`**: se cuentan desde
  donde llega el aviso vigente, que ya incorpora cada refrendo presentado. Si
  pintas «faltan N», usa este campo y **nunca la resta**.
- **La ventana vigente corre desde la última actualización**, o desde
  `fechaRegistro` si no hay ninguna. **No desde el inicio del contrato**: un SIROC
  tramitado tarde vence tarde.
- **El techo es `fechaFin`**, lo cierre alguien o no.

**`no_requiere` ya nunca viene con pendientes.** Un contrato finalizado o dado de
baja decía «no requiere» y «2 pendientes» a la vez; ahora las tres razones de
`no_requiere` responden `0`.

**Al editar las fechas del contrato, el bloque se recalcula solo** —se deriva al
leer— y **contando los refrendos que ya hay**. No hace falta pedir nada extra ni
arreglar nada a mano; basta con repintar lo que devuelve el `PATCH`:

| Se edita `fechaFin`   | Qué responde                                                   |
| --------------------- | -------------------------------------------------------------- |
| Se aplaza             | Vuelve a pedir **desde donde va el aviso**, no desde cero      |
| Se recorta            | Deja de pedir lo que los refrendos ya alcanzan a cubrir        |
| Se recorta por debajo | `0` pendientes, sin negativos y **sin borrar ningún refrendo** |

En ese último caso van a ver `actualizacionesRegistradas: 2` con
`actualizacionesRequeridas: 0`. **No lo pinten como una falta ni como un error de
captura**: esos avisos se presentaron de verdad ante el IMSS. Son dos cosas
distintas —lo que hay y lo que las fechas preveían— y así conviene decirlas.

### `seguimientoContrato` — el cabo suelto, por su nombre (D-84) — **nuevo**

Todo `Contrato` lo trae, siempre, derivado al leer igual que el otro:

```ts
interface SeguimientoContrato {
  estado: 'por_iniciar' | 'en_curso' | 'terminado_sin_cerrar' | 'finalizado' | 'baja'
  diasDesdeFin: number | null // días desde `fechaFin`; null si todavía no pasa
  requiereCierre: boolean // true SÓLO en 'terminado_sin_cerrar'
  mensaje: string // en español, listo para pintar tal cual
}
```

| `estado`               | Cuándo                                                  | Qué pintar                        |
| ---------------------- | ------------------------------------------------------- | --------------------------------- |
| `por_iniciar`          | `fechaInicio` todavía no llega                          | Nada                              |
| `en_curso`             | Hoy cae entre sus fechas, el día de `fechaFin` incluido | Nada                              |
| `terminado_sin_cerrar` | Pasó su `fechaFin` y nadie lo finalizó                  | **Aviso**: hay que cerrarlo       |
| `finalizado`           | `estado: 'finalizado'`                                  | Nada                              |
| `baja`                 | `activo: false`                                         | Nada; ya se sabe que está de baja |

**Para decidir si se pinta el aviso basta `requiereCierre`.** Es `true` exactamente
en `terminado_sin_cerrar`, y su `mensaje` ya dice qué hacer: «Este contrato
terminó el 2026-05-02 hace 61 días y sigue abierto: finalízalo, o corrige su
fecha de fin si la obra sigue.». `diasDesdeFin` viene también en `finalizado` y en
`baja` —es un hecho—, así que **no lo usen como señal**: úsenlo sólo para el texto.

`baja` manda sobre las fechas: un contrato capturado por error no es uno que haya
que cerrar.

### `POST /contratos/:id/siroc/actualizaciones` → `201`

Registra que el SIROC se refrendó. **Los cuatro campos son opcionales:**

```jsonc
{
  "fecha": "2026-11-12", // opcional; sin ella se asume HOY, que es el caso normal
  "nota": "Acuse 4471", // opcional; máximo 200 caracteres
  "monto": 320450.75, // opcional; lo reportado ESE bimestre, en pesos (D-91)
  "bimestre": "mayo-junio" // opcional; tal como se teclea, máximo 40 caracteres
}
// data: { "contrato": { … } }   // con seguimientoSiroc ya recalculado
```

**El monto y el bimestre son del reporte, no del contrato** (D-91).
`contrato.monto` es el total de la obra (D-90); éste es la cifra de esos dos
meses, y no se cuadran entre sí.

- Los dos **se capturan sólo aquí**. No hay ruta para corregirlos: un reporte mal
  capturado se deshace con `DELETE …/ultima` y se vuelve a registrar, igual que
  con una fecha. Y sólo se deshace **el último**, así que corregir uno de en medio
  obliga a deshacer los que vinieron después y recapturarlos con sus acuses —eso
  hay que decirlo en la pantalla antes de que lo intenten—.
- `monto` **`null` es «no se capturó» y `0` es un bimestre reportado en ceros**:
  no los pinten igual. Los refrendos anteriores a D-91 salen todos en `null`.
- `bimestre` sale **siempre como cadena o `null`**, aunque manden el número `3`
  —lo reciben como `"3"`—. Se guarda tal como se teclea.
- Los dos viajan también por `multipart`, junto al acuse, como el resto.

**Un refrendo espera un mes y 25 días desde el movimiento anterior** (D-85): el
registro del aviso o la última actualización, con la aritmética de la vigencia
—mismo día del mes siguiente, recortado a fin de mes— más 25 días. 1 ene → 26
feb; 31 ene → 28 feb → 25 mar. Es cinco días antes de que venza, cuando ya
marcan `por_vencer`. Se mira sólo sobre el que entra: los ya capturados no se
tocan.

**El techo se mira contra la `fecha` que mandas, no contra hoy** (D-84): capturar
tarde un refrendo que sí se tramitó dentro del contrato **sigue funcionando** —el
papel llega después—, y lo que se rechaza es colgarle uno posterior a su fin. Si
les sale ese `400`, lo que toca ofrecer es finalizar el contrato o editar su
`fechaFin`, no reintentar.

**No mandes `numero`**: actualizar el SIROC conserva el mismo, y el `400` lo dice.
`fechaRegistro` tampoco: va por `PUT /contratos/:id/siroc`. Y `vigenciaHasta` no
existe en ninguna de las dos: la vigencia se deriva.

| Código | Cuándo                                                           | `message`                                                                                                                                            |
| ------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | El contrato no tiene SIROC                                       | `Ese contrato no tiene SIROC registrado`                                                                                                             |
| `400`  | Contrato finalizado o dado de baja                               | `El contrato ya no está en curso: su SIROC no necesita más reportes bimestrales`                                                                     |
| `400`  | `fecha` futura                                                   | `El reporte bimestral del SIROC no puede tener fecha futura`                                                                                         |
| `400`  | `fecha` anterior al registro o a la actualización anterior       | `El reporte bimestral no puede ser anterior al registro del SIROC (…)`                                                                               |
| `400`  | `fecha` antes de un mes y 25 días del movimiento anterior (D-85) | `El SIROC se registró el AAAA-MM-DD: el siguiente reporte bimestral no puede fecharse antes del AAAA-MM-DD` (o «se reportó el»)                      |
| `400`  | `fecha` posterior a `fechaFin` del contrato (D-84)               | `El contrato terminó el AAAA-MM-DD y su SIROC ya no requiere reportes bimestrales: finaliza el contrato, o corrige su fecha de fin si la obra sigue` |
| `400`  | `monto` negativo o que no es un número (D-91)                    | `El monto del reporte bimestral no puede ser negativo` · `… debe ser un número en pesos` (en `errors[0].msg`)                                        |
| `400`  | `bimestre` de más de 40 caracteres (D-91)                        | `El bimestre no puede exceder 40 caracteres` (en `errors[0].msg`)                                                                                    |
| `400`  | Campos que no van aquí (`numero`, `fechaRegistro`…)              | Lista los campos y dice por dónde va cada uno (en `errors[0].msg`)                                                                                   |
| `404`  | Contrato inexistente o de otra empresa                           | `El contrato no existe`                                                                                                                              |

Ojo: los `400` de negocio traen el texto en **`message`**; sólo los de validación
de campos traen `errors[0].msg`. Es la misma convención del resto del recurso.

### `DELETE /contratos/:id/siroc/actualizaciones/ultima`

Deshace **la última** actualización, para cuando se capturó con la fecha
equivocada — o con el monto o el bimestre equivocados (D-91), que se van con
ella, como su acuse. Sólo la última: borrar una de en medio reescribiría la historia, y una
fecha mal tecleada corre la ventana y hace que el contrato **calle avisos que
debería dar**.

```jsonc
// data: { "contrato": { … } }   // 200
```

`400` si no hay ninguna que deshacer.

**Corregir el SIROC con `PUT` conserva sus actualizaciones**: son del mismo aviso.
Para empezar de cero está `DELETE /contratos/:id/siroc`, que se lleva el aviso
entero. Y si la nueva `fechaRegistro` quedara **después** de una actualización ya
registrada, el `PUT` responde `400` diciéndolo, en vez de dejar el SIROC en un
estado imposible.

## 4.2 El papel del SIROC (D-80)

**Son dos archivos distintos y los dos son opcionales.** `siroc.archivo` es el
aviso escaneado; `siroc.actualizaciones[n].archivo` es el acuse de **ese**
refrendo. Refrendar no sustituye al aviso original —el número no cambia—, así que
el papel nuevo se suma en vez de pisar al anterior: lo que se enseña si el IMSS
revisa es la serie completa.

### Subirlos

Las dos rutas que ya usas aceptan ahora `multipart/form-data` con el campo
`archivo`, **además de seguir aceptando el mismo `application/json` de siempre**.
No hay endpoint nuevo para subir: si no mandas archivo, nada cambia.

```js
// El aviso, al registrar o corregir el SIROC
const fd = new FormData()
fd.append('numero', 'SIR-2026-0001')
fd.append('fechaRegistro', '2026-09-05')
fd.append('archivo', file) // opcional
await api.put(`/contratos/${id}/siroc`, fd)

// El acuse, al capturar un refrendo
const fd2 = new FormData()
fd2.append('fecha', '2026-11-12') // opcional (hoy)
fd2.append('archivo', file) // opcional
await api.post(`/contratos/${id}/siroc/actualizaciones`, fd2)
```

**Un solo archivo por petición**, en el campo `archivo`. Tipos aceptados: PDF,
JPG, PNG, WEBP, DOC, DOCX, XLS, XLSX y CSV — se detectan **por contenido**, así
que renombrar la extensión no engaña a nadie. `415` si no es uno de ésos, con el
motivo en `message`. Límite **30 MB** por archivo desde D-81, `413` si se pasa.

### Qué se conserva y qué se borra

| Acción                               | Qué le pasa a los archivos                                          |
| ------------------------------------ | ------------------------------------------------------------------- |
| `PUT /siroc` sin archivo             | **No se toca ninguno.** Corregir el número no tira nada             |
| `PUT /siroc` con archivo             | Reemplaza el del aviso; el anterior se borra                        |
| `POST …/actualizaciones` con archivo | Se guarda como acuse **de esa** renovación                          |
| `PUT …/actualizaciones/:i/archivo`   | Le pone o reemplaza el acuse a **ese** refrendo, sin tocar nada más |
| `DELETE …/actualizaciones/ultima`    | Se lleva su acuse, y sólo el suyo                                   |
| `DELETE /siroc`                      | Se lleva el aviso y **todos** los acuses                            |

No se versiona: reemplazar borra. No hay forma de quitar un archivo dejando el
SIROC sin él.

### Ponerle el acuse a un refrendo ya capturado

```jsonc
// PUT /contratos/:id/siroc/actualizaciones/0/archivo
// multipart/form-data, campo `archivo` — OBLIGATORIO aquí
// data: { "contrato": { … } }   → 200
```

**El acuse sellado casi siempre llega después** de capturar el refrendo, así que
esta ruta existe para no obligar a nadie a deshacer la actualización y volver a
capturarla: eso movería la ventana de dos meses y con ella todos los avisos de
vencimiento.

- **Sirve para cualquiera**, no sólo la última: `…/0/archivo`, `…/1/archivo`…
- **Toca sólo el archivo.** Ni la fecha, ni la nota, ni el orden, ni la cuenta de
  refrendos, ni `seguimientoSiroc`: la respuesta trae el mismo bloque de antes.
- **Reemplaza** el que hubiera, borrando el anterior. No se versiona.
- **Se puede aunque el contrato esté finalizado** — el acuse tardío es justo el
  caso que resuelve.
- Mismos tipos y mismo límite que el aviso.

**Permiso:** `rh_admin` o `jefe_area`, el mismo que capturar el refrendo. El `GET`
de esa misma ruta sigue pidiendo sólo sesión y alcance.

| Código | `message` (o `errors[0].msg` donde se indica)              | Qué lo dispara                     |
| ------ | ---------------------------------------------------------- | ---------------------------------- |
| `400`  | `Envía el archivo en el campo "archivo"` (`errors[0].msg`) | La petición no trae archivo        |
| `400`  | `Ese contrato no tiene SIROC registrado`                   | El contrato todavía no tiene aviso |
| `404`  | `Ese reporte bimestral del SIROC no existe`                | La posición está fuera del arreglo |

Un `415` **no deja la actualización a medias**: si el archivo se rechaza, el
refrendo se queda exactamente como estaba.

### Pedir un enlace fresco

`archivo.url` viene firmada y **caduca a los 10 minutos**, así que una pantalla
abierta un rato se queda con un enlace muerto. Para uno nuevo, sin recargar el
proyecto entero:

```jsonc
// GET /contratos/:id/siroc/archivo
// GET /contratos/:id/siroc/actualizaciones/0/archivo
// data: { "archivo": { …, "url": "https://…" } }
```

`?descargar=true` fuerza la descarga. Lo que trae `previsualizable: false` —Word,
Excel, CSV— se descarga siempre, aunque no lo pidas: servirlo `inline` sería una
pantalla de basura binaria.

**Las renovaciones se piden por posición** (`0`, `1`, `2`…), no por id: no tienen
`_id`. El índice es estable porque el arreglo sólo crece y sólo se puede quitar la
última.

| Código | Cuándo                                 | `message`                                                         |
| ------ | -------------------------------------- | ----------------------------------------------------------------- |
| `400`  | El índice no es un número              | `El reporte bimestral indicado no es válido` (en `errors[0].msg`) |
| `404`  | El contrato no tiene SIROC             | `Ese contrato no tiene SIROC registrado`                          |
| `404`  | El SIROC no tiene archivo              | `Ese SIROC no tiene archivo`                                      |
| `404`  | Esa posición no existe                 | `Ese reporte bimestral del SIROC no existe`                       |
| `404`  | Contrato inexistente o de otra empresa | `El contrato no existe`                                           |

**Permisos.** Subir exige `rh_admin` o `jefe_area`, lo mismo que capturar el
SIROC. **Abrir el papel sólo pide sesión y alcance**: quien puede leer el número
del aviso puede ver el aviso.

### Dónde más viene el enlace

En **todos** los lugares donde ya venía el SIROC, sin pedir nada extra: los
contratos del proyecto (`GET /proyectos/:id/contratos`, y toda respuesta que
devuelva un `contrato`) y las **obras del expediente** de quien está asignado a
ellas (`GET /empleados/:id/expediente` → `obras[].siroc`, D-77). Se firma al leer,
así que siempre llega vivo.

## 4.3 El contrato escaneado, y el tope de subida (D-81)

El **contrato firmado** ya se puede adjuntar. Es **uno solo y se reemplaza**, al
revés que el del SIROC —donde cada refrendo produce un papel nuevo que se suma—:
aquí volver a escanear es corregir, no historiar.

### Lo primero: el tope subió a 30 MB

Lo que rebotaba sus contratos era `MAX_UPLOAD_BYTES`, y eran 10 MB. **Ahora son
30**, y no sólo para el contrato: también para el expediente, el registro de obra
y el aviso del SIROC. Pueden subir la constante de su validación de un tirón.

**Con una excepción, y es importante**: las dos rutas de **importación de
nómina** (`POST /empleados/importar[/previsualizar]`) se quedan en **10 MB**.
No es un olvido: ahí el `.xlsx` se abre entero en memoria y se expande, y un
archivo grande tumba el servidor en vez de subirse. Un reporte de nómina real
pesa cientos de KB. El `413` dice **el tope de esa ruta**, así que el mensaje de
error ya trae la cifra correcta y pueden mostrarlo tal cual.

### Subirlo

Dos rutas, las dos como `multipart/form-data` con el campo `archivo` y las dos
aceptando también `application/json` con `subidaId` (D-83):

```js
// Al capturar el contrato
const fd = new FormData()
fd.append('nombre', 'Contrato 001-A')
fd.append('fechaInicio', '2026-09-01')
fd.append('fechaFin', '2026-12-31')
fd.append('monto', '1500000.50') // obligatorio desde D-90
fd.append('archivo', file) // opcional
await api.post(`/proyectos/${id}/contratos`, fd)

// Adjuntarlo DESPUÉS, que es el caso normal: sólo el archivo
const fd2 = new FormData()
fd2.append('archivo', file)
await api.put(`/contratos/${contratoId}/archivo`, fd2)
```

Ese segundo caso es el que importa: **las fechas se capturan el día que se firma
y el escaneo llega después**. Hasta D-90 eso se hacía con un `PATCH` de sólo
archivo; ahora es `PUT /contratos/:id/archivo`, y el `message` es
`Contrato escaneado guardado`.

Tipos aceptados y detección por contenido: los mismos de §4.2 (D-78).

| Acción                        | Qué le pasa al archivo                         |
| ----------------------------- | ---------------------------------------------- |
| `PUT /archivo`                | Reemplaza el que hubiera; el anterior se borra |
| `POST /contratos` con archivo | Se guarda con el contrato recién creado        |
| Registrar una modificación    | **No se toca**: el convenio es un papel aparte |

No se versiona: reemplazar borra. **No hay forma de quitar el archivo** dejando
el contrato sin él — no se pidió; para corregir una subida equivocada, se
reemplaza.

### `GET /contratos/:id/archivo`

Un enlace fresco, igual que el del aviso: `archivo.url` caduca a los 10 minutos.

```jsonc
// data: { "archivo": { …, "url": "https://…" } }
```

`?descargar=true` fuerza la descarga; lo que trae `previsualizable: false` se
descarga siempre.

| Código | Cuándo                                 | `message`                       |
| ------ | -------------------------------------- | ------------------------------- |
| `404`  | El contrato no tiene archivo           | `Ese contrato no tiene archivo` |
| `404`  | Contrato inexistente o de otra empresa | `El contrato no existe`         |

**Permisos.** Subir y reemplazar exige `rh_admin` o `jefe_area`, lo mismo que
capturar el contrato. **Abrir el papel sólo pide sesión y alcance.**

### El nombre de descarga

Es el del **dato** (D-78), pero aquí el dato no es un número: `nombre` y `fase`
son los dos opcionales. Se usa `nombre`; si no hay, `fase`; si tampoco, el
ordinal — `Contrato 2.pdf`.

### Dónde viene el enlace

Donde ya viene el contrato: `GET /proyectos/:id/contratos`, toda respuesta que
devuelva un `contrato`, y las **obras del expediente** (`GET
/empleados/:id/expediente` → `obras[].contrato.archivo`, junto al SIROC que ya
estaba ahí). Un contrato sin papel dice `archivo: null`; la llave siempre viene.

## 4.4 El monto, las modificaciones y eliminar (D-90)

Tres cosas que llegaron juntas porque se estorbaban. Lo que hay que rehacer en la
pantalla del contrato está aquí.

### El monto

Un número en pesos, **el total con IVA incluido**: no se desglosa subtotal ni
impuesto. **Obligatorio en el alta** (`400` con `El monto del contrato es
requerido` si falta), y en `multipart` viaja como texto —el servidor lo convierte—.

**`null` no es `0`.** Los contratos capturados antes de este cambio se quedaron
**sin monto**, y hay que pintarlos como dato pendiente, no como cero. `0` sí es
una cifra: alguien la tecleó.

### La historia

Todo `Contrato` trae `historia`, derivada al leer. (La excepción de siempre:
`obras[].contrato` del expediente es una proyección corta y no trae ni `monto` ni
`historia`.)

```jsonc
// Lo normal: un contrato que se cumplió como se pactó
"historia": { "modificado": false, "entradas": [] }
```

**`modificado: false` significa que no hay línea del tiempo que dibujar** — el
contrato lo dice, no hay que deducirlo del arreglo vacío. Cuando sí hubo, la
primera entrada es el original y la última es la vigente:

```jsonc
"historia": {
  "modificado": true,
  "entradas": [
    {
      "tipo": "original",
      "indice": null,
      "fechaAcuerdo": null,
      "motivo": null,
      "fechaInicio": "2026-01-01",
      "fechaFin": "2026-03-31",
      "monto": 1500000,
      "archivo": { /* el contrato escaneado */ },
      "vigente": false
    },
    {
      "tipo": "modificacion",
      "indice": 0,
      "fechaAcuerdo": "2026-03-20",
      "motivo": "El cliente aplazó la obra",
      "fechaInicio": "2026-01-01",
      "fechaFin": "2026-12-31",
      "monto": 2100000.5,
      "archivo": { /* el convenio modificatorio */ },
      "vigente": true
    }
  ]
}
```

Los valores de la entrada `vigente` son **los mismos** que `contrato.fechaInicio`,
`fechaFin` y `monto`: no hay dos verdades, hay una y su pasado. Y **los dos
papeles se abren**: cada entrada trae su `archivo` con URL firmada.

Se registra con `POST /contratos/:id/modificaciones`, se deshace la última con
`DELETE /contratos/:id/modificaciones/ultima`, y el convenio de cualquiera se
abre o se reemplaza en `/contratos/:id/modificaciones/:indice/archivo`.

### Editar se fue, eliminar llegó

`PATCH /contratos/:id` responde **410**. Lo que hacía se reparte en tres rutas
—ver arriba— y `DELETE /contratos/:id` es la nueva: **borra el contrato entero**
y no se deshace. En la pantalla tiene que quedar clarísima la diferencia con la
baja, y **pedir confirmación explícita**; quien no puede eliminar (`rh_consulta`)
no debería ver la opción.

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
