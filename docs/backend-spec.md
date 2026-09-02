# Contrato de API — Plataforma de Expedientes (Urbacames)

> **Qué es este documento.** Define **cómo se habla** con el backend: formato de
> respuesta, códigos, errores, enumeraciones y el catálogo completo de rutas.
>
> **El modelo de datos vive en [`modelo-datos.md`](./modelo-datos.md)**:
> colecciones, vínculos, índices, agregaciones, alcance por empresa y toda la
> lógica derivada. Los dos documentos se complementan y **no se contradicen**;
> si algo pareciera contradecirse, manda `modelo-datos.md`.
>
> Con esos dos archivos hay suficiente para implementar sin volver a preguntar.
>
> Stack objetivo: **Node.js + Express + MongoDB (Mongoose)**.
>
> **Este archivo es del backend** (29 ago 2026) y se mantiene aquí, en
> `cames-files-manager-backend/docs/`. **Es la única versión**: la copia que el
> front tenía se reconcilió contra ésta y contra el código el 31 ago 2026 —cada
> diferencia y qué se decidió, en
> [`RECONCILIACION-DOCS.md`](./RECONCILIACION-DOCS.md)—. Cuando cambie una ruta,
> un código o la forma de una respuesta, se actualiza en el mismo cambio que el
> código —igual que
> [`CONTRATO-API.md`](./CONTRATO-API.md), que lleva el detalle petición por
> petición— y se anota en [`HANDOFF-BACKEND.md`](./HANDOFF-BACKEND.md).
>
> ⚠️ **Describe el destino completo, no lo que responde el servidor hoy.** El
> inventario que no puede desincronizarse se deriva del router en tiempo real:
>
> ```bash
> curl -s http://localhost:8080/api/v1 | jq '.data.implementados, .data.pendientes'
> ```
>
> Y del lado del front, cómo les pega de verdad con sus trampas:
> `~/Documents/projects/cames-files-manager/docs/backend-actual.md`.

---

## 1. Contexto y estado

Urbacames gestiona los expedientes laborales de su personal: un checklist de
documentos por persona, con carga de archivos, validación, control de vigencias,
alertas y reportes de auditoría. La plataforma aloja **varias empresas** del
grupo, que comparten catálogos de empleados, clientes y categorías.

El front nació contra una capa de datos simulada, que conserva, y ya pega contra
este servidor en casi todo. **Toda la lógica de dominio —avance, semáforo,
vigencias, alertas, checklist— está implementada y probada de los dos lados**,
pero **la autoridad es el backend**: el front sólo apaga botones, y donde las
dos versiones difieran manda ésta.

### Qué existe hoy

| Pieza | Estado |
| --- | --- |
| `/auth` — login, sesión, cambio de contraseña | **Implementado y conectado** |
| `/empleados` — catálogo, alta, edición, baja y accesos | **Implementado y conectado** |
| `/usuarios` — el CRUD anterior | **Retirado**: responde `410` |
| `/empresas` y `/categorias` | **Implementado y conectado** |
| `/clientes` y las carteras (`/empresas/:id/clientes`) | **Implementado y conectado** |
| `/proyectos` y sus asignaciones | **Implementado y conectado** |
| Adscripciones: alta y listado por empresa (`/empresas/:id/adscripciones`), edición, baja y jefaturas (`/adscripciones/:id`, `/estado`, `/jefaturas`) | **Implementado y conectado** |
| `GET /adscripciones` — listado global, de todas las empresas de un tirón | **No existe**, y no está pedido: se listan por empresa |
| `/areas` — el catálogo, con las temporales de la nómina | **Implementado y conectado** |
| `/proyectos/:id/contratos` y `/contratos/:id[/siroc]` | **Implementado y conectado** |
| Actualización del SIROC cada 2 meses (`/contratos/:id/siroc/actualizaciones`) | **Implementado**, pendiente de que el front lo consuma |
| Importación de colaboradores desde el `.xlsx` de nómina | **Implementado y conectado** |
| Expedientes, documentos y su revisión | **Implementado y conectado** |
| Listado paginado de expedientes (`GET /expedientes`) | **Implementado y conectado** |
| `/alertas` — documentación y cumpleaños, derivadas al leer | **Implementado** |
| Archivos en R2 | **Implementado** |
| `GET /empleados/:id/asignaciones` y `GET /empleados/:id/adscripciones` | Por construir. La segunda **no se hará aparte**: `GET /empleados/:id` ya trae sus adscripciones embebidas |
| Plantillas de checklist (administrarlas; la asignación ya está sembrada) | Por construir |
| Métricas del panel (`/dashboard/metricas`) y reportes | Por construir |
| Árbol de `/organizacion` | Por construir |
| Recuperación de contraseña (`/auth/recuperar`) | Por construir |
| Job diario de vigencias y correos | Por construir |

### Lo que hay que leer primero

1. **[`modelo-datos.md`](./modelo-datos.md) §1 y §2** — la jerarquía y las tres
   decisiones que la definen. Sin eso, el resto no se entiende.
2. **§2 de este documento** — las reglas del contrato.
3. **§12 de este documento** — el orden de implementación sugerido.

---

## 2. Reglas del contrato

Diez reglas. Romper cualquiera implica tocar el front.

1. **Prefijo de rutas:** `/api/v1`.

2. **Envelope de respuesta.** Toda respuesta, exitosa o no, usa esta forma:

   ```json
   { "status": "success" | "fail" | "error", "message": "…", "data": { } }
   ```

   El front desenvuelve `data` automáticamente. Los datos van **anidados bajo
   una llave con nombre**, nunca sueltos: `data: { expedientes: [...] }`, no
   `data: [...]`.

3. **Errores de validación.** Formato de `express-validator`, que el front ya
   sabe leer:

   ```json
   { "status": "fail", "message": "…", "errors": [{ "msg": "El nombre es requerido" }] }
   ```

   El front muestra `errors[0].msg` si existe, y si no `message`. **Los mensajes
   se escriben en español y se le muestran tal cual a la persona usuaria**: que
   digan qué hacer, no qué falló internamente.

4. **Códigos HTTP.** `200` lectura y actualización · `201` creación · `204` baja
   sin cuerpo · `400` validación o estado inválido · `401` sin sesión ·
   `403` sin permiso · `404` no existe *o no es visible para quien pregunta* ·
   `409` conflicto · `413` archivo muy grande · `415` tipo no permitido ·
   `429` rate limit.

   **El front cierra la sesión sólo con un `401` real.** Un `500`, un timeout o
   un error de red significan «el servidor no contestó», no «tu sesión no
   vale» — tratarlos igual saca a todo el mundo en cuanto el backend tiene un
   tropiezo momentáneo. Esto ya pasó una vez: `GET /auth/me` al arrancar la app
   cerraba la sesión guardada ante cualquier fallo, no sólo un `401`
   (`src/modules/auth/auth-provider.tsx` del front). El resto de su app pasa por
   el interceptor de `src/lib/api-client.ts`, que ya filtraba bien. Del lado de
   acá esto obliga a **no responder `401` por errores que no son de sesión**: un
   fallo de la base es `503`, no `401`.

5. **Identificadores.** Se exponen como `_id` en string. Nunca `id`.

6. **Fechas.** Dos formatos, y no se mezclan:
   - **Fechas de calendario** (ingreso, término de contrato, vigencia, baja):
     `YYYY-MM-DD`, sin hora ni zona. Son fechas civiles: el 19 de agosto es el
     19 de agosto en cualquier huso.
   - **Marcas de tiempo** (`createdAt`, `subidoEn`, `revisadoEn`): ISO 8601 UTC
     completo.

7. **Campos opcionales.** Se omiten o van como `null`; **nunca como cadena
   vacía**. El front trata `""` como valor presente.

