# Plan · Importación de colaboradores desde .xlsx

Plan de trabajo para dar de alta trabajadores a partir del archivo de nómina, con
re-importación idempotente.

> ## ✅ IMPLEMENTADO
>
> Este documento se conserva porque tiene el **análisis del archivo real** —los
> valores de cada columna, la calidad de los datos, los 19 puestos, los 14
> departamentos— y eso sigue siendo la referencia de por qué el mapeo es como es.
>
> Para lo demás, ve a lo que está al día:
>
> - **Qué se implementó y por qué** → `DECISIONES.md` **D-46**
> - **Cómo se llaman los endpoints** → `ENDPOINTS-IMPORTACION.md`
> - **La forma exacta de la respuesta** → `CONTRATO-API.md`
>
> ### Lo que se hizo distinto del plan
>
> 1. **`nomina` se guarda pero NO se expone.** El plan dejaba abierta la pregunta
>    de quién puede ver salario, SBC y cuenta bancaria, y la dejaba visible
>    mientras tanto. Se implementó al contrario: se guarda y **ninguna respuesta
>    lo devuelve** (`toJSON` lo omite y el campo va con `select: false`). Guardar
>    no obliga a exponer, y exponer datos sensibles sin la regla decidida sí
>    tenía consecuencias. La decisión sigue abierta en `ESTADO.md`.
> 2. **La regla de qué se pisa al re-importar se partió en dos.** El plan decía
>    «actualiza lo que cambió; no toca lo capturado a mano», que es ambiguo. Quedó:
>    en la **persona** el archivo sólo rellena lo vacío; en la **relación laboral**
>    el archivo manda. Ver D-46.
> 3. **El puesto no se cambia al re-importar**, se reporta. Cambiar el `tipo`
>    arrastra la coherencia con la categoría y la regla de áreas.
> 4. **El archivo real NO se copió a `tests/fixtures/`.** Trae CURP, NSS, salarios
>    y cuentas de 145 personas reales, y el servicio se niega a persistirlo justo
>    para no tener otra copia; committearlo al repo habría sido peor. Las pruebas
>    generan archivos con la misma estructura y los mismos casos borde
>    (`tests/helpers/nominaWorkbook.js`), y hay una prueba que usa el real **si
>    está presente** en `docs/`.
> 5. **La fila de encabezados se busca, no se supone.** El plan la fijaba en la 5;
>    se localiza por las columnas que contiene, para que un reporte con un renglón
>    más de título siga funcionando.
> 6. **`datosPendientes` se limpia en el modelo**, no en `affiliationService`, para
>    que valga por cualquier camino que escriba la adscripción.
> 7. **Se agregaron dos contadores al resumen** (`seAdscriben` y `sinCambios`): son
>    estados reales que el plan metía dentro de `yaExisten`.

Archivo analizado: `docs/Colaboradores_20260824.xlsx` (34 KB, una hoja).

---

## 1. Qué trae el archivo — verificado, no supuesto

Todo lo de esta sección se comprobó leyendo el archivo real.

### Estructura

| Dónde       | Qué hay                             |
| ----------- | ----------------------------------- |
| Filas 1-4   | Encabezado del reporte              |
| Fila 2      | `EMPRESA` → **MAQUINARIA CAMES**    |
| Fila 3      | `RFC` → **MCA180611HF1**            |
| **Fila 5**  | Nombres de las 30 columnas          |
| **Fila 6+** | **145 colaboradores**, uno por fila |

**El archivo es de UNA empresa.** El nombre y el RFC vienen en el encabezado, y
son la base de la validación de seguridad del punto 4.

### Los valores reales de cada columna que importa

**Estatus** (3 valores, ninguno inesperado):

| Valor       | Filas | Significa                                        |
| ----------- | ----- | ------------------------------------------------ |
| `Baja`      | 71    | Ya no trabaja ahí; queda en el listado como baja |
| `Alta`      | 67    | Activo                                           |
| `Reingreso` | 7     | Estuvo de baja y volvió: **activo**              |

**Tipo de contrato** (5 valores — mapean 1:1 con nuestro enum, son los códigos
del catálogo del SAT):

