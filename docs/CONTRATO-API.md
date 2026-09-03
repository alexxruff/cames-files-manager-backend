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

| Método | Ruta                                                       | Permiso                      | Llave de `data`                                                                                                                                  | Nota                                                                                                                                                               |
| ------ | ---------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/`                                                        | —                            | `version` · `base` · `implementados` · `pendientes` · `nota`                                                                                     | Inventario: `implementados` se deriva del router, `pendientes` del spec                                                                                            |
| GET    | `/health` · `/ready`                                       | —                            | `timestamp`; `/ready` suma `baseDeDatos`                                                                                                         | Liveness y readiness (el segundo verifica Mongo)                                                                                                                   |
| GET    | `/version`                                                 | —                            | `schemaVersion` · `service` · `commit` · `builtAt`                                                                                               | Identidad del release: `schemaVersion`, `service`, `commit`, `builtAt`. `no-store`                                                                                 |
| POST   | `/auth/login`                                              | —                            | `user` · `token`                                                                                                                                 | `data: { user, token }` con el `AuthUser` nuevo                                                                                                                    |
| GET    | `/auth/me`                                                 | sesión                       | `user`                                                                                                                                           | Revalida; 401 si cambió la contraseña o le quitaron el acceso                                                                                                      |
| POST   | `/auth/logout`                                             | sesión                       | `data: null`                                                                                                                                     | `data: null`                                                                                                                                                       |
| POST   | `/auth/cambiar-password`                                   | sesión                       | `user` · `token`                                                                                                                                 | Invalida las demás sesiones y **devuelve token nuevo**                                                                                                             |
| GET    | `/empleados`                                               | ver empleados                | `empleados[]` + `total` · `pagina` · `porPagina`                                                                                                 | Paginado, con alcance por empresa y filtros; orden por número con o sin `empresaId` (D-53); `activo` en tres estados (D-51, D-52)                                  |
| POST   | `/empleados`                                               | quien puede crear ese `tipo` | `empleado`                                                                                                                                       | Persona + adscripción en transacción (D-33); duplicados (D-34); `numeroEmpleado` obligatorio (D-54); `tipo` sale de la categoría (D-59)                            |
| GET    | `/empleados/:id`                                           | ver empleados                | `empleado`                                                                                                                                       | 404 si no es visible                                                                                                                                               |
| PATCH  | `/empleados/:id`                                           | quien puede crear ese `tipo` | `empleado`                                                                                                                                       | Datos de la persona (D-54); cambiar `categoriaId` cambia el `tipo` (D-59); no toca acceso, estado ni adscripciones                                                 |
| PATCH  | `/empleados/:id/estado`                                    | `rh_admin`                   | `empleado`                                                                                                                                       | Baja lógica con motivo, o reactivación                                                                                                                             |
| POST   | `/empleados/:id/acceso`                                    | `rh_admin`                   | `empleado`                                                                                                                                       | Da acceso a una persona existente                                                                                                                                  |
| PATCH  | `/empleados/:id/acceso`                                    | `rh_admin`                   | `empleado`                                                                                                                                       | Nivel, alcance, correo, activar                                                                                                                                    |
| DELETE | `/empleados/:id/acceso`                                    | `rh_admin`                   | sin cuerpo (204)                                                                                                                                 | Quita el acceso; la persona queda                                                                                                                                  |
| POST   | `/empleados/:id/acceso/restablecer-password`               | `rh_admin`                   | `empleado`                                                                                                                                       | Cierra sus sesiones                                                                                                                                                |
| GET    | `/empresas` · `/empresas/:id`                              | sesión                       | `empresas[]`, cada renglón `{ empresa, conteos }`; por id, `empresa` · `conteos`                                                                 | Las suyas, con conteos reales de empleados, cartera y proyectos en curso                                                                                           |
| POST   | `/empresas`                                                | admin de plataforma          | `empresa` · `conteos`                                                                                                                            | 409 en nombre o RFC repetidos                                                                                                                                      |
| PATCH  | `/empresas/:id`                                            | admin de plataforma          | `empresa` · `conteos`                                                                                                                            | Nombre, RFC, branding y configuración. **Ya no acepta `registrosPatronales`**: tienen rutas propias (D-65)                                                         |
| POST   | `/empresas/:id/registros-patronales`                       | admin de plataforma          | `empresa` · `registro`                                                                                                                           | Registros patronales de la empresa; únicos dentro de ella (D-65)                                                                                                   |
| PATCH  | `/empresas/:id/registros-patronales/:rpId`                 | admin de plataforma          | `empresa` · `registro`                                                                                                                           | Número y descripción                                                                                                                                               |
| PATCH  | `/empresas/:id/registros-patronales/:rpId/estado`          | admin de plataforma          | `empresa` · `registro`                                                                                                                           | Baja y reactivación; 400 si un proyecto en curso lo usa                                                                                                            |
| PATCH  | `/empresas/:id/estado`                                     | admin de plataforma          | `empresa` · `conteos`                                                                                                                            | Baja y reactivación; 400 si tiene gente adscrita o proyectos abiertos (D-64)                                                                                       |
| GET    | `/categorias`                                              | sesión                       | `categorias[]`                                                                                                                                   | Pueblan el desplegable del alta; filtro `?tipo=`                                                                                                                   |
| POST   | `/categorias`                                              | admin de plataforma          | `categoria`                                                                                                                                      | Idempotente por nombre: 200 si ya existía                                                                                                                          |
| PATCH  | `/categorias/:id/estado`                                   | admin de plataforma          | `categoria`                                                                                                                                      | 400 si hay personas con ese puesto                                                                                                                                 |
| GET    | `/areas`                                                   | sesión                       | `areas[]`                                                                                                                                        | Catálogo de áreas (D-58); `?activa=` en tres estados y `?temporal=`                                                                                                |
| POST   | `/areas`                                                   | admin de plataforma          | `area`                                                                                                                                           | Idempotente por nombre: 200 si ya existía                                                                                                                          |
| PATCH  | `/areas/:id`                                               | admin de plataforma          | `area`                                                                                                                                           | Renombra; la `clave` es inmutable                                                                                                                                  |
| PATCH  | `/areas/:id/estado`                                        | admin plataforma / RH        | `area`                                                                                                                                           | Baja y reactivación. Las **temporales** las cierra RH; 400 si alguien la tiene (D-58)                                                                              |
| GET    | `/clientes` · `/clientes/:id`                              | sesión                       | `clientes[]` + `total` · `pagina` · `porPagina`; por id, `cliente`                                                                               | Los de las carteras propias; `?catalogoCompleto=true` exige administrar clientes (D-40)                                                                            |
| POST   | `/clientes`                                                | `rh_admin` o `jefe_area`     | `cliente`                                                                                                                                        | 409 en nombre o RFC repetidos                                                                                                                                      |
| PATCH  | `/clientes/:id`                                            | `rh_admin` o `jefe_area`     | `cliente`                                                                                                                                        | Nombre, RFC y contactos                                                                                                                                            |
| PATCH  | `/clientes/:id/estado`                                     | `rh_admin` o `jefe_area`     | `cliente`                                                                                                                                        | Baja lógica; no hay borrado real (D-36)                                                                                                                            |
| POST   | `/clientes/:id/registros-obra`                             | `rh_admin` o `jefe_area`     | `cliente` · `registro`                                                                                                                           | Registros de obra del cliente; idempotente por número (D-66). JSON o `multipart` con `archivo` opcional (D-79)                                                     |
| PATCH  | `/clientes/:id/registros-obra/:roId`                       | `rh_admin` o `jefe_area`     | `cliente` · `registro`                                                                                                                           | Número, descripción y `archivo`: mandarlo **reemplaza** el anterior, que se borra (D-79)                                                                           |
| GET    | `/clientes/:id/registros-obra/:roId/archivo`               | sesión                       | `archivo`                                                                                                                                        | Enlace fresco al papel del registro; `?descargar=true`. 404 si no tiene archivo (D-79)                                                                             |
| PATCH  | `/clientes/:id/registros-obra/:roId/estado`                | `rh_admin` o `jefe_area`     | `cliente` · `registro`                                                                                                                           | Baja y reactivación                                                                                                                                                |
| GET    | `/empresas/:id/clientes`                                   | sesión                       | `cartera[]` (el vínculo, con su `cliente` resuelto dentro)                                                                                       | La cartera de la empresa, con el cliente resuelto                                                                                                                  |
| POST   | `/empresas/:id/clientes`                                   | `rh_admin` o `jefe_area`     | `cartera`                                                                                                                                        | Mete un cliente a la cartera; 200 si reactiva un vínculo previo                                                                                                    |
| PATCH  | `/carteras/:id` · `/carteras/:id/estado`                   | `rh_admin` o `jefe_area`     | `cartera`                                                                                                                                        | Contacto y notas; sacar falla si hay proyectos con ese cliente                                                                                                     |
| POST   | `/subidas`                                                 | según el destino             | `subida` (`_id` · `url` · `metodo` · `encabezados` · `expiraEn`)                                                                                 | Permiso para subir el archivo **directo a R2** (D-83). Se confirma con `subidaId` en la ruta del recurso; ver `ENDPOINTS-SUBIDAS.md`                               |
| GET    | `/proyectos` · `/proyectos/:id`                            | sesión                       | `proyectos[]` + `total` · `pagina` · `porPagina`; por id, `proyecto`                                                                             | Paginado, por alcance. Trae `diasParaCierre` derivado                                                                                                              |
| POST   | `/proyectos`                                               | `rh_admin` o `jefe_area`     | `proyecto`                                                                                                                                       | Exige cliente **en cartera activa** y **`registroPatronalId` + `registroObraId`** (D-69). **Ya no pide categorías** (D-82)                                         |
| PATCH  | `/proyectos/:id`                                           | `rh_admin` o `jefe_area`     | `proyecto`                                                                                                                                       | **Rechaza** `fechaFinEstimada` (D-38); los registros se cambian pero no se vacían (D-69) y se traban con los contratos (D-70)                                      |
| POST   | `/proyectos/:id/aplazar`                                   | `rh_admin` o `jefe_area`     | `proyecto`                                                                                                                                       | Única forma de mover el cierre; exige motivo y queda en el historial                                                                                               |
| POST   | `/proyectos/:id/finalizar`                                 | `rh_admin` o `jefe_area`     | `proyecto`                                                                                                                                       | Cierra también las asignaciones abiertas                                                                                                                           |
| POST   | `/proyectos/:id/reabrir`                                   | `rh_admin` o `jefe_area`     | `proyecto`                                                                                                                                       | Limpia `fechaFinReal`; no reabre asignaciones                                                                                                                      |
| GET    | `/proyectos/:id/asignaciones`                              | sesión                       | `asignaciones[]`                                                                                                                                 | `?activo=`; activas primero. Cada renglón trae `registroPatronalCoincide` en tres estados (D-71)                                                                   |
| GET    | `/proyectos/:id/asignables`                                | asignar a proyectos          | `asignables[]`                                                                                                                                   | El selector: adscritos, activos y sin asignar. **El puesto no filtra** (D-82)                                                                                      |
| POST   | `/proyectos/:id/asignaciones`                              | asignar a proyectos          | `asignacion` · `avisos[]`                                                                                                                        | Exige adscripción activa; `categoriaId` es **opcional** y cae en el puesto de la persona (D-82); **avisa sin bloquear** si el registro patronal no coincide (D-71) |
| GET    | `/asignaciones/:id`                                        | sesión                       | `asignacion` · `trazabilidad`                                                                                                                    | El detalle con la **cadena resuelta**: empleado → empresa → registro patronal → proyecto → registro de obra (D-71)                                                 |
| PATCH  | `/asignaciones/:id/salida`                                 | asignar a proyectos          | `asignacion`                                                                                                                                     | Cierra, no borra                                                                                                                                                   |
| GET    | `/proyectos/:id/contratos`                                 | sesión                       | `contratos[]`                                                                                                                                    | Contratos del proyecto por número; `?incluirInactivos=true` (D-70)                                                                                                 |
| POST   | `/proyectos/:id/contratos`                                 | `rh_admin` o `jefe_area`     | `contrato`                                                                                                                                       | El `numero` **lo asigna el servidor**; 400 si el proyecto está finalizado (D-70); acepta `multipart` con el contrato escaneado en `archivo` (D-81)                 |
| PATCH  | `/contratos/:id`                                           | `rh_admin` o `jefe_area`     | `contrato`                                                                                                                                       | Nombre, fase y fechas. El SIROC y el estado van por sus rutas; acepta `multipart`, y **sólo el archivo sin campos** es válido (D-81)                               |
| GET    | `/contratos/:id/archivo`                                   | sesión y alcance             | `archivo`                                                                                                                                        | Enlace fresco al contrato escaneado; `?descargar=true` fuerza la descarga (D-81)                                                                                   |
| PUT    | `/contratos/:id/siroc`                                     | `rh_admin` o `jefe_area`     | `contrato`                                                                                                                                       | Registra o corrige el SIROC entero; acepta `multipart` con el aviso en `archivo` (D-80); **409 `SIROC_DUPLICADO`** si el número ya existe (G4)                     |
| DELETE | `/contratos/:id/siroc`                                     | `rh_admin` o `jefe_area`     | `contrato`                                                                                                                                       | Lo quita y libera el número; 400 si no tenía                                                                                                                       |
| POST   | `/contratos/:id/siroc/actualizaciones`                     | `rh_admin` o `jefe_area`     | `contrato`                                                                                                                                       | Registra que el SIROC se actualizó; conserva el número. `fecha` opcional (hoy) y `nota` opcional (D-76); acepta `multipart` con el acuse en `archivo` (D-80)       |
| GET    | `/contratos/:id/siroc/archivo`                             | sesión y alcance             | `archivo`                                                                                                                                        | Enlace fresco al aviso escaneado; `?descargar=true` fuerza la descarga (D-80)                                                                                      |
| GET    | `/contratos/:id/siroc/actualizaciones/:indice/archivo`     | sesión y alcance             | `archivo`                                                                                                                                        | El acuse de esa renovación, por posición (D-80)                                                                                                                    |
| PUT    | `/contratos/:id/siroc/actualizaciones/:indice/archivo`     | `rh_admin` o `jefe_area`     | `contrato`                                                                                                                                       | Le pone (o reemplaza) el acuse a un refrendo **ya capturado**, sin tocar fecha ni nota (D-80)                                                                      |
| DELETE | `/contratos/:id/siroc/actualizaciones/ultima`              | `rh_admin` o `jefe_area`     | `contrato`                                                                                                                                       | Deshace la última actualización, capturada mal; 400 si no hay ninguna (D-76)                                                                                       |
| POST   | `/contratos/:id/finalizar` · `/contratos/:id/reabrir`      | `rh_admin` o `jefe_area`     | `contrato`                                                                                                                                       | Mueven `estado`; no se reabre si el proyecto está finalizado                                                                                                       |
| PATCH  | `/contratos/:id/estado`                                    | `rh_admin` o `jefe_area`     | `contrato`                                                                                                                                       | Mueve `activo` (la baja), que **no es lo mismo** que `estado` (D-70)                                                                                               |
| GET    | `/empresas/:id/maquinas`                                   | sesión y alcance             | `maquinas[]` · `total`                                                                                                                           | El catálogo de maquinaria de la empresa, por identificador; `?incluirInactivas=true&busqueda=` (D-86)                                                              |
| POST   | `/empresas/:id/maquinas`                                   | `rh_admin` o `jefe_area`     | `maquina`                                                                                                                                        | `{ identificador, modelo }` + imagen opcional (`multipart` en `archivo` o `subidaId`); **409 `MAQUINA_DUPLICADA`** si el identificador ya está en la empresa       |
| GET    | `/maquinas/:id`                                            | sesión y alcance             | `maquina`                                                                                                                                        | La ficha, con la URL firmada de su imagen                                                                                                                          |
| PATCH  | `/maquinas/:id`                                            | `rh_admin` o `jefe_area`     | `maquina`                                                                                                                                        | `identificador`, `modelo` y/o la imagen nueva; **sólo la imagen sin campos** es válido y reemplaza la anterior (D-86)                                              |
| PATCH  | `/maquinas/:id/estado`                                     | `rh_admin` o `jefe_area`     | `maquina`                                                                                                                                        | `{ activo }` — la baja y la reactivación; 400 si ya estaba así                                                                                                     |
| GET    | `/maquinas/:id/imagen`                                     | sesión y alcance             | `imagen`                                                                                                                                         | Enlace fresco a la foto; `?descargar=true` fuerza la descarga; 404 si no tiene                                                                                     |
| GET    | `/expedientes`                                             | ver empleados                | `expedientes[]` + `total` · `pagina` · `porPagina`                                                                                               | Paginado; mismos filtros que `/empleados` **más `estatus`** (D-45)                                                                                                 |
| GET    | `/empleados/:id/expediente`                                | ver empleados                | `expediente` · `empleado` · `avance` · `obras`                                                                                                   | Crea el expediente si no existía; `data: { expediente, empleado, avance, obras }` (D-77)                                                                           |
| GET    | `/expedientes/:id`                                         | ver empleados                | `expediente` · `empleado` · `avance` · `obras`                                                                                                   | Lo mismo por id de expediente; 404 si el empleado no es visible                                                                                                    |
| POST   | `/expedientes/:id/documentos/:tipo`                        | subir documentos             | `expediente` · `empleado` · `avance`                                                                                                             | `multipart`, campo `archivo`. Versiona; 413 >30 MB (D-81), 415 si no es de un tipo aceptado                                                                        |
| GET    | `/expedientes/:id/documentos/:tipo/versiones/:version/url` | ver documentos               | `url` · `expiraEnSegundos` · `archivo`                                                                                                           | URL firmada temporal; **queda en la bitácora** (D-41)                                                                                                              |
| POST   | `/expedientes/:id/documentos/:tipo/revisar`                | `rh_admin` · `rh_consulta`   | `expediente` · `empleado` · `avance`                                                                                                             | `{ aprobado, motivo? }`: valida o rechaza la versión en revisión (D-43, D-44)                                                                                      |
| GET    | `/empresas/:id/adscripciones`                              | ver empleados                | `adscripciones[]`                                                                                                                                | `?activo=&area=&tipo=&categoriaId=&orden=`; el jefe de área sólo ve sus propias áreas (D-45, D-51)                                                                 |
| POST   | `/empresas/:id/adscripciones`                              | `rh_admin`                   | `adscripcion`                                                                                                                                    | Vincula a alguien que ya existe; 200 si reactiva una adscripción previa (D-45)                                                                                     |
| PATCH  | `/adscripciones/:id`                                       | `rh_admin`                   | `adscripcion`                                                                                                                                    | areas, tipoContrato, fechas y **`registroPatronalId`** (D-72); re-sincroniza el checklist                                                                          |
| PATCH  | `/adscripciones/:id/estado`                                | `rh_admin`                   | `adscripcion`                                                                                                                                    | Baja **de esa empresa**; cierra sus asignaciones abiertas ahí (D-45)                                                                                               |
| PATCH  | `/adscripciones/:id/jefaturas`                             | `rh_admin`                   | `adscripcion`                                                                                                                                    | Qué áreas **dirige** esa persona en esa empresa (D-60)                                                                                                             |
| GET    | `/empresas/:id/jefaturas`                                  | `rh_admin`                   | `jefaturas[]`                                                                                                                                    | Quién dirige cada área; incluye las que nadie dirige (D-60)                                                                                                        |
| POST   | `/empleados/importar/previsualizar`                        | `rh_admin`                   | `aplicado` · `archivo` · `empresa` · `resumen` · `categoriasNuevas` · `areasNuevas` · `areasReactivadas` · `nuevos` · `yaExisten` · `conError`   | `multipart`: `archivo` (.xlsx) + `empresaId`. **No escribe nada** (D-46)                                                                                           |
| POST   | `/empleados/importar`                                      | `rh_admin`                   | `aplicado` · `archivo` · `empresa` · `resumen` · `categoriasNuevas` · `areasNuevas` · `areasReactivadas` · `nuevos` · `yaExisten` · `conError`   | Igual, más `confirmarRfcDistinto?`. Idempotente: re-subir no duplica (D-46)                                                                                        |
| GET    | `/alertas`                                                 | ver empleados                | `grupos[]` —o `alertas[]` con `agrupar=ninguno`— + `resumen` · `total` · `totalAlertas` · `totalEmpleados` · `agrupado` · `pagina` · `porPagina` | Bandeja derivada; **agrupada por empleado y paginada** (D-47, D-48)                                                                                                |
| ALL    | `/usuarios*`                                               | —                            | — (410, va por `errors[0].msg`)                                                                                                                  | **410** con las rutas nuevas (se borra cuando el front migre)                                                                                                      |

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
archivo pasa de 10 MB —esta ruta conserva el tope viejo a propósito, ver D-81— ·
`415` no es un .xlsx.

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
  "siroc": null, // o { numero, fechaRegistro, actualizaciones[], archivo }
  "archivo": null, // o el contrato escaneado (D-81); null, nunca ausente
  "estado": "en_curso", // en_curso | finalizado
  "activo": true,
  "seguimientoSiroc": {
    // derivado en cada lectura (D-76), ver abajo
  },
  "seguimientoContrato": {
    // derivado en cada lectura (D-84), ver abajo
  },
  "createdAt": "…",
  "updatedAt": "…"
}
```