8. **Nombres de campos.** El dominio va en **español** (`empleado`,
   `expediente`, `adscripcion`, `vigenciaHasta`). La autenticación conserva los
   nombres en inglés que ya usa el front (`name`, `email`, `role`, `active`).
   Los valores de los enums son los literales de la sección 4, exactos.

9. **Los estatus derivados no se guardan.** `expiring`, `expired` y todo el
   objeto `avance` se **calculan en cada consulta** a partir de las fechas. Si
   se persisten, quedan desincronizados al día siguiente. Lo mismo con las
   alertas: se derivan, no se almacenan.

10. **El servidor recalcula siempre.** El front manda intenciones ("sube esto",
    "valida aquello"), nunca estados calculados. Cualquier `avance`, `estatus`
    o `porcentaje` que llegue en el cuerpo de una petición se ignora.

---

---

## 3. Convenciones de implementación

Se siguió la estructura de `talentlink-backend` para que ambos proyectos se
mantengan igual. Lo que hay hoy —los nombres reales, no los propuestos—:

```
src/
  api/v1/
    <recurso>/
      <recurso>Model.js        Esquema de Mongoose
      <recurso>Service.js      Reglas de negocio, sin HTTP
      <recurso>Controller.js   HTTP: parsea, llama al service, responde
      <recurso>Routes.js       Rutas + validaciones + middlewares
    routes/index.js            Monta todos los recursos y expone el inventario
  models/index.js              Registra TODOS los modelos (D-31)
  middlewares/
    authMiddleware.js          protect, requireCapability
    scopeMiddleware.js         ← Filtro por empresa (modelo-datos.md §8)
    passwordMiddleware.js      requirePasswordDefinitiva (D-49)
    validateRequest.js · errorHandler.js · uploadMiddleware.js
  constants/                   Los enums del contrato, en un solo lugar
  services/                    Almacenamiento, semillas, arranque
  utils/
    domain/                    ← Lógica de expedientes (modelo-datos.md §6)
    permissions.js             La matriz de capacidades
```

**Cuatro capas por recurso, sin excepciones**, y **los controladores no llevan
lógica de negocio**: las reglas de dominio ([`modelo-datos.md`
§6](./modelo-datos.md)) viven en `utils/domain/` como funciones puras y se
prueban solas, sin HTTP de por medio (`tests/unitarias/domain/`).

> **Ojo con el idioma.** La carpeta es `domain`, no `dominio`, y el middleware
> es `scopeMiddleware.js`, no `alcanceMiddleware.js`: rutas y llaves JSON en
> español porque son contrato; archivos, funciones y variables en inglés. La
> tabla completa está en `CLAUDE.md` § Idiomas.

El front tiene esas mismas funciones probadas en `src/utils/expediente.ts` y
`src/utils/checklist.ts` de su repo: **son la referencia de comportamiento**,
con una diferencia conocida en `faltantes` (ver `modelo-datos.md` §6.3).

---

## 4. Enumeraciones

Valores literales exactos. Aquí viven en `src/constants/`; el front los tiene en
`src/enums/` de su repo y los compara por **igualdad estricta**.

### `DocumentType` — los 12 documentos del checklist

| Valor | Etiqueta | Caduca | Sensible |
| --- | --- | :---: | :---: |
| `ine` | Identificación oficial (INE) | | ✓ |
| `curp` | CURP | | ✓ |
| `rfc` | Constancia de situación fiscal (RFC) | | ✓ |
| `nss` | Número de Seguro Social (NSS) | | ✓ |
| `comprobante_domicilio` | Comprobante de domicilio | | ✓ |
| `acta_nacimiento` | Acta de nacimiento | | ✓ |
| `comprobante_estudios` | Comprobante de estudios (título/cédula) | | |
| `cv` | Currículum vitae (CV) | | |
| `referencias_laborales` | Referencias laborales | | |
| `alta_imss` | Alta ante el IMSS | | |
| `contrato` | Contrato de trabajo firmado | ✓ | ✓ |
| `examen_medico` | Examen médico de ingreso | ✓ | ✓ |

**Sensible** = el jefe de área ve que está entregado, pero no puede abrirlo ni
descargarlo. **Caduca** = puede llevar `vigenciaHasta` y disparar alertas.

El orden de la tabla es el orden en que el front los pinta. Categorías para
agrupar en pantalla (`DocumentCategory`): `identidad` (ine, curp,
acta_nacimiento) · `fiscal_seguridad_social` (rfc, nss, alta_imss) ·
`personales` (comprobante_domicilio) · `formacion` (comprobante_estudios, cv,
referencias_laborales) · `contratacion` (contrato, examen_medico).

### `DocumentStatus`

| Valor | Significado | ¿Se guarda? |
| --- | --- | --- |
| `pending` | Nunca se ha subido | Sí |
| `in_review` | Subido, esperando que RH lo revise | Sí |
| `validated` | Revisado y aceptado | Sí |
| `rejected` | Revisado y rechazado, hay que volver a subirlo | Sí |
| `expiring` | Validado, pero vence dentro del umbral | **No — derivado** |
| `expired` | Validado, pero ya venció | **No — derivado** |

En la base sólo viven los cuatro primeros. Los dos últimos se calculan al leer.

### `RecordStatus` — semáforo del expediente (siempre derivado)

`incomplete` · `complete` · `expiring` · `expired`

### `Area` — catálogo, no un enum (26 ago 2026)

Dejó de ser un conjunto cerrado: el archivo de nómina puede dar de alta áreas
nuevas. El valor que viaja en `areas[]` (adscripciones, `empresas[].areas`,
`?area=`) es la `clave` de un renglón de `GET /areas`:

```jsonc
{ "_id": "…", "clave": "operaciones_urbanizadora", "nombre": "Operaciones (Urbanizadora)",
  "esBase": true, "temporal": false, "activa": true }
```

Las nueve del arranque (`esBase: true`): `direccion` · `recursos_humanos` ·
`finanzas` · `operaciones_maquinaria` · `operaciones_urbanizadora` ·
`costos_y_presupuestos` · `comercial` · `tesoreria` · `contabilidad`. Durante
la transición conviven con las viejas del enum que todavía tienen gente
(`obra`, `administracion`, `proyectos`, `ventas`, `mantenimiento`,
`esBase: false`); `compras` no sobrevivió, nadie la tenía asignada.

| Método | Ruta | Quién |
| --- | --- | --- |
| `GET` | `/areas` (`?activa=true\|false\|todos&temporal=true`) | Sesión |
| `POST` | `/areas` (`{ nombre }`) | Admin de plataforma |
| `PATCH` | `/areas/:id` (`{ nombre }`) | Admin de plataforma |
| `PATCH` | `/areas/:id/estado` (`{ activa }`) | Ver abajo |

`activa` es de tres modos, igual que `activo` en empleados (`true` por
defecto). La baja: admin de plataforma, cualquiera; `rh_admin`/`rh_consulta`,
sólo `temporal: true`; `jefe_area`, ninguna. `400` si es base o si alguien la
tiene asignada. Detalle completo en
[`ENDPOINTS-AREAS.md`](./ENDPOINTS-AREAS.md) y D-58.

### `TipoContrato`

| Valor | Etiqueta | Temporal |
| --- | --- | :---: |
| `indeterminado` | Tiempo indeterminado | |
| `determinado` | Tiempo determinado | ✓ |
| `obra_determinada` | Obra determinada | ✓ |
| `prueba` | Periodo a prueba | ✓ |
| `capacitacion_inicial` | Capacitación inicial | ✓ |

**Temporal** = exige `fechaTerminoContrato` y su contrato se vigila por vigencia.

### `AlertType`

`vencido` (severidad 0) · `documento_rechazado` (1) · `por_vencer` (2) ·
`documento_faltante` (3). La severidad ordena la bandeja.

### `NivelAcceso`

`rh_admin` · `rh_consulta` · `jefe_area`. Ver la matriz en
[`modelo-datos.md` §8](./modelo-datos.md).

