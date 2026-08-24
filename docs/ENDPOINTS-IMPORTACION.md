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

## Lo que la importación NO hace

- **No da de baja a quien desaparece del archivo.** Que alguien no venga en el
  archivo de este mes no significa que se fue: sólo un `Baja` explícito lo da de
  baja, y **de esa empresa**, no del sistema.
- **No crea accesos a la plataforma.** Los importados entran como personas sin
  login. Dar acceso sigue siendo `POST /empleados/:id/acceso`, uno por uno.
- **No cambia el puesto de quien ya existe.** Si el archivo trae otro puesto, sale
  en `avisos` y se cambia desde el empleado.
- **No pisa datos de la persona capturados a mano.** En la persona el archivo sólo
  **rellena lo que está vacío**; en la relación laboral (contrato, departamento,
  nómina) sí manda el archivo.
- **No toca las adscripciones a otras empresas**, ni el expediente, ni los
  documentos.
- **No crea empresas** ni **asigna a proyectos**.
- **No guarda el archivo.** Se procesa en memoria y se descarta.
