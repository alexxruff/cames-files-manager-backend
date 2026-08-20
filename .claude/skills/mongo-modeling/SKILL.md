---
name: mongo-modeling
description: Cómo modelar colecciones en este proyecto — eje multi-cliente clienteId, fechas de calendario como String, toJSON, índices, invariantes, embebido vs colección aparte. Úsala al crear o modificar cualquier esquema de Mongoose o consulta.
---

# Modelado en MongoDB

## 1. El eje multi-cliente: `clienteId` nulable

Todo documento que pertenezca a alguien lleva:

```js
clienteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null }
```

- **`clienteId: null` significa "pertenece a Urbacames"** (la casa). En fase 1
  absolutamente todo se crea con `null`.
- **El `clienteId` NUNCA se lee del body ni del query string.** Sale del usuario
  autenticado (`req.ownerClienteId`). Si llega `?clienteId=otro`, se ignora en
  silencio.
- En `expedientes` va **desnormalizado** (copia del colaborador) para evitar un
  `$lookup` en cada consulta. Si un colaborador cambia de cliente, se actualiza
  su expediente en la misma operación: es el único lugar donde hay que
  acordarse.

Toda consulta de datos de colaboradores incluye `req.scopeFilter`:

```js
// interno → {} · cliente → { clienteId: <el suyo> }
const filtro = { ...scopeFilter, ...areaFilter, activo: true }
```

Y **fuera de alcance se responde 404, no 403**: un 403 confirmaría que el
documento existe.

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
(`collection: 'app_users'`). Explícito porque el aislamiento respecto al backend
prestado no debe depender de que `MONGODB_DB_NAME` esté bien puesto.

| Modelo              | Colección             | Spec                   |
| ------------------- | --------------------- | ---------------------- |
| `User`              | `app_users`           | `usuarios`             |
| `Client`            | `clients`             | `clientes`             |
| `Employee`          | `employees`           | `colaboradores`        |
| `Record`            | `records`             | `expedientes`          |
| `ChecklistTemplate` | `checklist_templates` | `plantillas_checklist` |
| `AccessLog`         | `access_logs`         | `bitacora_accesos`     |