---

---

## 5. Modelo, lógica y permisos

Estas tres piezas viven completas en
**[`modelo-datos.md`](./modelo-datos.md)** para no tenerlas duplicadas y
desincronizadas. Índice rápido:

| Necesitas | Sección |
| --- | --- |
| La jerarquía y por qué los catálogos son compartidos | §1, §2 |
| El mapa de las 14 colecciones que existen hoy | §3 |
| Esquemas de Mongoose, ocho de ellas | §5 |
| Las tres colecciones de vínculo: adscripciones, carteras, asignaciones | §5b |
| Estatus efectivo, avance, semáforo, checklist por unión, alertas | §6 |
| Índices | §7 |
| Filtro de alcance por empresa y matriz de permisos | §8 |
| Agregaciones de las consultas pesadas | §9 |
| Transacciones e integridad referencial | §10 |

**Lo mínimo que hay que retener antes de leer las rutas:**

- **Empleados, clientes y categorías son catálogos compartidos.** No llevan
  `empresaId`. La pertenencia se expresa con vínculos.
- **`adscripciones`** lleva la relación laboral: contrato, fecha de ingreso,
  áreas y baja, **por empresa**. Un empleado puede tener varias.
- **`carteras`** dice qué clientes usa cada empresa. Un proyecto sólo puede
  apuntar a un cliente en la cartera activa de su empresa.
- **`asignaciones`** vincula empleados a proyectos, con su categoría en esa obra
  y su fecha de salida.
- **Cada empleado tiene un expediente, uno solo**, compartido entre las empresas
  a las que esté adscrito.
- **El alcance se deriva de las adscripciones del usuario**, no de un campo.

---

## 6. Catálogo de rutas

Base `/api/v1`. Todas exigen sesión salvo `POST /auth/login`, `GET /health` y
`GET /ready`. Todas pasan por el middleware de alcance
([`modelo-datos.md` §8](./modelo-datos.md)).

En los ejemplos se muestra **sólo el contenido de `data`**.

### 6.1 Sesión — *implementado*

| Método | Ruta | `data` |
| --- | --- | --- |
| `POST` | `/auth/login` | `{ user, token }` |
| `GET` | `/auth/me` | `{ user }` |
| `POST` | `/auth/logout` | `null` |
| `POST` | `/auth/cambiar-password` | `{ user }` |

**`AuthUser` cambia de forma** al reubicar el usuario dentro del empleado:

```ts
{
  _id: string;              // id del empleado
  name: string;
  email: string;            // acceso.email
  nivelAcceso: 'rh_admin' | 'rh_consulta' | 'jefe_area';
  alcanceGlobal: boolean;   // administrador de plataforma
  /** Empresas donde tiene adscripción activa, con sus áreas en cada una. */
  empresas: { _id: string; nombre: string; areas: Area[] }[];
  active: boolean;
  /** La contraseña la puso otra persona y su dueño no la ha cambiado. */
  passwordTemporal: boolean;
  ultimoAccesoEn: string | null;
  createdAt: string;
  updatedAt: string;
}
```

Desaparecen `role`, `alcance`, `clienteId` y `area` (que era una sola).

**Contraseña temporal.** Cuando la contraseña la puso un `rh_admin` —al conceder
el acceso o al reponerla— o es la del administrador de arranque, la sesión abre
igual pero **todas las rutas salvo `GET /auth/me`, `POST /auth/logout` y
`POST /auth/cambiar-password` responden `403`**:

```json
{ "status": "fail", "message": "Tu contraseña es temporal: cámbiala para poder usar la plataforma.", "code": "PASSWORD_TEMPORAL", "data": null }
```

Se distingue por `code`, no por el mensaje. **Es `403`, no `401`**: el token
sirve, así que el front manda a `/cambiar-password` en vez de cerrar la sesión.
`POST /auth/cambiar-password` devuelve un token nuevo en `data.token` e
invalida el anterior.

> **Cambio incompatible con el front actual.** El front lee hoy `role`, `area` y
> `alcance`. Avisen cuando lo desplieguen y se ajusta en la misma ventana; son
> pocas líneas, pero hay que coordinarlo.

`POST /auth/recuperar` y `POST /auth/restablecer` siguen pendientes (responden
`404`): hoy sólo un `rh_admin` puede reponer una contraseña, y quien la recibe
la cambia en su siguiente acceso.

### 6.2 Catálogos compartidos

Sólo `alcanceGlobal` da de alta en ellos. Cualquiera con sesión puede leerlos,
filtrados por su alcance donde aplique.

#### Empleados

| Método | Ruta | Nota |
| --- | --- | --- |
| `GET` | `/empleados` | Paginado. Ver parámetros abajo |
| `POST` | `/empleados` | Crea la persona **y su expediente**, en transacción. **Ya no lleva `tipo`**: sale de la `categoriaId` (26 ago 2026) |
| `GET` `PATCH` | `/empleados/:id` | El `PATCH` acepta mandar el `tipo` que la persona **ya tiene** (se ignora); mandar uno **distinto** responde `400` (26 ago 2026). Para cambiarlo se manda la `categoriaId` nueva — cambiar de puesto es lo que cambia el tipo. `tipo` sí sigue **viniendo** en la respuesta |
| `PATCH` | `/empleados/:id/estado` | `{ activo, motivo }` — baja **del sistema** |
| `GET` | `/empleados/:id/expediente` | Siempre existe |
| `GET` | `/empleados/:id/adscripciones` | **Por construir**, y no se hará aparte: `GET /empleados/:id` ya las trae embebidas |
| `GET` | `/empleados/:id/asignaciones` | **Por construir.** Sus proyectos, activos e históricos |

> **`POST /empleados` — `numeroEmpleado` es obligatorio y va en la raíz**
> (26 ago 2026): string, máximo 30 caracteres, el ID de nómina **de la persona**
> y único en todo el grupo. Se exige haya o no `adscripcion`, así que un alta
> sólo al catálogo también lo lleva. Sin él, `400` con
> `errors[0].path = 'numeroEmpleado'`; repetido, `409` con
> `code: 'NUMERO_EMPLEADO_DUPLICADO'` y el mismo `path`.
>
> **`PATCH /empleados/:id` lo acepta** desde la misma fecha, pero **no admite
> `null` ni `''`**: para corregirlo se manda el nuevo. `PATCH
> /adscripciones/:id` responde `400` si lo recibe: el documento de la
> adscripción ya no tiene ese campo. Editables: `nombre`, `numeroEmpleado`,
> `curp`, `rfc`, `nss`, `fechaNacimiento`, `email`, `telefono`, `categoriaId`
> — `tipo` no está en esta lista: ver la fila de arriba.

Parámetros de `GET /empleados`:

| Parámetro | Nota |
| --- | --- |
| `busqueda` | **Por nombre o número de empleado** (D-51). Ignora acentos y mayúsculas, coincidencia parcial |
| `empresaId` | Filtra dentro del alcance; nunca lo amplía |
| `area` | Áreas de la adscripción, no del empleado |
| `proyectoId` | Con asignación activa a ese proyecto |
| ~~`tipo`~~ | **Desapareció el 26 ago 2026 (D-59)**: lo reemplazan las áreas y el tipo sale del puesto. Si se manda se ignora —no da `400`, para no dejar la tabla vacía sin explicación— |
| `categoriaId` | Nuevo (D-51) |
| `soloConAcceso` | Los que entran a la plataforma |
| `activo` | `true` (defecto) sólo activos · `false` sólo bajas · `todos` los dos. Reemplaza a `incluirInactivos` (D-51) |
| `orden` | `nombre_asc` (defecto) \| `nombre_desc` \| `numero_asc` \| `numero_desc` — los dos últimos, nuevos (D-51), funcionan con o sin `empresaId` (D-53); hay un solo número por persona y quien no lo tiene queda al final en los dos sentidos |
| `pagina` `porPagina` | Empieza en 1; 25 por defecto |