| En el archivo                                     | Filas | Nuestro enum           |
| ------------------------------------------------- | ----- | ---------------------- |
| `02 Contrato de trabajo por obra determinada`     | 85    | `obra_determinada`     |
| `01 Contrato de trabajo por tiempo indeterminado` | 46    | `indeterminado`        |
| `03 Contrato de trabajo por tiempo determinado`   | 8     | `determinado`          |
| `06 Contrato de trabajo con capacitación inicial` | 4     | `capacitacion_inicial` |
| `05 Contrato de trabajo sujeto a prueba`          | 2     | `prueba`               |

**Puesto**: 19 distintos. `Operador` (60), `Ayudante General` (47), `Peon` (9),
`Residente` (5), `Segurista` (5), `Analista` (3), y 13 más con 1-2 cada uno.

**Departamento**: 14 distintos, y **no son todos departamentos**: `Axis Zapopan`
(21), `Axis 3` (16), `Plenares` (12), `Kulkana` (2), `FlexPark` (2) son **obras**,
no áreas. El resto sí son áreas reales (`Operaciones` 62, `Administración` 5,
`Dirección` 3, `Recursos Humanos` 1, …). Ver punto 3.

### Calidad de los datos

| Campo               | Estado                                                        |
| ------------------- | ------------------------------------------------------------- |
| ID                  | 145 únicos, ninguno vacío                                     |
| RFC                 | 145 únicos, ninguno vacío                                     |
| CURP                | 145 únicos, ninguno vacío                                     |
| Fecha de ingreso    | Ninguna vacía                                                 |
| NSS                 | 1 duplicado: `00000000000` en 2 filas (relleno, no es un NSS) |
| Correo electrónico  | **85 vacíos**, y 1 duplicado real                             |
| Fecha de nacimiento | 10 vacías                                                     |

**No hay filas repetidas por persona.** El "histórico" del archivo es que
incluye a los que ya se fueron (`Baja`), no varias filas por trabajador.

### ⚠️ Las fechas, y por qué esto es la trampa de D-09

Las 280 fechas del archivo llegan como `Date` a **medianoche UTC** del día civil
correcto. Se comprobó: **extraerlas con `getFullYear()/getMonth()/getDate()`
(hora local) da el día anterior en las 280**, porque el servidor está en GMT-6.

**Se extraen en UTC** (`toISOString().slice(0, 10)`) y se guardan como
`String 'YYYY-MM-DD'`, que es lo que manda D-09. Va con prueba propia.

---

## 2. Decisiones tomadas (confirmadas contigo)

### a) Contratos temporales sin fecha de término → entran marcados como incompletos

**El problema:** 99 de 145 tienen contrato temporal y el archivo **no trae fecha
de término**. Nuestro `Affiliation` la exige para todo contrato temporal, porque
de ahí sale la vigencia del documento `contrato` (D-41).

**La solución:** la adscripción gana `datosPendientes: [String]`. Cuando incluye
`'fechaTerminoContrato'`, la validación del modelo **omite esa regla concreta**
—sólo esa— y la adscripción entra con `fechaTerminoContrato: null`.

Dos candados para que no se vuelva una puerta trasera:

1. `datosPendientes` **no está en la lista blanca** de `updateAffiliationValidation`,
   así que no se puede poner desde `PATCH /adscripciones/:id`. Sólo lo escribe el
   importador.
2. En cuanto alguien captura la fecha por `PATCH`, se saca sola de la lista.

Consecuencia que hay que asumir: mientras esté pendiente, el documento `contrato`
de esas 99 personas no puede derivar vigencia. El listado de pendientes es lo que
permite cerrarlo después.

### b) Se guarda toda la información de nómina, banco y cuenta incluidos

Va en la **adscripción**, no en la persona: el salario, el registro patronal y la
cuenta donde le depositan son de su relación con **esa** empresa. Alguien en dos
empresas del grupo tiene dos salarios y puede tener dos cuentas.

> **Nota que hay que resolver antes de exponer esto:** salario, SBC y número de
> cuenta son datos personales sensibles bajo LFPDPPP, y **hoy los vería cualquiera
> que pueda ver la adscripción** (incluido `jefe_area` en sus áreas). El sistema ya
> tiene el mecanismo para acotarlo —capacidades + bitácora de accesos—, pero
> decidir quién puede verlos es una decisión tuya que **no está tomada**. Queda
> anotado en `ESTADO.md` como decisión abierta.

