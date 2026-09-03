# Subir archivos sin pasar por el servidor

Referencia del **1 endpoint** nuevo y de cómo cambia lo que ya hacen con
adjuntos. Base: `/api/v1`. Envelope y convenciones generales:
[`INTEGRACION-FRONTEND.md`](./INTEGRACION-FRONTEND.md).

> **Por qué existe esto (D-83).** Subir un contrato de 12 MB a producción nunca
> terminaba. No era el navegador ni el tamaño: el tramo del equipo al borde
> público de Fly va a **7 KB/s**, contra **1 MB/s** medido a Cloudflare. A esa
> velocidad 12 MB tardan media hora y la petición muere a los cinco minutos. Con
> esto el archivo va **directo a R2** y el servidor sólo autoriza y registra.

## Cómo se sube ahora, en tres pasos

```
1. POST /subidas            →  { subida: { _id, url, metodo, encabezados, expiraEn } }
2. PUT <url>                →  el archivo, directo a R2 (no pasa por la API)
3. la ruta de siempre       →  { subidaId: "<_id>" } en el cuerpo, como JSON
```

El paso 3 es **la misma ruta que ya usan** para adjuntar ese papel. Lo único que
cambia es el cuerpo: en vez de `multipart` con el archivo, JSON con `subidaId`.

**El `multipart` de hoy sigue funcionando.** No hay prisa ni migración forzada:
las dos formas conviven, y se apagará la vieja cuando ya no la llamen.

---

## 1. `POST /subidas` → `201`

Pide el permiso. Requiere sesión, y **la capacidad que exija el destino** — la
misma que la ruta que va a confirmar.

```jsonc
{
  "destino": "contrato",
  "referencia": { "contratoId": "…" },
  "nombre": "contrato-firmado.pdf", // el nombre real, para mostrarlo después
  "mime": "application/pdf", // opcional; el tipo REAL se comprueba al confirmar
  "tamanoBytes": 12530759 // el tamaño exacto del archivo
}
```

```jsonc
// data
{
  "subida": {
    "_id": "6a98…",
    "url": "https://cames-files.<cuenta>.r2.cloudflarestorage.com/…?X-Amz-…",
    "metodo": "PUT",
    "encabezados": {
      "Content-Type": "application/pdf",
      "Content-Length": "12530759"
    },
    "expiraEn": "2026-09-02T23:15:00.000Z"
  }
}
```

### Los cinco destinos

| `destino`             | `referencia` que exige           | Se confirma en                                                                                           |
| --------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `expediente`          | `expedienteId` + `tipoDocumento` | `POST /expedientes/:id/documentos/:tipo`                                                                 |
| `contrato`            | `contratoId` **o** `proyectoId`  | `PATCH /contratos/:id` · `POST /proyectos/:id/contratos`                                                 |
| `siroc-aviso`         | `contratoId`                     | `PUT /contratos/:id/siroc`                                                                               |
| `siroc-actualizacion` | `contratoId`                     | `POST /contratos/:id/siroc/actualizaciones` · `PUT /contratos/:id/siroc/actualizaciones/:indice/archivo` |
| `registro-obra`       | `clienteId`                      | `POST /clientes/:id/registros-obra` · `PATCH /clientes/:id/registros-obra/:roId`                         |

En `contrato` va `proyectoId` cuando el contrato **todavía no existe** —el papel
viaja en el alta— y `contratoId` cuando ya está capturado.

### Errores

| Código | Cuándo                                                                                       |
| ------ | -------------------------------------------------------------------------------------------- |
| `400`  | `destino` no válido, sin `nombre`, `tamanoBytes` no positivo                                 |
| `400`  | Falta un id que ese destino exige (`errors[0].path` lo dice)                                 |
| `413`  | `tamanoBytes` pasa de 30 MB                                                                  |
| `403`  | No tienen la capacidad de ese destino                                                        |
| `404`  | El recurso no existe **o es de otra empresa** — la misma respuesta que daría la confirmación |
| `401`  | Sin sesión                                                                                   |

---

## 2. `PUT <url>` — la subida, directa a R2

```js
await fetch(subida.url, {
  method: subida.metodo,
  headers: subida.encabezados,
  body: archivo // el File tal cual, sin FormData
})
```

Tres cosas que hay que respetar, y las tres vienen dadas en la respuesta:

