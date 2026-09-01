# Contrato de la API

Referencia interna y breve. El detalle por endpoint —peticiones, respuestas y
catálogo de errores— vive en
[`INTEGRACION-FRONTEND.md`](./INTEGRACION-FRONTEND.md), que es el documento que se
le entrega al front; aquí no se duplica para que no se desincronicen.

- **Modelo autoritativo:** [`modelo-datos.md`](./modelo-datos.md)
- **Contrato y catálogo completo de rutas:** [`backend-spec.md`](./backend-spec.md)
- **Estado de implementación:** [`ESTADO.md`](./ESTADO.md)

Base: `/api/v1`.

## Reglas transversales

```json
{ "status": "success" | "fail" | "error", "message": "…", "data": { } }
```

- Datos **anidados bajo llave nombrada**; nunca sueltos.
- Errores de validación: `errors: [{ msg, path }]`, en español y mostrables.
- `_id` string, nunca `id`. Opcionales en `null`, nunca `''`.
- Fechas de calendario `'YYYY-MM-DD'` (String); marcas de tiempo ISO 8601 UTC.
- Códigos: `200` · `201` · `204` · `400` · `401` · `403` · `404` (no existe **o no
  es visible**) · `409` · `410` (movido) · `413` · `415` · `429`.
- `X-Request-Id` en toda respuesta.
- Nada de estado derivado en la base ni leído del cliente: el servidor recalcula.
- Los archivos se piden por **URL firmada temporal**; el backend nunca devuelve la
  ubicación real en el bucket.

## Rutas públicas

Sólo estas cinco: `POST /auth/login`, `GET /api/v1` (inventario), `GET /health`,
`GET /ready` y `GET /version`. Todo lo demás exige sesión y pasa por el
middleware de alcance.

`GET /version` es pública **a propósito**: quien despliega necesita saber qué
commit quedó arriba antes de tener sesión. Devuelve identidad de release y nada
más —cuatro campos, sin entorno, sin configuración, sin dependencias— y viaja con
`Cache-Control: no-store`, porque una respuesta cacheada mentiría sobre lo que
está corriendo:

```json
{
  "status": "success",
  "data": {
    "schemaVersion": 1,
    "service": "cames-api",
    "commit": "0f3c1b…40 hex",
    "builtAt": "2026-08-30T12:34:56Z"
  }
}
```

`commit` y `builtAt` se hornean en la imagen (`Dockerfile`); la construcción
falla si faltan o vienen malformados, así que **nunca dicen `"unknown"`**. Fuera
de un contenedor construido así llegan en `null`.

## Implementado hoy

La columna **«llave de `data`»** dice bajo qué nombre viene la carga útil, que es
lo que hay que escribir para leerla (`data.expediente`, no `data.expedientes`).
Sale de los controladores y los servicios, no de memoria. Recuerden la regla #1:
los datos **siempre** van anidados bajo una llave con nombre, nunca sueltos en
`data`. Un renglón con varias llaves las trae todas en la misma respuesta; los
listados paginados traen además `total`, `pagina` y `porPagina` al lado de la
lista, no dentro.

