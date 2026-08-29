# Plan — Registros patronales, registros de obra, contratos y SIROC

> **Plan de trabajo, no especificación cerrada.** Se implementa **una fase a la
> vez**. Al terminar cada una, el sistema queda funcional y consistente.
> Estado: **Fases 1, 2 y 3 implementadas** (D-65, D-66, D-67). Siguiente: Fase 4.

---

## A. Estado actual

### Modelos involucrados

| Colección      | Campos relevantes hoy                                                                   |
| -------------- | --------------------------------------------------------------------------------------- |
| `companies`    | `nombre`, `rfc`, **`registrosPatronales: [String]`** (D-64), `activo`                   |
| `clients`      | `nombre`, `rfc`, contactos, `activo`. **Sin registros de obra**                         |
| `portfolios`   | `empresaId` + `clienteId` únicos, contacto y notas. Es la cartera                       |
| `projects`     | `empresaId`, `clienteId`, `nombre`, fechas, `estado`, `categorias[]`, `aplazamientos[]` |
| `assignments`  | `proyectoId`, `empleadoId`, `categoriaId`, fechas, `activo`                             |
| `affiliations` | `condiciones.registroPatronal` — **una cadena, por persona**                            |

### Reglas que ya existen y se conservan

1. Nombre de proyecto único **dentro de la empresa** (`empresaId + nombreNormalizado`, índice único).
2. El cliente debe estar en la **cartera activa** de la empresa (`#assertClienteEnCartera`).
3. Las categorías del proyecto salen del catálogo global.
4. Al asignar personal: adscripción **activa** a la empresa del proyecto, categoría habilitada en el proyecto, proyecto no finalizado, y el jefe de área sólo asigna gente de **sus** áreas.
5. Asignación única por `(proyectoId, empleadoId)` **mientras está activa** (índice parcial).

### Datos reales hoy

```
EMPRESAS      3   ·  Urbacames Edificación (0 RP) · Maquinaria CAMES (1 RP) · TYA (0 RP)
CLIENTES      5   ·  ninguno con registros de obra (el campo no existe)
CARTERAS      7
PROYECTOS     3   ·  todos sin registro patronal ni registro de obra
ASIGNACIONES  2
```

**El hallazgo que más pesa:** el archivo de nómina ya trajo **cuatro registros
patronales distintos** para Maquinaria CAMES, repartidos en 144 personas:

| Registro         | Personas |
| ---------------- | -------- |
| `R13-77767-10-5` | 127      |
| `H67-29973-10-5` | 13       |
| `H68-39212-10-5` | 2        |
| `Z61-14090-10-9` | 2        |

La empresa sólo tiene **uno** capturado a mano. Los datos ya confirman el modelo
que describes —varios registros por empresa— y además **dan el material para
poblarlos sin capturar nada**.

---

## B. Problemas e inconsistencias detectadas

### B1. `registrosPatronales: [String]` no sirve para ser referenciado

Es el problema estructural. Se implementó ayer (D-64) como arreglo de cadenas
porque entonces sólo había que **guardarlos**. Ahora el proyecto tiene que
**apuntar a uno**, y apuntar a un elemento de un arreglo de cadenas es frágil:
corregir un dígito rompe la referencia en silencio, sin que nada falle.

**Necesitan identidad propia.** Es un cambio a algo que ya está en producción y
que ya le anuncié al front — hay que rehacerlo bien ahora, antes de que cuelguen
proyectos de él.

### B2. `condiciones.registroPatronal` es una cadena suelta

Cada adscripción guarda el registro patronal **como texto**, sin relación con el
catálogo de la empresa. Nada garantiza que el de una persona exista entre los de
su empresa. Con cuatro valores en uso y ninguno validado, la coherencia que pides
en el punto 9 hoy no se puede comprobar.

### B3. Los tres proyectos existentes no tienen ni registro patronal ni de obra

Hacer los campos obligatorios de golpe deja esos documentos inválidos y rompe
`PATCH /proyectos/:id`. Hay que pasar por optativo → poblar → obligatorio.

### B4. `Cliente` no tiene dónde guardar registros de obra

No existe el concepto. Es construcción nueva, sin datos que migrar.