### c) La empresa destino se elige, y el RFC del archivo se valida contra ella

Se manda `empresaId` al importar. El backend compara el RFC del encabezado
(`MCA180611HF1`) con el de esa empresa:

- Coinciden → adelante.
- No coinciden → **se avisa en la previsualización** y hay que confirmar
  explícitamente (`confirmarRfcDistinto: true`) para continuar.
- La empresa no tiene RFC capturado → se avisa, no se bloquea.

Es lo que evita meter a los 145 de Maquinaria Cames en la empresa equivocada.

---

## 3. Cómo se traduce cada columna

### A la persona (`employees`) — lo que es de ella, viva donde viva

| Columna del archivo                               | Campo             |
| ------------------------------------------------- | ----------------- |
| `Nombre` + `Primer Apellido` + `Segundo Apellido` | `nombre` (unido)  |
| `RFC`                                             | `rfc`             |
| `CURP`                                            | `curp`            |
| `NSS`                                             | `nss`             |
| `Fecha de nacimiento`                             | `fechaNacimiento` |
| `Celular`                                         | `telefono`        |
| `Correo electrónico`                              | `email`           |
| `Puesto`                                          | → `categoriaId`   |
| (derivado del puesto)                             | → `tipo`          |

### A la adscripción (`affiliations`) — su relación con esta empresa

| Columna del archivo | Campo                                  |
| ------------------- | -------------------------------------- |
| `ID`                | `numeroEmpleado` **(campo nuevo)**     |
| `Fecha de ingreso`  | `fechaIngreso`                         |
| `Tipo de contrato`  | `tipoContrato`                         |
| `Estatus`           | `activo`                               |
| `Departamento`      | `departamento` (crudo) **+** → `areas` |
| Nómina y banco      | `nomina{}` **(subdocumento nuevo)**    |

`nomina{}`: `salarioDiario`, `sbcParteFija`, `sbcParteVariable`, `sbcTopeUMA`,
`baseCotizacion`, `zonaSalario`, `tipoPrestacion`, `periodicidadPago`, `turno`,
`tipoRegimen`, `registroPatronal`, `teletrabajador`, `banco`, `sucursal`,
`cuenta`.

### Las tres traducciones que no son directas

**1. Puesto → categoría del catálogo.** El modelo `Category` **ya resuelve la
estandarización que pediste**: tiene `nombreNormalizado` con índice único, y
`normalize()` quita acentos y mayúsculas. Así, `Peon` / `Peón` / `PEON` /
`peon ` son la misma categoría, y la segunda importación la reutiliza en vez de
duplicarla. Se crean las que falten (19 en este archivo) y en la previsualización
se listan aparte, para que veas cuáles son nuevas.

**2. Puesto → `tipo` (mano de obra / administrativo).** Por lista de palabras del
puesto: `operador`, `ayudante`, `peon`, `segurista`, `topografo`, `albañil`,
`oficial`, `chofer`, `velador`, `soldador`, `electricista`, `carpintero`,
`fierrero`, `mecanico`, `jardinero`, `limpieza` → **mano de obra**. Todo lo demás
→ **administrativo**. Con los 19 puestos de este archivo clasifica bien; la
previsualización muestra el resultado para que se pueda revisar antes de aplicar.

**3. Departamento → `areas`.** Traducción explícita de los que **sí** son áreas:

| Departamento             | Área               |
| ------------------------ | ------------------ |
| `Operaciones`            | `obra`             |
| `Operación Limpieza`     | `mantenimiento`    |
| `Proyectos Urbanización` | `proyectos`        |
| `Administración`         | `administracion`   |
| `Dirección`              | `direccion`        |
| `Recursos Humanos`       | `recursos_humanos` |
| `Contabilidad`           | `contabilidad`     |
| `Comercial`              | `ventas`           |
| `Costos y Presupuestos`  | `administracion`   |

Los que son **obras** (`Axis Zapopan`, `Axis 3`, `Plenares`, `Kulkana`,
`FlexPark`) no tienen área equivalente: caen al valor por defecto según el tipo
(`obra` para mano de obra, `administracion` para administrativo) **y el nombre
original se conserva en `departamento`**, que es donde de verdad dice en qué obra
está. Cuando existan proyectos de verdad, de ahí sale la asignación.