> **`numeroEmpleado` se lee en `empleado.numeroEmpleado`** del renglón (26 ago
> 2026, D-54); ya no está en sus `adscripciones[]`, ni en la raíz de los renglones de
> `GET /empresas/:id/adscripciones`, donde llega dentro de `empleado`. El orden
> por número compara el valor **como texto**: coincide con el numérico porque el
> .xlsx de nómina lo rellena con ceros a la izquierda, pero un número capturado
> a mano sin rellenar (`9`) se iría después de `245`.

```jsonc
// data
{
  "total": 47, "pagina": 1, "porPagina": 25,
  "empleados": [
    {
      "empleado": { /* Empleado, sin empresaId ni contrato */ },
      "categoriaNombre": "Residente de Obra",
      "adscripciones": [
        { "empresaId": "…", "empresaNombre": "Urbacames Edificación",
          "areas": ["obra"], "tipoContrato": "indeterminado",
          "fechaIngreso": "2025-06-01", "activo": true }
      ],
      "asignaciones": [
        { "proyectoId": "…", "proyectoNombre": "Torre Andares — Etapa 2",
          "categoriaNombre": "Residente de Obra", "activo": true }
      ],
      "avanceExpediente": 83,
      "expedienteId": "…"
    }
  ]
}
```

El orden se calcula **sobre el total y después se corta**; una página más allá
del final devuelve lista vacía y el `total` real, no un `404`.

> Cada renglón de `adscripciones[]` trae más de lo que muestra el ejemplo de
> arriba: `dirigeAreas[]`, `departamento`, `datosPendientes[]`, `motivoBaja`,
> `fechaBaja` y `condiciones` (28 ago 2026) — los mismos campos que
> `GET /empresas/:id/adscripciones`, ver la sección de adscripciones más abajo
> y [`ENDPOINTS-ADSCRIPCIONES.md`](./ENDPOINTS-ADSCRIPCIONES.md).

#### Clientes y categorías

| Método | Ruta | Nota |
| --- | --- | --- |
| `GET` `POST` | `/clientes` | Catálogo global. `?busqueda=` |
| `GET` `PATCH` | `/clientes/:id` | |
| `PATCH` | `/clientes/:id/estado` | Falla si tiene proyectos en curso |
| `GET` `POST` | `/categorias` | `POST` **idempotente por nombre**: si ya existe, devuelve la existente en vez de fallar. Lleva `tipo`, y `GET` acepta `?tipo=` |
| `PATCH` | `/categorias/:id/estado` | Falla si hay empleados o proyectos usándola |

> ⚠️ **`categorias.tipo` está de salida (D-73).** Hoy es obligatorio al crear un
> puesto —es el selector «Aplica a» del front— y filtra el desplegable del alta.
> **Lo va a sustituir el área**, que dice lo mismo con más grano desde D-58. No
> se ha quitado porque de él cuelga quién puede gestionar a quién (§8.2 del
> modelo) y esa matriz hay que redefinirla antes. Mientras tanto sigue vigente
> tal cual: no lo quiten del front todavía, avisamos aquí y en
> `HANDOFF-BACKEND.md` cuando cambie.

### 6.3 Empresas y vínculos

| Método | Ruta | Nota |
| --- | --- | --- |
| `GET` `POST` | `/empresas` | Las del alcance del usuario. `POST` sólo admin de plataforma: `{ nombre, rfc? }` |
| `GET` `PATCH` | `/empresas/:id` | El `PATCH` es sólo admin de plataforma: ver abajo |
| `PATCH` | `/empresas/:id/estado` | `{ activo }` — sólo admin de plataforma, ver abajo |
| `GET` | `/organizacion` | **Por construir.** Árbol empresa → áreas (sólo administrativos) y proyectos |

#### Editar y dar de baja una empresa (28 ago 2026)

Hasta el 28 ago 2026 una empresa sólo se podía crear y consultar.

Campo nuevo en toda respuesta que devuelve una empresa. ⚠️ **Cambió de forma el
29 ago 2026** — ver «Registros con identidad propia», más abajo:

```jsonc
{ "registrosPatronales": [
    { "_id": "…", "numero": "R13-77767-10-5", "descripcion": "Zapopan", "activo": true }
] }  // [] si no tiene
```

Puede tener más de uno —por entidad o por clase de riesgo—.

**`PATCH /empresas/:id`** — sólo lo que cambia:

```jsonc
// petición
{ "nombre": "Maquinaria Cames", "rfc": "MCA180611HF1",
  "registrosPatronales": ["R13-77767-10-5", "Y54-12345-10-9"] }
// data
{ "empresa": { … }, "conteos": { … } }
```

Campos aceptados: `nombre`, `rfc`, `branding`, `configuracion`.
**`registrosPatronales` dejó de aceptarse aquí el 29 ago 2026**: responde `400`
indicando su ruta.

| Código | Cuándo |
| --- | --- |
| `400` | Cuerpo vacío; RFC mal formado; o mandar `activo` (el mensaje dice que use `/estado`) o `registrosPatronales` (dice que use su ruta) |
| `403` | No es administrador de plataforma |
| `404` | La empresa no existe |
| `409` | El nombre o el RFC ya son de otra empresa |

**`PATCH /empresas/:id/estado`** — `{ "activo": false }` para dar de baja,
`{ "activo": true }` para reactivar. Dar de baja se bloquea si todavía tiene
gente o proyectos:

```jsonc
// 400
{ "status": "fail",
  "message": "No se puede dar de baja: la empresa todavía tiene 12 personas adscritas y 2 proyectos abiertos. Ciérralos primero." }
```

El mensaje se muestra tal cual. Primero se cierra lo que cuelga —dar de baja a
la gente o finalizar los proyectos— y luego la empresa. **Reactivar nunca se
bloquea.**

⚠️ **Ni `activo` ni `registrosPatronales` se cambian desde
`PATCH /empresas/:id`.** Son rutas separadas a propósito: corregir un nombre y
esconder a sesenta personas no deberían costar lo mismo, y los registros pasaron
a tener `_id` propio.

#### Registros con identidad propia: patronales y de obra (29 ago 2026)

`registrosPatronales` pasó de `string[]` a objetos con `_id`, y llegó su gemelo
del lado del cliente, `registrosObra`. **El `_id` es el motivo**: un proyecto
apunta a un registro concreto, y una posición en un arreglo de cadenas no sirve
de referencia —corregir un dígito la rompería en silencio—.

```jsonc
{ "_id": "…", "numero": "R13-77767-10-5", "descripcion": "Zapopan", "activo": true }
```

**Son cosas distintas y de dueños distintos:**

| | Pertenece a | Para qué sirve | Permiso |
| --- | --- | --- | --- |
| Registro **patronal** | la **empresa** | El contexto patronal del proyecto | Admin de plataforma |
| Registro **de obra** | el **cliente** | De él saldrán los SIROC de cada contrato | `rh_admin` y `jefe_area` |

| Método | Ruta | Cuerpo |
| --- | --- | --- |
| `POST` | `/empresas/:id/registros-patronales` | `{ numero, descripcion? }` |
| `PATCH` | `/empresas/:id/registros-patronales/:rpId` | `{ numero?, descripcion? }` |
| `PATCH` | `/empresas/:id/registros-patronales/:rpId/estado` | `{ activo }` |
| `POST` | `/clientes/:id/registros-obra` | `{ numero, descripcion? }` o `multipart` con `archivo?` |
| `PATCH` | `/clientes/:id/registros-obra/:roId` | `{ numero?, descripcion? }` o `multipart` con `archivo?` |
| `GET` | `/clientes/:id/registros-obra/:roId/archivo` | — (`?descargar=true`) |
| `PATCH` | `/clientes/:id/registros-obra/:roId/estado` | `{ activo }` |

