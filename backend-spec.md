# Especificación del backend — Plataforma de Expedientes Laborales (Urbacames)

> **Cómo usar este documento.** Es la especificación completa y cerrada del
> backend que necesita el front que ya está construido. Está escrito para que se
> pueda entregar tal cual a una persona desarrolladora o a un agente de IA y
> pueda implementarlo sin volver a preguntar. Todo lo que aquí se define ya está
> ejercitado por el front y por 93 pruebas automatizadas: **si el backend
> devuelve otra forma, el front se rompe.**
>
> Stack objetivo: **Node.js + Express + MongoDB (Mongoose)**, siguiendo las
> convenciones del backend hermano `talentlink-backend`.

---

## 1. Contexto

Urbacames necesita gestionar los expedientes laborales de sus colaboradores: un
checklist de documentos por persona, con carga de archivos, validación, control
de vigencias, alertas y reportes de auditoría.

**El front ya está terminado y funcionando** contra una capa de datos simulada
(`src/mocks/`). Toda la lógica de dominio —cálculo de avance, semáforo,
vigencias, derivación de alertas, generación de checklist— está implementada y
probada en el front, y **debe replicarse en el servidor**, porque el front sólo
apaga botones: la autoridad es el backend.

### Qué existe hoy y qué hay que construir

| Pieza | Hoy | Objetivo |
| --- | --- | --- |
| Login, sesión, usuarios | `talentlink-backend` (prestado, compartido con Humenta) | Backend propio |
| Expedientes, documentos, alertas, plantillas, reportes | Simulados en el navegador | Backend propio |
| Archivos | En memoria, se pierden al recargar | Cloudflare R2 con URLs firmadas |
| Vigencias y correos | No existen | Job diario + notificaciones |

### Alcance de esta especificación

Dos fases, y **la fase 1 no debe bloquear la fase 2**:

- **Fase 1 (ahora).** Urbacames gestiona a sus propios colaboradores. Es lo que
  el front consume hoy.
- **Fase 2 (después).** Un colaborador puede pertenecer a un **cliente**, y ese
  cliente entra a la plataforma y ve a "sus" trabajadores como propios.

La sección 4 explica el diseño que permite pasar de una a otra **sin migrar
datos ni reescribir endpoints**. Léela antes de modelar cualquier colección.

---

## 2. Reglas no negociables

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

5. **Identificadores.** Se exponen como `_id` en string. Nunca `id`.

6. **Fechas.** Dos formatos, y no se mezclan:
   - **Fechas de calendario** (ingreso, término de contrato, vigencia, baja):
     `YYYY-MM-DD`, sin hora ni zona. Son fechas civiles: el 19 de agosto es el
     19 de agosto en cualquier huso.
   - **Marcas de tiempo** (`createdAt`, `subidoEn`, `revisadoEn`): ISO 8601 UTC
     completo.

7. **Campos opcionales.** Se omiten o van como `null`; **nunca como cadena
   vacía**. El front trata `""` como valor presente.

8. **Nombres de campos.** El dominio va en **español** (`colaborador`,
   `expediente`, `documentos`, `vigenciaHasta`). La autenticación conserva los
   nombres en inglés que ya usa el front (`name`, `email`, `role`, `active`).
   Los valores de los enums son los literales de la sección 5, exactos.

9. **Los estatus derivados no se guardan.** `expiring`, `expired` y todo el
   objeto `avance` se **calculan en cada consulta** a partir de las fechas. Si
   se persisten, quedan desincronizados al día siguiente. Lo mismo con las
   alertas: se derivan, no se almacenan.

10. **El servidor recalcula siempre.** El front manda intenciones ("sube esto",
    "valida aquello"), nunca estados calculados. Cualquier `avance`, `estatus`
    o `porcentaje` que llegue en el cuerpo de una petición se ignora.

---

## 3. Convenciones de implementación

Se sigue la estructura de `talentlink-backend` para que ambos proyectos se
mantengan igual:

```
src/
  api/v1/
    <recurso>/
      <recurso>Model.js        Esquema de Mongoose
      <recurso>Service.js      Reglas de negocio
      <recurso>Controller.js   HTTP: parsea, llama al service, responde
      <recurso>Routes.js       Rutas + validaciones + middlewares
    routes/index.js            Monta todos los recursos
  middlewares/
    authMiddleware.js          protect, restrictTo
    alcanceMiddleware.js       ← NUEVO: filtro obligatorio por cliente
    validateRequest.js
    errorHandler.js
  services/                    Correo, almacenamiento, jobs
  utils/
    dominio/                   ← Lógica de expedientes (sección 8)
  validations/
```

**Los controladores no llevan lógica de negocio.** Las reglas de la sección 8
viven en `utils/dominio/` y se prueban solas, sin HTTP de por medio. El front ya
tiene esas mismas funciones probadas en `src/utils/expediente.ts` y
`src/utils/checklist.ts`: **son la referencia de comportamiento, cópialas.**

---

## 4. El modelo multi-cliente (lo más importante de este documento)

### El requisito

Hoy Urbacames gestiona a sus propios colaboradores. Mañana debe poder existir un
**cliente** —otra empresa— cuyos trabajadores se administran en esta misma
plataforma, y ese cliente debe poder entrar y ver a esos trabajadores **como si
fueran suyos**: su listado, sus expedientes, sus alertas y nada más.

Esto **no se construye ahora**, pero el modelo de datos tiene que dejarlo
entrar sin migración ni reescritura.

### La decisión: un eje de pertenencia nulable desde el día uno

Se crea la colección `clientes` **desde ahora, aunque quede vacía**, y todo
documento que pertenezca a alguien lleva un campo:

```js
clienteId: { type: ObjectId, ref: 'Cliente', default: null, index: true }
```

**`clienteId: null` significa "pertenece a Urbacames"**, la casa. En la fase 1
absolutamente todo se crea con `null` y nadie nota que el campo existe. En la
fase 2 basta con crear clientes y asignar `clienteId`: ni un solo endpoint
cambia de forma.

> **Por qué nulable y no un "cliente Urbacames" en la tabla.** Un cliente
> ficticio obligaría a sembrarlo, referenciarlo en cada alta y recordar tratarlo
> distinto en los permisos. `null` es explícito y se lee bien en las consultas:
> `{ clienteId: null }` es "lo de la casa".

### Alcance de los usuarios

Cada usuario tiene un **alcance** que decide qué universo de datos ve:

