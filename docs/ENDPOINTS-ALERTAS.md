# Alertas: la bandeja de pendientes

Referencia del **endpoint nuevo**. Base: `/api/v1`. Envelope, códigos y
convenciones generales: [`INTEGRACION-FRONTEND.md`](./INTEGRACION-FRONTEND.md).
El por qué de cada decisión: `DECISIONES.md` D-47.

| #   | Endpoint       | Quién              |
| --- | -------------- | ------------------ |
| 1   | `GET /alertas` | quien ve empleados |

> **No hay nada más.** Las alertas **no se crean, ni se marcan, ni se borran**:
> se derivan de los expedientes y de las fechas de nacimiento en cada consulta.
>
> **Por eso se resuelven solas.** Sube el documento que faltaba y la alerta ya no
> está en la siguiente consulta. Pasa el cumpleaños y sale sola de la ventana. No
> hay que llamar a nada para cerrarlas, y no existe un `PATCH /alertas/:id`.
>
> La consecuencia práctica para el front: **no guardes alertas en el estado
> local** más allá de lo que dure la pantalla. Vuelve a pedir la lista después de
> subir o revisar un documento y ya viene correcta.

> ### ⚠️ CAMBIO: ahora viene agrupado por empleado y paginado
>
> Antes devolvía una lista plana con **todas** las alertas: con 145 personas y una
> docena de documentos requeridos cada una salían ~730 renglones, y los cinco
> primeros eran de la misma persona.
>
> Ahora, **por defecto**, devuelve `grupos[]` —**un renglón por empleado**— y
> **25 por página**. La llave cambia: `data.grupos`, no `data.alertas`. Cada grupo
> trae su `alertas[]` dentro, así que el detalle se despliega sin otra petición.
>
> Para la lista plana (el detalle de UNA persona, por ejemplo) usa
> `?agrupar=ninguno`, que también pagina.

---

## `GET /alertas` → 200

### Filtros, todos opcionales

| Parámetro        | Valores                                                                                |
| ---------------- | -------------------------------------------------------------------------------------- |
| `origen`         | `documento` · `cumpleanos`                                                             |
| `tipo`           | `vencido` · `documento_rechazado` · `por_vencer` · `documento_faltante` · `cumpleanos` |
| `empresaId`      | id de una de sus empresas (404 si no lo es)                                            |
| `empleadoId`     | id de empleado                                                                         |
| `area`           | un área del enum                                                                       |
| `diasCumpleanos` | 0–60. Ensancha la ventana de cumpleaños sólo para esta consulta                        |
| `agrupar`        | `empleado` (por defecto) · `ninguno`                                                   |
| `pagina`         | ≥ 1. Por defecto 1                                                                     |
| `porPagina`      | 1–100. Por defecto 25                                                                  |

Un `tipo` o un `origen` que no existen responden **400**, no una lista vacía: así
un filtro mal escrito no parece «no hay pendientes».

### Lo que devuelve — modo agrupado (por defecto)

```jsonc
// data
{
  "agrupado": true,
  "pagina": 1,
  "porPagina": 25,

  // Lo que se pagina. Agrupado son PERSONAS; en modo plano, alertas.
  // Úsalo para calcular el número de páginas.
  "total": 147,

  // Las dos magnitudes, siempre presentes, para el encabezado:
  // «731 pendientes en 147 personas».
  "totalAlertas": 731,
  "totalEmpleados": 147,

  // El contador de las pestañas. Cuenta TODAS las alertas visibles y
  // NO cambia al paginar ni al filtrar por tipo u origen.
  "resumen": {
    "total": 731,
    "vencido": 0,
    "documento_rechazado": 0,
    "por_vencer": 0,
    "documento_faltante": 729,
    "cumpleanos": 2
  },

  "grupos": [
    {
      "id": "empleado:66f…", // estable: úsalo como key
      "empleadoId": "66f…",
      "empleadoNombre": "ALBERTO ESPINO MEZA",
      "categoriaNombre": "Operador",
      "empresas": [{ "_id": "66f…", "nombre": "Maquinaria CAMES" }],
      "areas": ["obra"],

      // El tipo MÁS GRAVE del grupo: es el que define el color del renglón.
      "tipo": "documento_faltante",
      // Los días del más urgente. Negativo si ya venció.
      "diasRestantes": null,

      "total": 12,
      "resumen": {
        "total": 12,
        "vencido": 0,
        "documento_rechazado": 0,
        "por_vencer": 0,
        "documento_faltante": 12,
        "cumpleanos": 0
      },
      // Frase lista para el renglón, sin abrirlo.
      "mensaje": "12 documentos por subir.",

      // El detalle, ya ordenado. No hace falta otra petición para desplegarlo.
      "alertas": [/* … el mismo objeto Alerta de siempre … */]
    }
  ]
}
```

