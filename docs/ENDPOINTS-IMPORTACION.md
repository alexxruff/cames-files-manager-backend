# Importar colaboradores desde el .xlsx de nómina

Referencia de los **2 endpoints nuevos**. Base: `/api/v1`. Envelope, códigos y
convenciones generales: [`INTEGRACION-FRONTEND.md`](./INTEGRACION-FRONTEND.md).
El por qué de cada decisión: `DECISIONES.md` D-46.

| #   | Endpoint                                 | Quién      | Escribe |
| --- | ---------------------------------------- | ---------- | ------- |
| 1   | `POST /empleados/importar/previsualizar` | `rh_admin` | **No**  |
| 2   | `POST /empleados/importar`               | `rh_admin` | Sí      |

> **El flujo es de dos pasos, y el primero es el importante.** Se sube el
> archivo, se **ve** qué va a pasar —quiénes se suman, quiénes ya estaban, qué
> filas están mal— y sólo entonces se aplica. Los dos endpoints reciben el
> archivo y devuelven **exactamente la misma forma**, así que la pantalla se
> escribe una vez.
>
> **Se puede volver a subir el mismo archivo cuantas veces se quiera.** No
> duplica a nadie: reconoce a quien ya existe por su CURP y sólo agrega a los
> nuevos. Es el caso normal, no la excepción.

---

## Cómo se manda

`multipart/form-data`, no JSON. Manda los campos de texto **antes** del archivo.

| Campo                  | Tipo     | Obligatorio | Qué es                                      |
| ---------------------- | -------- | ----------- | ------------------------------------------- |
| `archivo`              | file     | sí          | El .xlsx. Máximo 10 MB                      |
| `empresaId`            | string   | sí          | A qué empresa se importa el personal        |
| `confirmarRfcDistinto` | `'true'` | no          | Sólo tras un `409 RFC_DISTINTO` (ver abajo) |

