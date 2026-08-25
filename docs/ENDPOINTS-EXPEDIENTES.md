# Expedientes: listado, consulta, subida y revisión de documentos

Referencia de los **6 endpoints nuevos** y de **un cambio** en algo que ya
consumen (`RenglonEmpleado`). Nada más cambió.

Base: `/api/v1`. Envelope, códigos y convenciones generales:
[`INTEGRACION-FRONTEND.md`](./INTEGRACION-FRONTEND.md).

| #   | Endpoint                                                       | Quién                      |
| --- | -------------------------------------------------------------- | -------------------------- |
| 0   | `GET /expedientes`                                             | quien ve empleados         |
| 1   | `GET /empleados/:id/expediente`                                | quien ve empleados         |
| 2   | `GET /expedientes/:id`                                         | quien ve empleados         |
| 3   | `POST /expedientes/:id/documentos/:tipo`                       | `rh_admin` · `rh_consulta` |
| 4   | `GET /expedientes/:id/documentos/:tipo/versiones/:version/url` | quien ve el expediente     |
| 5   | `POST /expedientes/:id/documentos/:tipo/revisar`               | `rh_admin` · `rh_consulta` |

> **El expediente es de la persona, no del contrato.** Uno por empleado. Alguien
> adscrito a dos empresas tiene **un** expediente: su INE es la misma. El
> checklist es la **unión** de lo que piden sus empresas — si una pide un
> documento, hace falta; si dos piden vigencias distintas, gana la más corta.
>
> **No hay que crearlo.** Nace con `POST /empleados`. El `GET` lo devuelve
> siempre.

---

## 0. Listado paginado

### `GET /expedientes`

**Mismos filtros que `GET /empleados`, más `estatus`.**

| Query                 | Nota                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `busqueda`            | Por nombre **o por número de empleado** (D-51)                                                                       |
| `empresaId`           | Acota dentro de lo visible; `404` si esa empresa no es tuya                                                          |
| `area`                |                                                                                                                      |
| `tipo`                | `mano_de_obra` / `administrativo`                                                                                    |
| `estatus`             | `incomplete` · `complete` · `expiring` · `expired` (el semáforo)                                                     |
| `activo`              | `true` (default, sólo activos) · `false` (sólo bajas) · `todos` — reemplaza a `incluirInactivos` (D-51)              |
| `orden`               | `nombre_asc` / `nombre_desc`. **Por defecto: lo más urgente primero** (vencido → incompleto → por vencer → completo) |
| `pagina`, `porPagina` | Igual que en `/empleados` (máx. 100)                                                                                 |

```jsonc
// data
{
  "total": 42,
  "pagina": 1,
  "porPagina": 25,
  "expedientes": [
    {
      "expediente": {/* igual que GET /expedientes/:id */},
      "empleado": {/* RenglonEmpleado */},
      "avance": {/* … */}
    }
  ]
}
```

Cada renglón es **exactamente** lo que devuelve `GET /expedientes/:id`: se puede
navegar de la tabla al detalle sin transformar nada.

Errores: `400` con un `estatus` que no existe; `404` si `empresaId` no es
visible; `401` sin sesión.

---

## 1 y 2. Consultar el expediente

`GET /empleados/:id/expediente` — por id de **empleado**, que es lo que tienes en
la tabla.
`GET /expedientes/:id` — por id de **expediente**. Misma respuesta exacta.

```jsonc
// data
{
  "expediente": {
    "_id": "6a8a…ac01",
    "empleadoId": "6a8a…abfa",
    "plantillas": ["6a8a…abe7"], // informativo: de dónde salió el checklist
    "documentos": [/* 12 renglones, ver abajo */],
    "createdAt": "2026-08-22T20:32:45.170Z",
    "updatedAt": "2026-08-22T20:32:45.229Z"
  },
  "empleado": {/* RenglonEmpleado, el mismo de GET /empleados/:id */},
  "avance": {
    "requeridos": 9,
    "entregados": 0,
    "porcentaje": 0,
    "faltantes": 8,
    "enRevision": 1,
    "rechazados": 0,
    "porVencer": 0,
    "vencidos": 0,
    "estatus": "incomplete" // complete | incomplete | expiring | expired
  }
}
```

**`documentos` viene siempre con los 12 renglones**, entregados o no: es el
checklist, no la lista de archivos. En el orden en que hay que pintarlos.

```jsonc
// entregado
{
  "tipo": "ine",
  "requerido": true,
  "estatus": "in_review",
  "vigenciaMeses": null,
  "vigenciaHasta": null,
  "archivo": {
    "nombre": "ine-roberto.pdf",
    "mime": "application/pdf",
    "tamanoBytes": 909,
    "subidoPor": "Alex Administrador",   // nombre, no id: sigue legible si se va
    "subidoEn": "2026-08-22T20:32:45.227Z"
  },
  "motivoRechazo": null,
  "revisadoPor": null,
  "revisadoEn": null,
  "versiones": [
    {
      "version": 1,
      "archivo": { /* igual que arriba */ },
      "estatus": "in_review",
      "vigenciaHasta": null,
      "revisadoPor": null,
      "revisadoEn": null,
      "motivoRechazo": null,
      "reemplazadaEn": null      // fecha en que otra versión la reemplazó
    }
  ]
}

// pendiente
{ "tipo": "curp", "requerido": true, "estatus": "pending", "archivo": null, "versiones": [], … }
```