### B5. No existe nada de contratos, fases ni SIROC

Construcción nueva completa.

---

## C. Modelo propuesto

### C1. Registro patronal — subdocumento con `_id`, dentro de `companies`

```js
registrosPatronales: [
  {
    _id, // ObjectId: es lo que referencia el proyecto
    numero, // 'R13-77767-10-5', único dentro de la empresa
    descripcion, // 'Zapopan', 'Clase de riesgo IV' — opcional
    activo // se da de baja, no se borra
  }
]
```

**Por qué subdocumento y no colección aparte:** no tienen vida fuera de su
empresa, no se comparten, y la empresa ya se carga en las vistas que los
necesitan. El `_id` de un subdocumento es un ObjectId real y **globalmente
único**, así que `projects.registroPatronalId` se puede indexar y consultar sin
problema; lo único que se pierde es `populate`, que aquí no hace falta.

### C2. Registro de obra — subdocumento con `_id`, dentro de `clients`

Simétrico, y por las mismas razones:

```js
registrosObra: [
  {
    _id,
    numero, // único dentro del cliente
    descripcion,
    activo
  }
]
```

### C3. Proyecto — dos referencias nuevas

```js
;(registroPatronalId, // ObjectId → companies.registrosPatronales._id
  registroObraId) // ObjectId → clients.registrosObra._id
```

**No se guarda el número, sólo el id.** El texto se resuelve al leer, igual que
`empresaNombre` o `categoriaNombre` hoy. Duplicarlo crearía dos verdades.

### C4. Contrato — colección propia, con el SIROC embebido

```js
// colección `contracts`
{
  proyectoId,          // ObjectId → projects
  numero,              // orden dentro del proyecto: 1, 2, 3…
  nombre,              // 'Fase 1', 'Cimentación' — opcional
  fechaInicio, fechaFin,
  siroc: {             // null hasta que se registre
    numero,
    fechaRegistro,
    vigenciaHasta
  },
  estado,              // en_curso | finalizado
  activo
}
```

**Colección y no subdocumento** porque crecen sin tope, se agregan con el tiempo
y van a necesitar consultarse solos. Mismo criterio que separa `assignments`
(colección) de `aplazamientos` (embebido).

**El SIROC va embebido, no es entidad propia:** es 1:1 con el contrato y no tiene
ciclo de vida independiente. Crear una colección para una relación 1:1 sin vida
propia sería duplicar entidad. Si algún día el SIROC necesita historial o
versiones, se gradúa entonces.

**Fase y contrato son la misma entidad.** En tu descripción cada fase tiene
exactamente un contrato, y un proyecto de un solo contrato no tiene fase. Dos
entidades 1:1 obligatorias son una sola con dos nombres. `nombre` cubre la
etiqueta de fase. **Esto conviene que lo confirmes** (ver G1).

### C5. Empleados — nada que duplicar

Desde una asignación ya se llega a todo:

```
assignment → proyectoId → empresaId, clienteId, registroPatronalId, registroObraId
assignment → empleadoId → affiliation(empresa) → condiciones.registroPatronal
```

**No hay que persistir ningún id nuevo en `assignments`.** Lo que sí falta es una
**validación** —ver G2— y, si se quiere, exponer la cadena resuelta en la
respuesta del detalle.

---

## D. Relaciones y cardinalidades

| Relación                     | Cardinalidad | Cómo se implementa                  |
| ---------------------------- | ------------ | ----------------------------------- |
| Empresa → Registro patronal  | 1:N          | subdocumento en `companies`         |
| Empresa → Cliente (cartera)  | N:M          | colección `portfolios` (ya existe)  |
| Cliente → Registro de obra   | 1:N          | subdocumento en `clients`           |
| Empresa → Proyecto           | 1:N          | `projects.empresaId`                |
| Cliente → Proyecto           | 1:N          | `projects.clienteId`                |
| Registro patronal → Proyecto | 1:N          | `projects.registroPatronalId`       |
| Registro de obra → Proyecto  | 1:N          | `projects.registroObraId`           |
| Proyecto → Contrato/Fase     | 1:N          | colección `contracts`               |
| Contrato → SIROC             | 1:1          | **embebido** en el contrato         |
| Proyecto ↔ Empleado          | N:M          | colección `assignments` (ya existe) |