Mismo comportamiento en los dos: `POST` **idempotente por número** (`201` si lo
creó, `200` si ya existía), el número se guarda **en mayúsculas** y se corrige
**sin perder el `_id`**, y dar de baja responde `400` si un proyecto **en
curso** lo usa, diciendo cuántos. Los finalizados no lo impiden.

**No hay `GET` propio**: las listas vienen dentro de `GET /empresas/:id` y
`GET /clientes/:id`.

**Sólo el de obra lleva archivo** (D-79): opcional, uno solo y sin versiones —
subir otro reemplaza y borra el anterior—. Sale como `archivo` en todo lugar
donde se devuelve el registro, con su `url` firmada a 10 minutos, y
`GET …/archivo` emite una nueva cuando esa caduca. La forma exacta está en
`CONTRATO-API.md` §«El archivo del registro de obra».

El proyecto los referencia con `registroPatronalId`/`registroObraId`, y la
respuesta los trae **ya resueltos** en `registroPatronal`/`registroObra`
(`null` si no los tiene). El patronal tiene que ser de la empresa del proyecto y
el de obra, del cliente; ninguno puede estar dado de baja.

**Obligatorios desde el 29 ago 2026.** `POST /proyectos` rechaza si falta
cualquiera de los dos, con `errors[0].path` en el campo. Consecuencias:

- ⚠️ **Al cambiar `clienteId` en el `PATCH` hay que mandar `registroObraId`**
  del cliente nuevo, en la misma petición. El servidor ya no lo limpia solo
  —el campo no admite vacío— y responde `400`.
- ⚠️ **El `PATCH` no admite `null`** en ninguno de los dos: se cambian por otro
  válido, pero no se vacían. Un valor vacío se **omite** del cuerpo.

Los proyectos anteriores al cambio, sin estos campos, siguen siendo válidos: se
aplazan, finalizan y editan con normalidad.

#### Adscripciones — empresa ↔ empleado

| Método | Ruta | Cuerpo |
| --- | --- | --- |
| `GET` | `/empresas/:id/adscripciones` | `?activo=true\|false\|todos&area=&categoriaId=&orden=numero_asc\|numero_desc` (`numero_asc` y `activo=true` son los valores por defecto, 25 ago 2026: omitir `activo` ya no revuelve activas y bajas. **`?tipo=` desapareció el 26 ago 2026**) |
| `POST` | `/empresas/:id/adscripciones` | `{ empleadoId, areas[], tipoContrato, fechaIngreso, fechaTerminoContrato? }` |
| `PATCH` | `/adscripciones/:id` | Mismos campos, **más `registroPatronalId`** (`null` desvincula) |
| `PATCH` | `/adscripciones/:id/estado` | `{ activo, motivo }` — baja **de esa empresa** |
| `GET` | `/empresas/:id/jefaturas` | Quién dirige cada área. Sólo `rh_admin` |
| `PATCH` | `/adscripciones/:id/jefaturas` | `{ dirigeAreas[] }` — **lista completa**. Sólo `rh_admin` |

**`registroPatronalId` en la adscripción (29 ago 2026, D-72).** Vincula la
relación laboral con el catálogo de **su** empresa; tiene que estar activo, o
`400` con `path: registroPatronalId`. **Convive con
`condiciones.registroPatronal`, que sigue siendo texto** y no se valida: uno es
el vínculo confiable y el otro lo que dijo el archivo de nómina. **No asumas que
el id está** —`null` es lo normal en quien se dio de alta a mano—: para
*mostrar* el registro de alguien, usa `condiciones.registroPatronal` o el
`registroPatronalEmpleado` que ya dan resuelto las asignaciones.

#### Jefaturas de área (26 ago 2026)

Trabajar en un área y dirigirla dejaron de ser lo mismo. Antes, poner a alguien
en Contabilidad porque ahí trabaja le daba visión sobre toda Contabilidad; ahora
se asigna, y la adscripción lleva los dos campos:

```jsonc
{
  "areas": ["direccion"],          // dónde TRABAJA
  "dirigeAreas": ["contabilidad"]  // qué DIRIGE. Vacío es lo normal
}
```

`dirigeAreas` **no tiene que ser subconjunto de `areas`** y es por empresa. No se
escribe desde `PATCH /adscripciones/:id`.

**Se lee por área y se escribe por persona**, y esa asimetría es la trampa del
contrato. `GET` devuelve todas las áreas activas, también las que no dirige
nadie —son justo donde hay que poder asignar—:

```jsonc
{
  "jefaturas": [
    { "area": { "clave": "contabilidad", "nombre": "Contabilidad", "temporal": false },
      "jefes": [{ "adscripcionId": "…", "empleadoId": "…", "nombre": "…", "numeroEmpleado": "0042" }] },
    { "area": { "clave": "tesoreria", "nombre": "Tesorería", "temporal": false }, "jefes": [] }
  ]
}
```

El `PATCH` va contra el `adscripcionId` de ahí —**no** contra el empleado— y
reemplaza la lista entera: `[]` retira todas las jefaturas. Un área puede tener
varios jefes y un jefe varias áreas. En el front, recomponer esa lista es
`dirigeAreasTras()` (`modules/organizacion/jefaturas-service.ts`): sin eso,
asignar una jefatura nueva **borra en silencio** las que la persona ya tenía.

#### Condiciones laborales de la adscripción (28 ago 2026)

Estaban guardadas pero invisibles por compartir subdocumento con los salarios;
no son datos sensibles y ya se devuelven, en las cuatro rutas que traen una
adscripción resuelta (`GET /empleados`, `GET /empleados/:id`,
`GET /empleados/:id/expediente`, `GET /empresas/:id/adscripciones`):

```jsonc
{
  "condiciones": {
    "tipoRegimen": "02 Sueldos",
    "turno": "Turno diurno",
    "registroPatronal": "R13-77767-10-5",
    "baseCotizacion": "Fijo",
    "zonaSalario": "Resto del país",
    "tipoPrestacion": "De ley",
    "periodicidadPago": "Semanal Cames Vales Despensa",
    "teletrabajador": false
  }
}
```

El objeto **siempre** viene; sus campos son `null` si el archivo no los
traía, salvo `teletrabajador`, que nunca es `null`. Sigue sin devolverse:
salario diario, las tres partes del SBC, banco, sucursal y cuenta — eso se
resuelve con los roles configurables. Si un ambiente devuelve
`condiciones: {}` vacío, falta correr la migración de datos ahí; no es un bug
del front.

**Adscribir es el flujo que hace útil el catálogo compartido:** se toma a alguien
que ya existe y se le vincula, en vez de darlo de alta otra vez. Si ya tuvo
adscripción a esa empresa y se dio de baja, **se reactiva la existente**; no se
crea otra (el índice único lo impide).

Crear o dar de baja una adscripción **re-sincroniza el checklist** del empleado
([`modelo-datos.md` §6.2](./modelo-datos.md)). Dar de baja también cierra sus
asignaciones a proyectos de esa empresa.

#### Carteras — empresa ↔ cliente

| Método | Ruta | Cuerpo |
| --- | --- | --- |
| `GET` | `/empresas/:id/clientes` | Los de su cartera |
| `POST` | `/empresas/:id/clientes` | `{ clienteId, contactoNombre?, contactoEmail?, contactoTelefono?, notas? }` |
| `PATCH` | `/carteras/:id` · `/carteras/:id/estado` | |

Sacar un cliente de la cartera falla si la empresa tiene proyectos con él.

### 6.4 Proyectos

