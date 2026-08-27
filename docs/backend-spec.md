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

---

## 1. Contexto y estado

Urbacames gestiona los expedientes laborales de su personal: un checklist de
documentos por persona, con carga de archivos, validación, control de vigencias,
alertas y reportes de auditoría. La plataforma aloja **varias empresas** del
grupo, que comparten catálogos de empleados, clientes y categorías.

El front está construido y funcionando contra una capa de datos simulada. **Toda
la lógica de dominio —avance, semáforo, vigencias, alertas, checklist— está
implementada y probada ahí**, y debe replicarse en el servidor: el front sólo
apaga botones, la autoridad es el backend.

### Qué existe hoy

| Pieza | Estado |
| --- | --- |
| `/auth` — login, sesión, cambio de contraseña | **Implementado** |
| `/usuarios` — CRUD de accesos | **Implementado**, pero se reubica (ver §10) |
| Empresas, empleados, clientes, categorías | Por construir |
| Adscripciones, carteras, asignaciones | Por construir |
| Expedientes, documentos, alertas, reportes | Por construir |
| Archivos en R2, job de vigencias, correos | Por construir |

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
    alcanceMiddleware.js       ← Filtro por empresa (modelo-datos.md §8)
    validateRequest.js
    errorHandler.js
  services/                    Correo, almacenamiento, jobs
  utils/
    dominio/                   ← Lógica de expedientes (modelo-datos.md §6)
  validations/
```

**Los controladores no llevan lógica de negocio.** Las reglas de dominio
([`modelo-datos.md` §6](./modelo-datos.md)) viven en `utils/dominio/` y se prueban solas, sin HTTP de por medio. El front ya
tiene esas mismas funciones probadas en `src/utils/expediente.ts` y
`src/utils/checklist.ts`: **son la referencia de comportamiento, cópialas.**

---

---

## 4. Enumeraciones

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
| Esquemas de Mongoose de las 12 colecciones | §5 |
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
  ultimoAccesoEn: string | null;
  createdAt: string;
  updatedAt: string;
}
```

Desaparecen `role`, `alcance`, `clienteId` y `area` (que era una sola).

> **Cambio incompatible con el front actual.** El front lee hoy `role`, `area` y
> `alcance`. Avisen cuando lo desplieguen y se ajusta en la misma ventana; son
> pocas líneas, pero hay que coordinarlo.

`POST /auth/recuperar` y `/restablecer` siguen pendientes: hoy sólo un
`rh_admin` puede reponer una contraseña.

### 6.2 Catálogos compartidos

Sólo `alcanceGlobal` da de alta en ellos. Cualquiera con sesión puede leerlos,
filtrados por su alcance donde aplique.

#### Empleados

| Método | Ruta | Nota |
| --- | --- | --- |
| `GET` | `/empleados` | Paginado. Ver parámetros abajo |
| `POST` | `/empleados` | Crea la persona **y su expediente**, en transacción |
| `GET` `PATCH` | `/empleados/:id` | |
| `PATCH` | `/empleados/:id/estado` | `{ activo, motivo }` — baja **del sistema** |
| `GET` | `/empleados/:id/expediente` | Siempre existe |
| `GET` | `/empleados/:id/adscripciones` | Sus empresas |
| `GET` | `/empleados/:id/asignaciones` | Sus proyectos, activos e históricos |

Parámetros de `GET /empleados`:

| Parámetro | Nota |
| --- | --- |
| `busqueda` | **Por nombre o número de empleado** (D-51). Ignora acentos y mayúsculas, coincidencia parcial |
| `empresaId` | Filtra dentro del alcance; nunca lo amplía |
| `area` | Áreas de la adscripción, no del empleado |
| `proyectoId` | Con asignación activa a ese proyecto |
| ~~`tipo`~~ | **Se fue en D-59**: el filtro lo reemplazan las áreas y el tipo sale del puesto |
| `soloConAcceso` | Los que entran a la plataforma |
| `activo` | `true` (defecto, sólo activos) \| `false` (sólo bajas) \| `todos` (D-51) |
| `orden` | `nombre_asc` (defecto) \| `nombre_desc` \| `numero_asc` \| `numero_desc` (D-51). `numero_*` no requiere `empresaId` (D-53): ordena por `empleado.numeroEmpleado` —de la persona, uno por renglón desde D-54— y los que no tienen número van al final en los dos sentidos |
| `pagina` `porPagina` | Empieza en 1; 25 por defecto |

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

#### Clientes y categorías

| Método | Ruta | Nota |
| --- | --- | --- |
| `GET` `POST` | `/clientes` | Catálogo global. `?busqueda=` |
| `GET` `PATCH` | `/clientes/:id` | |
| `PATCH` | `/clientes/:id/estado` | Falla si tiene proyectos en curso |
| `GET` `POST` | `/categorias` | `POST` **idempotente por nombre**: si ya existe, devuelve la existente en vez de fallar |
| `PATCH` | `/categorias/:id/estado` | Falla si hay empleados o proyectos usándola |