`mensaje` del grupo: con **una sola** alerta reusa su mensaje específico («Falta
subir CURP.»); con varias, cuenta por tipo («1 documento vencido, 1 rechazado y 2
por subir.») y añade el cumpleaños al final si lo hay.

### Lo que devuelve — modo plano (`?agrupar=ninguno`)

Mismos campos de arriba, salvo que **`grupos` no viene y `alertas` sí**, con las
alertas sueltas de la página. `total` es entonces el número de alertas.

```jsonc
// data
{
  "agrupado": false,
  "pagina": 1,
  "porPagina": 25,
  "total": 731,
  "totalAlertas": 731,
  "totalEmpleados": 147,
  "resumen": {/* igual */},
  "alertas": [
    {
      "id": "documento:66f…:66f…:contrato:vencido",
      "origen": "documento",
      "tipo": "vencido",
      "empleadoId": "66f…",
      "empleadoNombre": "José Luciano González Meza",
      "categoriaNombre": "Operador",
      "empresas": [{ "_id": "66f…", "nombre": "Maquinaria Cames" }],
      "areas": ["obra"],
      "diasRestantes": -4,
      "mensaje": "Contrato de trabajo firmado venció hace 4 días.",

      // Sólo cuando origen === 'documento'
      "expedienteId": "66f…",
      "tipoDocumento": "contrato",
      "vigenciaHasta": "2026-08-16",
      "motivoRechazo": null
    },
    {
      "id": "cumpleanos:66f…:2026:cumpleanos",
      "origen": "cumpleanos",
      "tipo": "cumpleanos",
      "empleadoId": "66f…",
      "empleadoNombre": "Ana Ruiz Bravo",
      "categoriaNombre": "Analista",
      "empresas": [{ "_id": "66f…", "nombre": "Maquinaria Cames" }],
      "areas": ["administracion"],
      "diasRestantes": 0,
      "mensaje": "Hoy es el cumpleaños de Ana Ruiz Bravo (cumple 36).",

      // Sólo cuando origen === 'cumpleanos'
      "fecha": "2026-08-24",
      "fechaNacimiento": "1990-08-24",
      "edad": 36
    }
  ]
}
```

### En TypeScript

```ts
interface RespuestaAlertas {
  agrupado: boolean
  pagina: number
  porPagina: number
  /** Lo que se pagina: grupos si `agrupado`, alertas si no. */
  total: number
  totalAlertas: number
  totalEmpleados: number
  resumen: Record<TipoAlerta | 'total', number>
  /** Sólo cuando `agrupado === true`. */
  grupos?: GrupoDeAlertas[]
  /** Sólo cuando `agrupado === false`. */
  alertas?: Alerta[]
}

interface GrupoDeAlertas {
  id: string // `empleado:${empleadoId}`, estable
  empleadoId: string
  empleadoNombre: string
  categoriaNombre: string | null
  empresas: { _id: string; nombre: string | null }[]
  areas: Area[]
  /** El tipo más grave del grupo. */
  tipo: TipoAlerta
  /** Los días del más urgente. Negativo si ya pasó. */
  diasRestantes: number | null
  total: number
  resumen: Record<TipoAlerta | 'total', number>
  mensaje: string
  alertas: Alerta[]
}
```

Y la alerta suelta, que no cambió — unión discriminada por `origen`:

```ts
interface AlertaBase {
  id: string
  origen: 'documento' | 'cumpleanos'
  tipo: TipoAlerta
  empleadoId: string
  empleadoNombre: string
  categoriaNombre: string | null
  empresas: { _id: string; nombre: string | null }[]
  areas: Area[]
  /** Negativo si ya pasó. `null` en documentos que no caducan. */
  diasRestantes: number | null
  /** Texto en español, listo para pintar tal cual. */
  mensaje: string
}

interface AlertaDocumento extends AlertaBase {
  origen: 'documento'
  tipo: 'vencido' | 'documento_rechazado' | 'por_vencer' | 'documento_faltante'
  expedienteId: string
  tipoDocumento: TipoDocumento
  vigenciaHasta: string | null
  motivoRechazo: string | null
}

interface AlertaCumpleanos extends AlertaBase {
  origen: 'cumpleanos'
  tipo: 'cumpleanos'
  /** El día en que se celebra este año, `'YYYY-MM-DD'`. */
  fecha: string
  fechaNacimiento: string
  /** Los años que cumple. */
  edad: number | null
}

type Alerta = AlertaDocumento | AlertaCumpleanos
```