**`estado` y `activo` no son lo mismo.** `finalizado` es un contrato que terminó
bien; `activo: false` es uno capturado por error o cancelado. Van por rutas
distintas a propósito: `POST /contratos/:id/finalizar` mueve el primero,
`PATCH /contratos/:id/estado` el segundo.

**Tres rangos de fechas** (D-85), comprobados en el servicio y **sólo sobre lo
que entra** —lo ya capturado no se toca—, cada uno con su `400` en `message`:

| Dónde                                      | Rango                                                          | `message`                                                                                                   |
| ------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `POST`/`PATCH` contrato, `fechaInicio`     | ≥ `proyecto.fechaInicio`                                       | `La fecha de inicio del contrato no puede ser anterior al inicio del proyecto (AAAA-MM-DD)`                 |
| `POST`/`PATCH` contrato, `fechaFin`        | ≤ `proyecto.fechaFinReal ?? fechaFinEstimada`                  | `La fecha de fin del contrato no puede ser posterior al fin del proyecto (AAAA-MM-DD)`                      |
| `PUT …/siroc`, `fechaRegistro` (si cambia) | `contrato.fechaInicio` … +7 días, incluidos                    | `La fecha de registro del SIROC debe estar entre el AAAA-MM-DD y el AAAA-MM-DD: …`                          |
| `POST …/siroc/actualizaciones`, `fecha`    | ≥ movimiento anterior + 1 mes (fin de mes recortado) + 25 días | `El SIROC se registró el AAAA-MM-DD: el siguiente reporte bimestral no puede fecharse antes del AAAA-MM-DD` |