| Método | Ruta                                                       | Permiso                      | Llave de `data`                                                                                                                                  | Nota                                                                                                                                    |
| ------ | ---------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/`                                                        | —                            | `version` · `base` · `implementados` · `pendientes` · `nota`                                                                                     | Inventario: `implementados` se deriva del router, `pendientes` del spec                                                                 |
| GET    | `/health` · `/ready`                                       | —                            | `timestamp`; `/ready` suma `baseDeDatos`                                                                                                         | Liveness y readiness (el segundo verifica Mongo)                                                                                        |
| GET    | `/version`                                                 | —                            | `schemaVersion` · `service` · `commit` · `builtAt`                                                                                               | Identidad del release: `schemaVersion`, `service`, `commit`, `builtAt`. `no-store`                                                      |
| POST   | `/auth/login`                                              | —                            | `user` · `token`                                                                                                                                 | `data: { user, token }` con el `AuthUser` nuevo                                                                                         |
| GET    | `/auth/me`                                                 | sesión                       | `user`                                                                                                                                           | Revalida; 401 si cambió la contraseña o le quitaron el acceso                                                                           |
| POST   | `/auth/logout`                                             | sesión                       | `data: null`                                                                                                                                     | `data: null`                                                                                                                            |
| POST   | `/auth/cambiar-password`                                   | sesión                       | `user` · `token`                                                                                                                                 | Invalida las demás sesiones y **devuelve token nuevo**                                                                                  |
| GET    | `/empleados`                                               | ver empleados                | `empleados[]` + `total` · `pagina` · `porPagina`                                                                                                 | Paginado, con alcance por empresa y filtros; orden por número con o sin `empresaId` (D-53); `activo` en tres estados (D-51, D-52)       |
| POST   | `/empleados`                                               | quien puede crear ese `tipo` | `empleado`                                                                                                                                       | Persona + adscripción en transacción (D-33); duplicados (D-34); `numeroEmpleado` obligatorio (D-54); `tipo` sale de la categoría (D-59) |
| GET    | `/empleados/:id`                                           | ver empleados                | `empleado`                                                                                                                                       | 404 si no es visible                                                                                                                    |
| PATCH  | `/empleados/:id`                                           | quien puede crear ese `tipo` | `empleado`                                                                                                                                       | Datos de la persona (D-54); cambiar `categoriaId` cambia el `tipo` (D-59); no toca acceso, estado ni adscripciones                      |
| PATCH  | `/empleados/:id/estado`                                    | `rh_admin`                   | `empleado`                                                                                                                                       | Baja lógica con motivo, o reactivación                                                                                                  |
| POST   | `/empleados/:id/acceso`                                    | `rh_admin`                   | `empleado`                                                                                                                                       | Da acceso a una persona existente                                                                                                       |
| PATCH  | `/empleados/:id/acceso`                                    | `rh_admin`                   | `empleado`                                                                                                                                       | Nivel, alcance, correo, activar                                                                                                         |
| DELETE | `/empleados/:id/acceso`                                    | `rh_admin`                   | sin cuerpo (204)                                                                                                                                 | Quita el acceso; la persona queda                                                                                                       |
| POST   | `/empleados/:id/acceso/restablecer-password`               | `rh_admin`                   | `empleado`                                                                                                                                       | Cierra sus sesiones                                                                                                                     |
| GET    | `/empresas` · `/empresas/:id`                              | sesión                       | `empresas[]`, cada renglón `{ empresa, conteos }`; por id, `empresa` · `conteos`                                                                 | Las suyas, con conteos reales de empleados, cartera y proyectos en curso                                                                |
| POST   | `/empresas`                                                | admin de plataforma          | `empresa` · `conteos`                                                                                                                            | 409 en nombre o RFC repetidos                                                                                                           |
| PATCH  | `/empresas/:id`                                            | admin de plataforma          | `empresa` · `conteos`                                                                                                                            | Nombre, RFC, branding y configuración. **Ya no acepta `registrosPatronales`**: tienen rutas propias (D-65)                              |
| POST   | `/empresas/:id/registros-patronales`                       | admin de plataforma          | `empresa` · `registro`                                                                                                                           | Registros patronales de la empresa; únicos dentro de ella (D-65)                                                                        |
| PATCH  | `/empresas/:id/registros-patronales/:rpId`                 | admin de plataforma          | `empresa` · `registro`                                                                                                                           | Número y descripción                                                                                                                    |
| PATCH  | `/empresas/:id/registros-patronales/:rpId/estado`          | admin de plataforma          | `empresa` · `registro`                                                                                                                           | Baja y reactivación; 400 si un proyecto en curso lo usa                                                                                 |
| PATCH  | `/empresas/:id/estado`                                     | admin de plataforma          | `empresa` · `conteos`                                                                                                                            | Baja y reactivación; 400 si tiene gente adscrita o proyectos abiertos (D-64)                                                            |
| GET    | `/categorias`                                              | sesión                       | `categorias[]`                                                                                                                                   | Pueblan el desplegable del alta; filtro `?tipo=`                                                                                        |
| POST   | `/categorias`                                              | admin de plataforma          | `categoria`                                                                                                                                      | Idempotente por nombre: 200 si ya existía                                                                                               |
| PATCH  | `/categorias/:id/estado`                                   | admin de plataforma          | `categoria`                                                                                                                                      | 400 si hay personas con ese puesto                                                                                                      |
| GET    | `/areas`                                                   | sesión                       | `areas[]`                                                                                                                                        | Catálogo de áreas (D-58); `?activa=` en tres estados y `?temporal=`                                                                     |
| POST   | `/areas`                                                   | admin de plataforma          | `area`                                                                                                                                           | Idempotente por nombre: 200 si ya existía                                                                                               |
| PATCH  | `/areas/:id`                                               | admin de plataforma          | `area`                                                                                                                                           | Renombra; la `clave` es inmutable                                                                                                       |
| PATCH  | `/areas/:id/estado`                                        | admin plataforma / RH        | `area`                                                                                                                                           | Baja y reactivación. Las **temporales** las cierra RH; 400 si alguien la tiene (D-58)                                                   |
| GET    | `/clientes` · `/clientes/:id`                              | sesión                       | `clientes[]` + `total` · `pagina` · `porPagina`; por id, `cliente`                                                                               | Los de las carteras propias; `?catalogoCompleto=true` exige administrar clientes (D-40)                                                 |
| POST   | `/clientes`                                                | `rh_admin` o `jefe_area`     | `cliente`                                                                                                                                        | 409 en nombre o RFC repetidos                                                                                                           |
| PATCH  | `/clientes/:id`                                            | `rh_admin` o `jefe_area`     | `cliente`                                                                                                                                        | Nombre, RFC y contactos                                                                                                                 |
| PATCH  | `/clientes/:id/estado`                                     | `rh_admin` o `jefe_area`     | `cliente`                                                                                                                                        | Baja lógica; no hay borrado real (D-36)                                                                                                 |
| POST   | `/clientes/:id/registros-obra`                             | `rh_admin` o `jefe_area`     | `cliente` · `registro`                                                                                                                           | Registros de obra del cliente; idempotente por número (D-66)                                                                            |
| PATCH  | `/clientes/:id/registros-obra/:roId`                       | `rh_admin` o `jefe_area`     | `cliente` · `registro`                                                                                                                           | Número y descripción                                                                                                                    |
| PATCH  | `/clientes/:id/registros-obra/:roId/estado`                | `rh_admin` o `jefe_area`     | `cliente` · `registro`                                                                                                                           | Baja y reactivación                                                                                                                     |
| GET    | `/empresas/:id/clientes`                                   | sesión                       | `cartera[]` (el vínculo, con su `cliente` resuelto dentro)                                                                                       | La cartera de la empresa, con el cliente resuelto                                                                                       |
| POST   | `/empresas/:id/clientes`                                   | `rh_admin` o `jefe_area`     | `cartera`                                                                                                                                        | Mete un cliente a la cartera; 200 si reactiva un vínculo previo                                                                         |
| PATCH  | `/carteras/:id` · `/carteras/:id/estado`                   | `rh_admin` o `jefe_area`     | `cartera`                                                                                                                                        | Contacto y notas; sacar falla si hay proyectos con ese cliente                                                                          |
| GET    | `/proyectos` · `/proyectos/:id`                            | sesión                       | `proyectos[]` + `total` · `pagina` · `porPagina`; por id, `proyecto`                                                                             | Paginado, por alcance. Trae `diasParaCierre` derivado                                                                                   |
| POST   | `/proyectos`                                               | `rh_admin` o `jefe_area`     | `proyecto`                                                                                                                                       | Exige cliente **en cartera activa**, ≥1 categoría y **`registroPatronalId` + `registroObraId`** (D-69)                                  |
| PATCH  | `/proyectos/:id`                                           | `rh_admin` o `jefe_area`     | `proyecto`                                                                                                                                       | **Rechaza** `fechaFinEstimada` (D-38); los registros se cambian pero no se vacían (D-69) y se traban con los contratos (D-70)           |
| POST   | `/proyectos/:id/aplazar`                                   | `rh_admin` o `jefe_area`     | `proyecto`                                                                                                                                       | Única forma de mover el cierre; exige motivo y queda en el historial                                                                    |
| POST   | `/proyectos/:id/finalizar`                                 | `rh_admin` o `jefe_area`     | `proyecto`                                                                                                                                       | Cierra también las asignaciones abiertas                                                                                                |
| POST   | `/proyectos/:id/reabrir`                                   | `rh_admin` o `jefe_area`     | `proyecto`                                                                                                                                       | Limpia `fechaFinReal`; no reabre asignaciones                                                                                           |
| POST   | `/proyectos/:id/categorias/clonar`                         | `rh_admin` o `jefe_area`     | `proyecto` · `agregadas`                                                                                                                         | Suma sin quitar ni duplicar                                                                                                             |
| GET    | `/proyectos/:id/asignaciones`                              | sesión                       | `asignaciones[]`                                                                                                                                 | `?activo=`; activas primero. Cada renglón trae `registroPatronalCoincide` en tres estados (D-71)                                        |
| GET    | `/proyectos/:id/asignables`                                | asignar a proyectos          | `asignables[]`                                                                                                                                   | El selector: adscritos, activos, con categoría habilitada y sin asignar                                                                 |
| POST   | `/proyectos/:id/asignaciones`                              | asignar a proyectos          | `asignacion` · `avisos[]`                                                                                                                        | Exige adscripción activa y categoría habilitada; **avisa sin bloquear** si el registro patronal no coincide (D-71)                      |
| GET    | `/asignaciones/:id`                                        | sesión                       | `asignacion` · `trazabilidad`                                                                                                                    | El detalle con la **cadena resuelta**: empleado → empresa → registro patronal → proyecto → registro de obra (D-71)                      |
| PATCH  | `/asignaciones/:id/salida`                                 | asignar a proyectos          | `asignacion`                                                                                                                                     | Cierra, no borra                                                                                                                        |
| GET    | `/proyectos/:id/contratos`                                 | sesión                       | `contratos[]`                                                                                                                                    | Contratos del proyecto por número; `?incluirInactivos=true` (D-70)                                                                      |
| POST   | `/proyectos/:id/contratos`                                 | `rh_admin` o `jefe_area`     | `contrato`                                                                                                                                       | El `numero` **lo asigna el servidor**; 400 si el proyecto está finalizado (D-70)                                                        |
| PATCH  | `/contratos/:id`                                           | `rh_admin` o `jefe_area`     | `contrato`                                                                                                                                       | Nombre, fase y fechas. El SIROC y el estado van por sus rutas                                                                           |
| PUT    | `/contratos/:id/siroc`                                     | `rh_admin` o `jefe_area`     | `contrato`                                                                                                                                       | Registra o corrige el SIROC entero; **409 `SIROC_DUPLICADO`** si el número ya existe (G4)                                               |
| DELETE | `/contratos/:id/siroc`                                     | `rh_admin` o `jefe_area`     | `contrato`                                                                                                                                       | Lo quita y libera el número; 400 si no tenía                                                                                            |
| POST   | `/contratos/:id/finalizar` · `/contratos/:id/reabrir`      | `rh_admin` o `jefe_area`     | `contrato`                                                                                                                                       | Mueven `estado`; no se reabre si el proyecto está finalizado                                                                            |
| PATCH  | `/contratos/:id/estado`                                    | `rh_admin` o `jefe_area`     | `contrato`                                                                                                                                       | Mueve `activo` (la baja), que **no es lo mismo** que `estado` (D-70)                                                                    |
| GET    | `/expedientes`                                             | ver empleados                | `expedientes[]` + `total` · `pagina` · `porPagina`                                                                                               | Paginado; mismos filtros que `/empleados` **más `estatus`** (D-45)                                                                      |
| GET    | `/empleados/:id/expediente`                                | ver empleados                | `expediente` · `empleado` · `avance`                                                                                                             | Crea el expediente si no existía; `data: { expediente, empleado, avance }`                                                              |
| GET    | `/expedientes/:id`                                         | ver empleados                | `expediente` · `empleado` · `avance`                                                                                                             | Lo mismo por id de expediente; 404 si el empleado no es visible                                                                         |
| POST   | `/expedientes/:id/documentos/:tipo`                        | subir documentos             | `expediente` · `empleado` · `avance`                                                                                                             | `multipart`, campo `archivo`. Versiona; 413 >10 MB, 415 si no es PDF/JPG/PNG/WEBP                                                       |
| GET    | `/expedientes/:id/documentos/:tipo/versiones/:version/url` | ver documentos               | `url` · `expiraEnSegundos` · `archivo`                                                                                                           | URL firmada temporal; **queda en la bitácora** (D-41)                                                                                   |
| POST   | `/expedientes/:id/documentos/:tipo/revisar`                | `rh_admin` · `rh_consulta`   | `expediente` · `empleado` · `avance`                                                                                                             | `{ aprobado, motivo? }`: valida o rechaza la versión en revisión (D-43, D-44)                                                           |
| GET    | `/empresas/:id/adscripciones`                              | ver empleados                | `adscripciones[]`                                                                                                                                | `?activo=&area=&tipo=&categoriaId=&orden=`; el jefe de área sólo ve sus propias áreas (D-45, D-51)                                      |
| POST   | `/empresas/:id/adscripciones`                              | `rh_admin`                   | `adscripcion`                                                                                                                                    | Vincula a alguien que ya existe; 200 si reactiva una adscripción previa (D-45)                                                          |
| PATCH  | `/adscripciones/:id`                                       | `rh_admin`                   | `adscripcion`                                                                                                                                    | areas, tipoContrato, fechas y **`registroPatronalId`** (D-72); re-sincroniza el checklist                                               |
| PATCH  | `/adscripciones/:id/estado`                                | `rh_admin`                   | `adscripcion`                                                                                                                                    | Baja **de esa empresa**; cierra sus asignaciones abiertas ahí (D-45)                                                                    |
| PATCH  | `/adscripciones/:id/jefaturas`                             | `rh_admin`                   | `adscripcion`                                                                                                                                    | Qué áreas **dirige** esa persona en esa empresa (D-60)                                                                                  |
| GET    | `/empresas/:id/jefaturas`                                  | `rh_admin`                   | `jefaturas[]`                                                                                                                                    | Quién dirige cada área; incluye las que nadie dirige (D-60)                                                                             |
| POST   | `/empleados/importar/previsualizar`                        | `rh_admin`                   | `aplicado` · `archivo` · `empresa` · `resumen` · `categoriasNuevas` · `areasNuevas` · `areasReactivadas` · `nuevos` · `yaExisten` · `conError`   | `multipart`: `archivo` (.xlsx) + `empresaId`. **No escribe nada** (D-46)                                                                |
| POST   | `/empleados/importar`                                      | `rh_admin`                   | `aplicado` · `archivo` · `empresa` · `resumen` · `categoriasNuevas` · `areasNuevas` · `areasReactivadas` · `nuevos` · `yaExisten` · `conError`   | Igual, más `confirmarRfcDistinto?`. Idempotente: re-subir no duplica (D-46)                                                             |
| GET    | `/alertas`                                                 | ver empleados                | `grupos[]` —o `alertas[]` con `agrupar=ninguno`— + `resumen` · `total` · `totalAlertas` · `totalEmpleados` · `agrupado` · `pagina` · `porPagina` | Bandeja derivada; **agrupada por empleado y paginada** (D-47, D-48)                                                                     |
| ALL    | `/usuarios*`                                               | —                            | — (410, va por `errors[0].msg`)                                                                                                                  | **410** con las rutas nuevas (se borra cuando el front migre)                                                                           |

### Importación de colaboradores desde .xlsx

Las dos rutas reciben `multipart/form-data` con el archivo en el campo `archivo`
y devuelven **la misma forma**: `previsualizar` con `aplicado: false` y sin haber
escrito nada, `importar` con `aplicado: true` y lo que de verdad pasó. Ver D-46.

```ts
interface ResultadoImportacion {
  aplicado: boolean
  archivo: {
    hoja: string
    filaEncabezados: number
    empresa: string | null // del encabezado del reporte
    rfc: string | null // del encabezado del reporte
    filas: number
  }
  empresa: {
    _id: string
    nombre: string
    rfc: string | null
    /** true, false, o null si no se pudo comparar (falta un RFC de los dos). */
    rfcCoincide: boolean | null
  }
  resumen: {
    filas: number
    nuevos: number // personas que no existían
    seAdscriben: number // existían, pero no en esta empresa
    seReactivan: number // estaban de baja de esta empresa y vuelven
    seDanDeBaja: number // el archivo dice Baja y estaban activas
    actualizan: number
    sinCambios: number
    yaExisten: number // suma de los cinco anteriores
    conError: number
    /**
     * Filas que necesitan una decisión: el archivo chocó con un cambio hecho a
     * mano y NO se aplicó (D-57). Se cruza con las anteriores, no se suma.
     */
    conConflicto: number
  }
  categoriasNuevas: { nombre: string; tipo: TipoEmpleado; filas: number }[]
  nuevos: {
    fila: number // renglón del .xlsx, para que el usuario lo ubique
    empleadoId: string | null // null en la previsualización
    nombre: string
    curp: string | null
    numeroEmpleado: string | null
    puesto: string | null
    tipo: TipoEmpleado
    estatus: string | null // 'Alta' | 'Baja' | 'Reingreso', tal como viene
    areas: Area[]
    departamento: string | null
    avisos: string[]
  }[]
  yaExisten: {
    fila: number
    empleadoId: string
    nombre: string
    curp: string | null
    numeroEmpleado: string | null
    accion: 'adscribir' | 'reactivar' | 'dar_de_baja' | 'actualizar' | 'sin_cambios'
    // Lo que el archivo NO aplicó por chocar con un cambio manual (D-57).
    conflictos: {
      campo: 'estatus' | 'tipoContrato' | 'fechaIngreso'
      enElArchivo: string
      enLaPlataforma: string
      enLaImportacionAnterior: string
      cambiadoEn: string | null // 'YYYY-MM-DD', sólo en la baja
      mensaje: string // mostrable tal cual
    }[]
    // Datos de la persona que difieren. NUNCA se pisan: informativo (D-57).
    diferencias: {
      campo: string
      enElArchivo: string
      enLaPlataforma: string
      mensaje: string
    }[]
    cambios: string[] // qué campos va a cambiar (o cambió). 'estatus' = alta/baja
    //                   en ESA empresa; 'activo' = alta/baja del sistema (D-55, D-56)
    avisos: string[]
  }[]
  conError: {
    fila: number
    nombre: string | null
    curp: string | null
    motivo: string // el primero, mostrable tal cual
    motivos: string[]
  }[]
  avisos: string[] // del archivo entero
}
```

**Códigos.** `200` la previsualización · `201` la importación · `400` faltan
columnas, no viene el archivo o no viene `empresaId` · `403` no es `rh_admin` ·
`404` la empresa no está en su alcance · `409` con `code: 'RFC_DISTINTO'` cuando
el RFC del archivo no es el de la empresa (en `data` va la previsualización
completa; para continuar, reenviar con `confirmarRfcDistinto: true`) · `413` el
archivo pasa de 10 MB · `415` no es un .xlsx.

**Las filas malas no detienen a las buenas.** Un archivo con 2 filas sin CURP y
143 correctas responde `201`, importa las 143 y las 2 salen en `conError` con su
número de renglón.

### Contratos y SIROC (D-70)

Un contrato **es una fase**: cada fase de la obra tiene exactamente un contrato,
y un proyecto de un solo contrato no tiene fases. Por eso `nombre` y `fase` son
los dos opcionales.

**`nombre` y `fase` son campos distintos del mismo contrato** (D-75): `nombre` es
cómo se llama el contrato y `fase` el alias con el que la obra lo nombra. Se
mandan en el alta, se editan por `PATCH /contratos/:id` y se vacían mandando `""`
o `null` —vuelven a `null`, nunca a cadena vacía—. Los contratos anteriores a
este cambio salen con `"fase": null`.

```jsonc
{
  "_id": "66f...",
  "proyectoId": "66f...",
  "numero": 1, // secuencia dentro del proyecto; la pone el servidor
  "nombre": "Contrato 001-A", // nombre del contrato, o null
  "fase": "Fase 1", // etiqueta de la fase, o null
  "fechaInicio": "2026-09-01",
  "fechaFin": "2026-12-31",
  "siroc": null, // o { numero, fechaRegistro, vigenciaHasta }
  "estado": "en_curso", // en_curso | finalizado
  "activo": true,
  "createdAt": "…",
  "updatedAt": "…"
}
```

**`estado` y `activo` no son lo mismo.** `finalizado` es un contrato que terminó
bien; `activo: false` es uno capturado por error o cancelado. Van por rutas
distintas a propósito: `POST /contratos/:id/finalizar` mueve el primero,
`PATCH /contratos/:id/estado` el segundo.

**El SIROC es único en TODO el sistema.** Repetirlo responde `409` con el
contrato y el proyecto que ya lo tienen, para que quien captura vea dónde está el
choque:

```jsonc
{
  "status": "fail",
  "message": "El SIROC SIR-2026-0001 ya está registrado en el contrato 1 de Torre Andares",
  "code": "SIROC_DUPLICADO",
  "data": {
    "contratoId": "66f…",
    "contratoNumero": 1,
    "proyectoId": "66f…",
    "proyectoNombre": "Torre Andares"
  }
}
```

**Qué deja de poderse cambiar en el proyecto cuando hay contratos** (G3). Los
candados miran el **cambio**, no la presencia: reenviar el mismo id en el
formulario completo sigue funcionando.

| Campo del proyecto   | Se bloquea cuando                    | `errors[0].path`     |
| -------------------- | ------------------------------------ | -------------------- |
| `registroPatronalId` | hay ≥1 contrato activo               | `registroPatronalId` |
| `registroObraId`     | hay ≥1 contrato activo **con SIROC** | `registroObraId`     |
| `clienteId`          | hay ≥1 contrato activo               | `clienteId`          |
| `empresaId`          | siempre                              | —                    |

Dar de baja el contrato lo saca de la cuenta, y quitar su SIROC libera el
registro de obra.

### Coherencia del registro patronal y trazabilidad (D-71)

Una persona puede cotizar en un registro patronal distinto al del proyecto al que
se le asigna. **Eso avisa, no bloquea** (G2): Maquinaria CAMES ya tiene 144
personas repartidas en cuatro registros y bloquear frenaría trabajo legítimo.

`POST /proyectos/:id/asignaciones` responde **201 igual**, con el aviso en
`data.avisos` y repetido en `message`:

```jsonc
{
  "status": "success",
  "message": "Ana Ruiz cotiza en el registro patronal R13-77767-10-5 y este proyecto es del H67-29973-10-5. La asignación queda registrada; revisa si hay que moverla de registro.",
  "data": {
    "asignacion": {},
    "avisos": ["…"] // vacío cuando no hay nada que advertir
  }
}
```

`registroPatronalCoincide` tiene **tres estados**, y `null` no es `false`:

| Valor   | Significa                                                          |
| ------- | ------------------------------------------------------------------ |
| `true`  | coinciden (ignorando guiones, espacios y mayúsculas)               |
| `false` | la persona cotiza en otro registro                                 |
| `null`  | **no se pudo comparar**: su adscripción no tiene registro patronal |

Sale en cada renglón de `GET /proyectos/:id/asignaciones`, junto con
`registroPatronalEmpleado` (el texto de su adscripción, no el del proyecto).

`GET /asignaciones/:id` devuelve el detalle con la **cadena completa resuelta al
leer**. No hay ningún id nuevo guardado en la asignación: todo se cruza en la
consulta, así que corregir el registro de la adscripción se refleja solo.

```jsonc
{
  "asignacion": {}, // más empleadoNombre, empleadoTipo, categoriaNombre
  "trazabilidad": {
    "empleado": { "_id": "66f…", "nombre": "Ana Ruiz" },
    "empresa": { "_id": "66f…", "nombre": "Maquinaria CAMES" },
    "adscripcionId": "66f…", // el eslabón: de ahí sale el registro de la persona
    "adscripcionActiva": true,
    "registroPatronalEmpleado": "R13-77767-10-5", // texto libre, o null
    "proyecto": { "_id": "66f…", "nombre": "Torre Andares" },
    "registroPatronal": {
      "_id": "66f…",
      "numero": "H67-29973-10-5",
      "descripcion": null,
      "activo": true
    },
    "cliente": { "_id": "66f…", "nombre": "Inmobiliaria X" },
    "registroObra": {
      "_id": "66f…",
      "numero": "OB-0012",
      "descripcion": null,
      "activo": true
    },
    "registroPatronalCoincide": false
  },
  "avisos": ["…"]
}
```

Lo lee cualquier sesión con alcance sobre el proyecto —mirar quién está en la
obra no es moverlo—, y responde **404** si el proyecto no es visible.

`registroPatronalId` en la adscripción (D-72) vincula la relación laboral con el
catálogo de su empresa, y **convive** con `condiciones.registroPatronal`, que
sigue siendo el texto crudo del archivo de nómina. Cuando el vínculo existe, el
número de la persona sale del catálogo —canónico— y no del texto; por eso
`registroPatronalCoincide` de una adscripción vinculada es exacto por
construcción. `null` mientras la migración M3 no lo haya resuelto: el respaldo
sigue siendo el texto.

### `AuthUser`

```ts
{
  _id: string            // id del empleado
  name: string
  email: string          // acceso.email
  nivelAcceso: 'rh_admin' | 'rh_consulta' | 'jefe_area'
  alcanceGlobal: boolean
  /**
   * `true` = la contraseña la puso otra persona (un administrador, o el
   * bootstrap). Mientras lo sea, TODA la API responde 403 con
   * `code: 'PASSWORD_TEMPORAL'` salvo `/auth/me`, `/auth/logout` y
   * `/auth/cambiar-password`. Ver D-49.
   */
  passwordTemporal: boolean
  empresas: { _id: string; nombre: string; areas: Area[] }[]
  active: boolean
  ultimoAccesoEn: string | null
  createdAt: string
  updatedAt: string
}
```

Desaparecieron `role`, `area`, `alcance` y `clienteId` respecto al modelo anterior.

### Contraseña temporal (D-49)

Cuando un administrador da acceso o repone una contraseña —y en el administrador
inicial del bootstrap— la contraseña queda **temporal**. La sesión es válida, pero
**toda la API responde `403` con `code: 'PASSWORD_TEMPORAL'`** hasta que la persona
la cambie.

Sólo funcionan tres rutas: `GET /auth/me`, `POST /auth/logout` y
`POST /auth/cambiar-password` (que sigue exigiendo `passwordActual` y las reglas de
complejidad).

`AuthUser.passwordTemporal` lo anuncia al iniciar sesión, así que el front puede
redirigir sin esperar el 403. Es `403` y no `401` a propósito: la sesión sirve, lo
que falta es un requisito — con un `401` el front cerraría la sesión y entraría en
bucle.

### Alcance y permisos

- `req.empresasVisibles` — `null` = todas (`acceso.alcanceGlobal`), o los ids de
  las empresas con adscripción activa.
- `req.areasPorEmpresa` — `{ empresaId: [areas] }` para el jefe de área.
- `empresaId` de la petición sólo **acota**; nunca amplía. Fuera de alcance: 404.
- Capacidades en `src/utils/permissions.js`; los catálogos compartidos exigen
  `alcanceGlobal`.
- **Quién puede qué: `modelo-datos.md` §8.2, y sólo ahí.** Es la única tabla de
  permisos del proyecto y una prueba la compara celda por celda contra el código.
  La columna «Permiso» de la tabla de abajo dice qué hace falta para cada ruta;
  el detalle por nivel, en §8.2.

## Pendiente

Ver la tabla de `ESTADO.md` y `backend-spec.md` §6. Las rutas están reservadas:
responden `404` y no deben ocuparse con otra cosa. `GET /api/v1` las lista en
`pendientes`.