### `estatus` del documento

| Valor       | Significa                               |
| ----------- | --------------------------------------- |
| `pending`   | No entregado                            |
| `in_review` | Entregado, esperando que RH lo valide   |
| `validated` | Validado y vigente                      |
| `rejected`  | Rechazado; `motivoRechazo` dice por qué |
| `expiring`  | Validado, vence en ≤30 días             |
| `expired`   | Validado pero vencido                   |

`expiring` y `expired` **se calculan al consultar** y no existen en la base: no
los mandes nunca, y no los caches más de un día. El día del vencimiento todavía
cuenta como vigente.

### Los 12 tipos

`sensible` = el **jefe de área** ve que está entregado pero **no puede abrirlo**
(el endpoint 4 le da `403`). `caduca` = puede llevar `vigenciaHasta`.

| `tipo`                  | Etiqueta                                | Sensible | Caduca |
| ----------------------- | --------------------------------------- | -------- | ------ |
| `ine`                   | Identificación oficial (INE)            | sí       | no     |
| `curp`                  | CURP                                    | sí       | no     |
| `rfc`                   | Constancia de situación fiscal (RFC)    | sí       | no     |
| `nss`                   | Número de Seguro Social (NSS)           | sí       | no     |
| `comprobante_domicilio` | Comprobante de domicilio                | sí       | no     |
| `acta_nacimiento`       | Acta de nacimiento                      | sí       | no     |
| `comprobante_estudios`  | Comprobante de estudios (título/cédula) | no       | no     |
| `cv`                    | Currículum vitae (CV)                   | no       | no     |
| `referencias_laborales` | Referencias laborales                   | no       | no     |
| `alta_imss`             | Alta ante el IMSS                       | no       | no     |
| `contrato`              | Contrato de trabajo firmado             | sí       | sí     |
| `examen_medico`         | Examen médico de ingreso                | sí       | sí     |

---

## 3. Subir un documento

### `POST /expedientes/:id/documentos/:tipo`

**`multipart/form-data`**, no JSON.

| Campo           | Tipo           | Obligatorio | Nota                                         |
| --------------- | -------------- | ----------- | -------------------------------------------- |
| `archivo`       | File           | sí          | El nombre del campo es exactamente `archivo` |
| `vigenciaHasta` | `'YYYY-MM-DD'` | no          | Sólo tipos que caducan                       |

```js
const fd = new FormData()
fd.append('archivo', file)
// No pongas Content-Type a mano: el navegador tiene que poner el boundary.
await fetch(`${API}/expedientes/${id}/documentos/ine`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: fd
})
```

Responde **`201`** con la **misma forma** que el `GET` (`expediente`, `empleado`,
`avance`): reemplaza el estado con la respuesta, sin segunda petición.

**Se puede subir cualquiera de los 12 tipos, siempre.** No depende de las
plantillas: si el tipo no estaba en el checklist de esa persona, entra igual y el
renglón aparece con `requerido: false`. Las plantillas sólo deciden qué es
**obligatorio** (y por tanto qué cuenta para el avance), nunca qué se permite
guardar.

**Reglas que importan al pintar la UI:**

- Queda en **`in_review`**, nunca en `validated`. El mensaje de la respuesta ya lo
  dice y se puede mostrar tal cual.
- **Subir otra vez versiona, no sobreescribe.** La nueva entra como `version` más
  alta al **frente** de `versiones`; la anterior queda con `reemplazadaEn` y se
  sigue pudiendo abrir. Un rechazo previo se limpia solo.
- **`vigenciaHasta` la calcula el backend** si no la mandas: `contrato` hereda la
  fecha de término de contrato más próxima; los demás usan los meses de vigencia
  de la plantilla.
- **Máximo 10 MB.** PDF, JPG, PNG y WEBP, y se verifica **el contenido del
  archivo**, no su extensión: un `.pdf` que en realidad es otra cosa da `415`.
- **HEIC se rechaza**, con un mensaje que pide convertirlo. Es lo que manda un
  iPhone por defecto y Chrome no lo muestra, así que un expediente en HEIC no se
  puede revisar. Conviene avisarlo en el input.

### Errores

| Código | Cuándo                                                                 |
| ------ | ---------------------------------------------------------------------- |
| `400`  | Falta `archivo`, `tipo` fuera de los 12, o `vigenciaHasta` mal formada |
| `403`  | `jefe_area` (ve el expediente, no sube)                                |
| `404`  | El expediente no existe **o el empleado no es visible**                |
| `413`  | Pesa más de 10 MB                                                      |
| `415`  | No es PDF/JPG/PNG/WEBP (el mensaje distingue el caso HEIC)             |

---

## 4. Abrir o descargar un archivo

### `GET /expedientes/:id/documentos/:tipo/versiones/:version/url`