---

## 4. Los dos endpoints

Sin estado intermedio: la previsualización y la importación reciben el archivo
las dos veces. Con 34 KB no vale la pena una colección de importaciones pendientes
que además habría que limpiar.

### `POST /empleados/importar/previsualizar` — no escribe nada

`multipart/form-data`: `archivo` (el .xlsx) + `empresaId`.

```jsonc
// data
{
  "archivo": { "empresa": "MAQUINARIA CAMES", "rfc": "MCA180611HF1", "filas": 145 },
  "empresa": { "_id": "…", "nombre": "…", "rfcCoincide": true },
  "resumen": {
    "nuevos": 145,
    "yaExisten": 0,
    "seReactivan": 0,
    "seDanDeBaja": 0,
    "actualizan": 0,
    "conError": 0
  },
  "categoriasNuevas": [{ "nombre": "Operador", "tipo": "mano_de_obra", "filas": 60 }],
  "nuevos": [
    {
      "fila": 6,
      "nombre": "…",
      "curp": "…",
      "puesto": "…",
      "tipo": "…",
      "estatus": "Alta"
    }
  ],
  "yaExisten": [{ "fila": 7, "nombre": "…", "curp": "…", "cambios": ["telefono"] }],
  "conError": [
    { "fila": 40, "nombre": "…", "motivo": "La CURP no tiene un formato válido" }
  ],
  "avisos": ["99 contratos temporales entran sin fecha de término"]
}
```

Esto es lo que pediste: **antes de tocar la base, ver quiénes se van a sumar.**

### `POST /empleados/importar` — aplica

Mismo cuerpo, más `confirmarRfcDistinto` si hiciera falta. Devuelve el mismo
resumen con lo que **de verdad** pasó.

**Permiso:** `rh_admin`. Es un alta masiva sobre el catálogo compartido; ni
`rh_consulta` ni `jefe_area`.

---

## 5. Re-importar: qué se toca y qué no

Es lo que hace que se pueda subir el archivo cuantas veces se quiera.

**Cómo se reconoce a alguien que ya existe**, en este orden: **CURP** → **RFC** →
`numeroEmpleado` dentro de esa empresa. Los 145 traen CURP y RFC, así que el
tercero es sólo una red.

| Situación                                    | Qué hace                                                     |
| -------------------------------------------- | ------------------------------------------------------------ |
| No existe                                    | Crea persona + adscripción + expediente (en una transacción) |
| Existe, sin adscripción a esta empresa       | Sólo adscribe; no duplica a la persona                       |
| Existe y ya adscrito                         | Actualiza lo que cambió; **no toca lo capturado a mano**     |
| `Baja` en el archivo y activo en la base     | Da de baja **de esta empresa** (no del sistema)              |
| `Alta`/`Reingreso` y de baja en la base      | Reactiva la adscripción                                      |
| Está en la base pero **ya no en el archivo** | **No se toca.** El archivo no es autoridad para borrar       |

Lo que **nunca** pisa una re-importación: el acceso a la plataforma, el
expediente y sus documentos, y las adscripciones a **otras** empresas.

Crear o reactivar una adscripción **re-sincroniza el expediente** (D-41), que ya
está resuelto por el módulo de adscripciones (D-45).

---

## 6. Qué se toca del código

**Nuevo:**

| Archivo                                         | Qué hace                                                     |
| ----------------------------------------------- | ------------------------------------------------------------ |
| `src/utils/spreadsheet.js`                      | Lee el .xlsx a filas crudas (envoltura fina sobre `exceljs`) |
| `src/utils/domain/employeeImport.js`            | **Puro**: fila → persona + adscripción + avisos. Sin base    |
| `src/api/v1/employees/employeeImportService.js` | Compara contra la base y aplica                              |
| `src/validations/employeeImportValidation.js`   | Validación de los dos endpoints                              |
| `tests/unitarias/domain/employeeImport.test.js` | Mapeos y casos borde, sin base                               |
| `tests/integracion/employeesImport.test.js`     | Los dos endpoints de punta a punta                           |

**Modificado:**