**Diferencia con tu propuesta:** planteas Empresa 1:N Cliente. En el modelo actual
es **N:M** —un cliente puede estar en la cartera de varias empresas del grupo— y
eso ya está construido y en uso (7 carteras para 5 clientes). No conviene
cambiarlo; el catálogo de clientes es compartido, igual que el de empleados.

**Contrato → SIROC 1:1** confirma que el SIROC no es entidad: se embebe.

---

## E. Cambios en APIs

### Nuevos

```
POST   /empresas/:id/registros-patronales          admin plataforma
PATCH  /empresas/:id/registros-patronales/:rpId    admin plataforma
PATCH  /empresas/:id/registros-patronales/:rpId/estado

POST   /clientes/:id/registros-obra                rh_admin / jefe_area
PATCH  /clientes/:id/registros-obra/:roId
PATCH  /clientes/:id/registros-obra/:roId/estado

GET    /proyectos/:id/contratos
POST   /proyectos/:id/contratos
PATCH  /contratos/:id
PATCH  /contratos/:id/estado
PUT    /contratos/:id/siroc                        registrar o corregir el SIROC
```

### Modificados

| Endpoint               | Cambio                                                          |
| ---------------------- | --------------------------------------------------------------- |
| `POST /proyectos`      | acepta y exige `registroPatronalId` y `registroObraId`          |
| `PATCH /proyectos/:id` | reglas nuevas de qué se puede cambiar (ver G3)                  |
| `GET /proyectos/:id`   | devuelve los dos registros **resueltos** (número y descripción) |
| `GET /empresas/:id`    | `registrosPatronales` pasa de `string[]` a objetos con `_id`    |
| `GET /clientes/:id`    | gana `registrosObra`                                            |
| `PATCH /empresas/:id`  | deja de aceptar `registrosPatronales` como lista de cadenas     |

### Ruptura de contrato

`registrosPatronales` cambia de `string[]` a objetos. Es lo que se anunció al
front hace un día. Se corrige ahora, antes de que haya proyectos colgando.

---

## F. Cambios en MongoDB

### Índices nuevos

```js
projects.index({ registroPatronalId: 1 })
projects.index({ registroObraId: 1 })
contracts.index({ proyectoId: 1, numero: 1 }, { unique: true })
contracts.index({ proyectoId: 1, estado: 1 })
contracts.index({ 'siroc.numero': 1 }, { unique: true, partial: string })
```

Unicidad de `numero` dentro de su padre: se fuerza en `pre('validate')` del
documento padre, como ya se hace con `registrosPatronales` sin repetidos (D-64).

### Migraciones (ninguna se ejecuta sin confirmar)

**M1 — `registrosPatronales` de cadenas a subdocumentos.** 3 empresas, 1 con un
valor. Riesgo bajo. Lee con el driver crudo (el esquema nuevo ignoraría el
formato viejo), crea `{_id, numero, activo:true}` por cada cadena.

**M2 — poblar los registros patronales desde la nómina.** Las 144 adscripciones
ya traen los cuatro números de Maquinaria CAMES. Se agregan como registros de la
empresa los que falten. **Es el que más valor da y no captura nada a mano.**

**M3 — vincular cada adscripción a su registro patronal** (opcional, fase
tardía): `affiliations.registroPatronalId`, resuelto por el número. Los cuatro
valores resuelven; lo que no resuelva se reporta y se deja nulo.

**M4 — poblar los proyectos existentes.** 3 proyectos sin los dos campos. **No
hay dato del cual derivarlos**: hay que elegirlos a mano o dejarlos nulos. Por
eso la fase 3 los agrega como opcionales y la 4 los vuelve obligatorios sólo
cuando estén poblados.

**Riesgo principal:** hacer `required` antes de poblar deja los 3 proyectos
inválidos, y cualquier `save()` sobre ellos —aplazar, finalizar, editar— falla.

---

## G. Decisiones tomadas

Confirmadas con el cliente el 28 de agosto de 2026.