| `alcance` | `clienteId` | Ve |
| --- | --- | --- |
| `interno` | `null` | **Todo**: lo de Urbacames y lo de todos los clientes |
| `cliente` | `ObjectId` | **Sólo** los colaboradores de ese cliente |

En la fase 1 todos los usuarios son `interno`. El campo existe y se valida desde
ya, para que el middleware de la siguiente sección esté escrito y probado antes
de que haga falta.

### El middleware que hace que no se filtre nada

Esta es la pieza crítica. **No confíes en que cada consulta se acuerde de
filtrar**: un olvido significa enseñarle a un cliente los trabajadores de otro.

```js
// middlewares/alcanceMiddleware.js
// Deja en req.filtroAlcance el filtro que TODA consulta de datos de
// colaboradores debe incluir. Para un usuario interno es {} (ve todo);
// para un usuario de cliente es { clienteId: <el suyo> } y no hay forma
// de ampliarlo desde la petición.
function aplicarAlcance(req, res, next) {
  req.filtroAlcance =
    req.user.alcance === 'cliente' ? { clienteId: req.user.clienteId } : {};
  next();
}
```

Reglas que lo acompañan:

- **El `clienteId` nunca se lee del cuerpo ni del query string.** Sale del token
  del usuario. Si un usuario de cliente manda `?clienteId=otro`, se ignora en
  silencio.
- **Fuera de alcance responde `404`, no `403`.** Un `403` confirmaría que el
  expediente existe. Para un cliente, lo de otro cliente sencillamente no existe.
- **Al crear**, el `clienteId` se hereda: usuario interno → `null` (o el cliente
  que elija explícitamente en fase 2); usuario de cliente → el suyo, siempre.
- Se recomienda una prueba automatizada por endpoint que verifique que un
  usuario de cliente A no alcanza datos de un cliente B.

### Dónde va el campo

| Colección | `clienteId` | Nota |
| --- | --- | --- |
| `usuarios` | Sí | `null` = personal de Urbacames |
| `colaboradores` | Sí | El dueño del trabajador |
| `expedientes` | Sí, **desnormalizado** | Copia del colaborador |
| `plantillas_checklist` | Sí | `null` = plantilla global, ver abajo |
| `clientes` | — | Es la colección raíz |
| `bitacora_accesos` | Sí, desnormalizado | Para auditar por cliente |

**Por qué se desnormaliza en `expedientes`:** casi todas las consultas del
producto empiezan por expediente (listado, alertas, métricas, reportes). Tener
el `clienteId` ahí evita un `$lookup` en cada una y permite un índice compuesto
que resuelve el listado completo. El precio es mantener la copia sincronizada:
**si un colaborador cambia de cliente, se actualiza su expediente en la misma
transacción.** Es el único lugar donde hay que acordarse.

### Plantillas de checklist por cliente

Un cliente puede exigir documentos distintos. La resolución de plantilla
(sección 8.1) gana un nivel de especificidad, de más específico a más general:

1. Plantilla del cliente que empata **área + tipo de contrato**
2. Plantilla del cliente que empata **tipo de contrato**
3. Plantilla global (`clienteId: null`) que empata **área + tipo de contrato**
4. Plantilla global que empata **tipo de contrato**
5. Plantilla general (`plantilla-general`) como red de seguridad

En fase 1 sólo existen los niveles 3 a 5, que es exactamente lo que el front ya
implementa. Los niveles 1 y 2 se agregan sin tocar nada más.

### Lo que queda preparado pero no se construye

Campos que conviene dejar declarados en `clientes` desde ya, aunque nadie los
llene, porque después obligarían a migrar:

- `branding: { logoUrl, colorPrimario, nombreComercial }` — para que la
  plataforma se vea del cliente cuando entre.
- `configuracion.diasAlertaVencimiento` — cada cliente puede querer otro plazo.
- `configuracion.documentosSensibles` — qué documentos oculta a sus jefes de área.

### Nota sobre outsourcing

Si en algún momento Urbacames coloca personal **empleado por ella** en un
cliente (subcontratación), hacen falta dos ejes distintos: quién **emplea**
legalmente y quién **usa** al trabajador. El diseño lo admite agregando
`empleadorId` junto a `clienteId`, sin tocar nada de lo anterior:
`clienteId` sigue siendo "quién lo ve como suyo". **No lo implementes ahora**,
pero no uses `clienteId` para significar "empleador", o cerrarías esa puerta.

---

## 5. Enumeraciones

Valores literales exactos. El front los tiene en `src/enums/` y los compara por
igualdad estricta.

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

### `Area`

`direccion` · `administracion` · `recursos_humanos` · `contabilidad` · `obra` ·
`proyectos` · `compras` · `ventas` · `mantenimiento`

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

`rh_admin` · `rh_consulta` · `jefe_area`. Ver la matriz en la sección 8.

---

## 6. Modelo de datos (MongoDB)

Todas las colecciones usan `timestamps: true` de Mongoose, lo que produce
`createdAt` y `updatedAt` en ISO 8601.

### 6.1 `clientes`

Vacía en fase 1. Se crea ahora para que el `clienteId` de las demás colecciones
tenga a qué apuntar.

```js
const clienteSchema = new mongoose.Schema({
  nombre:        { type: String, required: true, trim: true, maxlength: 120 },
  rfc:           { type: String, trim: true, uppercase: true, maxlength: 13 },
  contactoNombre:   { type: String, trim: true },
  contactoEmail:    { type: String, trim: true, lowercase: true },
  contactoTelefono: { type: String, trim: true },

  // Preparados para fase 2; nadie los llena todavía.
  branding: {
    nombreComercial: String,
    logoUrl:         String,
    colorPrimario:   String
  },
  configuracion: {
    // Si viene, pisa el valor global de 30 días.
    diasAlertaVencimiento: { type: Number, min: 1, max: 365 },
    // Si viene, pisa la lista global de documentos sensibles.
    documentosSensibles:   [{ type: String, enum: TIPOS_DOCUMENTO }]
  },

  activo: { type: Boolean, default: true }
}, { timestamps: true });
```

### 6.2 `usuarios`

Quienes entran a la plataforma. **No confundir con `colaboradores`**: un
colaborador es alguien de quien se guarda expediente y normalmente **no** tiene
acceso al sistema.

