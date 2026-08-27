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

Sólo estas cuatro: `POST /auth/login`, `GET /api/v1` (inventario), `GET /health`,
`GET /ready`. Todo lo demás exige sesión y pasa por el middleware de alcance.

## Implementado hoy

| Método | Ruta                                                       | Permiso                      | Nota                                                                                                                   |
| ------ | ---------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| GET    | `/`                                                        | —                            | Inventario: `implementados` se deriva del router, `pendientes` del spec                                                |
| GET    | `/health` · `/ready`                                       | —                            | Liveness y readiness (el segundo verifica Mongo)                                                                       |
| POST   | `/auth/login`                                              | —                            | `data: { user, token }` con el `AuthUser` nuevo                                                                        |
| GET    | `/auth/me`                                                 | sesión                       | Revalida; 401 si cambió la contraseña o le quitaron el acceso                                                          |
| POST   | `/auth/logout`                                             | sesión                       | `data: null`                                                                                                           |
| POST   | `/auth/cambiar-password`                                   | sesión                       | Invalida las demás sesiones y **devuelve token nuevo**                                                                 |
| GET    | `/empleados`                                               | ver empleados                | Paginado, con alcance por empresa y filtros; orden por número con o sin `empresaId` (D-53); `activo` en tres estados (D-51, D-52) |
| POST   | `/empleados`                                               | quien puede crear ese `tipo` | Persona + adscripción en transacción (D-33); duplicados (D-34); `numeroEmpleado` obligatorio (D-54); `tipo` sale de la categoría (D-59) |
| GET    | `/empleados/:id`                                           | ver empleados                | 404 si no es visible                                                                                                   |
| PATCH  | `/empleados/:id`                                           | quien puede crear ese `tipo` | Datos de la persona (D-54); cambiar `categoriaId` cambia el `tipo` (D-59); no toca acceso, estado ni adscripciones     |
| PATCH  | `/empleados/:id/estado`                                    | `rh_admin`                   | Baja lógica con motivo, o reactivación                                                                                 |
| POST   | `/empleados/:id/acceso`                                    | `rh_admin`                   | Da acceso a una persona existente                                                                                      |
| PATCH  | `/empleados/:id/acceso`                                    | `rh_admin`                   | Nivel, alcance, correo, activar                                                                                        |
| DELETE | `/empleados/:id/acceso`                                    | `rh_admin`                   | Quita el acceso; la persona queda                                                                                      |
| POST   | `/empleados/:id/acceso/restablecer-password`               | `rh_admin`                   | Cierra sus sesiones                                                                                                    |
| GET    | `/empresas` · `/empresas/:id`                              | sesión                       | Las suyas, con conteos reales de empleados, cartera y proyectos en curso                                               |
| POST   | `/empresas`                                                | admin de plataforma          | 409 en nombre o RFC repetidos                                                                                          |
| GET    | `/categorias`                                              | sesión                       | Pueblan el desplegable del alta; filtro `?tipo=`                                                                       |
| POST   | `/categorias`                                              | admin de plataforma          | Idempotente por nombre: 200 si ya existía                                                                              |
| PATCH  | `/categorias/:id/estado`                                   | admin de plataforma          | 400 si hay personas con ese puesto                                                                                     |
| GET    | `/areas`                                                   | sesión                       | Catálogo de áreas (D-58); `?activa=` en tres estados y `?temporal=`                                                    |
| POST   | `/areas`                                                   | admin de plataforma          | Idempotente por nombre: 200 si ya existía                                                                              |
| PATCH  | `/areas/:id`                                               | admin de plataforma          | Renombra; la `clave` es inmutable                                                                                      |
| PATCH  | `/areas/:id/estado`                                        | admin plataforma / RH        | Baja y reactivación. Las **temporales** las cierra RH; 400 si alguien la tiene (D-58)                                  |
| GET    | `/clientes` · `/clientes/:id`                              | sesión                       | Los de las carteras propias; `?catalogoCompleto=true` exige administrar clientes (D-40)                                |
| POST   | `/clientes`                                                | `rh_admin` o `jefe_area`     | 409 en nombre o RFC repetidos                                                                                          |
| PATCH  | `/clientes/:id`                                            | `rh_admin` o `jefe_area`     | Nombre, RFC y contactos                                                                                                |
| PATCH  | `/clientes/:id/estado`                                     | `rh_admin` o `jefe_area`     | Baja lógica; no hay borrado real (D-36)                                                                                |
| GET    | `/empresas/:id/clientes`                                   | sesión                       | La cartera de la empresa, con el cliente resuelto                                                                      |
| POST   | `/empresas/:id/clientes`                                   | `rh_admin` o `jefe_area`     | Mete un cliente a la cartera; 200 si reactiva un vínculo previo                                                        |
| PATCH  | `/carteras/:id` · `/carteras/:id/estado`                   | `rh_admin` o `jefe_area`     | Contacto y notas; sacar falla si hay proyectos con ese cliente                                                         |
| GET    | `/proyectos` · `/proyectos/:id`                            | sesión                       | Paginado, por alcance. Trae `diasParaCierre` derivado                                                                  |
| POST   | `/proyectos`                                               | `rh_admin` o `jefe_area`     | Exige cliente **en cartera activa** y ≥1 categoría                                                                     |
| PATCH  | `/proyectos/:id`                                           | `rh_admin` o `jefe_area`     | **Rechaza** `fechaFinEstimada` (D-38)                                                                                  |
| POST   | `/proyectos/:id/aplazar`                                   | `rh_admin` o `jefe_area`     | Única forma de mover el cierre; exige motivo y queda en el historial                                                   |
| POST   | `/proyectos/:id/finalizar`                                 | `rh_admin` o `jefe_area`     | Cierra también las asignaciones abiertas                                                                               |
| POST   | `/proyectos/:id/reabrir`                                   | `rh_admin` o `jefe_area`     | Limpia `fechaFinReal`; no reabre asignaciones                                                                          |
| POST   | `/proyectos/:id/categorias/clonar`                         | `rh_admin` o `jefe_area`     | Suma sin quitar ni duplicar                                                                                            |
| GET    | `/proyectos/:id/asignaciones`                              | sesión                       | `?activo=`; activas primero                                                                                            |
| GET    | `/proyectos/:id/asignables`                                | asignar a proyectos          | El selector: adscritos, activos, con categoría habilitada y sin asignar                                                |
| POST   | `/proyectos/:id/asignaciones`                              | asignar a proyectos          | Exige adscripción activa y categoría habilitada                                                                        |
| PATCH  | `/asignaciones/:id/salida`                                 | asignar a proyectos          | Cierra, no borra                                                                                                       |
| GET    | `/expedientes`                                             | ver empleados                | Paginado; mismos filtros que `/empleados` **más `estatus`** (D-45)                                                     |
| GET    | `/empleados/:id/expediente`                                | ver empleados                | Crea el expediente si no existía; `data: { expediente, empleado, avance }`                                             |
| GET    | `/expedientes/:id`                                         | ver empleados                | Lo mismo por id de expediente; 404 si el empleado no es visible                                                        |
| POST   | `/expedientes/:id/documentos/:tipo`                        | subir documentos             | `multipart`, campo `archivo`. Versiona; 413 >10 MB, 415 si no es PDF/JPG/PNG/WEBP                                      |
| GET    | `/expedientes/:id/documentos/:tipo/versiones/:version/url` | ver documentos               | URL firmada temporal; **queda en la bitácora** (D-41)                                                                  |
| POST   | `/expedientes/:id/documentos/:tipo/revisar`                | `rh_admin` · `rh_consulta`   | `{ aprobado, motivo? }`: valida o rechaza la versión en revisión (D-43, D-44)                                          |
| GET    | `/empresas/:id/adscripciones`                              | ver empleados                | `?activo=&area=&tipo=&categoriaId=&orden=`; el jefe de área sólo ve sus propias áreas (D-45, D-51)                     |
| POST   | `/empresas/:id/adscripciones`                              | `rh_admin`                   | Vincula a alguien que ya existe; 200 si reactiva una adscripción previa (D-45)                                         |
| PATCH  | `/adscripciones/:id`                                       | `rh_admin`                   | areas, tipoContrato, fechaIngreso, fechaTerminoContrato; re-sincroniza el checklist                                    |
| PATCH  | `/adscripciones/:id/estado`                                | `rh_admin`                   | Baja **de esa empresa**; cierra sus asignaciones abiertas ahí (D-45)                                                   |
| PATCH  | `/adscripciones/:id/jefaturas`                             | `rh_admin`                   | Qué áreas **dirige** esa persona en esa empresa (D-60)                                                                 |
| GET    | `/empresas/:id/jefaturas`                                  | `rh_admin`                   | Quién dirige cada área; incluye las que nadie dirige (D-60)                                                            |
| POST   | `/empleados/importar/previsualizar`                        | `rh_admin`                   | `multipart`: `archivo` (.xlsx) + `empresaId`. **No escribe nada** (D-46)                                               |
| POST   | `/empleados/importar`                                      | `rh_admin`                   | Igual, más `confirmarRfcDistinto?`. Idempotente: re-subir no duplica (D-46)                                            |
| GET    | `/alertas`                                                 | ver empleados                | Bandeja derivada; **agrupada por empleado y paginada** (D-47, D-48)                                                    |
| ALL    | `/usuarios*`                                               | —                            | **410** con las rutas nuevas (se borra cuando el front migre)                                                          |

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
    diferencias: { campo: string; enElArchivo: string; enLaPlataforma: string; mensaje: string }[]
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

## Pendiente

Ver la tabla de `ESTADO.md` y `backend-spec.md` §6. Las rutas están reservadas:
responden `404` y no deben ocuparse con otra cosa. `GET /api/v1` las lista en
`pendientes`.