```ts
const cuerpo = new FormData()
cuerpo.append('empresaId', empresaId)
cuerpo.append('archivo', archivo) // <input type="file">

const res = await fetch('/api/v1/empleados/importar/previsualizar', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` }, // NO pongas Content-Type
  body: cuerpo
})
```

**No fijes `Content-Type` a mano**: el navegador tiene que poner el `boundary`.

---

## 1. `POST /empleados/importar/previsualizar` → 200

No escribe **nada**. Es la pantalla de «esto es lo que va a pasar».

## 2. `POST /empleados/importar` → 201

Aplica. Devuelve el mismo objeto con `aplicado: true` y los `empleadoId` reales.

### La respuesta de las dos

```jsonc
// data
{
  "aplicado": false, // true en /importar

  // Lo que dice el ENCABEZADO del reporte, no la empresa destino
  "archivo": {
    "hoja": "Hoja 1",
    "filaEncabezados": 5,
    "empresa": "MAQUINARIA CAMES",
    "rfc": "MCA180611HF1",
    "filas": 145
  },

  // La empresa a la que se está importando
  "empresa": {
    "_id": "…",
    "nombre": "Maquinaria Cames",
    "rfc": "MCA180611HF1",
    "rfcCoincide": true // false = el archivo es de otra empresa. null = no se pudo comparar
  },

  "resumen": {
    "filas": 145,
    "nuevos": 145, // no existían: se van a crear
    "seAdscriben": 0, // existen en el grupo, pero no en esta empresa
    "seReactivan": 0, // estaban de baja de esta empresa y vuelven
    "seDanDeBaja": 0, // el archivo dice Baja y en la base están activas
    "actualizan": 0,
    "sinCambios": 0,
    "yaExisten": 0, // la suma de los cinco de arriba
    "conError": 0
  },

  // Puestos del archivo que no están en el catálogo. Se crean al importar
  "categoriasNuevas": [{ "nombre": "Operador", "tipo": "mano_de_obra", "filas": 60 }],

  "nuevos": [
    {
      "fila": 6, // renglón del .xlsx: es lo que el usuario busca en su archivo
      "empleadoId": null, // el id real, sólo en /importar
      "nombre": "JOSE LUCIANO GONZALEZ MEZA",
      "curp": "GOML820525HJCNZC06",
      "numeroEmpleado": "0001",
      "puesto": "Operador",
      "tipo": "mano_de_obra",
      "estatus": "Alta",
      "areas": ["obra"],
      "departamento": "Operaciones",
      "avisos": []
    }
  ],

  "yaExisten": [
    {
      "fila": 7,
      "empleadoId": "…",
      "nombre": "FRANCISCO JAVIER IBARRA JIMENEZ",
      "curp": "IAJF640808HNTBMR07",
      "numeroEmpleado": "0007",
      "accion": "actualizar",
      "cambios": ["telefono", "nomina"],
      "avisos": []
    }
  ],

  "conError": [
    {
      "fila": 40,
      "nombre": "MARIA LOPEZ",
      "curp": null,
      "motivo": "La fila no trae CURP, y sin ella no se puede reconocer a la persona al volver a importar",
      "motivos": ["…"] // todos, por si quieres mostrarlos
    }
  ],

  "avisos": [
    "99 personas entran con contrato temporal SIN fecha de término: el archivo no la trae. Hay que capturarla para que su contrato tenga vigencia."
  ]
}
```

### `accion`: qué le va a pasar a alguien que ya existe

| `accion`      | Qué hace                                                            |
| ------------- | ------------------------------------------------------------------- |
| `adscribir`   | Existe en el grupo pero no en esta empresa: **sólo la adscribe**    |
| `reactivar`   | Estaba de baja de esta empresa y el archivo la trae de alta         |
| `dar_de_baja` | El archivo dice `Baja` y en la base está activa **en esta empresa** |
| `actualizar`  | Cambia algo: los campos van en `cambios`                            |
| `sin_cambios` | Nada que hacer. Es lo normal al re-subir el mismo archivo           |

### La columna `Estatus` y quién queda dado de baja (D-55)

`Alta` y `Reingreso` entran activos; `Baja`, no. Esa baja es **de la empresa** y
va en la adscripción, pero además:

- **Si con esa baja no le queda ninguna empresa activa, se le da de baja también
  del sistema** (`empleado.activo: false`). Antes no: la persona quedaba activa
  sin ninguna adscripción vigente y no salía ni en `activo=true` ni en
  `activo=false`.
- **Si sigue activa en otra empresa del grupo, NO se le da de baja del sistema.**
  Sale en `avisos`.
- **Un `Reingreso` la reactiva** — pero sólo si la baja anterior la había puesto
  una importación. Una baja capturada a mano (un despido) no la deshace un
  archivo; también sale en `avisos`.

Todo esto aparece en la **previsualización**, no sólo al aplicar.

### Cómo se ve un cambio de estatus en el renglón (D-56)

Re-subir el archivo no sirve sólo para dar de alta a los que faltan: sirve para
revisar **qué cambió** en los que ya están. Cuando el `Estatus` de alguien es
distinto al que tiene registrado, su renglón de `yaExisten` trae:

- `accion`: `dar_de_baja` o `reactivar`.
- `cambios`: incluye **`'estatus'`** — el alta/baja **en esa empresa**. Si además
  alcanza al sistema, incluye también **`'activo'`** — el alta/baja **de la
  persona**. Son dos cosas distintas y por eso son dos nombres distintos.
- `avisos`: una frase con el antes y el después, mostrable tal cual —
  _«El estatus cambió: estaba de alta en Maquinaria Cames y el archivo la trae
  como "Baja"»_ — y, cuando aplica, si se da de baja del sistema o si sigue
  activa por tener otra empresa del grupo.

Una fila que sólo cambia el estado cuenta como `actualizar` o
`dar_de_baja`/`reactivar`, **nunca** como `sin_cambios`. Y al revés: re-subir el
mismo archivo sin cambios deja `cambios: []` y `avisos: []` — no se inventa
ruido.

---

## Lo que hay que saber para armar la pantalla

### `fila` es el renglón del Excel

Los datos empiezan en la fila 6 (los encabezados están en la 5). Muestra el
número tal cual: es con lo que la persona encuentra el renglón en su archivo.

### Las filas malas no detienen a las buenas

Un archivo con 143 filas correctas y 2 sin CURP responde **201**, importa las 143
y las 2 salen en `conError`. No hay «todo o nada».

### `avisos` va en dos niveles

- `data.avisos` — del archivo entero. Ahí sale el de los contratos temporales.
- `nuevos[].avisos` / `yaExisten[].avisos` — de esa persona. Por ejemplo:
  «"Axis Zapopan" no es un área de la organización (parece una obra)».

### Errores

| Código | Cuándo                                                                             |
| ------ | ---------------------------------------------------------------------------------- |
| `400`  | Faltan columnas (el mensaje las nombra), no viene el archivo, no viene `empresaId` |
| `403`  | No es `rh_admin`                                                                   |
| `404`  | La empresa no está en su alcance                                                   |
| `409`  | `code: 'RFC_DISTINTO'` — ver abajo                                                 |
| `413`  | El archivo pasa de 10 MB                                                           |
| `415`  | No es un .xlsx                                                                     |

### El `409 RFC_DISTINTO`

Si el RFC del encabezado del archivo no es el de la empresa destino, `/importar`
responde `409` **sin escribir nada**, y en `data` va la previsualización completa
para que la pantalla pueda mostrar qué se iba a importar. Para continuar, reenvía
lo mismo con `confirmarRfcDistinto: 'true'`.

Es el candado contra el error caro: meter a los 145 de una empresa en otra son
145 personas, 145 adscripciones y 145 expedientes que hay que deshacer a mano.
La previsualización ya trae `empresa.rfcCoincide`, así que se puede avisar antes.

---

## La columna `Departamento` es el área (D-58)

Antes se traducía con un mapa fijo del backend, y lo que no estaba en el mapa
caía a un área inventada (`obra` / `administracion`). Ahora **cada departamento
es un área del catálogo**:

- Si coincide con una del catálogo (por nombre o por clave), se usa esa.
- Si no, **se da de alta como área TEMPORAL** — casi siempre una obra. Sale en
  `areasNuevas`, y en los `avisos` de la fila la primera vez.
- Si existe pero está **dada de baja**, se reactiva y se avisa: el archivo dice
  que hay gente ahí otra vez. Sale en `areasReactivadas`.
- **Sin departamento**, la persona queda **sin área** y con `'areas'` en
  `datosPendientes`. Antes se le inventaba una.

```jsonc
"areasNuevas": [{ "nombre": "Axis Zapopan", "clave": "axis_zapopan", "filas": 12 }],
"areasReactivadas": [],
"avisos": ["El archivo usa 3 áreas temporales (Axis Zapopan, Axis 3, Plenares): dales de baja cuando la obra termine."]
```

Igual que `categoriasNuevas`: en la **previsualización** son las que se van a
crear —sin crearlas—, y al aplicar las que se crearon de verdad.

El aviso por renglón sale sólo la primera vez, cuando el área se crea. Repetirlo
en cada importación serían 145 avisos al mes que nadie lee; para eso está el
aviso general y `GET /areas?temporal=true`.

RH da de baja las temporales cuando la obra termina, desde `/areas` (ver
`ENDPOINTS-AREAS.md`). No hace falta ser administrador de plataforma.

**El archivo reasigna el área**, ya no sólo la rellena: es lo que corrige a quien
quedó con un área del modelo anterior. Pero si alguien la curó a mano, es
**conflicto** y no se pisa — ver abajo.

## El archivo contra lo que se corrigió a mano (D-57)

Es lo que hace útil re-subir el archivo cada mes: no sólo trae a los que faltan,
también **avisa cuándo el archivo contradice algo que se cambió en la
plataforma** — y no lo pisa.

### Cómo lo distingue

Cada importación deja registrado qué dijo el archivo. Al subir el siguiente se
comparan tres valores: lo que dijo el archivo anterior, lo que hay hoy en la
plataforma y lo que trae el archivo nuevo.

| Archivo anterior | Plataforma | Archivo nuevo | Resultado                           |
| ---------------- | ---------- | ------------- | ----------------------------------- |
| `Alta`           | `Alta`     | `Baja`        | novedad del archivo → **se aplica** |
| `Alta`           | `Baja`     | `Alta`        | lo cambiaron a mano → **conflicto** |

### `conflictos` — lo que NO se aplicó

Cada renglón de `yaExisten` trae `conflictos: []`, y cuando hay algo:

```jsonc
"conflictos": [
  {
    "campo": "estatus",                    // estatus | tipoContrato | fechaIngreso | areas
    "enElArchivo": "alta",
    "enLaPlataforma": "baja",
    "enLaImportacionAnterior": "alta",
    "cambiadoEn": "2026-08-26",            // fecha de la baja; null si no aplica
    "mensaje": "El archivo dice que el estatus es \"alta\", pero en la plataforma se cambió a \"baja\" el 2026-08-26 (Maquinaria Cames). Se conserva lo de la plataforma; para que gane el archivo, vuelve a enviarlo con esta persona en forzarArchivoPara."
  }
]
```

**Gana la plataforma.** El campo no se toca y la fila cuenta en
`resumen.conConflicto`. Es a propósito: el archivo se vuelve a subir cuando se
quiera, una corrección hecha a mano no se recupera.

### Cómo elige el usuario

Se vuelve a enviar con **`forzarArchivoPara`**, los `empleadoId` —los de la misma
previsualización— cuyo conflicto se resuelve a favor del archivo. Se acepta
repetido (`forzarArchivoPara=a&forzarArchivoPara=b`) o separado por comas, y
funciona igual en previsualizar, para ver el efecto antes de aplicar.

Es **por persona**, no un interruptor global: aceptar el archivo para uno no
debería aceptarlo para los otros 144. Fuerza **todos** los conflictos de esa
persona.

Si se resuelve a favor de la plataforma, el mes que viene el archivo volverá a
traer lo mismo y el conflicto **volverá a aparecer**: la discrepancia sigue ahí.

### `diferencias` — lo que difiere pero nunca se pisa

Los datos de la persona (nombre, CURP, teléfono, correo…) el archivo **sólo los
rellena si están vacíos**, nunca los pisa. Cuando difieren, ahora se dicen:

```jsonc
"diferencias": [
  {
    "campo": "telefono",
    "enElArchivo": "3311112222",
    "enLaPlataforma": "3399999999",
    "mensaje": "El archivo trae el teléfono \"3311112222\" y en la plataforma está \"3399999999\": se conserva lo de la plataforma"
  }
]
```

No son conflictos y no piden decisión: son informativos.

### Sólo tres campos pueden entrar en conflicto

`estatus`, `tipoContrato`, `fechaIngreso` y `areas` (D-58). Son los únicos que
el importador escribe **y** se pueden cambiar a mano. `departamento` y `nomina`
sólo los escribe el importador, y los datos de la persona nunca se pisan.

### En adscripciones viejas empieza a funcionar en la segunda subida

Las que ya existían antes de esta versión no tienen contra qué comparar: esa
importación se comporta como siempre (manda el archivo) y deja el registro. De
ahí en adelante la detección funciona.

## Lo que la importación NO hace

- **No da de baja a quien desaparece del archivo.** Que alguien no venga en el
  archivo de este mes no significa que se fue: sólo un `Baja` explícito lo da de
  baja. Esa baja es **de esa empresa**, y alcanza al sistema únicamente cuando no
  le queda ninguna otra empresa activa (D-55).
- **No crea accesos a la plataforma.** Los importados entran como personas sin
  login. Dar acceso sigue siendo `POST /empleados/:id/acceso`, uno por uno.
- **No cambia el puesto de quien ya existe.** Si el archivo trae otro puesto, sale
  en `avisos` y se cambia desde el empleado.
- **No pisa datos de la persona capturados a mano.** En la persona el archivo sólo
  **rellena lo que está vacío**, y lo que difiere sale en `diferencias` (D-57). En
  la relación laboral manda el archivo, **salvo** que choque con un cambio hecho a
  mano: eso sale en `conflictos` y no se aplica hasta que se pida (D-57).
- **No toca las adscripciones a otras empresas**, ni el expediente, ni los
  documentos.
- **No crea empresas** ni **asigna a proyectos**.
- **No guarda el archivo.** Se procesa en memoria y se descarta.