### 6.3 Empresas y vínculos

| Método | Ruta | Nota |
| --- | --- | --- |
| `GET` | `/empresas` | Las del alcance del usuario |
| `GET` | `/organizacion` | Árbol empresa → áreas (sólo administrativos) y proyectos |

#### Adscripciones — empresa ↔ empleado

| Método | Ruta | Cuerpo |
| --- | --- | --- |
| `GET` | `/empresas/:id/adscripciones` | `?activo=&area=` |
| `POST` | `/empresas/:id/adscripciones` | `{ empleadoId, areas[], tipoContrato, fechaIngreso, fechaTerminoContrato? }` |
| `PATCH` | `/adscripciones/:id` | Mismos campos |
| `PATCH` | `/adscripciones/:id/estado` | `{ activo, motivo }` — baja **de esa empresa** |

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
| `POST` | `/proyectos/:id/asignaciones` | `{ empleadoId, categoriaId, fechaAsignacion }` |
| `PATCH` | `/asignaciones/:id/salida` | `{ fechaSalida }` — cierra, no borra |

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

### 6.5 Expedientes y documentos

| Método | Ruta | Nota |
| --- | --- | --- |
| `GET` | `/expedientes` | Paginado. Mismos filtros que empleados, más `estatus` |
| `GET` | `/expedientes/:id` | Con el empleado embebido |
| `POST` | `/expedientes/:id/documentos/:tipo` | `multipart`: `archivo` + `vigenciaHasta?` |
| `POST` | `…/:tipo/validar` | Sin cuerpo |
| `POST` | `…/:tipo/rechazar` | `{ motivo }`, mínimo 10 caracteres |
| `GET` | `…/:tipo/versiones/:v/url` | URL firmada, 10 min. Registra en bitácora |

Ciclo del documento:

```
pending ──subir──▶ in_review ──validar──▶ validated ──(tiempo)──▶ expiring ──▶ expired
                        │                     │                       │           │
                        └──rechazar──▶ rejected                       │           │
                                          │                           │           │
                                          └────────── subir (nueva versión) ──────┘
```

- **Subir se permite desde cualquier estatus** (así se reemplaza).
- **Validar y rechazar sólo desde `in_review`**; desde otro estatus, `400`.
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
  imagen, `413` si pasa de 10 MB.

### 6.6 Alertas, métricas y reportes

| Método | Ruta | `data` |
| --- | --- | --- |
| `GET` | `/alertas` | `{ alertas }` — `?tipo=&empresaId=&area=&origen=` |
| `GET` | `/dashboard/metricas` | `{ metricas }` — `?empresaId=` |
| `GET` | `/reportes/expedientes` | `{ reporte }` — mismos filtros que expedientes |

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
- [ ] `rh_consulta` puede subir pero recibe `403` al validar o rechazar.
- [ ] `jefe_area` recibe `403` al pedir la URL de un documento sensible, y `200`
      con el historial de metadatos del mismo documento.
- [ ] `jefe_area` sólo ve expedientes de su área.
- [ ] Validar o rechazar algo que no está `in_review` responde `400`.
- [ ] Subir a un expediente de un empleado dado de baja del sistema responde
      `400`; una baja de una sola adscripción **no** lo bloquea.

**Archivos**
- [ ] Un archivo que no es PDF ni imagen se rechaza aunque el `Content-Type`
      diga lo contrario.
- [ ] Más de 10 MB responde `413`.
- [ ] Las URLs firmadas caducan y quedan registradas en la bitácora.

---

---

## 10. Migración de lo ya implementado

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

Sólo la primera bloquea algo; las demás son una constante o una lista.

1. **¿El expediente se comparte entre empresas del grupo?** Este modelo dice que
   sí: es de la persona. Si Urbacames necesita uno por empresa, cambia el modelo
   y hay que saberlo **antes** de implementar expedientes.
   Ver [`modelo-datos.md` §2.1](./modelo-datos.md).
2. **¿La CURP es obligatoria desde el alta?** Determina si el índice es `unique`
   o `unique + sparse`. Ver [`modelo-datos.md` §5.2](./modelo-datos.md).
3. Umbral de vencimiento de documentos: hoy 30 días.
4. Qué documentos son sensibles: hoy 8 de los 12.
5. A quién llegan los correos de alerta.

---

## 12. Orden de implementación sugerido

Cada paso deja algo verificable. El front sigue con datos simulados hasta el
final, así que nada de esto lo bloquea.

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
| Flujo funcional original del cliente | [`flujo-expedientes.md`](./flujo-expedientes.md) |
| Qué está implementado hoy y cómo probarlo | [`backend-actual.md`](./backend-actual.md) |
| Capa simulada del front | [`mocks.md`](./mocks.md) |
| Contratos TypeScript y enums | `src/interfaces/`, `src/enums/` |
| Lógica de dominio ya probada | `src/utils/expediente.ts`, `src/utils/checklist.ts` |
| Casos borde cubiertos | `src/utils/__tests__/`, `src/mocks/__tests__/` |
