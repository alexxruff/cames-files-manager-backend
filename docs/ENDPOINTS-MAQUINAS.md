# El catálogo de maquinaria

Referencia de los **6 endpoints** de la maquinaria por empresa (tarea #30,
D-86) para el equipo de front. Base: `/api/v1`. Envelope, códigos y
convenciones generales: [`INTEGRACION-FRONTEND.md`](./INTEGRACION-FRONTEND.md).

> **Qué es.** Cada empresa tiene su catálogo de **maquinaria y equipo de
> trabajo**. Una máquina tiene tres datos —el identificador con el que la
> empresa la conoce, el modelo y una foto— y se da de alta, se edita, se da de
> baja y se reactiva. **Sólo se ve dentro del alcance de la empresa.** Asignarla
> a un trabajador y verla en su obra es la tarea #31; las incidencias, la #34.

## Índice

| #   | Endpoint                      | Quién                    |
| --- | ----------------------------- | ------------------------ |
| 1   | `GET /empresas/:id/maquinas`  | sesión                   |
| 2   | `POST /empresas/:id/maquinas` | `rh_admin` · `jefe_area` |
| 3   | `GET /maquinas/:id`           | sesión                   |
| 4   | `PATCH /maquinas/:id`         | `rh_admin` · `jefe_area` |
| 5   | `PATCH /maquinas/:id/estado`  | `rh_admin` · `jefe_area` |
| 6   | `GET /maquinas/:id/imagen`    | sesión                   |

«Sesión» es cualquier usuario con alcance sobre la empresa. `rh_consulta`
consulta y no escribe: la capacidad es `manageProjects`, la misma que los
proyectos y los contratos, porque la maquinaria es de la obra.

---

## La forma de una máquina

Es la misma en las seis respuestas:

```jsonc
{
  "_id": "66f1…",
  "empresaId": "66a0…",
  "identificador": "ECO-12", // tal como se tecleó
  "modelo": "CAT 320D",
  "imagen": {
    // null si no tiene
    "nombre": "foto patio (1).png", // el original, para mostrar
    "nombreDescarga": "ECO-12.png", // con el que se guarda al bajarla (D-78)
    "mime": "image/png",
    "tamanoBytes": 184320,
    "previsualizable": true, // siempre true: sólo entran imágenes
    "subidoPor": "Ana Ruiz",
    "subidoEn": "2026-09-03T15:22:04.113Z",
    "url": "https://…" // FIRMADA, caduca a los 10 minutos
  },
  "activo": true,
  "createdAt": "2026-09-03T15:22:04.113Z",
  "updatedAt": "2026-09-03T15:22:04.113Z"
}
```

```ts
interface Maquina {
  _id: string
  empresaId: string
  identificador: string
  modelo: string
  imagen: Adjunto | null // el mismo `Adjunto` del contrato y del registro de obra
  activo: boolean
  createdAt: string
  updatedAt: string
}
```

**No trae** quién la tiene ni en qué obra está: eso llega con la #31 y se
resolverá al leer.

---

## 1. `GET /empresas/:id/maquinas`

El catálogo de la empresa. **Sin paginar**, ordenado por identificador con
orden natural (`ECO-2` antes que `ECO-10`).

| Query              | Tipo    | Por omisión | Qué hace                                                  |
| ------------------ | ------- | ----------- | --------------------------------------------------------- |
| `incluirInactivas` | boolean | `false`     | Suma las de baja. Sin esto, sólo las activas              |
| `busqueda`         | string  | —           | Por identificador **o** modelo, sin acentos ni mayúsculas |

```jsonc
// data
{
  "total": 2,
  "maquinas": [ { …Maquina }, { …Maquina } ]
}
```

- `404` si la empresa no está al alcance de la sesión. **No es `403`** y no es
  lista vacía: para esa sesión, la empresa no existe.

## 2. `POST /empresas/:id/maquinas` → `201`

Dos formas de mandarla, y las dos devuelven `{ maquina }`:

```jsonc
// application/json — sin foto, o con la foto ya subida directo a R2 (D-83)
{ "identificador": "ECO-12", "modelo": "CAT 320D", "subidaId": "…" }
```

```
// multipart/form-data — la foto viaja en el campo `archivo`
identificador = ECO-12
modelo        = CAT 320D
archivo       = <foto.png>
```