**G1. Fase y contrato son la misma entidad.** ✅ Una sola colección
`contracts`, con `nombre` opcional como etiqueta de fase. No se modela «fase»
por separado.

**G2. La coherencia del registro patronal del empleado es un AVISO, no un
bloqueo.** ✅ Si se asigna a un proyecto de `H67` a alguien cuya adscripción dice
`R13`, la asignación **se permite** y la respuesta lo advierte. Razón: Maquinaria
CAMES ya tiene gente repartida en cuatro registros y bloquear impediría trabajo
legítimo; avisar deja el dato a la vista sin frenar a nadie.

**G3. Qué se puede cambiar después de crear el proyecto.** ✅ Como se propuso:

| Campo             | Regla                                                   |
| ----------------- | ------------------------------------------------------- |
| Nombre, fechas    | libre                                                   |
| Registro patronal | libre **mientras no haya contratos**; después bloqueado |
| Registro de obra  | **bloqueado en cuanto exista un contrato con SIROC**    |
| Cliente           | bloqueado si hay contratos                              |
| Empresa           | **nunca**                                               |

**G4. El SIROC es único, sin excepción.** ✅ Índice único global sobre
`contracts.siroc.numero` (parcial: sólo cuando hay número, porque el SIROC se
registra después del contrato). Intentar repetirlo responde `409` con el
contrato y el proyecto que ya lo tienen, para que quien captura vea de inmediato
dónde está el choque en vez de un error de base de datos.

**G5. Registro patronal.** ✅ **Único dentro de la empresa** (forzado en el
modelo), varios por empresa sin tope. **Entre empresas no se bloquea**: no hay
evidencia de que sea imposible y un índice equivocado frenaría trabajo real.

## H. Plan por fases

Cada fase deja el sistema funcional. Ninguna rompe lo anterior.

### FASE 1 — Registro patronal como entidad referenciable ✅ HECHA (D-65)

Convierte `registrosPatronales` de `string[]` a subdocumentos con `_id`, con sus
endpoints de alta, edición y baja. Migración **M1** y **M2** (poblar desde la
nómina). _Depende de: G5._
**Resultado:** las empresas tienen registros patronales referenciables y
Maquinaria CAMES queda con sus cuatro, sin captura manual.

### FASE 2 — Registro de obra en el cliente ✅ HECHA (D-66)

Simétrica a la 1, sobre `clients`. Sin migración: no hay datos.
**Resultado:** los clientes pueden registrar sus obras.

### FASE 3 — El proyecto los referencia (opcionales) ✅ HECHA (D-67)

Agrega `registroPatronalId` y `registroObraId` como **opcionales**, con las
validaciones de pertenencia (5–8 de tu lista). El alta ya los acepta y los valida
si vienen. `GET` los devuelve resueltos.
**Resultado:** se pueden crear proyectos con el modelo nuevo sin invalidar los 3
que ya existen.

### FASE 4 — Obligatorios y reglas de edición

Poblar los 3 proyectos existentes (**M4**, a mano), volver los campos
obligatorios y aplicar las reglas de qué se puede cambiar. _Depende de: G3._
**Resultado:** la regla «todo proyecto tiene exactamente un registro patronal y
uno de obra» queda garantizada.

### FASE 5 — Contratos y SIROC

Colección `contracts` con el SIROC embebido, y sus endpoints. _Depende de: G1, G4._
**Resultado:** un proyecto puede dividirse en contratos y cada uno registrar su
SIROC.

### FASE 6 — Coherencia con empleados

La validación de G2 al asignar, y la cadena resuelta
(`empleado → empresa → registro patronal → proyecto → registro de obra`) en la
respuesta del detalle. **Sin duplicar ids.** _Depende de: G2._
**Resultado:** se puede responder la trazabilidad completa desde la API.

### FASE 7 — Vincular la adscripción a su registro patronal _(opcional)_

`affiliations.registroPatronalId` + **M3**, y que el importador lo resuelva.
**Resultado:** la cadena deja de depender de comparar cadenas de texto.

### FASE 8 — Limpieza

Borrar respaldos de las migraciones, actualizar `ARQUITECTURA-DATOS.md`, y el
mensaje de cambios para el front.
