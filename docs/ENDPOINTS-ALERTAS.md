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

Un `tipo` o un `origen` que no existen responden **400**, no una lista vacía: así
un filtro mal escrito no parece «no hay pendientes».

### Lo que devuelve

```jsonc
// data
{
  "total": 37, // alertas después de aplicar los filtros
  "truncado": false, // true si se recortó la lista (tope de 1000)

  // El contador de la campanita. Cuenta TODAS las alertas visibles,
  // NO las que quedaron tras el filtro: así el badge no cambia al
  // cambiar de pestaña.
  "resumen": {
    "total": 37,
    "vencido": 2,
    "documento_rechazado": 1,
    "por_vencer": 4,
    "documento_faltante": 29,
    "cumpleanos": 1
  },

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

En TypeScript, es una unión discriminada por `origen`:

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

| Código | Cuándo                                                |
| ------ | ----------------------------------------------------- |
| `400`  | `tipo`, `origen`, `area` o `diasCumpleanos` inválidos |
| `401`  | sin sesión                                            |
| `404`  | `empresaId` fuera de su alcance                       |

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