| Campo           | Tipo   | Obligatorio | Regla                                                                                  |
| --------------- | ------ | :---------: | -------------------------------------------------------------------------------------- |
| `identificador` | string |     sí      | 1–60 caracteres; **único dentro de la empresa**                                        |
| `modelo`        | string |     sí      | 1–120 caracteres                                                                       |
| `archivo`       | file   |     no      | Sólo en `multipart`. JPG, PNG o WEBP, hasta 30 MB                                      |
| `subidaId`      | string |     no      | Sólo en JSON: el permiso de `POST /subidas`, destino `maquina`, `referencia.empresaId` |

**El identificador se compara sin acentos, sin mayúsculas y con los espacios
colapsados**: `Eco 12` y `ECO 12` son la misma máquina; `ECO-12` y `ECO 12` no
(el guión cuenta). Chocar responde:

```jsonc
// 409
{
  "status": "error",
  "message": "Esa empresa ya tiene una máquina con ese identificador",
  "code": "MAQUINA_DUPLICADA",
  "errors": [{ "msg": "Ya existe una máquina con ese identificador", "path": "identificador" }],
  "data": { "maquina": { …Maquina } } // la que ya está, por si quieren abrirla desde el aviso
}
```

## 3. `GET /maquinas/:id`

La ficha: `{ maquina }`. `404` si es de una empresa fuera de alcance; las de
baja **sí** se devuelven (el catálogo las esconde, la ficha no).

## 4. `PATCH /maquinas/:id`

Identificador, modelo y/o la foto. Acepta lo mismo que el alta —JSON o
`multipart`— y **todos los campos son opcionales**, con dos reglas:

- **Mandar sólo la foto, sin ningún campo, es válido**: es cómo se le pone la
  imagen a una máquina ya dada de alta, o se cambia la que tiene. En
  `multipart` es el `archivo` solo; en JSON es `{ "subidaId": "…" }` con el
  permiso pedido para `referencia.maquinaId`.
- **Reemplazar la foto borra la anterior.** No hay versiones.

Un cuerpo vacío sin archivo es `400` «No hay nada que actualizar». `activo` y
`empresaId` no van aquí: el `400` dice por dónde va cada uno.

Responde `{ maquina }` con `message` `«Máquina actualizada»` o `«Máquina
actualizada con su imagen»`.

## 5. `PATCH /maquinas/:id/estado`

```jsonc
{ "activo": false } // la baja
{ "activo": true } // la reactivación
```

`{ maquina }`. `400` si ya estaba en ese estado. Una máquina de baja **no se
borra**: sigue en su ficha y aparece en el catálogo con `incluirInactivas=true`.
Desde la #31, además, no se podrá asignar.

## 6. `GET /maquinas/:id/imagen`

Un enlace fresco a la foto, porque la `url` que viene dentro de cada máquina
caduca a los 10 minutos y una ficha lleva abierta más que eso.

```jsonc
// data
{ "imagen": { …Adjunto, "url": "https://…" } }
```

`?descargar=true` fuerza la descarga en vez de abrirla. `404` si la máquina no
tiene imagen, o si está fuera de alcance.

---

## La foto por subida directa (D-83)

Igual que el contrato escaneado, en tres pasos:

```
1. POST /subidas  { destino: "maquina", referencia: { empresaId } ó { maquinaId }, nombre, mime, tamanoBytes }
2. PUT <url>      la foto, directo a R2
3. POST /empresas/:id/maquinas  ó  PATCH /maquinas/:id   con { subidaId } en el cuerpo
```

`empresaId` cuando la máquina **todavía no existe** (la foto viaja en el alta);
`maquinaId` cuando ya está y se le pone o cambia la foto. Un permiso pedido con
`empresaId` **no sirve** para el `PATCH` de una máquina, ni al revés: `400` con
`errors[0].path = "subidaId"`. El paso a paso completo está en
[`ENDPOINTS-SUBIDAS.md`](./ENDPOINTS-SUBIDAS.md).

## Errores

| Código | Cuándo                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------ |
| `400`  | Sin `identificador` o `modelo` al dar de alta; `PATCH` sin nada; campo que no va; `activo` no booleano |
| `400`  | `subidaId` que no es de esta máquina/empresa, ya usado, caducado, o cuyo archivo no llegó              |
| `401`  | Sin sesión                                                                                             |
| `403`  | Escribir sin `manageProjects` (`rh_consulta`)                                                          |
| `404`  | Empresa o máquina fuera de alcance; `GET …/imagen` sin foto                                            |
| `409`  | `MAQUINA_DUPLICADA` — el identificador ya está en esa empresa                                          |
| `413`  | La foto pasa de 30 MB                                                                                  |
| `415`  | La «foto» no es JPG, PNG ni WEBP: un PDF, un Word, un HEIC. El mensaje dice qué llegó                  |