```js
const usuarioSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true, maxlength: 50 },
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 8, select: false },

  // Nivel de acceso del flujo. Sustituye al role user/admin del backend prestado.
  nivelAcceso: {
    type: String,
    enum: ['rh_admin', 'rh_consulta', 'jefe_area'],
    required: true,
    default: 'rh_consulta'
  },

  // Obligatoria y única para jefe_area; ignorada para los otros dos niveles.
  area: { type: String, enum: AREAS, default: null },

  // Eje multi-cliente (sección 4).
  alcance:   { type: String, enum: ['interno', 'cliente'], default: 'interno' },
  clienteId: { type: ObjectId, ref: 'Cliente', default: null },

  active: { type: Boolean, default: true },

  ultimoAccesoEn: { type: Date, default: null }
}, { timestamps: true });
```

**Invariantes que el esquema debe hacer cumplir** (`pre('validate')`):

- `nivelAcceso === 'jefe_area'` ⟹ `area` es obligatoria.
- `nivelAcceso !== 'jefe_area'` ⟹ `area` se fuerza a `null`.
- `alcance === 'cliente'` ⟹ `clienteId` es obligatorio y debe existir.
- `alcance === 'interno'` ⟹ `clienteId` se fuerza a `null`.

Hashear la contraseña con `bcrypt` (coste 12) en un `pre('save')` sólo si
cambió, y exponer `comparePassword`. `toJSON` nunca debe incluir `password`.

### 6.3 `colaboradores`

La persona de la que se lleva expediente.

```js
const colaboradorSchema = new mongoose.Schema({
  nombre:  { type: String, required: true, trim: true, minlength: 3, maxlength: 120 },
  puesto:  { type: String, required: true, trim: true, minlength: 3, maxlength: 120 },
  area:    { type: String, enum: AREAS, required: true },

  tipoContrato:         { type: String, enum: TIPOS_CONTRATO, required: true },
  fechaIngreso:         { type: String, required: true },  // YYYY-MM-DD
  fechaTerminoContrato: { type: String, default: null },   // YYYY-MM-DD, sólo temporales

  email:    { type: String, lowercase: true, trim: true, default: null },
  telefono: { type: String, trim: true, default: null },

  // Baja lógica: el expediente se conserva para auditoría.
  activo:     { type: Boolean, default: true },
  motivoBaja: { type: String, default: null },
  fechaBaja:  { type: String, default: null },             // YYYY-MM-DD

  clienteId: { type: ObjectId, ref: 'Cliente', default: null }
}, { timestamps: true });
```

**Validaciones de negocio:**

- Si `tipoContrato` es temporal ⟹ `fechaTerminoContrato` obligatoria y
  **estrictamente posterior** a `fechaIngreso`.
- Si `tipoContrato` es `indeterminado` ⟹ `fechaTerminoContrato` se fuerza a `null`.
- `email`, si viene, **único dentro del mismo `clienteId`** (no globalmente: dos
  clientes distintos pueden tener homónimos con el mismo correo genérico).
- Dar de baja exige `motivoBaja`; al reactivar se limpian `motivoBaja` y
  `fechaBaja`.

**Las fechas de calendario se guardan como `String` `YYYY-MM-DD`, no como
`Date`.** Guardarlas como `Date` las convierte a medianoche UTC y en México se
leen un día antes. Es un bug real que ya se corrigió en el front; no lo
reintroduzcas en la base. Las marcas de tiempo (`createdAt`, `subidoEn`,
`revisadoEn`) sí son `Date`.

### 6.4 `expedientes`

Un expediente por colaborador, con su checklist embebido.

```js
const archivoSchema = new mongoose.Schema({
  nombre:      { type: String, required: true },   // nombre original del archivo
  mime:        { type: String, required: true },
  tamanoBytes: { type: Number, required: true },
  subidoPor:   { type: String, required: true },   // NOMBRE de la persona, no su id
  subidoEn:    { type: Date,   required: true },
  // Interno: no se expone al front. Ubicación real en el almacenamiento.
  claveAlmacenamiento: { type: String, required: true, select: false }
}, { _id: false });

const versionSchema = new mongoose.Schema({
  version:       { type: Number, required: true, min: 1 },
  archivo:       { type: archivoSchema, required: true },
  estatus:       { type: String, enum: ['in_review', 'validated', 'rejected'], required: true },
  vigenciaHasta: { type: String, default: null },  // YYYY-MM-DD
  revisadoPor:   { type: String, default: null },  // nombre
  revisadoEn:    { type: Date,   default: null },
  motivoRechazo: { type: String, default: null },
  reemplazadaEn: { type: Date,   default: null }
}, { _id: false });

const documentoSchema = new mongoose.Schema({
  tipo:      { type: String, enum: TIPOS_DOCUMENTO, required: true },
  requerido: { type: Boolean, required: true },
  // Sólo los cuatro estatus persistibles; expiring/expired se derivan.
  estatus:   { type: String, enum: ['pending', 'in_review', 'validated', 'rejected'], required: true },

  vigenciaMeses: { type: Number, default: null },  // heredado de la plantilla
  vigenciaHasta: { type: String, default: null },  // YYYY-MM-DD, de la versión vigente

  archivo:       { type: archivoSchema, default: null },  // copia de la versión vigente
  motivoRechazo: { type: String, default: null },
  revisadoPor:   { type: String, default: null },
  revisadoEn:    { type: Date,   default: null },

  // De la MÁS RECIENTE a la más antigua. versiones[0] es la vigente.
  versiones: { type: [versionSchema], default: [] }
}, { _id: false });

const expedienteSchema = new mongoose.Schema({
  colaboradorId: { type: ObjectId, ref: 'Colaborador', required: true, unique: true },
  plantillaId:   { type: ObjectId, ref: 'PlantillaChecklist', required: true },
  documentos:    { type: [documentoSchema], default: [] },

  // Desnormalizado desde el colaborador (sección 4).
  clienteId: { type: ObjectId, ref: 'Cliente', default: null }
}, { timestamps: true });
```

**Por qué el checklist va embebido y no en su propia colección:** un expediente
tiene como mucho 12 documentos con unas pocas versiones cada uno; siempre se lee
completo, siempre se escribe completo, y nunca se consulta un documento fuera de
su expediente. Embebido se lee de un golpe y las actualizaciones son atómicas.

**`subidoPor` y `revisadoPor` guardan el nombre en texto, no el `userId`.** Es
deliberado: es un registro histórico de auditoría y debe seguir siendo legible
aunque el usuario se dé de baja o cambie de nombre. Si además quieres
trazabilidad dura, agrega `subidoPorId`/`revisadoPorId` **junto** al nombre, sin
sustituirlo.

### 6.5 `plantillas_checklist`

Qué documentos exige cada tipo de expediente.