En el `PATCH` se revisan **sólo las fechas que vienen**.

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

### El SIROC se actualiza cada dos meses (D-76)

El aviso de obra **se refrenda cada dos meses conservando el mismo número**: no
se saca un SIROC nuevo, se actualiza el que hay. Por eso `siroc.numero` sigue
siendo uno solo y las renovaciones son una lista de fechas dentro del mismo
SIROC:

```jsonc
"siroc": {
  "numero": "SIR-2026-0001",
  "fechaRegistro": "2026-09-10",
  "actualizaciones": [
    { "fecha": "2026-11-12", "nota": "Acuse 4471", "archivo": null }
  ],
  "archivo": null // el aviso escaneado; ver abajo
}
```

#### El papel del aviso, y el acuse de cada refrendo (D-80)

**Son dos archivos distintos y los dos son opcionales.** `siroc.archivo` es el
aviso escaneado; `siroc.actualizaciones[n].archivo` es el acuse de **esa**
renovación. Refrendar no sustituye al aviso original —el número es el mismo—, así
que el papel nuevo se suma en vez de pisar al anterior.

```jsonc
"archivo": {
  "nombre": "escaneo (2) final_v3.pdf", // el original, para mostrar
  "mime": "application/pdf",
  "tamanoBytes": 184320,
  "subidoPor": "Ana Ruiz", // el NOMBRE de quien lo subió
  "subidoEn": "2026-09-10T18:04:11.921Z",
  "previsualizable": true, // false → ofrece descargar, no visor (D-78)
  "nombreDescarga": "SIR-2026-0001.pdf", // el del DATO, no el del original
  "url": "https://…" // firmada, CADUCA A LOS 10 MINUTOS
}
```