El backend **nunca devuelve el archivo ni su ubicación real**: devuelve una URL
firmada que **caduca en 10 minutos**.

Query: `?descargar=true` para forzar la descarga en vez de abrirlo en el
navegador.

```jsonc
// data
{
  "url": "https://…?X-Amz-Signature=…",
  "archivo": {
    "nombre": "ine-roberto.pdf",
    "mime": "application/pdf",
    "tamanoBytes": 909
  }
}
```

- **Pídela en el momento del clic**, no al cargar la lista: si la guardas en el
  estado, se vence.
- **`403` para el `jefe_area` en los documentos sensibles.** Ve el renglón y su
  estatus; no el archivo.
- **Cada llamada queda en la bitácora** (quién, qué documento, de quién, cuándo,
  desde qué IP). Es requisito legal (LFPDPPP), así que no la llames en bucle ni
  en un `prefetch`: sólo cuando la persona de verdad abre el documento.
- `version` es el número, no un índice: `1` es la primera. `404` si no existe.

---

## 5. Validar o rechazar un documento

### `POST /expedientes/:id/documentos/:tipo/revisar`

`rh_admin` y `rh_consulta` (D-44) — el `jefe_area` no. **Un solo endpoint para
las dos acciones**: lo decide `aprobado`, no dos rutas distintas.

```jsonc
// aprobar
{ "aprobado": true }

// rechazar — motivo obligatorio, mínimo 10 caracteres
{ "aprobado": false, "motivo": "La foto del INE está ilegible" }
```

Revisa la **versión vigente** (la última que se subió) del documento indicado.
Responde **`200`** con la **misma forma** que el `GET` (`expediente`, `empleado`,
`avance`).

- Sólo funciona si el documento está en **`in_review`**: recién subido, sin
  revisar todavía. Si está `pending` (nada subido) o ya revisado (`validated` o
  `rejected`), responde `400`.
- **Aprobar** deja el documento y su versión en `validated`, con `revisadoPor`
  (nombre de quien revisó) y `revisadoEn`, y limpia cualquier rechazo anterior.
- **Rechazar** los deja en `rejected`, con `motivoRechazo` (lo que mandaste en
  `motivo`), `revisadoPor` y `revisadoEn`. Para levantarlo, la persona sube una
  entrega nueva (endpoint 3): eso vuelve a dejarlo en `in_review` y ya se puede
  revisar otra vez.
- **A partir de una aprobación el avance sube**: antes de eso, `avance.porcentaje`
  cuenta 0 aunque todo esté subido, porque sólo cuenta lo validado.

### Errores

| Código | Cuándo                                                       |
| ------ | ------------------------------------------------------------ |
| `400`  | El documento no tiene una entrega esperando revisión         |
| `400`  | `aprobado` no viene o no es booleano                         |
| `400`  | `aprobado: false` sin `motivo`, o con menos de 10 caracteres |
| `403`  | El `jefe_area` (sólo `rh_admin` y `rh_consulta` revisan)     |
| `404`  | El expediente no existe **o el empleado no es visible**      |

---

## Cambio en algo que ya consumen

`RenglonEmpleado` tenía dos campos en `null` «hasta que existan los
expedientes». **Ya vienen llenos**, en `GET /empleados`, `GET /empleados/:id` y en
todas las rutas que devuelven el renglón:

```ts
{
  avanceExpediente: number | null // el porcentaje, 0–100 (antes: siempre null)
  expedienteId: string | null // (antes: siempre null)
}
```

Con eso la tabla de empleados pinta la barra de avance sin pedir el expediente de
cada renglón. El porcentaje es el mismo que `avance.porcentaje` del expediente, y
baja solo cuando un documento vence.

`asignaciones` sigue en `[]` en el renglón; las asignaciones se consultan por
proyecto (`GET /proyectos/:id/asignaciones`).

---

## Lo que todavía no existe de expedientes

Responden `404` con `"La ruta … no existe"`, y `GET /api/v1` los lista en
`pendientes`:

- `GET /expedientes` (listado paginado de todos los expedientes)

### Un caso de `400` que sí pueden ver

Los dos tipos que caducan (`contrato`, `examen_medico`) necesitan vigencia. El
backend la deriva **si el tipo está en el checklist** (de los meses de la
plantilla) o, para `contrato`, de la fecha de término del contrato. Si el tipo
**no** estaba en el checklist no hay de dónde sacarla: responde `400`
«Indica hasta cuándo es vigente» y hay que mandar `vigenciaHasta`.

### `avance.porcentaje` sólo cuenta lo validado

Cuenta lo **validado y vigente** (`validated` y `expiring`), no lo subido: un
documento en `in_review` no suma. Ya existe el endpoint 5 para aprobarlo, así que
el flujo completo es subir → `POST …/revisar` con `aprobado: true` → el
porcentaje sube solo.

Mientras un lote no se haya validado, la barra puede verse en 0% con archivos ya
subidos; si quieres reflejar «ya está todo, falta revisar», usa
`entregados + enRevision` sobre `requeridos` para un indicador aparte.
