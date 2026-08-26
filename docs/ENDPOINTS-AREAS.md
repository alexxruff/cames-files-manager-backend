# Áreas — `/areas`

Catálogo de áreas de la organización (D-58). Antes era un enum fijo del backend
(`src/enums/area.ts` en el front); ahora es una colección y **el front tiene que
leerlo de aquí**, no de una lista propia.

## Lo que cambia para el front

1. **Las áreas se piden a `GET /areas`.** La lista quemada en el front hay que
   quitarla: los valores cambiaron y ya no son fijos.
2. **El valor del contrato es `clave`**, no `nombre`. `clave` es lo que se manda
   en `areas` de una adscripción y en `?area=` de los filtros; `nombre` es lo que
   se muestra.
3. **Hay áreas que no estaban**: las que crea el archivo de nómina (`temporal:
true`), casi siempre una obra.

## Las nueve base

| `clave`                    | `nombre`                   |
| -------------------------- | -------------------------- |
| `direccion`                | Dirección                  |
| `recursos_humanos`         | Recursos Humanos (RH)      |
| `finanzas`                 | Finanzas                   |
| `operaciones_maquinaria`   | Operaciones (Maquinaria)   |
| `operaciones_urbanizadora` | Operaciones (Urbanizadora) |
| `costos_y_presupuestos`    | Costos y Presupuestos      |
| `comercial`                | Comercial                  |
| `tesoreria`                | Tesorería                  |
| `contabilidad`             | Contabilidad               |

Vienen con `esBase: true` y **no se pueden dar de baja**.

## `GET /areas`

Cualquiera con sesión. Pueblan los desplegables del alta y de las adscripciones.

| Filtro     | Valores                      | Defecto |
| ---------- | ---------------------------- | ------- |
| `activa`   | `true` \| `false` \| `todos` | `true`  |
| `temporal` | `true` \| `false`            | —       |

`activa=false` trae **sólo** las dadas de baja, no una mezcla — misma regla que
`activo` en empleados (D-52). `temporal=true` es la lista que RH revisa para ir
cerrando obras terminadas.

```jsonc
// data
{
  "areas": [
    {
      "_id": "…",
      "clave": "operaciones_urbanizadora", // ← el valor del contrato
      "nombre": "Operaciones (Urbanizadora)", // ← lo que se muestra
      "esBase": true,
      "temporal": false,
      "activa": true,
      "createdAt": "…",
      "updatedAt": "…"
    },
    {
      "_id": "…",
      "clave": "axis_zapopan",
      "nombre": "Axis Zapopan",
      "esBase": false,
      "temporal": true, // ← la creó el archivo de nómina
      "activa": true
    }
  ]
}
```

Vienen ordenadas: primero las base, luego el resto por nombre.

## `POST /areas` — dar de alta

**Administrador de plataforma** (`alcanceGlobal`). **Idempotente por nombre**,
igual que las categorías: si ya existe, responde `200` con la que hay en vez de
`409`, así que no hace falta preguntar antes de crear.

```jsonc
// petición
{ "nombre": "Jurídico y Cumplimiento" }

// data — 201 si se creó, 200 si ya existía
{ "area": { "clave": "juridico_y_cumplimiento", "nombre": "Jurídico y Cumplimiento", … } }
```

La `clave` **no se manda**: la deriva el backend del nombre y es inmutable.

Si el área existe pero está dada de baja, se devuelve tal cual **sin
reactivarla**: crear no debería deshacer una baja sin que nadie lo pida. Para
reactivarla, `PATCH /areas/:id/estado`.

## `PATCH /areas/:id` — renombrar

**Administrador de plataforma.** Sólo `nombre`. La `clave` no cambia nunca: las
adscripciones la guardan, y cambiarla las dejaría huérfanas.

`409` si el nombre ya es de otra área.

## `PATCH /areas/:id/estado` — dar de baja y reactivar

```jsonc
{ "activa": false }
```

**Dar de baja no borra**: el área se conserva, deja de ofrecerse y se puede
reactivar cuando haga falta.

**Quién puede:**

| Área             | Quién                                      |
| ---------------- | ------------------------------------------ |
| `temporal: true` | `rh_admin` y `rh_consulta` — cierran obras |
| Cualquier otra   | Administrador de plataforma                |
| `esBase: true`   | **Nadie**: `400`                           |

Un `jefe_area` no cierra ninguna.

| Código | Cuándo                                                                      |
| ------ | --------------------------------------------------------------------------- |
| `400`  | Es un área base; o **alguien todavía la tiene asignada** (dice cuántos)     |
| `403`  | No tienes permiso para esa área (el mensaje distingue temporal de catálogo) |
| `404`  | No existe                                                                   |

```jsonc
// 400 con gente dentro
{
  "status": "fail",
  "message": "No se puede dar de baja: 12 personas la tienen asignada. Reasígnalas primero."
}
```

Primero se reasigna —subiendo el archivo de nómina o a mano— y luego se da de
baja.

## Dónde se usan las claves

- `POST /empleados` → `adscripcion.areas: ["operaciones_urbanizadora"]`
- `POST /empresas/:id/adscripciones` y `PATCH /adscripciones/:id` → `areas`
- Filtros `?area=` de `/empleados`, `/expedientes`, `/alertas` y
  `/empresas/:id/adscripciones`

**Guardar exige un área activa; filtrar no.** Un `?area=` con un área dada de
baja funciona a propósito: ahí es donde está la gente que hay que reasignar. Un
área que no existe responde `400` en los dos casos.

## Áreas temporales y el archivo de nómina

La columna `Departamento` **es** el área. Lo que no coincide con el catálogo entra
como área temporal, y la importación lo reporta en `areasNuevas`. Detalle en
`ENDPOINTS-IMPORTACION.md`.