`null` cuando no hay archivo — nunca la llave ausente. La clave de almacenamiento
**no sale nunca**.

**Cómo se sube.** `PUT /contratos/:id/siroc` y
`POST /contratos/:id/siroc/actualizaciones` aceptan `multipart/form-data` con el
campo `archivo` además de los campos de texto de siempre. Las dos **siguen
aceptando `application/json`** sin archivo: lo que el front ya manda no cambia.

**Corregir el SIROC no tira ningún papel.** `PUT /siroc` conserva el archivo del
aviso y los de todas las renovaciones; sólo reemplaza el del aviso si la petición
trae uno nuevo, y entonces el anterior se borra. `DELETE /siroc` se lleva todos;
`DELETE /siroc/actualizaciones/ultima` se lleva el de esa renovación.

**El acuse puede llegar después.**
`PUT /contratos/:id/siroc/actualizaciones/:indice/archivo` (multipart, campo
`archivo` obligatorio) le pone el papel a un refrendo **ya capturado** —o
reemplaza el que tenga— **sin tocar nada más**: ni la fecha, ni la nota, ni el
orden, ni `seguimientoSiroc`. Sirve para cualquiera de ellos, no sólo el último, y
también sobre un contrato finalizado. Existe para que nadie tenga que deshacer la
actualización y recapturarla, que movería la ventana de dos meses.

**El enlace caduca a los 10 minutos.** Para uno fresco, sin recargar el proyecto:

| Método | Ruta                                                   | Devuelve                    |
| ------ | ------------------------------------------------------ | --------------------------- |
| GET    | `/contratos/:id/siroc/archivo`                         | `archivo` del aviso         |
| GET    | `/contratos/:id/siroc/actualizaciones/:indice/archivo` | `archivo` de esa renovación |

`?descargar=true` fuerza la descarga; lo que no es previsualizable se descarga
siempre. Las renovaciones se direccionan **por posición** (0, 1, 2…) porque no
tienen `_id`; el índice es estable, el arreglo sólo crece y sólo se quita la
última. `404` si el contrato no tiene SIROC, si el SIROC no tiene archivo o si esa
posición no existe.

**El SIROC no tiene fecha final.** Del aviso se capturan **dos datos y ya**: su
número y el día en que se registró. Su vigencia son siempre dos meses contados
desde ahí —o desde la última actualización—, y sale derivada en
`seguimientoSiroc.vigenciaPeriodoHasta`. `siroc.vigenciaHasta` **ya no existe**:
se sigue aceptando en el cuerpo de `PUT /contratos/:id/siroc` y se ignora, para
que el campo se pueda quitar del formulario sin dejar de registrar SIROCs
mientras tanto, pero no se guarda ni vuelve en la respuesta.