```js
const renglonSchema = new mongoose.Schema({
  tipo:          { type: String, enum: TIPOS_DOCUMENTO, required: true },
  requerido:     { type: Boolean, required: true },
  vigenciaMeses: { type: Number, min: 1, max: 60, default: null }
}, { _id: false });

const plantillaSchema = new mongoose.Schema({
  nombre:      { type: String, required: true, trim: true },
  descripcion: { type: String, default: '' },

  tiposContrato: { type: [String], enum: TIPOS_CONTRATO, required: true },
  // null = aplica a todas las áreas. Una lista la vuelve más específica.
  areas:         { type: [String], enum: AREAS, default: null },

  documentos: { type: [renglonSchema], required: true },

  // Las base vienen sembradas y no se pueden borrar.
  esBase: { type: Boolean, default: false },

  clienteId: { type: ObjectId, ref: 'Cliente', default: null }
}, { timestamps: true });
```

**Validación:** al menos un documento con `requerido: true`. Sin eso, todo
expediente nacería completo.

### 6.6 `bitacora_accesos`

Registro de quién consultó o descargó documentos. **Es un requisito legal, no un
extra**: un expediente laboral contiene INE, CURP, NSS y examen médico, que son
datos personales sensibles bajo la LFPDPPP.

```js
const bitacoraSchema = new mongoose.Schema({
  usuarioId:     { type: ObjectId, ref: 'Usuario', required: true },
  usuarioNombre: { type: String, required: true },
  accion:        { type: String, enum: ['ver_documento', 'descargar_documento', 'exportar_reporte'], required: true },
  expedienteId:  { type: ObjectId, ref: 'Expediente', default: null },
  tipoDocumento: { type: String, enum: TIPOS_DOCUMENTO, default: null },
  version:       { type: Number, default: null },
  ip:            { type: String, default: null },
  userAgent:     { type: String, default: null },
  clienteId:     { type: ObjectId, ref: 'Cliente', default: null }
}, { timestamps: true });
```

Se escribe en cada emisión de URL firmada y en cada exportación de reporte.
Conservar mínimo 24 meses; es apropiado un índice TTL si se acuerda un plazo.

### 6.7 Índices

```js
// colaboradores
{ clienteId: 1, activo: 1, area: 1 }              // listado filtrado
{ clienteId: 1, email: 1 }                        // unique, sparse
{ nombre: 'text', puesto: 'text' }                // búsqueda

// expedientes
{ colaboradorId: 1 }                              // unique
{ clienteId: 1, updatedAt: -1 }                   // listado
{ clienteId: 1, 'documentos.estatus': 1 }         // métricas y alertas
{ 'documentos.vigenciaHasta': 1 }                 // job de vigencias

// usuarios
{ email: 1 }                                      // unique
{ clienteId: 1, active: 1 }

// plantillas_checklist
{ clienteId: 1, tiposContrato: 1, areas: 1 }      // resolución de plantilla

// bitacora_accesos
{ expedienteId: 1, createdAt: -1 }
{ usuarioId: 1, createdAt: -1 }
```

**Sobre la búsqueda por nombre:** el front busca ignorando acentos y
mayúsculas. Con índice de texto de MongoDB, configúralo con
`default_language: 'spanish'`. Si se resuelve con `$regex`, guarda además un
campo `nombreNormalizado` sin acentos y en minúsculas, y busca contra él —
un `$regex` con `$options: 'i'` sobre el nombre original **no** hace que "Gomez"
encuentre "Gómez", y eso el usuario sí lo nota.

---

## 7. Lógica de negocio

Estas reglas ya están implementadas y probadas en el front. **Replícalas al pie
de la letra**; las pruebas de `src/utils/__tests__/expediente.test.ts` y
`checklist.test.ts` describen los casos borde y sirven de referencia.

### 7.1 Generar el checklist (paso B del flujo)

Al crear un expediente:

1. Resolver la plantilla según el orden de especificidad de la sección 4.
2. Por cada renglón, crear un documento con `estatus: 'pending'`,
   `versiones: []`, y copiar `requerido` y `vigenciaMeses`.
3. Guardar en el expediente el `plantillaId` con el que se generó.

### 7.2 Re-sincronizar el checklist

Se dispara cuando cambia el **área** o el **tipo de contrato** del colaborador,
o cuando se **edita la plantilla** que usa el expediente.

Nunca se borra trabajo hecho:

- Documento que **está en la plantilla nueva**: se conserva con su estatus,
  archivo y versiones; sólo se actualizan `requerido` y `vigenciaMeses`.
- Documento que **no está en la plantilla nueva**:
  - si tiene versiones ⟹ **se conserva marcado `requerido: false`**;
  - si nunca se subió nada ⟹ se descarta.
- Documento **nuevo en la plantilla**: se agrega en `pending`.

### 7.3 Estatus efectivo de un documento

```
si estatus almacenado ≠ 'validated'  → devolver el estatus almacenado
si no hay vigenciaHasta              → 'validated'

dias = vigenciaHasta − hoy   (días completos, ambos a medianoche local)
  dias <  0   → 'expired'
  dias <= 30  → 'expiring'
  dias >  30  → 'validated'
```

Detalles que las pruebas verifican y que es fácil equivocar:

- **El día del vencimiento todavía cuenta como vigente**: `dias === 0` es
  `expiring`, no `expired`. Se vence al día siguiente.
- **El umbral es inclusivo**: exactamente 30 días es `expiring`; 31 es
  `validated`.
- **Lo que no está validado no vence**: un documento `in_review` con vigencia
  pasada sigue siendo `in_review`.
- El umbral de 30 días es una constante configurable
  (`DIAS_ALERTA_VENCIMIENTO`), pisable por cliente en fase 2.

### 7.4 Avance del expediente

```
requeridos  = documentos con requerido = true
entregados  = de los requeridos, los que quedan en 'validated' o 'expiring'
faltantes   = de los requeridos, los que quedan en 'pending'
porcentaje  = requeridos === 0 ? 100 : redondear(entregados / requeridos × 100)

enRevision  = TODOS los documentos en 'in_review'
rechazados  = TODOS los documentos en 'rejected'
porVencer   = TODOS los documentos en 'expiring'
vencidos    = TODOS los documentos en 'expired'
```

Dos asimetrías deliberadas:

- El **porcentaje sólo mira los requeridos**: un documento opcional sin subir no
  puede impedir que un expediente llegue al 100 %.
- Los **contadores de revisión y vigencia miran todos** los documentos, porque
  un opcional vencido también exige que alguien actúe.
