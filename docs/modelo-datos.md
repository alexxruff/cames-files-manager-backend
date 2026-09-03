# Modelo de datos — Plataforma de Expedientes (Urbacames)

> **Documento autoritativo del modelo.** Define **qué se guarda y cómo se
> relaciona**. Su complemento es [`backend-spec.md`](./backend-spec.md), que
> define **cómo se habla** con el backend: envelope, códigos, errores y rutas.
> Los dos juntos son lo que necesita el equipo de backend.
>
> Escrito para implementarse en **MongoDB con Mongoose**. Asume criterio senior:
> justifica las decisiones de modelado en vez de sólo listar campos, y señala
> dónde están los riesgos.
>
> Estado del front: **ya migró.** La sección 11 lista lo que asumía del modelo
> anterior (empleados y clientes con `empresaId` propio) y se conserva porque
> explica por qué el modelo quedó así, no como trabajo pendiente.
>
> **Este archivo es del backend** (29 ago 2026) y se mantiene aquí, en
> `cames-files-manager-backend/docs/`. **Es la única versión**: la copia que el
> front tenía se reconcilió contra ésta y contra el código el 31 ago 2026 —cada
> diferencia y qué se decidió, en
> [`RECONCILIACION-DOCS.md`](./RECONCILIACION-DOCS.md)—. Cuando cambie un
> esquema, se actualiza en el mismo cambio que el código, como
> `ARQUITECTURA-DATOS.md`.
>
> ⚠️ **Es el diseño y su porqué, no el inventario de lo que existe.** El modelo
> derivó desde D-27 (las áreas son un catálogo, el número de trabajador es de la
> persona, el tipo se deriva del puesto, hay jefaturas de área). Para saber
> **qué hay hoy y qué se rompe al tocarlo**, `ARQUITECTURA-DATOS.md`; donde los
> dos discrepen, manda ése.

---

## 1. La jerarquía

```mermaid
flowchart TD
    subgraph catalogos["Catálogos compartidos — no pertenecen a ninguna empresa"]
        CLI[("Clientes")]
        EMP[("Empleados")]
        CAT[("Categorías")]
    end

    E1["Empresa 1"]
    E2["Empresa 2"]

    CLI -->|se vincula| C1["Cliente en Empresa 1"]
    CLI -->|se vincula| C2["Cliente en Empresa 2"]
    E1 --> C1
    E2 --> C2

    C1 --> P1["Proyecto 1"]
    C1 --> P2["Proyecto 2"]
    C2 --> P3["Proyecto 1"]
    C2 --> P4["Proyecto 2"]

    E1 -->|adscripción| A1["Administrativos de Empresa 1"]
    E2 -->|adscripción| A2["Administrativos de Empresa 2"]
    EMP --> A1
    EMP --> A2

    EMP -->|asignación| P1
    EMP -->|asignación| P2
    EMP -->|asignación| P3
    EMP -->|asignación| P4

    EMP -->|1 a 1| EX{{"Expediente"}}
```

Leído en palabras:

1. **Empresas, empleados y clientes son tres colecciones independientes.** Ninguna
   contiene a la otra.
2. **La empresa lleva la estructura.** Es el ancla organizativa: sus áreas, sus
   proyectos, su gente.
3. **Un empleado no es exclusivo de una empresa: se le vincula.** Puede estar en
   una o en varias.
4. **El listado de clientes es común a todas las empresas.** Cada empresa lo usa
   de forma independiente, pero sale del mismo lugar.
5. **El proyecto sí pertenece a una empresa**, y no puede existir sin un cliente
   vinculado. Un mismo cliente puede tener uno o más proyectos **por empresa**.
6. **Los proyectos tienen empleados**, tomados del mismo listado global y
   vinculados al proyecto.
7. **Cada empleado tiene un expediente, y sólo uno**, sin importar en cuántas
   empresas o proyectos esté.

---

## 2. Las tres decisiones que definen el modelo

Antes de los esquemas, lo que hay que entender para no implementar otra cosa.

### 2.1 El expediente es de la persona, no del empleo

Un empleado que trabaja para Urbacames Edificación y para Urbacames
Infraestructura **tiene un solo expediente**. Su INE es su INE en las dos.

Consecuencias que hay que asumir de forma deliberada:

- **El beneficio:** no se vuelve a pedir el mismo documento cada vez que la
  persona se mueve entre empresas del grupo. Es la razón de ser del catálogo
  compartido.
- **El precio:** las dos empresas ven los mismos documentos. Si eso fuera
  inaceptable para el cliente, el modelo tendría que cambiar a un expediente por
  vínculo laboral. **Confirmar con Urbacames antes de implementar** — está en la
  sección 12.
- **El checklist se resuelve por unión.** Si en una empresa es administrativo y
  en otra es personal de obra, su expediente pide **lo que exijan las dos
  plantillas**, tomando siempre la condición más estricta (requerido gana a
  opcional; la vigencia más corta gana). Ver 6.2.

### 2.2 La relación laboral vive en el vínculo, no en el empleado

`tipoContrato`, `fechaIngreso`, `fechaTerminoContrato`, las áreas y la baja
**no son atributos de la persona**: son atributos de su relación con una empresa
concreta. Una persona puede tener contrato indeterminado en una y por obra
determinada en otra.

Por eso existe la colección `adscripciones`. Poner esos campos en `empleados`
—como está hoy en el front— hace imposible el escenario que pide el diagrama.

### 2.3 Quién ve qué se deriva de los vínculos

Con empleados y clientes globales, el filtro por inquilino **ya no es un campo
en el documento**. Un usuario ve:

- Las empresas donde tiene adscripción activa.
- Los empleados adscritos a esas empresas, o asignados a proyectos de esas
  empresas.
- Los clientes en la cartera de esas empresas.
- Los proyectos de esas empresas.

Un **administrador de plataforma** (`acceso.alcanceGlobal: true`) ve todo y es
quien administra los catálogos compartidos. Detalle en la sección 8.

---

## 3. Mapa de colecciones

Las **17 que existen hoy**. Las tres que van antes de `machines` llegaron
después de escribir este documento y no tienen sección propia en §5: su detalle
está en [`ARQUITECTURA-DATOS.md`](./ARQUITECTURA-DATOS.md).

| Colección | Naturaleza | Pertenece a | Esquema |
| --- | --- | --- | --- |
| `companies` | Entidad raíz | — | §5.1 |
| `employees` | **Catálogo compartido** | — | §5.2 |
| `clients` | **Catálogo compartido** | — | §5.3 |
| `categories` | **Catálogo compartido** | — | §5.4 |
| `checklist_templates` | Configuración | — (o empresa, ver 5.7) | §5.7 |
| `records` | 1 a 1 con empleado | Empleado | §5.6 |
| `projects` | Entidad de la empresa | Empresa + Cliente | §5.5 |
| `contracts` | Las fases del proyecto | Proyecto | §5.5b |
| `affiliations` | **Vínculo** empresa ↔ empleado | — | §5b.1 |
| `portfolios` | **Vínculo** empresa ↔ cliente | — | §5b.2 |
| `assignments` | **Vínculo** proyecto ↔ empleado | — | §5b.3 |
| `credentials` | Material secreto, aislado (D-27) | Empleado | — |
| `areas` | **Catálogo compartido**, dejó de ser enum (D-58) | — | — |
| `access_logs` | Auditoría | — | — |
| `uploads` | **Permiso de subida directa**, efímero (D-83) | — | — |
| `machines` | **Catálogo por empresa**: la maquinaria (D-86) | Empresa | §5.5c |
| `machine_assignments` | **Vínculo** máquina ↔ obra ↔ trabajador (D-87) | Máquina | §5.5d |

> **Los nombres de arriba son los de MongoDB, en inglés**; en el contrato HTTP
> las rutas y las llaves van en español (`/empresas`, `/expedientes`). La tabla
> completa de equivalencias está en `CLAUDE.md` § Idiomas. Este documento usa a
> veces el nombre en español al hablar del concepto; la colección es la de esta
> tabla.

### Por qué los vínculos son colecciones y no arreglos embebidos

Es la pregunta que va a hacer cualquiera que revise esto, así que queda
contestada:

- **Son muchos-a-muchos con atributos propios.** Una adscripción tiene contrato,
  fecha de ingreso, áreas y su propia baja. Eso no es un id suelto en un arreglo.
- **Se consultan desde los dos lados.** «Los empleados de esta empresa» y «las
  empresas de este empleado» son igual de frecuentes. Embebido en cualquiera de
  los dos extremos, el otro lado se vuelve un escaneo de colección.
- **Crecen sin techo previsible.** Un proyecto grande puede tener cientos de
  asignaciones; el límite de 16 MB por documento es real.
- **Hay que conservar historia.** Una asignación cerrada (`fechaSalida`) sigue
  importando para auditoría: hay que poder responder quién estaba en la obra en
  una fecha dada.

En cambio **el checklist sí va embebido** en el expediente: son 12 documentos con
unas pocas versiones, siempre se leen y escriben completos, y nunca se consulta
un documento fuera de su expediente.

---

## 4. Convenciones transversales