Todo contrato viaja además con `seguimientoSiroc`, **derivado en cada lectura**
(regla #6): no hay nada que marcar ni apagar, y el día que se captura la
renovación el aviso desaparece solo.

```jsonc
"seguimientoSiroc": {
  "periodoMeses": 2,
  "actualizacionesRequeridas": 2,   // predichas desde fechaInicio/fechaFin
  "actualizacionesRegistradas": 1,
  "actualizacionesPendientes": 1,
  "ultimaActualizacion": "2026-11-12", // o null
  "vigenciaPeriodoHasta": "2027-01-12", // cuándo cumple los 2 meses; null sin SIROC
  "diasParaActualizacion": 3,        // negativo si ya pasó; null sin SIROC
  "requiereActualizacion": false,    // true SÓLO cuando ya venció
  "estado": "por_vencer",
  "mensaje": "El SIROC cumple sus dos meses el 2027-01-12: requiere su reporte bimestral en 3 días."
}
```

| `estado`      | Cuándo                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------- |
| `sin_siroc`   | El contrato todavía no tiene SIROC                                                          |
| `no_requiere` | Finalizado o dado de baja, **pasado de su `fechaFin` sin deuda**, o la ventana cubre el fin |
| `al_dia`      | Faltan más de `DIAS_ALERTA_SIROC` días (5 por defecto)                                      |
| `por_vencer`  | Faltan `DIAS_ALERTA_SIROC` días o menos; el día justo entra aquí                            |
| `vencida`     | Ya pasaron los dos meses, dentro de sus fechas **o con deuda de entonces**                  |

**La `fechaFin` del contrato es el techo del cálculo** (D-84): **corta la cuenta,
no la borra**. Pasada esa fecha el contrato no acumula refrendos nuevos, pero lo
que debía antes de terminar lo sigue debiendo: si el aviso dejó de cubrir antes
del fin, responde `vencida` con los pendientes que faltaron hasta `fechaFin` —ni
uno más— y un mensaje que pide capturarlos con la fecha de entonces. Sólo sin
deuda cae en `no_requiere` con
`actualizacionesPendientes: 0`, `requiereActualizacion: false` y
`diasParaActualizacion: null`, y su mensaje es «El contrato terminó el
AAAA-MM-DD: su SIROC ya no requiere reportes bimestrales.». `vigenciaPeriodoHasta`
sigue viniendo: hasta dónde llegó el aviso es un hecho del expediente. **El día
justo de `fechaFin` todavía cuenta como dentro.**

Lo que le falta a ese contrato no es un trámite ante el IMSS —es que alguien lo
cierre o corrija sus fechas—, y eso viaja aparte, en `seguimientoContrato`. Hasta
este cambio se decía con el aviso del SIROC, y toda obra terminada que nadie
cerró quedaba en rojo para siempre.

**Un contrato DENTRO de sus fechas no cambia en nada**: si su aviso cumplió los
dos meses y la obra sigue, hay que refrendarlo aunque ya se hayan capturado todos
los que sus fechas preveían.

Los cuatro cálculos, para que el front no los repita:

- **Cuántas pide el contrato** (`actualizacionesRequeridas`): las ventanas de dos
  meses que hacen falta para cubrir `fechaInicio → fechaFin`, **menos la
  primera**, que ya la cubre el SIROC original. Un contrato de dos meses justos
  pide cero; uno de seis, dos. Es una **predicción del plan de la obra**, y se
  responde desde el alta, antes de que exista el SIROC.
- **Cuántas faltan de verdad** (`actualizacionesPendientes`): las ventanas que
  hacen falta para ir **de `vigenciaPeriodoHasta` a `fechaFin`**. NO es
  `requeridas − registradas`: se cuenta desde donde llega el aviso vigente, que
  ya incorpora cada refrendo presentado.
- **Desde cuándo corre la ventana vigente**: desde la última actualización
  registrada, o desde `fechaRegistro` si no hay ninguna. **No desde el inicio del
  contrato**: un SIROC tramitado tarde vence tarde.
- **`requiereActualizacion`** es `true` sólo con `estado: 'vencida'`. `por_vencer`
  avisa con anticipación, pero todavía no se debe nada.

**Al mover las fechas, el número se recalcula solo** —todo se deriva al leer— y
**contando los refrendos que ya hay**:

| Se edita `fechaFin`   | Qué responde el seguimiento                                    |
| --------------------- | -------------------------------------------------------------- |
| Se aplaza             | Vuelve a pedir **desde donde va el aviso**, no desde cero      |
| Se recorta            | Deja de pedir lo que los refrendos ya alcanzan a cubrir        |
| Se recorta por debajo | `0` pendientes, sin negativos y **sin borrar ningún refrendo** |

En ese último caso `actualizacionesRegistradas` queda **por encima** de
`actualizacionesRequeridas`. **No es un error ni una cuenta rota**: esos avisos se
presentaron de verdad ante el IMSS. Los dos números se muestran como lo que son
—lo que hay y lo que las fechas preveían—, no como una falta.

### `seguimientoContrato` — el contrato como cabo suelto

También derivado en cada lectura (D-84), en toda respuesta de contrato:

```jsonc
"seguimientoContrato": {
  "estado": "terminado_sin_cerrar",
  "diasDesdeFin": 61,             // días desde fechaFin; null si aún no pasa
  "requiereCierre": true,          // true SÓLO en terminado_sin_cerrar
  "mensaje": "Este contrato terminó el 2026-05-02 hace 61 días y sigue abierto: finalízalo, o corrige su fecha de fin si la obra sigue."
}
```

| `estado`               | Cuándo                                                   |
| ---------------------- | -------------------------------------------------------- |
| `por_iniciar`          | `fechaInicio` todavía no llega                           |
| `en_curso`             | Hoy cae entre sus fechas, el día de `fechaFin` incluido  |
| `terminado_sin_cerrar` | Pasó su `fechaFin` y nadie lo finalizó — **pide acción** |
| `finalizado`           | `estado: 'finalizado'`                                   |
| `baja`                 | `activo: false`; manda sobre las fechas (D-70)           |

`diasDesdeFin` es un hecho y se dice esté cerrado o no. `requiereCierre` es el
único campo que hay que mirar para decidir si se pinta un aviso: es `true`
exactamente en `terminado_sin_cerrar`.

**Registrar la actualización** es `POST /contratos/:id/siroc/actualizaciones` con
`{ fecha?, nota? }` — sin `fecha` se asume hoy, que es como se captura al volver
del IMSS. `numero` y `fechaRegistro` **no se aceptan aquí** y el 400 dice por
dónde van. Los 400 posibles, con el texto en `message`:

| Qué pasó                                                 | `message`                                                                                                                                            |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| El contrato no tiene SIROC                               | `Ese contrato no tiene SIROC registrado`                                                                                                             |
| El contrato está finalizado o dado de baja               | `El contrato ya no está en curso: su SIROC no necesita más reportes bimestrales`                                                                     |
| La fecha es futura                                       | `El reporte bimestral del SIROC no puede tener fecha futura`                                                                                         |
| La fecha va antes del registro o de la anterior          | `El reporte bimestral no puede ser anterior al registro del SIROC (…)`                                                                               |
| La fecha es posterior a `fechaFin` (D-84)                | `El contrato terminó el AAAA-MM-DD y su SIROC ya no requiere reportes bimestrales: finaliza el contrato, o corrige su fecha de fin si la obra sigue` |
| Antes de un mes y 25 días del movimiento anterior (D-85) | `El SIROC se registró el AAAA-MM-DD: el siguiente reporte bimestral no puede fecharse antes del AAAA-MM-DD` (o «se reportó el»)                      |
| No hay ninguna que deshacer                              | `Ese SIROC no tiene reportes bimestrales registrados`                                                                                                |

**El techo se mira contra la fecha DE LA ACTUALIZACIÓN, no contra hoy** (D-84):
capturar tarde un refrendo que sí se tramitó dentro del contrato **sigue
entrando**, porque el papel llega después. Lo que se rechaza es colgarle al
contrato uno posterior a su fin.

Corregir el SIROC con `PUT /contratos/:id/siroc` **conserva sus actualizaciones**:
son del mismo aviso. Para empezar de cero está `DELETE /contratos/:id/siroc`, que
se lleva el aviso entero.

#### El contrato escaneado, y el tope de subida (D-81)

`contrato.archivo` es el contrato firmado, con la misma forma de `Archivo` que el
resto de los adjuntos. **Uno solo y se reemplaza**, al revés que los del SIROC.

**Cómo se sube.** `POST /proyectos/:id/contratos` y `PATCH /contratos/:id`
aceptan `multipart/form-data` con el campo `archivo`, opcional, además de seguir
aceptando el JSON de siempre. Un `PATCH` con **sólo el archivo y ningún campo**
es válido —así se adjunta el papel a un contrato ya capturado, que es el caso
normal— y devuelve `message: 'Contrato actualizado con su archivo'`. Un `PATCH`
sin campos **y** sin archivo sigue siendo `400`.

Editar sin archivo **no tira el papel**; mandar uno nuevo reemplaza y borra el
anterior de R2. No se versiona y no hay forma de quitarlo dejando el contrato sin
él.

**El nombre de descarga** es `nombre`, o `fase` si no hay nombre, o el ordinal
—`Contrato 2.pdf`— si no hay ninguno de los dos.

**El enlace caduca a los 10 minutos.** `GET /contratos/:id/archivo` da uno
fresco; `?descargar=true` fuerza la descarga. Lo lee cualquier sesión con alcance
sobre el proyecto; subir exige `rh_admin` o `jefe_area`. `404` si el contrato no
tiene archivo y `404 —no 403—` si el proyecto no está a su alcance.

**El tope de subida son 30 MB**, no 10: un contrato de obra escaneado pasa de 20.
Vale para todos los adjuntos —expediente, registro de obra y SIROC incluidos—
**menos la importación de nómina**, que se queda en 10 MB porque ahí el `.xlsx`
se abre entero en memoria. El `413` dice el tope de la ruta que lo rechazó.

### El SIROC de su obra, en el expediente (D-77)

El detalle del expediente —`GET /empleados/:id/expediente` y
`GET /expedientes/:id`— trae una **cuarta llave, `obras`**, junto a `expediente`,
`empleado` y `avance`: bajo qué aviso de obra está trabajando esa persona.

**No hay ningún campo nuevo guardado.** La cadena `empleado → asignación activa →
proyecto → contrato → siroc` ya existe entera y se resuelve al leer, así que el
mismo expediente responde distinto en cuanto alguien refrenda el aviso o cierra
una fase. Mismo criterio que D-71.

```json
{
  "status": "success",
  "data": {
    "expediente": { "...": "igual que siempre" },
    "empleado": { "...": "el renglón de /empleados/:id" },
    "avance": { "...": "igual que siempre" },
    "obras": [
      {
        "asignacionId": "6a9f...",
        "proyecto": { "_id": "6a89...", "nombre": "Torre Poniente" },
        "contrato": {
          "_id": "6a93...",
          "numero": 2,
          "nombre": "Estructura",
          "fase": "Fase 2",
          "fechaInicio": "2026-03-01",
          "fechaFin": "2026-12-31",
          "estado": "en_curso",
          // El contrato escaneado, con su url firmada (D-81). null si no lo hay.
          "archivo": { "...": "la misma forma que en el contrato" }
        },
        "siroc": {
          "numero": "SIR-2026-0002",
          "fechaRegistro": "2026-03-01",
          "actualizaciones": [],
          // El aviso escaneado, con su url firmada (D-80). null si no lo hay.
          "archivo": { "...": "la misma forma que en el contrato" }
        },
        "vigente": true,
        // Sin `seguimientoContrato`: aquí se consulta bajo qué aviso trabajó
        // alguien, no si hay que cerrar el contrato — ver D-84.
        "seguimientoSiroc": { "...": "el mismo bloque que viaja con el contrato" }
      }
    ]
  }
}
```

**Un renglón por asignación activa**, y `[]` si no está en ninguna obra — nunca
la llave ausente. Una obra cuyo proyecto no tenga contratos con SIROC no aparece.

**Cuál de las fases manda.** Un proyecto tiene varios contratos y cada uno puede
traer su aviso. Se elige:

1. El contrato cuya ventana `fechaInicio`–`fechaFin` **contiene el día de la
   consulta** (los bordes cuentan). Si se traslapan, el que empezó después.
2. Si ninguno la contiene, **el último que estuvo activo**: el de `fechaFin` más
   reciente ya pasada, aunque esté `finalizado`. La obra terminó, pero el aviso
   bajo el que trabajó esa persona sigue siendo un dato de su expediente.

`vigente` dice cuál de los dos casos es, **para que el front no lo deduzca de las
fechas**: `true` cubre hoy, `false` es histórico. Nunca se elige un contrato con
`activo: false` —capturado por error o cancelado (D-70)— ni uno cuya ventana esté
entera por delante: ése ni cubre hoy ni cubrió nunca a nadie.

**Alcance.** Un proyecto de una empresa que quien pregunta no ve **no sale en la
lista**, y el expediente responde `200` igual: no se avisa de su existencia.

**El listado `GET /expedientes` NO trae `obras`**, sólo el detalle: serían dos
consultas más por renglón y el listado pagina de a 100.

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
      "archivo": null, // o el adjunto con su url firmada (D-79)
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

### El archivo del registro de obra (D-79)

Un registro de obra puede traer el papel escaneado. **Es opcional**: donde no lo
hay, `archivo` viene en `null`, y ésa es la única forma de la que hay que
distinguirlo.

Sale igual en **todos** los lugares donde se devuelve un registro de obra: el
cliente y su listado, el detalle del proyecto (`proyecto.registroObra`) y la
cadena de `GET /asignaciones/:id`.

**El registro patronal NO lo lleva**, y la llave `archivo` ni siquiera aparece en
él: no tiene ese campo y su forma no cambió.

```jsonc
{
  "_id": "66f…",
  "numero": "OB-2026-0145",
  "descripcion": "Torre Andares",
  "activo": true,
  "archivo": {
    "nombre": "escaneo (2) final_v3.pdf", // el original, para mostrar
    "nombreDescarga": "OB-2026-0145.pdf", // con el que se guarda al bajarlo
    "mime": "application/pdf",
    "tamanoBytes": 184320,
    "previsualizable": true, // false en Word, Excel y CSV: hay que descargarlo
    "subidoPor": "Ana Ruiz",
    "subidoEn": "2026-09-01T18:22:04.113Z",
    "url": "https://…" // FIRMADA, caduca a los 10 minutos
  }
}
```

**Subirlo.** `POST /clientes/:id/registros-obra` y
`PATCH /clientes/:id/registros-obra/:roId` aceptan `multipart/form-data` con el
campo **`archivo`** junto a `numero` y `descripcion`. Las dos rutas siguen
aceptando `application/json` sin archivo, así que lo que ya se manda funciona
igual. En el `PATCH`, mandar **sólo** el archivo es una edición válida y
**reemplaza** el que hubiera —el anterior se borra: no hay versiones—.

Subir con un `numero` que ya existía guarda el archivo en **ese** registro y
responde `200` con `«Ese registro de obra ya existía»`, sin duplicar nada.

**Abrirlo.** La `url` que viaja en la respuesta caduca a los 10 minutos.
`GET /clientes/:id/registros-obra/:roId/archivo` devuelve `{ archivo }` con una
nueva, sin recargar el cliente entero; `?descargar=true` fuerza la descarga. Lo
lee cualquier sesión con alcance sobre el cliente. **404** si ese registro no
tiene archivo, y **404 —no 403—** si el cliente no está a su alcance.

| Código | Cuándo                                                                       |
| ------ | ---------------------------------------------------------------------------- |
| `413`  | El archivo pasa de 30 MB (D-81)                                              |
| `415`  | El contenido no es de un tipo permitido (se valida el archivo, no el nombre) |
| `403`  | Adjuntar o reemplazar sin poder administrar clientes                         |

### El catálogo de maquinaria (D-86)

Cada empresa tiene el suyo y **sólo ve el suyo**: `GET /empresas/:id/maquinas`
responde `404` —no `403`— cuando la empresa no está al alcance de la sesión, y
lo mismo cualquier ruta de `/maquinas/:id` cuando la máquina es de otra.

```jsonc
{
  "_id": "66f…",
  "empresaId": "66a…",
  "identificador": "ECO-12", // como lo tecleó quien la dio de alta
  "modelo": "CAT 320D",
  "imagen": {
    // null si no tiene
    "nombre": "foto patio (1).png", // el original, para mostrar
    "nombreDescarga": "ECO-12.png", // con el que se guarda al bajarla
    "mime": "image/png",
    "tamanoBytes": 184320,
    "previsualizable": true, // siempre: sólo entran imágenes
    "subidoPor": "Ana Ruiz",
    "subidoEn": "2026-09-03T18:22:04.113Z",
    "url": "https://…" // FIRMADA, caduca a los 10 minutos
  },
  "activo": true,
  // Quién la tiene y en qué obra (D-87). `null` = en el patio, disponible.
  // NO es un campo de la máquina: se resuelve al leer.
  "asignacion": {
    "_id": "6710…",
    "maquinaId": "66f…",
    "empleadoId": "66b…", // null = en la obra, SIN trabajador
    "empleadoNombre": "Juan Pérez",
    "proyectoId": "66c…",
    "proyectoNombre": "Fraccionamiento Sur",
    "asignacionId": "66d…", // la asignación del trabajador de la que tomó la obra
    "fechaAsignacion": "2026-08-10",
    "fechaDevolucion": null,
    "motivoCierre": null,
    "motivoCierreTexto": null,
    "vigente": true,
    "dias": 25 // inclusivos; el vigente cuenta hasta hoy
  },
  "createdAt": "2026-09-03T18:22:04.113Z",
  "updatedAt": "2026-09-03T18:22:04.113Z"
}
```

El listado devuelve `{ maquinas: [...], total }`, **sin paginar** y ordenado por
identificador con orden natural (`ECO-2` antes que `ECO-10`). Por omisión trae
sólo las activas; `?incluirInactivas=true` suma las de baja y `?busqueda=` filtra
por identificador o modelo, sin acentos ni mayúsculas.

**El identificador es único dentro de la empresa**, comparado sin acentos, sin
mayúsculas y con los espacios colapsados: `eco 12` y `ECO-12` **no** chocan
(el guión cuenta), pero `Eco 12` y `ECO 12` sí. Chocar responde:

```jsonc
// 409
{
  "status": "error",
  "message": "Esa empresa ya tiene una máquina con ese identificador",
  "code": "MAQUINA_DUPLICADA",
  "errors": [
    { "msg": "Ya existe una máquina con ese identificador", "path": "identificador" }
  ],
  "data": { "maquina": { "_id": "…", "identificador": "ECO-12", "…": "…" } } // la que ya está
}
```

**La imagen.** Opcional al dar de alta y se pone o cambia después con el mismo
`PATCH /maquinas/:id`: `multipart/form-data` con el campo **`archivo`** —solo o
junto a `identificador` y `modelo`— o `application/json` con `subidaId` (D-83,
destino `maquina`). Reemplazarla **borra la anterior**: no hay versiones. La
`url` caduca a los 10 minutos; `GET /maquinas/:id/imagen` devuelve `{ imagen }`
con una nueva sin recargar el catálogo.

| Código | Cuándo                                                                     |
| ------ | -------------------------------------------------------------------------- |
| `400`  | Sin `identificador` o `modelo` en el alta; `PATCH` sin nada que actualizar |
| `409`  | `MAQUINA_DUPLICADA`                                                        |
| `413`  | La imagen pasa de 30 MB                                                    |
| `415`  | La «imagen» no es JPG, PNG ni WEBP — un PDF, un HEIC, un Word              |
| `403`  | Escribir sin `manageProjects` (`rh_consulta`)                              |
| `404`  | Empresa o máquina fuera de alcance; `GET …/imagen` de una máquina sin foto |

### La máquina en la obra (D-87)

**La obra no se captura.** `POST /maquinas/:id/asignacion` recibe `empleadoId` y,
sólo si esa persona está en varias obras de la empresa de la máquina,
`proyectoId` para desempatar. La obra sale de **su asignación**, cuyo id queda en
`asignacion.asignacionId`; una máquina no puede quedar en una obra donde su
operador no está.

```jsonc
// 201 — data
{
  "maquina": { "…": "…", "asignacion": { "…": "…" } },
  "liberada": { "…": "…" }, // el tramo que se cerró, o null
  "avisos": ["La máquina se le quitó a Juan Pérez en Obra Norte, que la tuvo 11 días."]
}
```

Si está en varias obras y no se dice cuál:

```jsonc
// 400
{
  "status": "fail",
  "message": "Juan Pérez está en 2 obras: dinos en cuál va la máquina.",
  "code": "OBRA_REQUERIDA",
  "errors": [{ "msg": "Indica en qué obra va la máquina", "path": "proyectoId" }],
  "data": {
    "obras": [
      {
        "proyectoId": "66c…",
        "proyectoNombre": "Obra Norte",
        "asignacionId": "66d…",
        "fechaAsignacion": "2026-08-05"
      }
    ]
  }
}
```

**Una máquina está con una sola persona a la vez** —asignarla a otra cierra el
tramo anterior con `motivoCierre: 'reasignacion'` y lo devuelve en `liberada`— y
**una persona puede traer varias**. Una máquina de baja no se asigna (400), y
darla de baja teniéndola alguien cierra su tramo (`baja_de_maquina`).

**Cuando el trabajador se va, la máquina pierde a la persona, no la obra.** Al
cerrar su asignación (`PATCH /asignaciones/:id/salida`) o al darlo de baja
(`PATCH /empleados/:id/estado`), el tramo se cierra —`salida_de_obra` o
`baja_de_trabajador`— y **se abre otro en la misma obra con `empleadoId: null`**.
Las dos respuestas lo dicen en `maquinasLiberadas`, y su `message` también:

```jsonc
// data — en las dos rutas
{
  "…": "…",
  "maquinasLiberadas": [
    {
      "maquinaId": "66f…",
      "identificador": "ECO-12",
      "modelo": "CAT 320D",
      "proyectoId": "66c…",
      "proyectoNombre": "Obra Norte",
      "motivo": "salida_de_obra"
    }
  ]
}
```

`GET /maquinas/:id/historial` devuelve la cadena completa —`tramos[]`, del más
reciente al más viejo, con `dias` calculados y el vigente contando hasta hoy— y
`porTrabajador[]`, el acumulado de más a menos días. Los tramos sin trabajador
salen en la historia pero **no le suman días a nadie**.

| Código | Cuándo                                                                                        |
| ------ | --------------------------------------------------------------------------------------------- |
| `400`  | Sin `empleadoId`; empleado de baja, sin obra en esa empresa, o no asignado a la obra indicada |
| `400`  | `OBRA_REQUERIDA` — está en varias obras y no se dijo en cuál                                  |
| `400`  | Máquina de baja; devolver una que no está asignada; fecha anterior a la entrega               |
| `409`  | `MAQUINA_YA_ASIGNADA` — ya la tiene esa misma persona en esa misma obra                       |

El detalle, con todos los cuerpos y ejemplos, está en
[`ENDPOINTS-MAQUINAS.md`](./ENDPOINTS-MAQUINAS.md).

### Las incidencias de la máquina (D-88)

**El trabajador y la obra no se mandan: se derivan.** El cuerpo del alta lleva
`{ tipoId, descripcion, fechaIncidencia? }` y nada más; quién tenía la máquina ese
día sale de cruzar esa fecha con su historia de asignaciones, así que una
incidencia de hace un mes señala a quien la traía **entonces**.

```jsonc
// data.incidencia
{
  "_id": "6720…",
  "maquinaId": "66f1…",
  "empresaId": "66a0…",
  "tipoId": "66e0…",
  "tipo": { "_id": "66e0…", "nombre": "Falla hidráulica", "activo": true }, // null si no se pudo resolver
  "descripcion": "Botó aceite por la manguera del cilindro",
  "fechaIncidencia": "2026-08-05", // cuándo PASÓ, no cuándo se capturó
  "fechaResolucion": null, // null = abierta
  "notaResolucion": null,
  "abierta": true,
  "dias": 5, // inclusivos: lo que lleva abierta, o lo que tardó en cerrarse
  "contexto": {
    "sinAsignar": false, // true = estaba en el patio
    "tramoId": "6710…",
    "empleadoId": "66b2…", // null con tramo = en la obra, sin operador
    "empleadoNombre": "Juan Pérez",
    "proyectoId": "66c3…",
    "proyectoNombre": "Obra Norte",
    "fechaAsignacion": "2026-08-01",
    "fechaDevolucion": null,
    "texto": "Juan Pérez · Obra Norte" // ya armado, para mostrar
  },
  "createdAt": "2026-09-03T…",
  "updatedAt": "2026-09-03T…"
}
```

En el listado, `abiertas` y `resueltas` **no cambian con el filtro**: siempre son
del total, para que la pantalla pueda decir «2 abiertas» mientras se miran las
resueltas.

El **catálogo de tipos es del grupo**, no de cada empresa, y lo escribe quien
gestiona proyectos (D-88). Dar de baja un tipo deja de ofrecerlo en el alta pero
**las incidencias viejas lo conservan**, con `tipo.activo: false`; renombrarlo
corrige el nombre en todas.

| Código | Cuándo                                                                                  |
| ------ | --------------------------------------------------------------------------------------- |
| `400`  | Sin `tipoId` o sin `descripcion`; tipo inexistente o **dado de baja**; fecha del futuro |
| `400`  | Resolver con fecha anterior a la de la incidencia                                       |
| `404`  | Incidencia inexistente, o de una máquina fuera de alcance                               |
| `409`  | `INCIDENCIA_YA_RESUELTA` — ya se cerró, y el mensaje dice cuándo. **No hay reapertura** |
| `409`  | `TIPO_INCIDENCIA_DUPLICADO` — renombrar un tipo sobre uno que ya existe                 |

El detalle, con todos los cuerpos y ejemplos, está en
[`ENDPOINTS-MAQUINAS.md`](./ENDPOINTS-MAQUINAS.md).

### Tipos de archivo aceptados (D-78)

En **todo** el backend —también en los documentos del expediente—: **PDF, JPG,
PNG, WEBP, DOC, DOCX, XLS, XLSX y CSV**. Se valida **el contenido**, no la
extensión ni el `Content-Type`, salvo el CSV, que no tiene firma posible: ése
exige que el nombre declare `.csv` y que el contenido sea texto.

Cada archivo devuelve **`previsualizable`**. Los de Office y el CSV vienen en
`false`: el navegador no los abre, su URL firmada se emite siempre como descarga
y la interfaz debe ofrecer **descargar**, no un visor. HEIC sigue rechazado, y el
mensaje del `415` explica que hay que convertirlo.

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