- `affiliationModel.js` — campos nuevos (`numeroEmpleado`, `departamento`,
  `nomina{}`, `datosPendientes[]`) y la excepción de validación del punto 2a.
- `employeeController.js` / `employeeRoutes.js` — las dos rutas.
- `affiliationService.js` — al capturar `fechaTerminoContrato`, sacarla de
  `datosPendientes`.
- `package.json` — `exceljs` (ya instalado).

**Sobre `exceljs`:** `npm audit` marca `uuid <11.1.1` como moderado. **No aplica
aquí**: el aviso es sobre `uuid` v3/v5/v6 con parámetro `buf`, y `exceljs` sólo
llama `uuidv4()` sin argumentos (lo verifiqué en el código instalado). Bajar a
`exceljs@3.4.0` sería un cambio incompatible sin ganancia de seguridad.

**El archivo se procesa en memoria y no se guarda**: no va a R2 ni queda en disco.
Trae CURP, NSS, salarios y cuentas bancarias de 145 personas; conservarlo sería
un segundo lugar del que se pueden filtrar. Límite de tamaño y validación por
magic bytes, igual que los documentos del expediente.

---

## 7. Cómo se prueba

**Unitarias, sin base** (`employeeImport.js` es puro a propósito):

- Las 5 traducciones de tipo de contrato.
- `Alta`/`Reingreso` → activo; `Baja` → inactivo.
- **Las fechas no se corren un día** — con las fechas reales del archivo.
- Nombre unido a partir de las 3 columnas.
- Puesto → tipo, con los 19 puestos reales.
- Puesto con acentos y mayúsculas distintas → la misma categoría.
- Departamento → área, incluyendo los que son obras y caen al valor por defecto.
- Fila sin CURP, sin fecha de ingreso, con contrato desconocido → error con
  número de fila.

**Integración, con base:**

- Importar el archivo real: 145 personas, 19 categorías, 145 adscripciones.
- **Importarlo dos veces seguidas → la segunda no crea nada** (lo que pediste).
- Segunda importación con un `Baja` que antes era `Alta` → adscripción de baja.
- Segunda importación con un `Reingreso` → adscripción reactivada.
- Una persona que ya existía en otra empresa → se adscribe, no se duplica.
- Un dato editado a mano en la base no se pisa al re-importar.
- RFC distinto → avisa y no aplica sin confirmación.
- 403 para `rh_consulta` y `jefe_area`; 404 con empresa fuera de alcance.
- Un .xlsx que no tiene las columnas esperadas → 400 que dice cuáles faltan.

El archivo real se usa como caso de prueba: se copia a `tests/fixtures/`.

---

## 8. Lo que este plan deja fuera a propósito

- **No borra a nadie.** Que alguien desaparezca del archivo no lo da de baja.
- **No crea empresas** (decisión 2c).
- **No toca expedientes ni documentos**, más allá de la re-sincronización del
  checklist que ya hace el módulo de adscripciones.
- **No crea accesos a la plataforma.** Los 145 entran como personas sin login;
  dar acceso sigue siendo `POST /empleados/:id/acceso`, uno por uno y a
  propósito.
- **No asigna a proyectos**, aunque el departamento diga `Axis Zapopan`: los
  proyectos son otra colección y la asignación es una decisión, no un efecto
  secundario de importar un archivo.

---

## 9. Las tres preguntas del plan, y cómo quedaron

1. ~~**El plan completo.**~~ Implementado, con las siete desviaciones de arriba.
2. **Quién puede ver salario, SBC y cuenta bancaria.** **Sigue abierta.** Se
   implementó de forma que no bloquea: los datos se guardan y **no se exponen**,
   así que la decisión se puede tomar después sin haber filtrado nada mientras
   tanto. Anotada en `ESTADO.md` como decisión abierta #10.
3. **La lista de puestos que son mano de obra.** **Sigue abierta**, y no bloquea:
   con los 19 puestos de este archivo clasifica bien, y cuando el puesto ya existe
   en el catálogo **manda el catálogo**, no la lista. Está en una constante de una
   línea (`PALABRAS_MANO_DE_OBRA` en `src/utils/domain/employeeImport.js`) y la
   previsualización muestra el resultado de cada puesto antes de aplicar.