| Método | Ruta | Nota |
| --- | --- | --- |
| `GET` `POST` | `/proyectos` | `?empresaId=&estado=&clienteId=` |
| `GET` `PATCH` | `/proyectos/:id` | El `PATCH` **rechaza** cambiar `fechaFinEstimada` |
| `POST` | `/proyectos/:id/aplazar` | `{ fechaNueva, motivo }` |
| `POST` | `/proyectos/:id/finalizar` | `{ fechaFinReal }` |
| `POST` | `/proyectos/:id/reabrir` | |
| `POST` | `/proyectos/:id/categorias/clonar` | `{ origenId }` |
| `GET` | `/proyectos/:id/asignaciones` | `?activo=` |
| `GET` | `/proyectos/:id/asignables` | Quiénes se pueden asignar. Ver [`modelo-datos.md` §9.3](./modelo-datos.md) |
| `POST` | `/proyectos/:id/asignaciones` | `{ empleadoId, categoriaId, fechaAsignacion }` → `{ asignacion, avisos[] }` |
| `GET` | `/asignaciones/:id` | El detalle con la cadena completa en `trazabilidad` |
| `PATCH` | `/asignaciones/:id/salida` | `{ fechaSalida }` — cierra, no borra |
| `GET` `POST` | `/proyectos/:id/contratos` | `?incluirInactivos=`; el alta es `{ nombre?, fase?, fechaInicio, fechaFin }` |
| `PATCH` | `/contratos/:id` | **Sólo** `nombre`, `fase`, `fechaInicio`, `fechaFin` |
| `PUT` `DELETE` | `/contratos/:id/siroc` | `{ numero, fechaRegistro }` — el aviso no tiene fecha final (D-76); reemplaza entero, conservando sus actualizaciones |
| `POST` | `/contratos/:id/siroc/actualizaciones` | `{ fecha?, nota? }` — el refrendo de cada 2 meses; el número no cambia (D-76) |
| `DELETE` | `/contratos/:id/siroc/actualizaciones/ultima` | Deshace la última, capturada mal |
| `POST` | `/contratos/:id/finalizar` · `/reabrir` | Mueven `estado` |
| `PATCH` | `/contratos/:id/estado` | `{ activo }` — mueve **`activo`**, la baja |

Reglas que el servidor impone:

- **No hay proyecto sin cliente**, y el cliente debe estar en la **cartera
  activa** de la empresa del proyecto.
- `fechaFinEstimada > fechaInicio`; al menos una categoría; nombre único por
  empresa.
- **La fecha de cierre sólo se mueve con `/aplazar`**, que exige motivo de 10+
  caracteres, fecha posterior a la vigente, y **guarda el aplazamiento en el
  historial** con quién y cuándo. Es auditoría, no un adorno: por eso el `PATCH`
  la rechaza en vez de permitirla en silencio.
- Asignar exige que el empleado tenga **adscripción activa a la empresa del
  proyecto** y que su categoría esté **habilitada en ese proyecto**.
- Clonar categorías **suma sin quitar** y sin duplicar.
- Un proyecto no se borra: se finaliza. Reabrirlo limpia `fechaFinReal`.

**Contratos — que son las fases del proyecto (29 ago 2026).** `nombre` es la
etiqueta de la fase y es opcional; **el `numero` lo pone el servidor** (secuencia
dentro del proyecto) y no se manda ni se corrige. El contrato **no tiene**
`clienteId`, `empresaId` ni monto: no los busques en la respuesta. Ojo con dos
cosas verificadas contra el servidor:

- El alta **ignora los campos de más en silencio** (`201` sin ellos), mientras
  que el `PATCH` sí los rechaza con `400` diciendo por dónde va cada uno.
- **`estado` y `activo` no son lo mismo.** `finalizado` es un contrato que
  terminó bien (`/finalizar`); `activo: false` es uno capturado por error
  (`PATCH /contratos/:id/estado` — la ruta se llama `/estado` pero mueve
  `activo`, y es la única colisión de nombres del recurso).

**El SIROC es único en TODO el sistema** y se guarda en mayúsculas: si se muestra
después de capturarlo, hay que usar lo que devuelve la respuesta. Repetirlo es
`409 SIROC_DUPLICADO` con `data: { contratoId, contratoNumero, proyectoId,
proyectoNombre }` — se muestra el nombre pero **no se enlaza**: puede ser un
proyecto de otra empresa y el enlace daría `404`. Quitarlo con `DELETE` libera el
número.

**El SIROC se actualiza cada dos meses conservando el mismo número** (D-76). Cada
refrendo se registra con `POST /contratos/:id/siroc/actualizaciones` y todo
contrato viaja con `seguimientoSiroc` —cuántas actualizaciones pide, cuántas
lleva, cuándo cumple los dos meses y si ya urge—, **derivado en cada lectura**
como el resto de los estados de esta plataforma. La forma exacta está en
[`CONTRATO-API.md`](./CONTRATO-API.md) § «El SIROC se actualiza cada dos meses».

**Qué le traba cada contrato al proyecto:**

| Campo del proyecto | Se bloquea cuando |
| --- | --- |
| `registroPatronalId` | hay ≥1 contrato **activo** |
| `registroObraId` | hay ≥1 contrato activo **con SIROC** |
| `clienteId` | hay ≥1 contrato **activo** |
| `empresaId` | siempre |

Los candados miran el **cambio**, no la presencia: reenviar el mismo id en el
formulario completo sigue funcionando. Un contrato dado de baja sale de la
cuenta.

**Coherencia del registro patronal (D-71) — avisa, no bloquea.** Alguien puede
cotizar en un registro distinto al del proyecto: el alta responde **`201`
igual**, con el aviso en `data.avisos` y repetido en `message`. **Tratarlo como
error es el fallo fácil: la asignación se hizo.** Cada renglón de
`GET /proyectos/:id/asignaciones` trae además `registroPatronalEmpleado` (texto
de la nómina) y `registroPatronalCoincide`, que tiene **tres estados**: `true`,
`false` (cotiza en otro) y `null` (**no se pudo comparar**). `null` no es
`false`. La comparación la hace el servidor, que ya ignora guiones, espacios y
mayúsculas.

### 6.5 Expedientes y documentos

| Método | Ruta | Nota |
| --- | --- | --- |
| `GET` | `/expedientes` | Paginado. Mismos filtros que empleados, más `estatus` |
| `GET` | `/expedientes/:id` | Con el empleado embebido |
| `POST` | `/expedientes/:id/documentos/:tipo` | `multipart`: `archivo` + `vigenciaHasta?` |
| `POST` | `…/:tipo/revisar` | `{ aprobado: true }` para validar, o `{ aprobado: false, motivo }` (mínimo 10 caracteres) para rechazar. Un solo endpoint para las dos acciones. |
| `GET` | `…/:tipo/versiones/:v/url` | URL firmada, 10 min. Registra en bitácora |
| `GET` `PATCH` | `/plantillas-checklist` | **Por construir.** Administrar las plantillas. La resolución por unión y el sembrado ya están (§6.2 del modelo); lo que falta es editarlas |

Ciclo del documento:

```
pending ──subir──▶ in_review ──revisar (aprobado: true)──▶ validated ──(tiempo)──▶ expiring ──▶ expired
                        │                                       │                       │           │
                        └──revisar (aprobado: false)──▶ rejected                        │           │
                                          │                                              │           │
                                          └───────────────── subir (nueva versión) ──────┘
```

- **Subir se permite desde cualquier estatus** (así se reemplaza).
- **Revisar (aprobar o rechazar) sólo desde `in_review`**; desde otro estatus, `400`.
- Al subir versión nueva: numerarla, marcar `reemplazadaEn` en la anterior,
  insertarla **al inicio**, poner el documento en `in_review` y **limpiar
  `motivoRechazo`, `revisadoPor` y `revisadoEn`** — el rechazo anterior no debe
  contaminar la entrega nueva.
- Si el documento exige vigencia y no viene, `400`.
- **Un empleado dado de baja del sistema tiene el expediente en sólo lectura.**
  Una baja de una sola adscripción **no** lo bloquea: sigue trabajando en otra
  empresa.