Aplican a todos los esquemas y no se repiten en cada uno.

- `timestamps: true` en todas las colecciones → `createdAt` / `updatedAt` en ISO.
- **Identificadores** se exponen como `_id` en string. Nunca `id`.
- **Fechas de calendario** (ingreso, vigencia, inicio de obra) se guardan como
  `String` en formato `YYYY-MM-DD`. **No como `Date`.** Guardarlas como `Date`
  las convierte a medianoche UTC y en México se leen un día antes; es un bug que
  ya se corrigió en el front y no hay que reintroducirlo. Las **marcas de
  tiempo** (`createdAt`, `subidoEn`, `revisadoEn`) sí son `Date`.
- **Nada se borra.** Todo es baja lógica con `activo: boolean`. Un expediente es
  un registro de auditoría.
- **Los estatus derivados no se persisten.** `expiring`, `expired`, el `avance`
  del expediente y todas las alertas se calculan al leer. Ver sección 6.
- **Campos opcionales**: `null` u omitidos, nunca cadena vacía.

---

## 5. Esquemas

### 5.1 `empresas`

La entidad raíz. Cambia poco y se lee mucho: buen candidato a caché.

```js
// Un registro con identidad propia. Lo comparten el patronal de la empresa y el
// de obra del cliente: misma forma exacta, dueños distintos.
const registroSchema = new mongoose.Schema({
  numero:      { type: String, required: true, trim: true, uppercase: true,
                 minlength: 3, maxlength: 30 },
  descripcion: { type: String, trim: true, default: null },
  // Baja lógica: se bloquea si un proyecto EN CURSO lo usa. Los finalizados no.
  activo:      { type: Boolean, default: true }
});

const empresaSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true, maxlength: 120, unique: true },
  rfc:    { type: String, trim: true, uppercase: true, maxlength: 13 },

  // Una empresa puede tener registro por entidad o por clase de riesgo.
  // Subdocumentos con _id propio desde el 29 ago 2026: el proyecto apunta a uno
  // concreto, y una posición dentro de un arreglo de cadenas no sirve de
  // referencia — corregir un dígito la rompería en silencio. El número se
  // guarda en mayúsculas; el alta es idempotente por número.
  registrosPatronales: [registroSchema],

  // Preparados para el día que cada empresa quiera verse distinta.
  branding: {
    nombreComercial: String,
    logoUrl:         String,
    colorPrimario:   String
  },
  configuracion: {
    // Si viene, pisa los valores globales.
    diasAlertaVencimiento: { type: Number, min: 1, max: 365 },
    diasAlertaProyecto:    { type: Number, min: 1, max: 90 },
    documentosSensibles:   [{ type: String, enum: TIPOS_DOCUMENTO }]
  },

  activo: { type: Boolean, default: true }
}, { timestamps: true });
```

### 5.2 `empleados` — catálogo compartido

**La persona.** No lleva `empresaId`, no lleva contrato y no lleva áreas: todo
eso vive en `adscripciones`.

```js
const empleadoSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true, minlength: 3, maxlength: 120 },

  // Número de trabajador de la nómina. De la PERSONA y único en todo el grupo
  // (D-54): vivía en la adscripción, único por empresa, y se movió cuando se
  // pidió capturarlo al dar de alta a alguien que aún no se adscribe a ninguna
  // empresa. Índice único parcial, igual que la CURP.
  numeroEmpleado: { type: String, trim: true, maxlength: 30, default: null },

  // Clave natural: es lo que evita duplicar personas. OJO, el diseño la pedía
  // obligatoria y se implementó OPCIONAL — ver la nota de abajo y D-28.
  curp: {
    type: String, default: null, uppercase: true, trim: true,
    match: /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/
  },
  rfc:  { type: String, uppercase: true, trim: true, maxlength: 13, sparse: true },
  nss:  { type: String, trim: true, maxlength: 11, sparse: true },

  fechaNacimiento: { type: String, default: null },   // YYYY-MM-DD
  email:    { type: String, lowercase: true, trim: true, default: null },
  telefono: { type: String, trim: true, default: null },

  // Su puesto base, del catálogo global. En un proyecto puede tener otro.
  categoriaId: { type: ObjectId, ref: 'Categoria', required: true },

  // Clasificación general de la persona. Su ubicación real sale de los vínculos.
  tipo: { type: String, enum: ['administrativo', 'mano_de_obra'], required: true },

  // Acceso a la plataforma. Ausente en la mayoría: casi nadie entra.
  // OJO, la contraseña NO está aquí: vive en `credentials`, aparte (D-27). Este
  // subdocumento sólo lleva quién es y qué puede.
  acceso: {
    type: {
      email:    { type: String, required: true, lowercase: true, trim: true },
      nivelAcceso: {
        type: String,
        enum: ['rh_admin', 'rh_consulta', 'jefe_area'],
        required: true
      },
      // El administrador de plataforma ve todas las empresas y administra
      // los catálogos compartidos.
      alcanceGlobal:  { type: Boolean, default: false },
      activo:         { type: Boolean, default: true },
      // La contraseña la puso otra persona y su dueño no la ha cambiado. Con
      // ella se inicia sesión, pero la API responde 403 PASSWORD_TEMPORAL a
      // todo salvo /auth/me, /auth/logout y /auth/cambiar-password.
      passwordTemporal: { type: Boolean, default: false },
      // Cuándo se cambió la contraseña. Invalida los tokens anteriores. El
      // ÚLTIMO ACCESO no está aquí: lo lleva la credencial, con el resto del
      // material de sesión.
      passwordActualizadaEn: { type: Date, default: null }
    },
    default: null,
    _id: false
  },

  // Baja del sistema completo. Distinta de la baja de una empresa concreta.
  activo:     { type: Boolean, default: true },
  motivoBaja: { type: String, default: null },
  fechaBaja:  { type: String, default: null },   // YYYY-MM-DD

  // Interno: búsqueda parcial insensible a acentos. No se serializa.
  nombreNormalizado: { type: String, select: false, default: '' }
}, { timestamps: true });
```

> **La CURP es la clave de identidad.** Con un catálogo
> compartido, sin clave natural terminas con «Juan Pérez» tres veces y tres
> expedientes de la misma persona, que es exactamente el problema que este
> modelo viene a resolver. La CURP es única por persona en México y sirve.
>
> Si Urbacames no siempre la tiene al dar de alta —pasa con personal de obra el
> primer día—, hay dos salidas honestas: permitir un alta provisional con
> `curp: null`, obligando a completarla antes de validar el expediente; o generar
> una clave temporal marcada.
>
> **Se implementó la primera, y el párrafo de arriba se quedó viejo:** hoy `curp`
> es **opcional** (`default: null`, `employeeModel.js`) con índice único
> **parcial** —`$type: 'string'`, no `sparse`, que indexaría los nulos y haría
> chocar a la segunda persona sin CURP (D-28)—. **La decisión de exigirla desde
> el alta sigue abierta**: [`ESTADO.md`](./ESTADO.md) «Decisiones abiertas» #2.

> **El correo de acceso va dentro de `acceso`, no arriba.** El correo personal
> del empleado y su usuario de la plataforma son cosas distintas y pueden
> diferir. `acceso.email` es único global; el `email` de contacto no.

### 5.3 `clientes` — catálogo compartido

```js
const clienteSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true, maxlength: 160, unique: true },
  rfc:    { type: String, uppercase: true, trim: true, maxlength: 13, sparse: true },

  contactoNombre:   { type: String, trim: true, default: null },
  contactoEmail:    { type: String, lowercase: true, trim: true, default: null },
  contactoTelefono: { type: String, trim: true, default: null },

  // Los registros de obra del cliente (29 ago 2026): de ellos saldrán los SIROC
  // de cada contrato. Mismo `registroSchema` que los patronales de la empresa —
  // misma forma, dueño distinto. Ojo: NO son lo mismo. El patronal da el
  // contexto patronal del proyecto y es de la empresa; éste es del cliente, y
  // lo administran `rh_admin` y `jefe_area` (el patronal, sólo el admin de
  // plataforma).
  registrosObra: [registroSchema],

  activo: { type: Boolean, default: true }
}, { timestamps: true });
```

El nombre es único **globalmente**, no por empresa: es el mismo cliente para
todo el grupo, y tenerlo dos veces rompe el propósito del catálogo. Comparar
normalizando (sin acentos, sin mayúsculas) para que «Grupo Alvarado» y «grupo
alvarado» no convivan.

### 5.4 `categorias` — catálogo compartido

```js
const categoriaSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true, maxlength: 80, unique: true },
  // A quién aplica el puesto. Obligatorio, y DE SALIDA: ver la nota de abajo.
  tipo:   { type: String, enum: ['administrativo', 'mano_de_obra'], required: true },
  // Las sembradas no se pueden desactivar.
  esBase: { type: Boolean, default: false },
  activo: { type: Boolean, default: true }
}, { timestamps: true });
```

> **Por qué el catálogo es global y no por empresa.** El empleado es global y
> lleva una `categoriaId`. Si el catálogo fuera por empresa, un empleado adscrito
> a dos empresas tendría un puesto ambiguo. Global se resuelve solo, y cada
> proyecto sigue habilitando el subconjunto que usa.

