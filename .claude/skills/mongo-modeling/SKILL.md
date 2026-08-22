---
name: mongo-modeling
description: Cómo modelar colecciones en este proyecto — eje multi-cliente clienteId, fechas de calendario como String, toJSON, índices, invariantes, embebido vs colección aparte. Úsala al crear o modificar cualquier esquema de Mongoose o consulta.
---

# Modelado en MongoDB

## 1. El alcance se DERIVA de los vínculos, no es un campo

Con empleados y clientes **globales** (catálogos compartidos), «lo que puedo ver»
ya no es un `clienteId` en el documento: se calcula cruzando las **adscripciones**
activas del usuario (modelo-datos §8.1).

```js
// scopeMiddleware deja esto en cada petición
req.empresasVisibles // ids, o null = todas (acceso.alcanceGlobal)
req.areasPorEmpresa // { empresaId: [areas] }, para el jefe de área
```

Reglas que no se negocian:

- **Toda consulta de datos de empleados cruza `affiliations`.** Un `find` directo
  sobre `employees` sin ese cruce devuelve gente de otras empresas.
- **`empresaId` nunca se lee del body ni del query para decidir alcance.** Si
  llega, sólo **acota** dentro de lo visible (`empresaFiltro`).
- **Fuera de alcance responde 404, no 403.**
- Sólo cuentan las adscripciones **activas**, salvo `incluirInactivos=true`.
- Una prueba por endpoint que verifique que la Empresa A no alcanza datos de la B
  (`tests/integracion/scope.test.js`).

## 1b. El usuario es un empleado con `acceso`

No hay colección de usuarios. `empleados.acceso` guarda la autorización
(`email`, `nivelAcceso`, `alcanceGlobal`, `activo`, `passwordActualizadaEn`) y el
**secreto vive en `credentials`** (D-27).

**No vuelvas a embeber el `passwordHash` en el empleado**, aunque parezca más
simple: las agregaciones y los `$lookup` ignoran `select: false`, y el listado de
empleados es precisamente una agregación con `$lookup`. Hay una prueba que lo
demuestra (`tests/unitarias/credentialIsolation.test.js`).

## 2. Fechas de calendario como `String`

```js
fechaIngreso:  { type: String, required: true }  // 'YYYY-MM-DD'
vigenciaHasta: { type: String, default: null }   // 'YYYY-MM-DD'
subidoEn:      { type: Date, required: true }    // marca de tiempo → Date
```

Guardar una fecha civil como `Date` la lleva a medianoche UTC y en México se lee
un día antes. Es un bug que ya se corrigió en el front: no lo reintroduzcas.
Toda la aritmética va en `utils/dates.js` (`addMonths` respeta el fin de mes,
`daysBetween` cuenta días completos, `today()` usa la zona de negocio).

## 3. Nada de estatus derivados en la base

`expiring`, `expired`, `avance`, `porcentaje` y las alertas **se calculan al
leer**. Sólo se persisten los cuatro estatus de
`STORED_DOCUMENT_STATUSES` (`pending`, `in_review`, `validated`, `rejected`).
Persistir lo derivado lo desincroniza al día siguiente.

## 4. `toJSON` es parte del contrato

Cada modelo define su `toJSON` y ahí se cumple el contrato: `_id` en string,
sin `password`, sin `__v`, sin campos internos, opcionales en `null` y nunca
`''`. Ver `src/api/v1/users/userModel.js` como referencia.

## 5. Invariantes en el esquema, no en el controlador

Lo que nunca puede ser inválido se fuerza en `pre('validate')`, para que también
se cumpla desde un script, una migración o una prueba:

```js
schema.pre('validate', function (next) {
  if (this.nivelAcceso === 'jefe_area' && !this.area) {
    this.invalidate('area', 'Un jefe de área necesita un área asignada')
  } else if (this.nivelAcceso !== 'jefe_area') {
    this.area = null // se normaliza en silencio, no es error del usuario
  }
  next()
})
```

## 6. Índices

Declara los índices en el esquema y sincroniza con `npm run db:indices`
(en producción `autoIndex` está apagado a propósito). Los del spec §6.7:

```js
// colaboradores
{ clienteId: 1, activo: 1, area: 1 }
{ clienteId: 1, email: 1 }                 // unique, sparse
// expedientes
{ colaboradorId: 1 }                       // unique
{ clienteId: 1, updatedAt: -1 }
{ clienteId: 1, 'documentos.estatus': 1 }
{ 'documentos.vigenciaHasta': 1 }
```

No dupliques un índice que ya declaraste en el campo (`unique: true` ya crea
uno): Mongoose avisa y el índice extra cuesta escrituras.

## 7. Búsqueda insensible a acentos

Un `$regex` con `$options: 'i'` **no** hace que "Gomez" encuentre "Gómez". Cada
documento buscable guarda un campo normalizado (`nameNormalized`,
`nombreNormalizado`) mantenido en `pre('save')` **y** en los hooks de
`findOneAndUpdate`, y se consulta con `utils/text.js`:

```js
const filtro = buildSearchFilter(req.query.busqueda, {
  camposNormalizados: ['nameNormalized'],
  camposDirectos: ['email']
})
```

## 8. Embebido vs colección aparte

Se embebe cuando el hijo **siempre** se lee y se escribe con el padre y su
número está acotado: el checklist de 12 documentos con sus versiones va embebido
en `expedientes`. Se separa cuando crece sin techo o se consulta por sí mismo:
la bitácora de accesos es su propia colección.

## 9. Colecciones

Nombre de colección **explícito y en inglés** en cada esquema
(`collection: 'employees'`). Explícito porque el aislamiento respecto al backend
prestado no debe depender de que `MONGODB_DB_NAME` esté bien puesto.

| Modelo              | Colección             | Nombre en el spec    |
| ------------------- | --------------------- | -------------------- |
| `Company`           | `companies`           | empresas             |
| `Employee`          | `employees`           | empleados            |
| `Credential`        | `credentials`         | credenciales         |
| `Client`            | `clients`             | clientes             |
| `Category`          | `categories`          | categorías           |
| `Affiliation`       | `affiliations`        | adscripciones        |
| `Portfolio`         | `portfolios`          | carteras             |
| `Assignment`        | `assignments`         | asignaciones         |
| `Project`           | `projects`            | proyectos            |
| `Record`            | `records`             | expedientes          |
| `ChecklistTemplate` | `checklist_templates` | plantillas_checklist |
| `AccessLog`         | `access_logs`         | bitacora_accesos     |

**Al agregar un modelo, regístralo en `src/models/index.js`** o `populate()`
fallará en caliente con `MissingSchemaError` (D-31).

**Índices únicos sobre campos con `default: null`: usa `partialFilterExpression`,
no `sparse`.** Con un default el campo existe en el documento, así que un índice
disperso no lo omite y dos registros sin valor colisionan. Aplica a `curp` y a
`acceso.email`.

**Transacciones:** el modelo las exige (crear un empleado escribe su expediente;
dar acceso escribe empleado y credencial). El Mongo local es replica set por eso
(D-29); en pruebas se usa `MongoMemoryReplSet`.