- Validar el `mime` **por contenido, no por la extensión ni por el header**: es
  un archivo de usuario y el `Content-Type` es manipulable. `415` si no es PDF ni
  imagen, `413` si pasa del tope de la ruta — 30 MB en general, 10 MB en la
  importación de nómina (D-81).

### 6.6 Alertas, métricas y reportes

| Método | Ruta | `data` |
| --- | --- | --- |
| `GET` | `/alertas` | `{ alertas }` — `?tipo=&empresaId=&area=&origen=`. Aquí `tipo` es **el de la alerta**, no el de la persona: éste no se tocó |
| `GET` | `/dashboard/metricas` | **Por construir.** `{ metricas }` — `?empresaId=` |
| `GET` | `/reportes/expedientes` | **Por construir.** `{ reporte }` — mismos filtros que expedientes |

`Alerta` es una **unión discriminada por `origen`**:

```ts
type Alerta = AlertaDocumento | AlertaProyecto

// Comunes: id, tipo, empresaId, mensaje, diasRestantes?
// AlertaDocumento: origen:'documento', expedienteId, empleadoId, empleadoNombre,
//                  categoriaNombre, areas[], tipoDocumento, vigenciaHasta?, motivoRechazo?
// AlertaProyecto:  origen:'proyecto', proyectoId, proyectoNombre, clienteNombre,
//                  fechaFinEstimada
```

El **`id` tiene que ser estable entre recálculos** — el front lo usa como clave
de lista y si cambia, la bandeja parpadea.

`MetricasDashboard`: `empleadosActivos`, `administrativos`, `manoDeObra`,
`conAccesoPlataforma`, `expedientesCompletos`, `expedientesIncompletos`,
`avancePromedio`, `documentosEnRevision`, `documentosPorVencer`,
`documentosVencidos`, `proyectosEnCurso`, `alertasActivas`.

El reporte devuelve **filas planas con las etiquetas ya traducidas al español**
(`"Obra"`, no `"obra"`; `"Validado"`, no `"validated"`), porque van directo al
Excel que arma el front. Dos arreglos: uno por expediente y uno por documento.
Se ordena por nombre, no por urgencia: es un documento de auditoría.

### 6.7 Salud

`GET /health` · `GET /ready` · `GET /api/v1` (qué está implementado). Públicas.

---

## 7. Almacenamiento de archivos

`talentlink-backend` ya usa **Cloudflare R2** con URLs firmadas
(`@aws-sdk/client-s3` + `s3-request-presigner`, variables `R2_ACCOUNT_ID`,
`R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_SIGNED_URL_TTL`).
Reutiliza ese servicio.

**El bucket es privado.** Nunca se expone una URL pública: cada apertura pasa por
`GET …/url`, que valida permisos, firma por 10 minutos y deja registro.

Convención de claves, que hace obvio a quién pertenece cada archivo y facilita
borrar todo lo de un empleado:

```
expedientes/{empleadoId}/{tipoDocumento}/v{version}-{uuid}.{ext}
```

- El nombre original va en `archivo.nombre` (para mostrar y descargar); en la
  clave **nunca** — un nombre de archivo controlado por el usuario en una ruta
  es un riesgo de path traversal.
- **Las versiones anteriores no se borran.** El versionado es el requisito de
  trazabilidad del flujo.
- Antes de subir a R2, valida el tipo real por los *magic bytes* del contenido.
- Considera pasar un antivirus (ClamAV o equivalente) antes de aceptar el
  archivo: son documentos que suben personas y los abre todo el equipo de RH.

---

---

## 8. Trabajos programados

### Job diario de vigencias

Una vez al día, temprano (06:00 hora de México):

1. Recorrer los expedientes de empleados **activos**, y los proyectos en curso.
2. Derivar el estatus efectivo de cada documento (7.3).
3. Agrupar por destinatario y **enviar un solo correo resumen** con lo que
   vence pronto y lo que ya venció.

**No escribas `expiring` ni `expired` en la base.** El job notifica; no cambia
estado. El estatus se sigue derivando al leer.

**Manda un correo por persona, no uno por alerta.** Con 300 empleados, un
correo por documento vencido es un buzón inservible y la gente deja de leerlos.

Destinatarios en fase 1: los usuarios `rh_admin` y `rh_consulta` activos. En
fase 2, los del cliente correspondiente. Conviene que sea configurable.

`talentlink-backend` ya tiene servicio de correo (Mailjet en producción,
Mailtrap en desarrollo): reutilízalo.

### Idempotencia

Si el job corre dos veces el mismo día, no debe mandar dos correos. Lleva
registro del último envío por destinatario y día.

---

---

## 9. Criterios de aceptación

Lista para verificar antes de dar por terminado el backend. Cada punto es una
prueba automatizada.

**Contrato**
- [ ] Todas las respuestas usan el envelope `{ status, message?, data }` con los
      datos anidados bajo llave nombrada.
- [ ] Las fechas de calendario se devuelven como `YYYY-MM-DD` y las marcas de
      tiempo en ISO completo.
- [ ] Los campos opcionales ausentes salen como `null` u omitidos, nunca `""`.
- [ ] Los errores de validación traen `errors[0].msg` en español.

**Aislamiento entre empresas**
- [ ] Un usuario adscrito sólo a la Empresa A no obtiene datos de la Empresa B en
      **ninguna** ruta: listados, detalle, alertas, métricas, reportes y URL de
      archivo.
- [ ] Pedir un recurso de otra empresa responde `404`, no `403`.
- [ ] Mandar `empresaId` en el cuerpo o en el query string **filtra dentro** del
      alcance, nunca lo amplía.
- [ ] Un usuario con `alcanceGlobal` sí ve todas las empresas.
- [ ] Un empleado adscrito a dos empresas es visible desde las dos, y su
      expediente es **el mismo**.

**Vínculos**
- [ ] Adscribir a alguien que ya tuvo adscripción a esa empresa **reactiva** la
      existente; no crea otra.
- [ ] Dar de baja una adscripción cierra sus asignaciones a proyectos de esa
      empresa y re-sincroniza el checklist.
- [ ] Asignar a un proyecto falla si el empleado no tiene adscripción activa a
      la empresa del proyecto.
- [ ] Asignar falla si la categoría del empleado no está habilitada en el
      proyecto, y el mensaje dice qué hacer.
- [ ] Quitar a alguien de un proyecto **cierra** la asignación con `fechaSalida`;
      no la borra.
- [ ] Dos peticiones concurrentes asignando al mismo empleado al mismo proyecto
      producen un `400` legible, no un `500`.
- [ ] Un proyecto no puede apuntar a un cliente fuera de la cartera de su
      empresa.

**Proyectos**
- [ ] `PATCH /proyectos/:id` **rechaza** cambiar `fechaFinEstimada`.
- [ ] Aplazar exige motivo de 10+ caracteres y fecha posterior, y deja el
      aplazamiento en el historial.
- [ ] Un proyecto finalizado deja de generar alertas aunque su fecha haya pasado.
- [ ] Clonar categorías suma sin quitar y sin duplicar.

**Lógica de dominio**
- [ ] Un documento con vigencia **hoy** es `expiring`; con vigencia **ayer**,
      `expired`.
- [ ] Exactamente 30 días es `expiring`; 31 es `validated`.
- [ ] Un documento `in_review` con vigencia pasada sigue `in_review`.
- [ ] Un checklist sin documentos requeridos da 100 % y no divide entre cero.
- [ ] Un documento opcional vencido pone el expediente en `expired` aunque el
      avance sea 100 %.
- [ ] Un empleado dado de baja del sistema no genera ninguna alerta.
- [ ] Un documento opcional sin subir no genera alerta de faltante.
- [ ] El `id` de una alerta es idéntico en dos consultas seguidas.
- [ ] Cambiar el área de una adscripción conserva los documentos ya entregados,
      marcándolos opcionales si la unión de plantillas nueva no los pide.