> ⚠️ **`tipo` está de salida (D-73).** Llegó con el alta de personal, hoy es
> obligatorio —es el selector «Aplica a» del front— y filtra el desplegable del
> alta. Lo sustituye el área, que dice lo mismo con más grano desde D-58. Sigue
> en pie porque de él cuelga la matriz de permisos (§8.2), que hay que redefinir
> primero. **No construyas encima.**

### 5.5 `proyectos`

La única entidad que **sí** pertenece a una empresa.

```js
const aplazamientoSchema = new mongoose.Schema({
  fechaAnterior: { type: String, required: true },  // YYYY-MM-DD
  fechaNueva:    { type: String, required: true },
  motivo:        { type: String, required: true, minlength: 10 },
  registradoPor: { type: String, required: true },  // nombre, para el histórico
  registradoPorId: { type: ObjectId, ref: 'Empleado' },
  registradoEn:  { type: Date, required: true }
}, { _id: false });

const proyectoSchema = new mongoose.Schema({
  empresaId: { type: ObjectId, ref: 'Empresa', required: true },
  clienteId: { type: ObjectId, ref: 'Cliente', required: true },

  nombre:           { type: String, required: true, trim: true, maxlength: 160 },
  fechaInicio:      { type: String, required: true },  // YYYY-MM-DD
  fechaFinEstimada: { type: String, required: true },  // YYYY-MM-DD
  fechaFinReal:     { type: String, default: null },

  estado: { type: String, enum: ['en_curso', 'finalizado'], default: 'en_curso' },

  // Los dos registros que contextualizan el proyecto (29 ago 2026). Apuntan a
  // un subdocumento por su _id: el patronal tiene que ser de `empresaId` y el
  // de obra de `clienteId`, y ninguno puede estar dado de baja.
  //
  // OBLIGATORIOS AL CREAR, y el PATCH no admite vaciarlos. El `default: null`
  // se queda por los proyectos anteriores al cambio, que siguen siendo válidos
  // y se editan con normalidad.
  //
  // OJO: al cambiar `clienteId` hay que exigir el `registroObraId` del cliente
  // nuevo en la misma petición. Antes se limpiaba solo; ya no puede, porque el
  // campo no admite vacío.
  registroPatronalId: { type: ObjectId, default: null },
  registroObraId:     { type: ObjectId, default: null },

  // AQUÍ HUBO un `categorias: [ObjectId]` —el subconjunto del catálogo
  // habilitado en la obra—. Se quitó (D-82): sólo servía para filtrar el
  // selector de asignables y rechazar altas, y a una obra va quien haga falta.
  // Los proyectos anteriores lo traen guardado; el esquema ya no lo lee y
  // `npm run migrate:categorias-proyecto` lo limpia.

  // De la más reciente a la más antigua.
  aplazamientos: { type: [aplazamientoSchema], default: [] }
}, { timestamps: true });
```

Se dejó corto a propósito: se acordó arrancar con lo básico. Van a llegar más
campos (presupuesto, ubicación, responsable) y el esquema los admite sin migrar
nada. El número de contrato **ya no está en esta lista**: los contratos son una
colección aparte, abajo.

### 5.5b `contratos` — que son las fases del proyecto

Un contrato **es** una fase (29 ago 2026, D-68 a D-70). No hay entidad «fase» ni
un campo que las relacione: la fase es **un campo del contrato**, y es opcional,
así que un proyecto de un solo contrato simplemente no tiene fases.

Desde el 31 ago 2026 son dos campos y no uno (D-75): `nombre` es el del contrato
y `fase` su etiqueta de obra. Se separaron porque en obra se nombran distinto y
un solo campo obligaba a elegir cuál de los dos se pierde.

```js
const sirocSchema = new mongoose.Schema({
  // ÚNICO EN TODO EL SISTEMA: no se repite entre empresas, clientes ni
  // proyectos. Se guarda en mayúsculas.
  numero:        { type: String, required: true, minlength: 3, maxlength: 40 },
  fechaRegistro: { type: String, required: true },   // YYYY-MM-DD
  vigenciaHasta: { type: String, default: null }     // puede no conocerse
}, { _id: false });

const contratoSchema = new mongoose.Schema({
  proyectoId: { type: ObjectId, ref: 'Proyecto', required: true },

  // Secuencia dentro del proyecto (max + 1, contando también los dados de
  // baja). LA PONE EL SERVIDOR: no se manda al crear ni se puede corregir.
  numero: { type: Number, required: true },

  // Los dos opcionales y ninguno derivado del otro (D-75):
  //   nombre → el del contrato   ('Contrato 001-A')
  //   fase   → la etiqueta de obra ('Fase 1', 'Cimentación')
  nombre:      { type: String, default: null, maxlength: 120 },
  fase:        { type: String, default: null, maxlength: 120 },
  fechaInicio: { type: String, required: true },   // YYYY-MM-DD
  fechaFin:    { type: String, required: true },   // posterior al inicio

  siroc: { type: sirocSchema, default: null },

  // El contrato firmado, escaneado (2 sept 2026, D-81). Opcional, uno solo y se
  // reemplaza: no se versiona. El aviso del SIROC y el acuse de cada refrendo
  // son OTROS archivos, y viven dentro de `siroc` (D-80).
  archivo: { type: attachmentSchema, default: null },  // models/attachmentSchema.js

  // OJO: `estado` y `activo` NO son lo mismo, y se mueven por rutas distintas.
  //   estado: 'finalizado' → la fase terminó bien   (POST /contratos/:id/finalizar)
  //   activo: false        → se capturó por error   (PATCH /contratos/:id/estado)
  // Confundirlos borra la diferencia entre una obra completada y una que nunca
  // existió.
  estado: { type: String, enum: ['en_curso', 'finalizado'], default: 'en_curso' },
  activo: { type: Boolean, default: true }
}, { timestamps: true });
```

**Lo que el contrato NO tiene**, porque son las tres suposiciones naturales: no
tiene `clienteId` (es el del proyecto), no tiene `empresaId` (sale del proyecto)
y **no tiene monto, importe ni moneda** — el backend no modela dinero en ninguna
parte de la obra.

Reglas:

- **Un contrato activo traba el proyecto**: su `clienteId` y su
  `registroPatronalId` dejan de poder cambiar. Con **un SIROC** se traba además
  el `registroObraId`, y con un umbral más bajo: basta uno, porque el aviso ante
  el IMSS ya salió con esa obra.
- Un contrato **dado de baja sale de esa cuenta**: si era el único, el proyecto
  vuelve a poder cambiar de cliente y de registro patronal. Su número no se
  reutiliza.
- **Quitar el SIROC libera su número.** Existe por eso: con el número único
  global, uno capturado en el contrato equivocado lo bloquearía para siempre.
- No se puede crear un contrato en un proyecto **finalizado**, ni reabrir un
  contrato mientras su proyecto lo esté.

Aquí vive en `src/api/v1/contracts/` y el detalle de la entrega está en
[`PLAN-OBRA-CONTRATOS.md`](./PLAN-OBRA-CONTRATOS.md) y
[`ENDPOINTS-PROYECTOS.md`](./ENDPOINTS-PROYECTOS.md) §3 y §4. En el repo del
front: `src/interfaces/contrato-api.ts`,
`src/modules/proyectos/contratos-service.ts` y el panel de contratos de la ficha
del proyecto; la regla de qué traba cada contrato la tienen aislada y con
pruebas en `candadosDeProyecto` (`src/modules/proyectos/cambios-proyecto.ts`).

### 5.5c `maquinas` — el catálogo de maquinaria de cada empresa

Cada empresa tiene su catálogo de **maquinaria y equipo de trabajo** (3 sept
2026, D-86). Al revés que los catálogos de §5.3 y §5.4, **no es compartido**: la
máquina es de una empresa, el identificador con el que la conocen sólo tiene
sentido dentro de ella, y el alcance es el de la empresa.

```js
const maquinaSchema = new mongoose.Schema({
  empresaId: { type: ObjectId, ref: 'Empresa', required: true },

  // Con qué número la conoce la empresa: económico, placa, serie… Lo teclea
  // quien la da de alta. ÚNICO DENTRO DE LA EMPRESA sobre la forma normalizada
  // (sin acentos ni mayúsculas): `eco-12` y `ECO 12` son la misma máquina.
  identificador:            { type: String, required: true, maxlength: 60 },
  identificadorNormalizado: { type: String, select: false },

  modelo:            { type: String, required: true, maxlength: 120 },
  modeloNormalizado: { type: String, select: false },   // para la búsqueda

  // La foto. Una sola, opcional, se reemplaza y no se versiona (D-79). Es el
  // mismo `attachmentSchema` del contrato, con una diferencia: SÓLO IMÁGENES
  // (JPG, PNG, WEBP). Un PDF responde 415.
  imagen: { type: attachmentSchema, default: null },

  // La baja. Se esconde del listado salvo que se pida; no se borra.
  activo: { type: Boolean, default: true }
}, { timestamps: true });
```