1. **`Content-Length` va firmado**, y el navegador lo pone solo a partir del
   archivo — no se puede fijar a mano, es una cabecera prohibida para `fetch` y
   `XMLHttpRequest`. Pasarlo en `encabezados` no estorba: se ignora. Lo que
   importa es que el `tamanoBytes` que anunciaron sea **exactamente** el del
   archivo, porque si no, la firma no valida y R2 rechaza la subida. Sáquenlo de
   `File.size`.
2. **`Content-Type` también va firmado**, y ése sí lo mandan ustedes: el mismo
   `mime` que declararon.
3. **No es `FormData`.** El cuerpo es el archivo, en crudo.

R2 contesta `200` con el cuerpo vacío. La `url` caduca a los **15 minutos**.

> **CORS ya está puesto** en el bucket para `https://cames-expedientes.fly.dev` y
> `http://localhost:5174`, sólo `PUT`. Si levantan el front en otro puerto,
> avisen y se agrega.

---

## 3. Confirmar en la ruta del recurso

El mismo endpoint de siempre, con JSON:

```jsonc
// PATCH /api/v1/contratos/6a98…
{ "subidaId": "6a98…" }
```

Y la respuesta es la de siempre: el contrato con su `archivo`, ya firmado y listo
para abrir. Igual en los cinco destinos:

```jsonc
// POST /expedientes/:id/documentos/ine
{ "subidaId": "…", "vigenciaHasta": "2030-01-01" }

// PUT /contratos/:id/siroc
{ "numero": "SIR-2026-1", "fechaRegistro": "2026-02-01", "subidaId": "…" }

// POST /contratos/:id/siroc/actualizaciones
{ "fecha": "2026-04-01", "subidaId": "…" }

// PUT /contratos/:id/siroc/actualizaciones/0/archivo
{ "subidaId": "…" }

// POST /clientes/:id/registros-obra
{ "numero": "OB-2026-1", "subidaId": "…" }
```

### Qué se comprueba en este paso

Todo lo que se comprobaba antes, y en el mismo sitio:

- **El tipo real, por contenido.** El servidor pide a R2 los primeros 4 KB del
  objeto y reconoce su firma. Un `.pdf` que en realidad es otra cosa da `415` y
  **se borra**, como siempre (D-78).
- **El tamaño real**, contra el que se anunció.
- **Que el permiso sea de ese recurso**, siga vivo y **no se haya usado**.

### Errores de la confirmación

| Código | `message`                                                  | Cuándo                                               |
| ------ | ---------------------------------------------------------- | ---------------------------------------------------- |
| `400`  | `Ese permiso de subida no sirve para este archivo`         | `subidaId` de otro recurso, de otro destino, o falso |
| `400`  | `Ese permiso de subida ya se usó. Pide uno nuevo.`         | Reintento con el mismo id                            |
| `400`  | `El permiso de subida caducó. Vuelve a intentarlo.`        | Pasaron más de 15 minutos                            |
| `400`  | `El archivo no llegó al almacenamiento. Vuelve a subirlo.` | El `PUT` del paso 2 no llegó a completarse           |
| `400`  | `El archivo subido no es el que se anunció.`               | El tamaño real no coincide                           |
| `415`  | El de siempre, con los tipos aceptados                     | El contenido no es de un tipo permitido              |

Todos son recuperables pidiendo un permiso nuevo y volviendo a subir. **Ninguno
deja el documento a medias**: si la confirmación falla, el recurso se queda como
estaba.

---

## Lo que no cambia

- **Abrir y descargar**: idéntico. Las URL firmadas de lectura, sus 10 minutos y
  las rutas `…/archivo` siguen igual.
- **Los permisos**: quien podía adjuntar puede pedir el permiso; quien no, no.
- **El tope de 30 MB** y los tipos aceptados (D-78, D-81).
- **La importación de nómina** se queda por `multipart`, con su tope de 10 MB: ahí
  el servidor **lee** el archivo, no sólo lo guarda.

## Lo que conviene saber

- Si el navegador sube y nunca confirma —cierran la pestaña, se cae la red—, el
  archivo queda en una zona de espera invisible y se borra solo. **No hay que
  hacer nada**, ni existe forma de que el usuario lo vea.
- El permiso puede pedirse en cuanto el usuario elige el archivo, sin esperar a
  que llene el resto del formulario: caduca en 15 minutos y no reserva nada.