---

## Lo que hay que saber para armar la pantalla

### Un renglón por persona

Pinta el renglón con los campos del **grupo** (`empleadoNombre`,
`categoriaNombre`, `tipo`, `mensaje`, `total`) y despliega `grupo.alertas` al
abrirlo. No hace falta otra petición: el detalle ya viene.

`grupo.tipo` es el **más grave** del grupo, así que sirve para el color o el icono
del renglón. `grupo.resumen` da los conteos por tipo si quieres pintar chips
dentro de la fila.

### La paginación

`total` es lo que hay que paginar: **personas** en modo agrupado, **alertas** en
modo plano. Las páginas son de 25 por defecto y hasta 100. Una página más allá del
final devuelve la lista vacía con `200`, no un error.

`resumen`, `totalAlertas` y `totalEmpleados` **no cambian al paginar**: sirven para
el encabezado y las pestañas.

### `id` es estable: úsalo como `key`

No cambia entre dos consultas mientras la causa siga igual, así que la lista no
parpadea. El del cumpleaños **no cambia durante toda la ventana** de este año, y
sí es distinto el año que viene.

### El orden ya viene resuelto: lo más grave primero

`vencido` → `documento_rechazado` → `por_vencer` → `documento_faltante` →
`cumpleanos`. Dentro del mismo tipo, lo que ocurre antes; y a igualdad de días,
por nombre con orden español (ignorando acentos). **No reordenes en el cliente**
salvo que el usuario lo pida.

`cumpleanos` va al final a propósito: es lo único de la lista que no es un
problema que resolver, y no debe empujar hacia abajo un documento vencido.

### `mensaje` está listo para pintar

Ya viene en español, con el singular correcto («hace 1 día», no «hace 1 días») y
con el nombre del documento traducido. No lo armes en el cliente.

### `empresas[]` va en plural

El expediente es de la **persona** y se comparte entre las empresas del grupo, así
que quien está adscrito a dos no tiene una sola empresa dueña de la alerta. Para
acotar por empresa usa `?empresaId=`, que filtra a la gente antes de derivar.

### Los cumpleaños

- Ventana por defecto: **7 días** (incluye el mismo día, `diasRestantes: 0`).
- `?diasCumpleanos=30` la ensancha sólo para esa consulta. `0` = sólo hoy.
- Quien no tiene `fechaNacimiento` capturada no genera alerta.
- El 29 de febrero se celebra el 28 en los años no bisiestos.

### Quién no aparece nunca

Alguien dado de baja **del sistema**, y alguien sin adscripción activa (dado de
baja de todas sus empresas). No generan alertas de ningún tipo.

### Errores

| Código | Cuándo                                                                                  |
| ------ | --------------------------------------------------------------------------------------- |
| `400`  | `tipo`, `origen`, `area`, `diasCumpleanos`, `agrupar`, `pagina` o `porPagina` inválidos |
| `401`  | sin sesión                                                                              |
| `404`  | `empresaId` fuera de su alcance                                                         |

### Alcance

`rh_admin` y `rh_consulta` ven las alertas de sus empresas; `jefe_area`, sólo las
de **su área**. No hace falta filtrar en el cliente: lo que llega ya está acotado.

---

## Lo que este endpoint todavía NO trae

- **Alertas de proyecto** (`proyecto_por_finalizar`, `proyecto_vencido`). El sobre
  ya está preparado para sumarlas con su propio `origen`; cuando existan, la
  pantalla no cambia de forma.
- **Marcar, posponer o descartar una alerta.** Requeriría guardarlas, que es justo
  lo que se evitó para que se resuelvan solas. Si hace falta un «no me lo
  recuerdes hasta el lunes», dilo y se diseña como aplazamiento por usuario.
- **El correo diario de vigencias.** Esto es la bandeja de la interfaz; el resumen
  por correo es otro pendiente.