**Lo que la máquina NO tiene**, a propósito: marca, tipo, serie ni papeles
(entran después como campos nuevos si hacen falta), y **ni `empleadoId` ni
`proyectoId`**: quién la tiene y en qué obra está vive en §5.5d y se resuelve al
leer. Todas las respuestas de máquinas traen `asignacion`, que es `null` cuando
está en el patio.

Reglas:

- **El identificador no se repite dentro de la empresa.** Chocar responde
  `409 MAQUINA_DUPLICADA` con la máquina que ya está, para que el front pueda
  abrirla desde el aviso.
- **Se lista y se da de alta bajo la empresa** (`/empresas/:id/maquinas`) y se
  opera por su id (`/maquinas/:id`). Fuera de alcance, 404.
- **Escribe quien gestiona proyectos** (`manageProjects`): la maquinaria es de
  la obra. Lee cualquiera con sesión y alcance.

Aquí vive en `src/api/v1/machines/` y el detalle de la entrega está en
[`ENDPOINTS-MAQUINAS.md`](./ENDPOINTS-MAQUINAS.md).

### 5.5d `asignaciones de máquina` — dónde está y quién la tiene

Un **tramo**: una máquina, en una obra, con una persona, entre dos fechas (3 sept
2026, D-87). La cadena de tramos de una máquina **es** su historia.

```js
const asignacionDeMaquinaSchema = new mongoose.Schema({
  maquinaId:  { type: ObjectId, ref: 'Maquina',  required: true },
  // Copiada de la máquina: con esto se recorta al alcance sin cruzarla.
  empresaId:  { type: ObjectId, ref: 'Empresa',  required: true },
  // La obra. NUNCA se captura: sale de la asignación del trabajador.
  proyectoId: { type: ObjectId, ref: 'Proyecto', required: true },

  // NULO A PROPÓSITO: `null` = «en la obra, sin trabajador». Es lo que deja la
  // salida de la obra o la baja de la persona (D-87).
  empleadoId:   { type: ObjectId, ref: 'Empleado',   default: null },
  // De qué asignación tomó la obra. La trazabilidad de «la máquina va donde va
  // la persona»; nula en los tramos sin trabajador.
  asignacionId: { type: ObjectId, ref: 'Asignacion', default: null },

  fechaAsignacion: { type: String, required: true },   // 'YYYY-MM-DD'
  fechaDevolucion: { type: String, default: null },

  // Sólo en los tramos cerrados, y obligatorio en ellos.
  motivoCierre: {
    type: String,
    enum: ['devolucion', 'reasignacion', 'baja_de_maquina',
           'salida_de_obra', 'baja_de_trabajador'],
    default: null
  },

  activo: { type: Boolean, default: true }
}, { timestamps: true });

// Una máquina está con UNA sola persona a la vez. Parcial, no `unique` a secas:
// el histórico son muchos tramos cerrados de la misma máquina.
schema.index({ maquinaId: 1 }, { unique: true, partialFilterExpression: { activo: true } });
```

Reglas:

- **La obra sale del trabajador.** El cuerpo manda `empleadoId`; `proyectoId`
  sólo desempata cuando la persona está en varias obras, y tiene que ser una de
  las suyas, en la empresa de la máquina.
- **Una máquina, una persona.** Asignarla a otra cierra el tramo anterior con
  motivo `reasignacion`. Una persona sí puede traer varias máquinas.
- **La máquina pierde al trabajador, no la obra.** Al cerrar su asignación a la
  obra o al darlo de baja, el tramo se cierra y **se abre otro en la misma obra
  con `empleadoId: null`**. Sólo la devolución la saca de ahí.
- **Dar de baja la máquina sí cierra el tramo del todo** (`baja_de_maquina`):
  fuera de servicio no está en ninguna obra.
- **Nada de tiempo se guarda** (§6): los días de cada tramo y el acumulado por
  trabajador se calculan al leer, y el tramo vigente cuenta hasta hoy.

Aquí vive en `src/api/v1/machineAssignments/`.

### 5.6 `expedientes`

Uno por empleado. El checklist va embebido.

```js
const archivoSchema = new mongoose.Schema({
  nombre:      { type: String, required: true },   // nombre original
  mime:        { type: String, required: true },
  tamanoBytes: { type: Number, required: true },
  subidoPor:   { type: String, required: true },   // NOMBRE, no id: es histórico
  subidoPorId: { type: ObjectId, ref: 'Empleado' },
  subidoEn:    { type: Date, required: true },
  // Interno. No se expone: la ubicación real en el almacenamiento.
  claveAlmacenamiento: { type: String, required: true, select: false }
}, { _id: false });

const versionSchema = new mongoose.Schema({
  version:       { type: Number, required: true, min: 1 },
  archivo:       { type: archivoSchema, required: true },
  estatus:       { type: String, enum: ['in_review', 'validated', 'rejected'], required: true },
  vigenciaHasta: { type: String, default: null },
  revisadoPor:   { type: String, default: null },
  revisadoEn:    { type: Date, default: null },
  motivoRechazo: { type: String, default: null },
  reemplazadaEn: { type: Date, default: null }
}, { _id: false });

const documentoSchema = new mongoose.Schema({
  tipo:      { type: String, enum: TIPOS_DOCUMENTO, required: true },
  requerido: { type: Boolean, required: true },
  // Sólo los cuatro persistibles: expiring/expired se derivan.
  estatus:   { type: String, enum: ['pending', 'in_review', 'validated', 'rejected'], required: true },

  vigenciaMeses: { type: Number, default: null },
  vigenciaHasta: { type: String, default: null },
  archivo:       { type: archivoSchema, default: null },
  motivoRechazo: { type: String, default: null },
  revisadoPor:   { type: String, default: null },
  revisadoEn:    { type: Date, default: null },

  // De la MÁS RECIENTE a la más antigua. versiones[0] es la vigente.
  versiones: { type: [versionSchema], default: [] }
}, { _id: false });

const expedienteSchema = new mongoose.Schema({
  empleadoId: { type: ObjectId, ref: 'Empleado', required: true, unique: true },

  // Plantillas de las que salió el checklist. Son varias cuando el empleado
  // tiene adscripciones a más de una empresa (ver 6.2).
  plantillas: [{ type: ObjectId, ref: 'PlantillaChecklist' }],

  documentos: { type: [documentoSchema], default: [] }
}, { timestamps: true });
```

> **`subidoPor` guarda el nombre en texto, no sólo el id.** Es deliberado: es un
> registro histórico y debe seguir siendo legible aunque la persona se dé de baja
> o cambie de nombre. El id va **junto**, no en lugar del nombre.

### 5.7 `plantillas_checklist`

```js
const plantillaSchema = new mongoose.Schema({
  // Identificador estable entre ambientes (D-24). El sembrado necesita ser
  // idempotente y la resolución necesita una red de seguridad que se pueda
  // nombrar (`plantilla-general`); un `_id` de Mongo no sirve para eso.
  clave:       { type: String, lowercase: true, trim: true, default: null },

  nombre:      { type: String, required: true, trim: true },
  descripcion: { type: String, default: '' },

  tiposContrato: [{ type: String, enum: TIPOS_CONTRATO, required: true }],
  // null = todas las áreas. Sin `enum`: las áreas son una colección desde D-58.
  areas:         { type: [String], default: null },
  // null = todas las empresas. Permite que una empresa pida documentos extra.
  empresaId:     { type: ObjectId, ref: 'Empresa', default: null },

  documentos: [{
    tipo:          { type: String, enum: TIPOS_DOCUMENTO, required: true },
    requerido:     { type: Boolean, required: true },
    vigenciaMeses: { type: Number, min: 1, max: 60, default: null }
  }],

  esBase: { type: Boolean, default: false },
  activo: { type: Boolean, default: true }
}, { timestamps: true });
```

Al menos un documento con `requerido: true`, o todo expediente nacería completo.

---

## 5b. Los vínculos

Las tres colecciones que hacen que el modelo funcione. Son donde está la
inteligencia y donde es fácil equivocarse.

### 5b.1 `adscripciones` — empresa ↔ empleado

**La relación laboral.** Aquí vive el contrato, no en el empleado.