- **Un documento por vencer sigue contando como entregado.** El checklist está
  completo; lo que pasa es que además hay que renovarlo.

`requeridos === 0` devuelve 100 y no divide entre cero.

### 7.5 Semáforo del expediente

En este orden exacto, de lo más urgente a lo más tranquilo:

```
vencidos > 0                → 'expired'
entregados < requeridos     → 'incomplete'
porVencer > 0               → 'expiring'
en otro caso                → 'complete'
```

### 7.6 Derivar alertas

Se recalculan en cada consulta, **nunca se almacenan**. Recorrer los
expedientes de **colaboradores activos** (los dados de baja no generan nada) y,
por cada documento:

| Estatus efectivo | Alerta |
| --- | --- |
| `expired` | `vencido` |
| `expiring` | `por_vencer` |
| `rejected` | `documento_rechazado` |
| `pending` **y requerido** | `documento_faltante` |
| `pending` y opcional | ninguna |
| `validated`, `in_review` | ninguna |

- **`id` estable entre recálculos:** `` `${expedienteId}:${tipoDocumento}:${tipoAlerta}` ``.
  El front lo usa como `key` de React; si cambia entre consultas, la lista
  parpadea.
- **Orden:** primero por severidad (`vencido` 0 → `documento_faltante` 3),
  después por `diasRestantes` ascendente, y a igualdad por nombre del
  colaborador con `localeCompare` en español.
- **`diasRestantes`** es negativo si ya venció y se omite si el documento no
  tiene vigencia.
- **`mensaje`** es texto listo para pintar, en español:
  - `vencido`: "Contrato de trabajo firmado venció hace 4 días."
  - `por_vencer`: "Examen médico de ingreso vence en 7 días." / "…vence hoy."
  - `documento_rechazado`: "CURP fue rechazado y hay que volver a subirlo."
  - `documento_faltante`: "Falta subir Alta ante el IMSS."

### 7.7 Vigencia sugerida al subir

El front propone una fecha; el servidor la valida:

- **`contrato`**: si el contrato es temporal, la vigencia es la
  `fechaTerminoContrato` del colaborador. Si es indeterminado, **no lleva
  vigencia**.
- **Los demás que caducan** (`examen_medico`): hoy + `vigenciaMeses` de la
  plantilla.
- Al sumar meses, **respetar el fin de mes**: 31 de enero + 1 mes = 28 (o 29) de
  febrero, no 3 de marzo.

### 7.8 Ciclo de vida de un documento

```
pending ──subir──▶ in_review ──validar──▶ validated ──(tiempo)──▶ expiring ──▶ expired
                        │                     │                       │           │
                        └──rechazar──▶ rejected                       │           │
                                          │                           │           │
                                          └────────── subir (nueva versión) ──────┘
```

Reglas del servidor:

- **Subir se permite desde cualquier estatus** (así se reemplaza un documento).
- **Validar y rechazar sólo desde `in_review`.** Desde cualquier otro estatus,
  `400`.
- **Rechazar exige motivo** de al menos 10 caracteres útiles.
- Al subir una versión nueva: numerarla `versiones.length + 1`, marcar
  `reemplazadaEn` en la anterior, insertarla **al inicio** del arreglo, poner el
  documento en `in_review` y **limpiar `motivoRechazo`, `revisadoPor` y
  `revisadoEn`** — el rechazo anterior no debe contaminar la entrega nueva.
- **Un colaborador dado de baja tiene el expediente en sólo lectura**: subir,
  validar y rechazar responden `400`.
- Si el documento **exige vigencia** y no viene `vigenciaHasta`, `400`.

---

## 8. Autenticación y permisos

### Sesión

JWT en el header `Authorization: Bearer <token>`. Expiración de 12 h, como en
`talentlink-backend`. El front guarda el token en `localStorage` y revalida con
`GET /auth/me` en cada arranque.

### Matriz de permisos

Es la sección 2 del flujo funcional del cliente. **El front ya la tiene en
`src/utils/permisos.ts`; el servidor debe imponerla, porque el front sólo apaga
botones.**

| Capacidad | `rh_admin` | `rh_consulta` | `jefe_area` |
| --- | :---: | :---: | :---: |
| Ver expedientes | ✓ | ✓ | Sólo su área |
| Alta y baja de colaboradores | ✓ | | |
| Subir / reemplazar documentos | ✓ | ✓ | |
| Validar o rechazar documentos | ✓ | | |
| Abrir documentos sensibles | ✓ | ✓ | |
| Configurar plantillas | ✓ | | |
| Generar reportes | ✓ | ✓ | |
| Administrar usuarios | ✓ | | |

**El jefe de área** ve el listado, el avance y el estatus de cada documento de
**su área**, incluido el historial de versiones con sus metadatos. Lo que no
puede es **abrir el archivo** de un documento marcado como sensible: para él no
se emite URL firmada (`403`).

Combinación de filtros para un jefe de área de un cliente: se aplican **los
dos** — su cliente **y** su área.

### Contraseñas

Reglas actuales, que el front ya replica en
`src/utils/user-validation.ts`: mínimo 8 caracteres, con mayúscula, minúscula,
dígito y uno de `!@#$%^&*`.

El nombre de usuario acepta hoy `/^[a-zA-Z\s-]+$/`, **sin acentos ni ñ**. Es una
limitación heredada del backend prestado y **conviene corregirla** en el backend
propio a `/^[\p{L}\s'-]+$/u`: hay gente que se llama Muñoz. Si se cambia,
avísame para relajar la validación del front.

---

## 9. API

Base: `/api/v1`. Todas las rutas exigen sesión salvo `POST /auth/login`.
Todas pasan por el middleware de alcance de la sección 4.

En los ejemplos se muestra **sólo el contenido de `data`**; recuerda envolverlo.

### 9.1 Autenticación

#### `POST /auth/login`

```jsonc
// petición
{ "email": "marisol@urbacames.com", "password": "Urbacames1!" }

// data
{
  "user": { /* AuthUser, ver abajo */ },
  "token": "eyJhbGciOi…"
}
```

**`AuthUser`** — forma exacta que el front espera hoy:

```ts
{
  _id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';        // ⚠️ ver nota de migración
  active: boolean;
  createdAt: string;             // ISO
  updatedAt: string;
}
```