- [ ] Un empleado adscrito a dos empresas recibe la **unión** de las dos
      plantillas, con la condición más estricta de cada documento.
- [ ] Editar una plantilla re-sincroniza los expedientes que la usan.
- [ ] Reemplazar un documento crea la versión 2, marca `reemplazadaEn` en la 1 y
      **limpia el `motivoRechazo` anterior**.

**Permisos**
- [ ] `rh_consulta` puede subir, y también validar o rechazar (`revisar`).
- [ ] `jefe_area` recibe `403` al pedir la URL de un documento sensible, y `200`
      con el historial de metadatos del mismo documento.
- [ ] `jefe_area` sólo ve expedientes de su área.
- [ ] Revisar (validar o rechazar) algo que no está `in_review` responde `400`.
- [ ] Subir a un expediente de un empleado dado de baja del sistema responde
      `400`; una baja de una sola adscripción **no** lo bloquea.

**Archivos**
- [ ] Un archivo que no es PDF ni imagen se rechaza aunque el `Content-Type`
      diga lo contrario.
- [ ] Más de 30 MB responde `413` (10 MB en la importación de nómina, D-81).
- [ ] Las URLs firmadas caducan y quedan registradas en la bitácora.

---

---

## 10. Migración de lo ya implementado

> **Hecha.** `/usuarios` responde `410` con la ruta que la sustituye
> (`src/api/v1/users/goneRoutes.js`); se borra cuando el front deje de llamarla.
> El acceso vive en `empleados.acceso` y la contraseña aparte, en `credentials`
> (D-27). Se conserva porque explica de dónde viene la forma actual.

`/auth` y `/usuarios` están en pie y **no se tiran**. Cambian de sitio: el
usuario deja de ser una entidad suelta y pasa a ser el subdocumento `acceso` de
un empleado.

1. **Por cada `usuario`, crear un `empleado`** con su `acceso`, su expediente en
   blanco y una `adscripción` a la empresa que corresponda. La contraseña se
   copia hasheada: nadie tiene que restablecerla.
2. **`/auth/login` y `/auth/me` conservan la ruta**; lo que cambia es la forma de
   `user` (§6.1). Coordinar el despliegue con el front.
3. **`/usuarios` pasa a significar «empleados con acceso»**: el mismo CRUD, pero
   operando sobre `empleados` y filtrando `acceso != null`. **Dar acceso a
   alguien que ya es empleado debe añadirle el subdocumento, no crear otra
   persona.**
4. `alcance` y `clienteId` del usuario desaparecen; el alcance sale de las
   adscripciones.

Si prefieren otra ruta de migración, díganla y se ajusta el front. Lo único
innegociable: **que no queden dos registros de la misma persona.**

---

## 11. Decisiones ya tomadas

No hace falta volver a preguntarlas.

| Pregunta | Decisión |
| --- | --- |
| ¿El usuario de la plataforma es una entidad aparte? | **No.** Es `acceso` dentro del empleado |
| ¿El empleado pertenece a una empresa? | **No.** Se le adscribe a una o varias |
| ¿Los clientes son de cada empresa? | **No.** Catálogo compartido + cartera por empresa |
| ¿Un administrativo puede estar en proyectos? | **Sí**, áreas y proyectos conviven |
| ¿Las categorías reemplazan al puesto? | **Sí**, y el catálogo es global |
| ¿Quién crea proyectos y los cierra? | Administrador RH **y jefe de área** |
| ¿Quién administra los catálogos compartidos? | Sólo `alcanceGlobal` |
| ¿El empleado sube sus propios documentos? | **No**, siempre RH. Tres niveles, definitivos |
| ¿Los listados van paginados? | **Sí**, empleados y expedientes |
| ¿Umbral de aviso de proyecto? | **7 días** |

### Lo que falta decidir

Las cinco de la entrega original quedaron en cuatro resueltas y una abierta; el
detalle está en [`modelo-datos.md` §12](./modelo-datos.md).

| Pregunta | Cómo quedó |
| --- | --- |
| ¿El expediente se comparte entre empresas del grupo? | **Sí**, es de la persona (§2.1 del modelo) |
| ¿La CURP es obligatoria desde el alta? | **Sigue abierta.** Hoy es opcional, con índice único parcial (D-28) |
| Umbral de vencimiento de documentos | **30 días**, inclusivo, `DIAS_ALERTA_VENCIMIENTO` |
| Qué documentos son sensibles | **8 de los 12** (`SENSITIVE_DOCUMENT_TYPES`) |
| A quién llegan los correos de alerta | **Abierta.** No hay correos ni job: `GET /alertas` deriva todo al leer (D-47) |

**Y una que bloquea al front:** `affiliations.nomina` guarda salario, SBC y
cuenta bancaria porque el archivo de nómina los trae, pero **ninguna respuesta
los devuelve** hasta que se decida quién puede verlos (LFPDPPP). Ver D-46 y
[`ESTADO.md`](./ESTADO.md) #10.

---

## 12. Orden de implementación sugerido

El plan original, que se siguió. **Los pasos 1 a 6 están hechos**, y del 7 sólo
las alertas; faltan métricas, reportes y el job del 8. Lo vivo, con checkboxes y
el orden sugerido, está en [`ESTADO.md`](./ESTADO.md).

1. **Colecciones base** — `empresas`, `empleados`, `clientes`, `categorias`, con
   sus índices.
2. **Migración de `usuarios` a `empleados.acceso`** y ajuste de `/auth` (§10).
3. **`adscripciones` y el middleware de alcance.** Es la pieza de la que depende
   todo lo demás: que quede sólida, con pruebas de aislamiento entre empresas,
   antes de seguir.
4. **`expedientes`** con el checklist por unión y los archivos en R2.
5. **`carteras` y `proyectos`**, con la regla de cliente en cartera.
6. **`asignaciones`** y las agregaciones de listado.
7. **Alertas, métricas y reportes** — derivados de todo lo anterior.
8. **Job diario de vigencias** y correos.

---

## Referencias

| Qué | Dónde |
| --- | --- |
| **Modelo de datos completo** | [`modelo-datos.md`](./modelo-datos.md) |
| **Qué colecciones hay hoy y qué se rompe al tocarlas** | [`ARQUITECTURA-DATOS.md`](./ARQUITECTURA-DATOS.md) |
| El detalle petición por petición, con ejemplos | [`CONTRATO-API.md`](./CONTRATO-API.md) |
| Por qué se desvió del spec, decisión por decisión | [`DECISIONES.md`](./DECISIONES.md) |
| Lo que el front ya usa y no se puede romper | [`INTEGRACION-FRONTEND.md`](./INTEGRACION-FRONTEND.md) |
| Por recurso | `ENDPOINTS-PROYECTOS` · `-ADSCRIPCIONES` · `-ALERTAS` · `-AREAS` · `-EXPEDIENTES` · `-IMPORTACION` |
| Qué falta implementar, en orden | [`ESTADO.md`](./ESTADO.md) |
| Lógica de dominio ya probada | `src/utils/domain/`, `tests/unitarias/domain/` |
| Conversación con el front | [`HANDOFF-BACKEND.md`](./HANDOFF-BACKEND.md) |

En el repo del front (`~/Documents/projects/cames-files-manager/docs/`), que se
lee ahí y no se copia aquí:

| Qué | Dónde |
| --- | --- |
| Flujo funcional original del cliente | `flujo-expedientes.md` |
| Cómo les pega el backend, con sus trampas | `backend-actual.md` |
| Capa simulada del front | `mocks.md` |
| Contratos TypeScript y enums | `src/interfaces/`, `src/enums/` |
| Casos borde ya cubiertos de su lado | `src/utils/__tests__/`, `src/mocks/__tests__/` |
| Su mitad de la conversación | `HANDOFF-FRONTEND.md` |