```js
const adscripcionSchema = new mongoose.Schema({
  empresaId:  { type: ObjectId, ref: 'Empresa',  required: true },
  empleadoId: { type: ObjectId, ref: 'Empleado', required: true },

  // Dónde TRABAJA dentro de esta empresa. Un administrativo tiene al menos una.
  // `AREAS` ya no es un enum cerrado: son claves del catálogo `areas`.
  areas: [{ type: String }],

  // Qué DIRIGE (26 ago 2026). Vacío es lo normal.
  // Trabajar en un área y dirigirla dejaron de ser lo mismo: antes, estar en
  // Contabilidad porque ahí trabajas te daba visión sobre toda Contabilidad.
  // NO tiene que ser subconjunto de `areas`, y se escribe sólo desde
  // PATCH /adscripciones/:id/jefaturas, nunca desde PATCH /adscripciones/:id.
  dirigeAreas: [{ type: String, default: [] }],

  // El departamento TAL CUAL lo dice la nómina, sin traducir (24 ago 2026). No
  // es lo mismo que `areas`: puede traer el nombre de una obra («Kulkana»), y
  // entonces es la única información real de dónde está la persona.
  departamento: { type: String, default: null },

  // El registro patronal de ESTA relación laboral (29 ago 2026, D-72). Apunta
  // a un subdocumento de `empresa.registrosPatronales`, tiene que ser de la
  // empresa de la adscripción y estar activo; `null` desvincula.
  //
  // CONVIVE con `condiciones.registroPatronal`, que sigue siendo texto: este es
  // el vínculo validado, aquél lo que dijo la nómina, crudo. Mismo reparto que
  // entre `areas` (modelado) y `departamento` (texto original).
  //
  // `null` es lo normal todavía: la migración vinculó lo que resolvió por
  // número, y quien se da de alta a mano sin él se queda en nulo. Para MOSTRAR
  // el registro de alguien conviene `condiciones.registroPatronal`, o el
  // `registroPatronalEmpleado` que ya dan resuelto las asignaciones.
  registroPatronalId: { type: ObjectId, default: null },

  tipoContrato:         { type: String, enum: TIPOS_CONTRATO, required: true },
  fechaIngreso:         { type: String, required: true },  // YYYY-MM-DD
  fechaTerminoContrato: { type: String, default: null },   // sólo temporales

  // Qué dejó sin capturar el importador (24 ago 2026): 'fechaTerminoContrato'
  // (el archivo no la trae) o 'areas' (la fila no traía departamento). Se
  // borra solo al mandar el dato por PATCH; no se puede escribir a mano.
  datosPendientes: [{ type: String, enum: ['fechaTerminoContrato', 'areas'] }],

  // Baja de ESTA empresa. No implica baja del sistema.
  activo:     { type: Boolean, default: true },
  motivoBaja: { type: String, default: null },
  fechaBaja:  { type: String, default: null },

  // Condiciones laborales del archivo de nómina (28 ago 2026). Estaban
  // guardadas pero invisibles por compartir subdocumento con los salarios; no
  // son datos sensibles. El objeto siempre existe; sus campos son `null` si el
  // archivo no los traía, salvo `teletrabajador`, que nunca es `null`.
  condiciones: {
    tipoRegimen:       { type: String, default: null },
    turno:             { type: String, default: null },
    registroPatronal:  { type: String, default: null },
    baseCotizacion:    { type: String, default: null },
    zonaSalario:       { type: String, default: null },
    tipoPrestacion:    { type: String, default: null },
    periodicidadPago:  { type: String, default: null },
    teletrabajador:    { type: Boolean, default: false }
  },

  // Salario, SBC y cuenta bancaria del archivo de nómina. `select: false` y
  // fuera del `toJSON`: se guardan y NINGUNA respuesta los devuelve, hasta que
  // se decida quién puede verlos (§12).
  nomina: { /* salarioDiario, sbcParteFija, sbcParteVariable, sbcTopeUMA,
               banco, sucursal, cuenta */ },

  // Qué traía la fila del .xlsx la última vez que se importó, para saber qué
  // cambió sin volver a abrir el archivo. Contabilidad interna del importador:
  // en inglés, `select: false`, no es contrato (D-46).
  payrollSnapshot: { /* active, contractType, hireDate, areas[], importedAt */ }
}, { timestamps: true });

adscripcionSchema.index({ empresaId: 1, empleadoId: 1 }, { unique: true });
// «quién dirige esta área en esta empresa» — la lectura de la pantalla de jefaturas
adscripcionSchema.index({ empresaId: 1, dirigeAreas: 1 });
```

Reglas:

- **Única por par empresa+empleado.** Si vuelve a la misma empresa después de una
  baja, se **reactiva** la adscripción existente y se registra el reingreso; no
  se crea otra. (Si hiciera falta el historial completo de reingresos, se agrega
  un subdocumento `periodos[]`; hoy no se pidió.)
- Un empleado con `tipo: 'administrativo'` necesita al menos un área en su
  adscripción.
- Contrato temporal ⟹ `fechaTerminoContrato` obligatoria y posterior al ingreso.
- Dar de baja la adscripción **no** da de baja al empleado ni borra su
  expediente. Si era su única adscripción activa, es razonable proponer también
  la baja global, pero es una decisión de quien la ejecuta, no automática.

### 5b.2 `carteras` — empresa ↔ cliente

Qué clientes usa cada empresa del catálogo común.

```js
const carteraSchema = new mongoose.Schema({
  empresaId: { type: ObjectId, ref: 'Empresa', required: true },
  clienteId: { type: ObjectId, ref: 'Cliente', required: true },

  // Datos de la relación, que pueden diferir por empresa.
  contactoNombre:   { type: String, default: null },
  contactoEmail:    { type: String, default: null },
  contactoTelefono: { type: String, default: null },
  notas:            { type: String, default: null },

  activo: { type: Boolean, default: true }
}, { timestamps: true });

carteraSchema.index({ empresaId: 1, clienteId: 1 }, { unique: true });
```

> **Por qué existe y no se deduce de los proyectos.** Se podría calcular «los
> clientes de esta empresa» como los distintos `clienteId` de sus proyectos, y
> ahorrarse la colección. Se descartó por tres razones: hay que poder registrar
> un cliente en la empresa **antes** de tener un proyecto con él —y crear un
> proyecto exige cliente, así que si no, el flujo no cierra—; la relación tiene
> datos propios (el contacto puede ser distinto por empresa); y un `distinct`
> sobre proyectos para pintar un selector es una consulta cara que se repite en
> cada pantalla.

Regla que hace real la flecha del diagrama: **el cliente de un proyecto tiene que
estar en la cartera activa de la empresa del proyecto.** Si no, `400`.

### 5b.3 `asignaciones` — proyecto ↔ empleado

```js
const asignacionSchema = new mongoose.Schema({
  proyectoId:  { type: ObjectId, ref: 'Proyecto',  required: true },
  empleadoId:  { type: ObjectId, ref: 'Empleado',  required: true },

  // Su rol EN ESTE proyecto. Puede diferir de la categoría base del empleado.
  categoriaId: { type: ObjectId, ref: 'Categoria', required: true },

  fechaAsignacion: { type: String, required: true },  // YYYY-MM-DD
  fechaSalida:     { type: String, default: null },

  activo: { type: Boolean, default: true }
}, { timestamps: true });

// Sólo puede haber una asignación ACTIVA por par; las cerradas se conservan.
asignacionSchema.index(
  { proyectoId: 1, empleadoId: 1 },
  { unique: true, partialFilterExpression: { activo: true } }
);
```

Reglas:

- La `categoriaId` de la asignación es **su puesto en esa obra**, y no se valida
  contra nada del proyecto (D-82). Es opcional al asignar: sin ella se guarda el
  puesto de la propia persona.
- El empleado debe tener **adscripción activa** a la empresa del proyecto. No se
  puede poner en una obra de Empresa 1 a alguien que no trabaja para Empresa 1.
- No se asigna a un empleado dado de baja ni a un proyecto finalizado.
- Quitar a alguien **no borra**: cierra la asignación con `fechaSalida` y
  `activo: false`. Hay que poder responder quién estaba en la obra el día del
  accidente.

> El índice parcial es la parte fina: permite el histórico (varias asignaciones
> cerradas del mismo par) e impide el duplicado activo. Un `unique` simple
> bloquearía la reincorporación.

**Coherencia del registro patronal (29 ago 2026, D-71).** Una persona puede
cotizar en un registro patronal **distinto** al del proyecto al que se le
asigna. Eso **avisa, no bloquea**: Maquinaria CAMES tiene 144 personas
repartidas en cuatro registros, y moverlas es un trámite ante el IMSS, no un
error de captura.

Nada de esto se guarda: son dos campos **derivados** que el listado calcula al
leer.

| Campo                       | Qué es                                                     |
| --------------------------- | ---------------------------------------------------------- |
| `registroPatronalEmpleado`  | El de **su adscripción**, texto libre tal como vino de la nómina |
| `registroPatronalCoincide`  | Si es el del proyecto. **Tres estados**                     |

`registroPatronalCoincide` es `true` (coinciden), `false` (cotiza en otro) o
`null` (**no se pudo comparar**: su adscripción no tiene registro). **`null` no
es `false`** — colapsarlos haría que «falta capturar un dato» se leyera como
«hay que hacer un trámite», que son acciones distintas. Misma convención que
`rfcCoincide` en la importación.

La comparación **la hace el servidor**, que ya ignora guiones, espacios y
mayúsculas. El front no normaliza nada por su cuenta.

El alta responde `201` **con avisos**, no un error: `POST
/proyectos/:id/asignaciones` devuelve `{ asignacion, avisos: string[] }` y el
primer aviso se repite en el `message`. En el front esto vive en
`ResultadoAsignacion` y se pinta como éxito con descripción, nunca como fallo.