> **Nota de migración importante.** El front todavía recibe `role: 'user' |
> 'admin'` y lo traduce a nivel de acceso en `src/utils/access-level.ts`
> (`admin` → `rh_admin`, `user` → `rh_consulta`), porque el backend prestado no
> conoce más. **El backend nuevo debe devolver además estos campos:**
>
> ```ts
> nivelAcceso: 'rh_admin' | 'rh_consulta' | 'jefe_area';
> area: Area | null;             // sólo para jefe_area
> alcance: 'interno' | 'cliente';
> clienteId: string | null;
> ```
>
> Manda **los dos**: `role` por compatibilidad durante la transición
> (`rh_admin` → `admin`, el resto → `user`) y `nivelAcceso` como fuente real.
> Cuando esté disponible, en el front se borra el mapeo y se lee `nivelAcceso`
> directo. Es un cambio de tres líneas, pero hasta entonces **el jefe de área no
> puede existir de verdad**.

#### `GET /auth/me`

```jsonc
// data
{ "user": { /* AuthUser */ } }
```

Token inválido o expirado ⟹ `401`. El front limpia la sesión y manda a login.

#### `POST /auth/logout`

`200` con `data: null`. El front lo llama sin esperar respuesta.

#### `POST /auth/cambiar-password` — *falta hoy, hace falta*

```jsonc
{ "passwordActual": "…", "passwordNueva": "…" }
```

`400` si la actual no coincide o la nueva no cumple las reglas.

#### `POST /auth/recuperar` y `POST /auth/restablecer` — *deseable*

Hoy, si alguien olvida su contraseña, sólo un administrador puede reponerla.
Flujo estándar con token de un solo uso y caducidad corta. **Responder siempre
`200` aunque el correo no exista**, para no revelar qué cuentas hay.

### 9.2 Usuarios

Todas exigen `nivelAcceso: 'rh_admin'`.

#### `GET /usuarios`

Query: `?incluirInactivos=true` (por defecto `false`), `?busqueda=`.

```jsonc
// data
{ "usuarios": [ /* AuthUser[] */ ] }
```

> **Corrige una limitación actual.** Hoy `GET /users` devuelve sólo los activos,
> así que un usuario dado de baja desaparece y **no hay forma de reactivarlo**
> desde la interfaz. Con `incluirInactivos` se resuelve.

#### `POST /usuarios` → `201`

```jsonc
{
  "name": "Claudia Serrano",
  "email": "claudia@urbacames.com",
  "password": "Urbacames1!",
  "nivelAcceso": "rh_consulta",
  "area": null,                  // obligatoria si nivelAcceso = jefe_area
  "alcance": "interno",
  "clienteId": null
}
// data: { "usuario": { /* AuthUser */ } }
```

`400` si el correo ya existe. **No devuelvas token**: esto es un alta hecha por
un administrador, no un registro.

#### `PATCH /usuarios/:id`

Acepta `name`, `email`, `nivelAcceso`, `area`, `alcance`, `clienteId`.
Cualquier otro campo ⟹ `400` con la lista de campos no permitidos. La
contraseña **no** se cambia por aquí.

#### `DELETE /usuarios/:id` → `204`

Baja lógica (`active: false`). **Un administrador no puede darse de baja a sí
mismo** ⟹ `400`. Tampoco se puede dejar al sistema sin ningún `rh_admin` activo.

#### `PATCH /usuarios/:id/reactivar`

Devuelve el usuario con `active: true`.

### 9.3 Expedientes

#### `GET /expedientes`

Query, todos opcionales y combinables:

| Parámetro | Tipo | Nota |
| --- | --- | --- |
| `busqueda` | string | Nombre, puesto o correo. Ignora acentos y mayúsculas |
| `area` | `Area` | Para un jefe de área se fuerza a la suya |
| `estatus` | `RecordStatus` | Se filtra **después** de calcular el avance |
| `tipoContrato` | `TipoContrato` | |
| `incluirInactivos` | boolean | Por defecto `false` |

```jsonc
// data
{
  "expedientes": [
    {
      "_id": "665f…",
      "colaborador": { /* Colaborador completo */ },
      "avance": {
        "requeridos": 12, "entregados": 9, "porcentaje": 75,
        "faltantes": 2, "enRevision": 1, "rechazados": 0,
        "porVencer": 1, "vencidos": 0,
        "estatus": "incomplete"
      },
      "updatedAt": "2026-08-19T18:04:11.000Z"
    }
  ]
}
```

**Orden por defecto:** severidad del estatus (`expired` 0, `incomplete` 1,
`expiring` 2, `complete` 3), luego porcentaje ascendente, luego nombre con
`localeCompare` español. Lo urgente primero.

> **Paginación.** Hoy no la hay y el front pinta todo. Con 300 colaboradores
> hace falta. **Decídelo antes de implementar**: si va a existir, que
> `data` sea `{ expedientes, total, pagina, porPagina }` desde la primera
> versión, y avísame para agregar el control en el front. Cambiarlo después es
> un cambio incompatible.

#### `GET /expedientes/:id`

```jsonc
// data
{
  "expediente": {
    "_id": "665f…",
    "colaborador": { /* Colaborador completo, no sólo el id */ },
    "plantillaId": "665a…",
    "documentos": [ /* DocumentoExpediente[] con estatus ya derivado */ ],
    "createdAt": "…", "updatedAt": "…"
  }
}
```

**El colaborador va embebido en la respuesta**, no como referencia: el front
pinta la ficha y el checklist en la misma pantalla y no quiere una segunda
llamada.

Fuera del alcance del usuario ⟹ `404`, no `403`.

#### `POST /expedientes` → `201`

Crea colaborador y expediente juntos, en una transacción.

```jsonc
{
  "nombre": "Roberto Aguilar Sosa",
  "puesto": "Auxiliar Administrativo",
  "area": "administracion",
  "tipoContrato": "indeterminado",
  "fechaIngreso": "2026-08-01",
  "fechaTerminoContrato": null,
  "email": "raguilar@urbacames.com",
  "telefono": "33 1111 2222"
}
// data: { "expediente": { /* Expediente con el checklist ya generado */ } }
```

Validar según 6.3, generar el checklist según 7.1. `clienteId` **no viene en el
cuerpo**: lo pone el servidor según quién crea.

#### `PATCH /expedientes/:id/colaborador`

Mismo cuerpo que la creación. Si cambian `area` o `tipoContrato`, re-sincronizar
el checklist (7.2) y actualizar `plantillaId`. Devuelve el expediente completo.

#### `PATCH /expedientes/:id/estado`

```jsonc
{ "activo": false, "motivo": "Renuncia voluntaria" }
```