**La cadena completa** —`empleado → empresa → registro patronal → proyecto →
registro de obra`— la resuelve `GET /asignaciones/:id` en `trazabilidad`, también
al leer. Por eso corregir el registro patronal de una adscripción se refleja de
inmediato en todas sus asignaciones, sin re-asignar a nadie.

---

## 6. Lógica derivada

Nada de esto se guarda. Se calcula al leer, y por eso nunca queda desfasado.

### 6.1 Estatus de un documento

```
si estatus almacenado ≠ 'validated'  → el estatus almacenado
si no hay vigenciaHasta              → 'validated'

dias = vigenciaHasta − hoy   (días completos, ambos a medianoche local)
  dias <  0    → 'expired'
  dias <= 30   → 'expiring'
  dias >  30   → 'validated'
```

Los tres casos borde que ya están probados en el front y que hay que respetar:
**el día del vencimiento todavía es vigente** (`dias === 0` es `expiring`); **el
umbral es inclusivo** (30 es `expiring`, 31 es `validated`); **lo que no está
validado no vence** (un `in_review` con fecha pasada sigue `in_review`).

### 6.2 Checklist por unión de plantillas

Es la consecuencia directa de que el expediente sea de la persona.

```
plantillas = para cada adscripción ACTIVA del empleado:
               resolverPlantilla(empresa, áreas de esa adscripción, tipoContrato)

checklist  = unión de los renglones de todas ellas, donde por cada tipo:
               requerido      = OR de los requeridos   (requerido gana)
               vigenciaMeses  = MIN de las vigencias   (la más estricta gana)
```

Resolución de una plantilla, de más específica a más general:

1. Plantilla de la empresa que empata **área + tipo de contrato**
2. Plantilla de la empresa que empata **tipo de contrato**
3. Plantilla global (`empresaId: null`) que empata **área + tipo de contrato**
4. Plantilla global que empata **tipo de contrato**
5. La plantilla general, como red de seguridad

**Al re-sincronizar nunca se pierde trabajo hecho:** un documento que la unión
nueva ya no pide, pero que tiene versiones subidas, **se conserva marcado como
opcional**. Sólo se descartan los que nunca se llenaron.

Esto se dispara cuando: cambia un área o el contrato de una adscripción, se
agrega o se da de baja una adscripción, o se edita una plantilla.

### 6.3 Avance del expediente

```
requeridos  = documentos con requerido = true
entregados  = de los requeridos, los que quedan en 'validated' o 'expiring'
faltantes   = de los requeridos, los que quedan en 'pending'
porcentaje  = requeridos === 0 ? 100 : redondear(entregados / requeridos × 100)

enRevision, rechazados, porVencer, vencidos = sobre TODOS los documentos
```

Dos asimetrías deliberadas: el porcentaje sólo mira los requeridos —un opcional
sin subir no puede impedir el 100 %—, y los contadores de vigencia miran todo
—un opcional vencido también exige que alguien actúe—. Un documento **por vencer
sigue contando como entregado**.

> ⚠️ **`faltantes` y los rechazados: el backend y el front no cuentan igual.**
> Aquí `faltantes` son sólo los `pending` (`src/utils/domain/progress.js`, con
> prueba); el front suma también los `rejected` (`src/utils/expediente.ts` de su
> repo). **El número que ve el usuario es el del backend** —el `avance` viaja en
> la respuesta—, así que la diferencia sólo se nota en la capa simulada. No
> cambia el semáforo: un rechazado no está entregado, `entregados < requeridos`
> y el expediente sale `incomplete` en las dos versiones. **Sin decidir**:
> anotado en [`HANDOFF-BACKEND.md`](./HANDOFF-BACKEND.md).

Semáforo, en este orden exacto:

```
vencidos > 0             → 'expired'
entregados < requeridos  → 'incomplete'
porVencer > 0            → 'expiring'
en otro caso             → 'complete'
```

### 6.4 Alertas

Se derivan en cada consulta. Dos familias, con el mismo formato de sobre.

**De documento**, por cada empleado con adscripción activa:

| Estatus efectivo | Alerta |
| --- | --- |
| `expired` | `vencido` |
| `expiring` | `por_vencer` |
| `rejected` | `documento_rechazado` |
| `pending` **y requerido** | `documento_faltante` |
| `pending` y opcional, `validated`, `in_review` | ninguna |

**De proyecto**, por cada proyecto en curso:

| Condición | Alerta |
| --- | --- |
| Faltan 7 días o menos para `fechaFinEstimada` | `proyecto_por_finalizar` |
| Ya pasó y sigue en curso | `proyecto_vencido` |

Un proyecto finalizado **deja de avisar** aunque su fecha haya pasado.

**El `id` de la alerta tiene que ser estable entre recálculos** —
`` `${origen}:${entidadId}:${detalle}:${tipo}` `` — porque el front lo usa como
clave de lista: si cambia, la bandeja parpadea.

Orden: severidad (`vencido` → `proyecto_vencido` → `documento_rechazado` →
`por_vencer` → `proyecto_por_finalizar` → `documento_faltante`), luego días
restantes ascendente, luego nombre con `localeCompare` español.

---

## 7. Índices

Los vínculos son las colecciones calientes: se cruzan en casi toda consulta.

```js
// empleados
{ curp: 1 }                                    // unique
{ numeroEmpleado: 1 }                          // unique parcial, $type: 'string' (D-54)
{ 'acceso.email': 1 }                          // unique, sparse
{ nombre: 'text' }                             // búsqueda, default_language: 'spanish'
{ nombreNormalizado: 1 }                       // alternativa a $text, ver nota
{ activo: 1, tipo: 1 }

// clientes
{ nombre: 1 }                                  // unique
{ activo: 1 }

// categorias
{ nombre: 1 }                                  // unique

// adscripciones
{ empresaId: 1, empleadoId: 1 }                // unique
{ empresaId: 1, activo: 1, areas: 1 }          // «los administrativos de esta área»
{ empleadoId: 1, activo: 1 }                   // «las empresas de esta persona»

// carteras
{ empresaId: 1, clienteId: 1 }                 // unique
{ empresaId: 1, activo: 1 }

// asignaciones
{ proyectoId: 1, empleadoId: 1 }               // unique parcial sobre activo:true
{ proyectoId: 1, activo: 1 }                   // «quién está en esta obra»
{ empleadoId: 1, activo: 1 }                   // «en qué obras está esta persona»

// proyectos
{ empresaId: 1, estado: 1 }
{ clienteId: 1 }
{ empresaId: 1, fechaFinEstimada: 1 }          // job de cierres próximos

// contratos
{ proyectoId: 1, numero: 1 }                   // unique — la secuencia de la fase
{ proyectoId: 1, estado: 1 }
{ 'siroc.numero': 1 }                          // unique parcial, $type: 'string'

// expedientes
{ empleadoId: 1 }                              // unique
{ 'documentos.vigenciaHasta': 1 }              // job de vigencias
{ 'documentos.estatus': 1 }

// access_logs
{ expedienteId: 1, createdAt: -1 }
{ usuarioId: 1, createdAt: -1 }
```

> **Los únicos opcionales van con `partialFilterExpression`, nunca con
> `sparse`.** `numeroEmpleado`, `siroc.numero` y `rfc` nacen en `null`: el campo
> existe valiendo nulo, así que `sparse` lo indexa igual y el segundo registro
> sin dato choca con el primero. `{ $type: 'string' }` es lo que deja fuera a los
> nulos de verdad.

> **Sobre la búsqueda por nombre.** El front busca ignorando acentos y
> mayúsculas: «gomez» tiene que encontrar «Gómez». Un `$regex` con `$options:'i'`
> **no** hace eso, y es el error clásico. Dos salidas: índice `$text` con
> `default_language: 'spanish'` (que ya normaliza diacríticos), o un campo
> `nombreNormalizado` mantenido en un `pre('save')` y consultado con `$regex`.
> La segunda da coincidencia parcial, que es lo que espera la gente al escribir
> media palabra; la primera sólo empata palabras completas. **Recomendación:
> `nombreNormalizado`.**

---

## 8. Alcance y permisos

### 8.1 El filtro ya no es un campo

Con empleados y clientes globales, «lo que puedo ver» se calcula:

```js
// middlewares/alcanceMiddleware.js
async function aplicarAlcance(req, res, next) {
  if (req.user.acceso.alcanceGlobal) {
    req.empresasVisibles = null;      // null = todas
    return next();
  }
  const adscripciones = await Adscripcion
    .find({ empleadoId: req.user._id, activo: true })
    .select('empresaId areas');

  req.empresasVisibles = adscripciones.map(a => String(a.empresaId));
  // Para el jefe de área: sus áreas por empresa.
  req.areasPorEmpresa = Object.fromEntries(
    adscripciones.map(a => [String(a.empresaId), a.areas])
  );
  next();
}
```

Y con eso:

| Recurso | Cómo se filtra |
| --- | --- |
| Proyectos | `empresaId ∈ empresasVisibles` |
| Clientes | los de `carteras` con `empresaId ∈ empresasVisibles` |
| Empleados | los con adscripción a una empresa visible, **o** asignados a un proyecto de una empresa visible |
| Expedientes | los de esos empleados |
| Alertas y métricas | derivadas de lo anterior |

Reglas que no se negocian:

- **`empresaId` nunca se lee del cuerpo ni del query string** para decidir
  alcance: sale del usuario. Si llega en la petición, sirve como filtro adicional
  dentro de lo visible, jamás para ampliarlo.
- **Fuera de alcance responde `404`, no `403`.** Un `403` confirmaría que el
  recurso existe.
- Una prueba por endpoint que verifique que un usuario de la Empresa A no alcanza
  datos de la Empresa B.

> **El caso que hay que pensar:** un empleado adscrito a las dos empresas es
> visible desde las dos, y **su expediente es el mismo**. Es el comportamiento
> buscado (ver 2.1), pero conviene que la interfaz lo diga, para que nadie crea
> que está viendo un documento «de su empresa» cuando es de la persona.

### 8.2 Matriz de permisos

**Ésta es la única tabla de permisos del proyecto.** Sale de
`src/utils/permissions.js` (`PERMISSION_MATRIX`), que es lo que el servidor
aplica de verdad, y una prueba la compara **celda por celda** contra el código:
si las dos dejan de coincidir, `npm test` falla y **la que está mal es esta
tabla**, no el código.

Antes hubo dos —ésta y la de D-32— y no decían lo mismo: ésta dejaba la edición
de personal sólo en `rh_admin` diez días después de que Urbacames confirmara lo
contrario. Por eso ahora hay una sola y una prueba que la sostiene.

Cómo se lee cada celda:

| Celda               | Qué significa                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| ✓                   | Permitido                                                                                              |
| —                   | No permitido                                                                                           |
| sus áreas           | Permitido, pero acotado a las áreas que dirige en cada empresa (`req.areasPorEmpresa`)                 |
| + alcance global    | Permitido **sólo** si además tiene `acceso.alcanceGlobal` (administrador de plataforma)                |

| Capacidad                | Qué permite                                                             |    `rh_admin`    | `rh_consulta` | `jefe_area` |
| ------------------------ | ----------------------------------------------------------------------- | :--------------: | :-----------: | :---------: |
| `viewEmployees`          | Ver empleados y expedientes                                             |        ✓         |       ✓       |  sus áreas  |
| `deactivateEmployees`    | Dar de baja del sistema y reactivar                                     |        ✓         |       —       |      —      |
| `manageFieldEmployees`   | Alta **y edición** de personal de obra (`mano_de_obra`)                 |        ✓         |       ✓       |      ✓      |
| `manageAdminEmployees`   | Alta **y edición** de personal administrativo                           |        ✓         |       —       |      —      |
| `manageAffiliations`     | Adscribir a una empresa, editar la adscripción y darla de baja          |        ✓         |       —       |      —      |
| `uploadDocuments`        | Subir y reemplazar documentos del expediente                            |        ✓         |       ✓       |      —      |
| `reviewDocuments`        | Validar o rechazar un documento (D-44)                                  |        ✓         |       ✓       |      —      |
| `openSensitiveDocuments` | Abrir documentos sensibles                                              |        ✓         |       ✓       |      —      |
| `manageProjects`         | Crear, aplazar, finalizar y reabrir proyectos, sus contratos y la maquinaria (D-86) |        ✓         |       —       |      ✓      |
| `assignToProjects`       | Asignar personal a un proyecto y darle salida                           |        ✓         |       —       |      ✓      |
| `manageClients`          | Alta, edición y baja de clientes del catálogo global                    |        ✓         |       —       |      ✓      |
| `manageClientPortfolio`  | Vincular un cliente a la cartera de una empresa propia                  |        ✓         |       —       |      ✓      |
| `manageTemplates`        | Configurar las plantillas de checklist                                  |        ✓         |       —       |      —      |
| `generateReports`        | Generar reportes                                                        |        ✓         |       ✓       |      —      |
| `manageAccess`           | Conceder, editar y quitar el acceso a la plataforma                     |        ✓         |       —       |      —      |
| `manageAreaLeadership`   | Decir quién dirige cada área en cada empresa (D-60)                     |        ✓         |       —       |      —      |
| `manageCompanies`        | Crear y editar empresas y sus registros patronales                      | + alcance global |       —       |      —      |
| `manageCategories`       | Crear categorías y darlas de baja                                       | + alcance global |       —       |      —      |
| `manageAreas`            | Crear, renombrar y dar de baja áreas del catálogo (D-58)                | + alcance global |       —       |      —      |
| `closeTemporaryAreas`    | Cerrar las áreas **temporales** que deja el archivo de nómina (D-58)    |        ✓         |       ✓       |      —      |

**El personal se decide por tipo, no por una sola capacidad.** `POST /empleados`
y `PATCH /empleados/:id` no llevan un `requireCapability` fijo: el servicio
pregunta `canManageEmployeeType(acceso, tipo)`, que va a
`manageFieldEmployees` o a `manageAdminEmployees` según el `tipo` de la persona
—que sale de su categoría (D-59)—. Un middleware fijo le daría `403` a un
`rh_consulta` que sí puede dar de alta a un trabajador de obra.

De ahí salen tres consecuencias que se preguntan seguido:

- **Un `jefe_area` puede corregir a la gente de obra que él mismo capturó**, y un
  `rh_consulta` también. Sin eso, un dígito mal en una CURP obligaba a pedirle la
  corrección a un administrador (D-32).
- **Cambiar el `tipo` a `administrativo` exige poder crear administrativos.** Si
  no, un `jefe_area` daría de alta a un peón y después lo «ascendería».
- **La baja del sistema sigue siendo de `rh_admin`** (`deactivateEmployees`):
  corregir datos y sacar a alguien del sistema no son la misma decisión.

Y el alcance no cambia con ninguna de estas capacidades: un `jefe_area` sólo
alcanza a la gente de **sus áreas**, así que editar a alguien de otra área
responde `404`, igual que el listado.

El front sólo apaga botones. **La autorización real es del servidor.**

---

## 9. Consultas que hay que resolver con agregación

Con muchos-a-muchos, `find()` ya no basta. Las tres que sostienen la interfaz.

### 9.1 Empleados de una empresa, con avance de expediente

Alimenta el listado general. Paginado, con búsqueda por nombre y orden
alfabético en los dos sentidos.

```js
Adscripcion.aggregate([
  { $match: { empresaId, activo: true } },
  { $lookup: { from: 'empleados', localField: 'empleadoId', foreignField: '_id', as: 'empleado' } },
  { $unwind: '$empleado' },
  { $match: { 'empleado.activo': true, 'empleado.nombreNormalizado': { $regex: termino } } },
  { $lookup: { from: 'categorias', localField: 'empleado.categoriaId', foreignField: '_id', as: 'categoria' } },
  { $lookup: { from: 'expedientes', localField: 'empleadoId', foreignField: 'empleadoId', as: 'expediente' } },
  { $lookup: { from: 'asignaciones',
      let: { emp: '$empleadoId' },
      pipeline: [
        { $match: { $expr: { $and: [ { $eq: ['$empleadoId', '$$emp'] }, { $eq: ['$activo', true] } ] } } },
        { $lookup: { from: 'proyectos', localField: 'proyectoId', foreignField: '_id', as: 'proyecto' } }
      ],
      as: 'asignaciones' } },
  { $sort: { 'empleado.nombre': 1 } },        // o -1
  { $facet: {
      datos: [ { $skip: (pagina - 1) * porPagina }, { $limit: porPagina } ],
      total: [ { $count: 'n' } ]
  } }
])
```

> **`$facet` para paginar.** Devuelve la página y el total en una sola ida. Y
> **el orden va antes del corte**: ordenar dentro de la página daría un listado
> distinto según dónde esté parado quien mira.

El `avance` **no se calcula en el pipeline**: se traen los documentos y se
deriva en el servicio, con la misma función que usa el resto del sistema. Meter
esa lógica en un pipeline la duplica y la vuelve imposible de probar sola.

### 9.2 Árbol de organización

Alimenta el tablero de tarjetas por empresa. Por cada empresa: sus áreas con los
administrativos adscritos, y sus proyectos con el conteo de asignados.

Se resuelve con dos agregaciones —una sobre `adscripciones` agrupando por área,
otra sobre `proyectos` con `$lookup` a `asignaciones` y `clientes`— y se arma el
árbol en el servicio. **No intentar una sola mega-agregación**: es ilegible y no
gana nada, porque las dos partes son independientes.

**La mano de obra no va bajo las áreas.** Las áreas listan sólo
`empleado.tipo === 'administrativo'`; el personal de obra se cuenta en su
proyecto. Mezclarlos es justo la confusión que este modelo corrige.

### 9.3 Empleados asignables a un proyecto

Para el selector al asignar personal. Tiene que cruzar dos condiciones —eran
tres hasta D-82, que quitó la del puesto—:

```js
Adscripcion.aggregate([
  { $match: { empresaId: proyecto.empresaId, activo: true } },
  { $lookup: { from: 'empleados', localField: 'empleadoId', foreignField: '_id', as: 'e' } },
  { $unwind: '$e' },
  { $match: { 'e.activo': true } },
  // Fuera los que ya están asignados.
  { $lookup: { from: 'asignaciones',
      let: { emp: '$empleadoId' },
      pipeline: [ { $match: { $expr: { $and: [
        { $eq: ['$empleadoId', '$$emp'] },
        { $eq: ['$proyectoId', proyecto._id] },
        { $eq: ['$activo', true] } ] } } } ],
      as: 'ya' } },
  { $match: { ya: { $size: 0 } } }
])
```

---

## 10. Integridad y transacciones

MongoDB no tiene llaves foráneas: la integridad referencial es responsabilidad
del servicio. Cuatro puntos donde importa.

**Operaciones que deben ser atómicas** (requieren *replica set*, incluso de un
solo nodo, para `session.withTransaction`):

- Alta de empleado → crear `empleados` **y** su `expedientes`. Un empleado sin
  expediente rompe la invariante principal del modelo.
- Alta de adscripción → crear el vínculo **y** re-sincronizar el checklist.
- Baja de adscripción → cerrar el vínculo, cerrar sus asignaciones a proyectos de
  esa empresa, y re-sincronizar el checklist.

**Borrados que hay que impedir**, porque dejarían huérfanos:

- Un cliente con proyectos en curso no se da de baja.
- Un cliente no se saca de la cartera de una empresa si tiene proyectos ahí.
- Una categoría no se desactiva si hay empleados o proyectos usándola.
- Un proyecto no se borra: se finaliza.

**Verificación periódica.** Vale la pena un comando de mantenimiento que detecte
inconsistencias: empleados sin expediente, asignaciones a proyectos inexistentes,
adscripciones a empresas dadas de baja. Con integridad a nivel de aplicación,
tarde o temprano algo se escapa.

**Concurrencia.** Dos personas asignando al mismo empleado al mismo proyecto a la
vez: el índice único parcial de `asignaciones` lo resuelve — hay que capturar el
error `E11000` y traducirlo a un `400` legible, no dejarlo salir como `500`.

---

## 11. Qué cambia respecto a lo entregado

> **Historia, ya ocurrida.** La migración de abajo se hizo: `usuarios` responde
> `410` (`src/api/v1/users/goneRoutes.js`, se borra cuando el front deje de
> llamarla) y el acceso vive en `empleados.acceso` con la contraseña aparte, en
> `credentials` (D-27). Del lado del front, sus cinco cambios y sus cinco
> pantallas nuevas también están. Se conserva porque explica **por qué** el
> modelo quedó así.

### En el backend

Lo implementado hasta hoy es `/auth` y `/usuarios`. **No se tira**, pero cambia
de sitio:

| Hoy | Con este modelo |
| --- | --- |
| Colección `usuarios` | Desaparece. Se vuelve el subdocumento `acceso` de `empleados` |
| `usuario.alcance` + `usuario.clienteId` | Desaparecen. El alcance se deriva de `adscripciones` |
| — | Aparece `acceso.alcanceGlobal` para el administrador de plataforma |
| `usuario.area` | Se muda a `adscripciones.areas[]`, una por empresa |

**Migración sugerida**, para no romper el front mientras tanto:

1. Por cada `usuario`, crear un `empleado` con su `acceso`, su expediente en
   blanco, y una `adscripción` a la empresa que corresponda. La contraseña se
   copia hasheada: nadie tiene que restablecerla.
2. `/auth/login` y `/auth/me` **conservan su forma**: siguen devolviendo
   `{ user, token }`. Lo que cambia es de dónde sale ese `user`.
3. `AuthUser` gana `empleadoId` y `empresas[]` (las de sus adscripciones
   activas), y pierde `alcance` y `clienteId`.
4. `/usuarios` pasa a significar «empleados con acceso»: el mismo CRUD, operando
   sobre `empleados` y filtrando `acceso != null`. **Dar acceso a alguien que ya
   es empleado debe añadirle el subdocumento, no crear otra persona.**

Si prefieren otra ruta de migración, díganla y se ajusta el front. Lo único
innegociable: **que no queden dos registros de la misma persona.**

### En el front

La interfaz **no se ha tocado** en este cambio, a petición del cliente. Lo que
hoy asume el modelo anterior y habrá que corregir:

- `Empleado.empresaId` → desaparece; la relación pasa a `adscripciones`.
- `Empleado.areas` / `tipoContrato` / `fechaIngreso` / `fechaTerminoContrato` →
  se mudan a la adscripción. Un empleado puede tener varias.
- `Cliente.empresaId` → desaparece; se vincula por cartera.
- Catálogo de categorías por empresa → pasa a ser global.
- `Empleado.proyectos: string[]` → pasa a `asignaciones` con categoría y fechas.

**Pantallas nuevas que implica el modelo**, y que hoy no existen:

- **Catálogos compartidos** (empleados, clientes, categorías) administrados por
  el administrador de plataforma, separados de la vista por empresa.
- **Adscribir a un empleado existente a una empresa**, en vez de darlo de alta
  desde cero cada vez. Es el flujo que hace útil el catálogo compartido.
- **Vincular un cliente del catálogo a la cartera de una empresa.**
- **Asignar personal desde la ficha del proyecto**, con el selector de 9.3.
- En la ficha del empleado, **sus adscripciones y sus asignaciones**, que hoy es
  un solo campo plano.

---

## 12. Decisiones que faltan

Las seis preguntas con las que nació este documento, y en qué quedaron. Sólo la
última sigue abierta; se les sumó una séptima.

| # | Pregunta | Cómo quedó |
| --- | --- | --- |
| 1 | ¿El expediente se comparte entre empresas del grupo? | **Sí**, es de la persona, como decía §2.1. Implementado así |
| 2 | ¿La CURP es obligatoria desde el alta? | **Sigue abierta.** Implementada como **opcional** con único parcial (D-28); falta confirmarlo con Urbacames |
| 3 | Umbral de vencimiento de documentos | **30 días**, inclusivo, configurable con `DIAS_ALERTA_VENCIMIENTO` |
| 4 | Umbral de aviso de proyecto | **7 días** |
| 5 | Qué documentos son sensibles | **8 de los 12** (`SENSITIVE_DOCUMENT_TYPES`) |
| 6 | A quién llegan los correos de alerta | **Abierta.** No hay correos todavía: las alertas se derivan al consultar `GET /alertas` (D-47) y no hay job |

**La séptima, y es la que bloquea al front:** `affiliations.nomina` guarda
salario, SBC y cuenta bancaria porque el archivo de nómina los trae, pero
**ninguna respuesta los devuelve** hasta que se decida quién puede verlos
(LFPDPPP). No se arregla agregándolos al `toJSON`: ver D-46 y
[`ESTADO.md`](./ESTADO.md) #10.

---

## 13. Orden de implementación sugerido

El plan original, que se siguió. **Los pasos 1 a 6 están hechos**, y del 7 sólo
las alertas; faltan métricas, reportes y el job del 8 — el detalle vivo, con
checkboxes, está en [`ESTADO.md`](./ESTADO.md).

1. **Colecciones base**: `empresas`, `empleados`, `clientes`, `categorias`, con
   sus índices. Sin vínculos todavía.
2. **Migración de `usuarios` a `empleados.acceso`** y ajuste de `/auth`. Aquí el
   front ya puede apuntar al backend para la sesión.
3. **`adscripciones`** y el middleware de alcance. Es la pieza de la que depende
   todo lo demás; conviene que quede sólida y con pruebas de aislamiento entre
   empresas antes de seguir.
4. **`expedientes`** con la resolución de checklist por unión, y el
   almacenamiento de archivos en R2.
5. **`carteras`** y **`proyectos`**, con la regla de cliente en cartera.
6. **`asignaciones`** y las agregaciones de 9.1 y 9.3.
7. **Alertas, métricas y reportes**, que son derivados de todo lo anterior.
8. **Job diario de vigencias** y correos.

---

## Referencias

| Qué | Dónde |
| --- | --- |
| Contrato de API, códigos y catálogo de rutas | [`backend-spec.md`](./backend-spec.md) |
| **Qué colecciones hay HOY y qué se rompe al tocarlas** | [`ARQUITECTURA-DATOS.md`](./ARQUITECTURA-DATOS.md) |
| Por qué el modelo se desvió de este documento | [`DECISIONES.md`](./DECISIONES.md) |
| Qué falta implementar, en orden | [`ESTADO.md`](./ESTADO.md) |
| Lógica de expedientes ya probada | `src/utils/domain/` (`progress`, `documentStatus`, `checklist`, `expiry`) |
| Conversación con el front | [`HANDOFF-BACKEND.md`](./HANDOFF-BACKEND.md) |

En el repo del front (`~/Documents/projects/cames-files-manager/docs/`), que se
lee ahí y no se copia aquí:

| Qué | Dónde |
| --- | --- |
| Flujo funcional original del cliente | `flujo-expedientes.md` |
| Cómo les pega el backend, con sus trampas | `backend-actual.md` |
| Capa simulada del front | `mocks.md` |
| Su mitad de la conversación | `HANDOFF-FRONTEND.md` |