Dar de baja exige motivo (`400` si falta) y sella `fechaBaja`. Reactivar limpia
ambos. Devuelve el expediente completo.

### 9.4 Documentos

#### `POST /expedientes/:id/documentos/:tipo`

**`multipart/form-data`:**

| Campo | Tipo | Nota |
| --- | --- | --- |
| `archivo` | File | PDF, JPG, PNG o WEBP · máximo 10 MB |
| `vigenciaHasta` | string | `YYYY-MM-DD`. Obligatorio si el documento caduca |

Valida el `mime` **por contenido, no por la extensión ni por el header que manda
el cliente**: es un archivo subido por un usuario y el `Content-Type` es
manipulable. Rechaza con `415` lo que no sea PDF o imagen, y con `413` lo que
pase de 10 MB.

Aplica 7.8: nueva versión, documento en `in_review`, limpiar el rechazo previo.
Devuelve el expediente completo, ya recalculado.

#### `POST /expedientes/:id/documentos/:tipo/validar`

Sin cuerpo. Sólo desde `in_review`. Sella `revisadoPor` (nombre de quien valida)
y `revisadoEn`, en el documento y en `versiones[0]`.

#### `POST /expedientes/:id/documentos/:tipo/rechazar`

```jsonc
{ "motivo": "La foto está borrosa y no se lee el número." }
```

Mínimo 10 caracteres. Sólo desde `in_review`.

#### `GET /expedientes/:id/documentos/:tipo/versiones/:version/url`

```jsonc
// data
{ "url": "https://…r2…?X-Amz-Signature=…", "expiraEn": "2026-08-19T18:14:11.000Z" }
```

- URL firmada, **caducidad de 10 minutos**.
- `403` si el documento es sensible y quien pide es `jefe_area`.
- **Escribe en `bitacora_accesos` en cada emisión.** Es el punto donde se
  registra quién vio qué.

### 9.5 Alertas y métricas

#### `GET /alertas`

Query: `?tipo=<AlertType>&area=<Area>`.

```jsonc
// data
{
  "alertas": [
    {
      "id": "665f…:examen_medico:por_vencer",
      "tipo": "por_vencer",
      "expedienteId": "665f…",
      "colaboradorNombre": "Ricardo Montalvo Cruz",
      "colaboradorPuesto": "Residente de Obra",
      "area": "obra",
      "tipoDocumento": "examen_medico",
      "diasRestantes": 12,
      "vigenciaHasta": "2026-08-31",
      "mensaje": "Examen médico de ingreso vence en 12 días."
    }
  ]
}
```

Derivadas según 7.6, nunca almacenadas.

#### `GET /dashboard/metricas`

```jsonc
// data
{
  "metricas": {
    "colaboradoresActivos": 13,
    "expedientesCompletos": 6,
    "expedientesIncompletos": 7,
    "avancePromedio": 84,
    "documentosEnRevision": 2,
    "documentosPorVencer": 2,
    "documentosVencidos": 1,
    "alertasActivas": 11
  }
}
```

Sólo cuenta colaboradores **activos**. `avancePromedio` es el promedio simple de
los porcentajes, redondeado a entero.

### 9.6 Plantillas de checklist

#### `GET /plantillas-checklist`

```jsonc
// data
{ "plantillas": [ /* PlantillaChecklist[] */ ] }
```

Para un usuario de cliente: las suyas más las globales.

#### `PATCH /plantillas-checklist/:id`

```jsonc
{ "documentos": [ { "tipo": "ine", "requerido": true }, … ] }
```

Exige `rh_admin` y al menos un documento requerido (`400`). Tras guardar,
**re-sincroniza todos los expedientes que usan la plantilla** (7.2) — es la parte
que se olvida y deja los checklists desfasados.

`POST` y `DELETE` de plantillas no hacen falta todavía; las cuatro base vienen
sembradas. Cuando existan, `esBase: true` no se puede borrar.

### 9.7 Reportes

#### `GET /reportes/expedientes`

Mismos filtros que `GET /expedientes`.

```jsonc
// data
{
  "reporte": {
    "generadoEn": "2026-08-19T18:20:00.000Z",
    "resumen": {
      "total": 13, "completos": 6, "incompletos": 7,
      "conVencidos": 1, "conPorVencer": 2, "avancePromedio": 84
    },
    "expedientes": [ /* una fila por expediente */ ],
    "documentos": [ /* una fila por documento */ ]
  }
}
```

Filas planas, con las **etiquetas ya traducidas al español** (`"Obra"`, no
`"obra"`; `"Validado"`, no `"validated"`) porque van directo al Excel:

```ts
FilaReporteExpediente = {
  colaborador, puesto, area, tipoContrato, fechaIngreso,
  estado,                    // "Activo" | "Baja"
  estatusExpediente,         // "Completo" | "Incompleto" | "Por vencer" | "Vencido"
  avance,                    // number 0-100
  documentosRequeridos, documentosEntregados,
  faltantes, enRevision, rechazados, porVencer, vencidos
}

FilaReporteDocumento = {
  colaborador, area, documento,
  requerido,                 // "Sí" | "No"
  estatus, vigenciaHasta,    // "" si no aplica
  archivo, subidoPor, revisadoPor, motivoRechazo,
  versiones                  // number
}
```

El Excel lo arma el front. Registrar la exportación en `bitacora_accesos`.

Ordenar por nombre del colaborador, no por urgencia: es un documento de
auditoría y se lee alfabéticamente.

### 9.8 Clientes — *fase 2, no implementar todavía*

Se listan para que las rutas estén reservadas y nadie las ocupe con otra cosa:
`GET /clientes` · `POST /clientes` · `PATCH /clientes/:id` ·
`PATCH /clientes/:id/estado`. Sólo para `alcance: 'interno'` y `rh_admin`.

---

## 10. Almacenamiento de archivos

`talentlink-backend` ya usa **Cloudflare R2** con URLs firmadas
(`@aws-sdk/client-s3` + `s3-request-presigner`, variables `R2_ACCOUNT_ID`,
`R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_SIGNED_URL_TTL`).
Reutiliza ese servicio.

**El bucket es privado.** Nunca se expone una URL pública: cada apertura pasa por
`GET …/url`, que valida permisos, firma por 10 minutos y deja registro.

Convención de claves, que hace obvio a quién pertenece cada archivo y facilita
borrar todo lo de un colaborador:

```
expedientes/{clienteId|casa}/{colaboradorId}/{tipoDocumento}/v{version}-{uuid}.{ext}
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

## 11. Trabajos programados

### Job diario de vigencias

Una vez al día, temprano (06:00 hora de México):

1. Recorrer los expedientes de colaboradores **activos**.
2. Derivar el estatus efectivo de cada documento (7.3).
3. Agrupar por destinatario y **enviar un solo correo resumen** con lo que
   vence pronto y lo que ya venció.

**No escribas `expiring` ni `expired` en la base.** El job notifica; no cambia
estado. El estatus se sigue derivando al leer.

**Manda un correo por persona, no uno por alerta.** Con 300 colaboradores, un
correo por documento vencido es un buzón inservible y la gente deja de leerlos.

Destinatarios en fase 1: los usuarios `rh_admin` y `rh_consulta` activos. En
fase 2, los del cliente correspondiente. Conviene que sea configurable.

`talentlink-backend` ya tiene servicio de correo (Mailjet en producción,
Mailtrap en desarrollo): reutilízalo.

### Idempotencia

Si el job corre dos veces el mismo día, no debe mandar dos correos. Lleva
registro del último envío por destinatario y día.

---

## 12. Migración desde el backend prestado

Hoy el front autentica contra `talentlink-backend`, compartido con Humenta. Al
tener backend propio:

1. **Migrar los usuarios de Urbacames.** En esa base conviven usuarios de
   Humenta y de otros proyectos: hay que seleccionar sólo los que correspondan.
   Las contraseñas ya están hasheadas con bcrypt y el hash se puede copiar tal
   cual, así que nadie tiene que restablecerla.
2. **Asignar `nivelAcceso`** a cada uno: `admin` → `rh_admin`, `user` →
   `rh_consulta`. Los jefes de área se dan de alta a mano con su `area`.
3. **Poner `alcance: 'interno'` y `clienteId: null`** en todos.
4. **Cambiar `VITE_API_BASE_URL`** en el front y apagar `VITE_USE_MOCKS`.
5. Sustituir en el front las cuatro llamadas a `endpointPendiente(...)` por
   `request(...)`. Está marcado en el código y son los únicos cuatro archivos
   que cambian:
   `src/modules/{expedientes,alertas,configuracion,reportes}/*-service.ts`.

No hay datos de expedientes que migrar: los actuales son de demostración y viven
en el navegador de cada quien.

---

## 13. Criterios de aceptación

Lista para verificar antes de dar por terminado el backend. Cada punto es una
prueba automatizada.

**Contrato**
- [ ] Todas las respuestas usan el envelope `{ status, message?, data }` con los
      datos anidados bajo llave nombrada.
- [ ] Las fechas de calendario se devuelven como `YYYY-MM-DD` y las marcas de
      tiempo en ISO completo.
- [ ] Los campos opcionales ausentes salen como `null` u omitidos, nunca `""`.
- [ ] Los errores de validación traen `errors[0].msg` en español.

**Multi-cliente**
- [ ] Un usuario con `alcance: 'cliente'` no obtiene datos de otro cliente en
      **ninguna** ruta: listado, detalle, alertas, métricas, reportes y URL de
      archivo.
- [ ] Pedir un expediente de otro cliente responde `404`, no `403`.
- [ ] Mandar `clienteId` en el cuerpo o en el query string no cambia el alcance.
- [ ] Todo lo que se crea en fase 1 queda con `clienteId: null`.

**Lógica de dominio**
- [ ] Un documento con vigencia **hoy** es `expiring`; con vigencia **ayer**,
      `expired`.
- [ ] Exactamente 30 días es `expiring`; 31 es `validated`.
- [ ] Un documento `in_review` con vigencia pasada sigue `in_review`.
- [ ] Un checklist sin documentos requeridos da 100 % y no divide entre cero.
- [ ] Un documento opcional vencido pone el expediente en `expired` aunque el
      avance sea 100 %.
- [ ] Un colaborador dado de baja no genera ninguna alerta.
- [ ] Un documento opcional sin subir no genera alerta de faltante.
- [ ] El `id` de una alerta es idéntico en dos consultas seguidas.
- [ ] Cambiar el área de un colaborador conserva los documentos ya entregados,
      marcándolos opcionales si la plantilla nueva no los pide.
- [ ] Editar una plantilla re-sincroniza los expedientes que la usan.
- [ ] Reemplazar un documento crea la versión 2, marca `reemplazadaEn` en la 1 y
      **limpia el `motivoRechazo` anterior**.

**Permisos**
- [ ] `rh_consulta` puede subir pero recibe `403` al validar o rechazar.
- [ ] `jefe_area` recibe `403` al pedir la URL de un documento sensible, y `200`
      con el historial de metadatos del mismo documento.
- [ ] `jefe_area` sólo ve expedientes de su área.
- [ ] Validar o rechazar algo que no está `in_review` responde `400`.
- [ ] Subir a un expediente de un colaborador dado de baja responde `400`.

**Archivos**
- [ ] Un archivo que no es PDF ni imagen se rechaza aunque el `Content-Type`
      diga lo contrario.
- [ ] Más de 10 MB responde `413`.
- [ ] Las URLs firmadas caducan y quedan registradas en la bitácora.

---

## 14. Preguntas abiertas

Cuatro decisiones que están tomadas por defecto en el front y que conviene
confirmar con Urbacames antes de cerrarlas en el backend:

1. **Umbral de aviso de vencimiento.** Hoy 30 días. El flujo del cliente no lo
   especifica.
2. **Qué documentos son sensibles.** Se marcaron ocho de los doce (sección 5).
3. **A quién llegan los correos de alerta** y con cuánta anticipación.
4. **Si el colaborador sube sus propios documentos** o siempre lo hace RH. Si la
   respuesta es que sí, hace falta un cuarto nivel de acceso y un flujo de
   invitación por token, y eso **sí** cambia el modelo de usuarios. Conviene
   preguntarlo antes de empezar.

---

## Referencias en el repositorio del front

| Qué | Dónde |
| --- | --- |
| Flujo funcional original del cliente | `docs/flujo-expedientes.md` |
| Capa simulada y tabla de endpoints | `docs/mocks.md` |
| Contratos TypeScript exactos | `src/interfaces/` |
| Valores de los enums | `src/enums/` |
| Avance, semáforo, vigencias, alertas | `src/utils/expediente.ts` |
| Generación y sincronización del checklist | `src/utils/checklist.ts` |
| Matriz de permisos | `src/utils/permisos.ts` |
| Plantillas base sembradas | `src/mocks/plantillas.ts` |
| Casos borde probados | `src/utils/__tests__/`, `src/mocks/__tests__/` |
