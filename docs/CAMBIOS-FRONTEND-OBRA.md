# Cambios para el front — la cadena de la obra

Qué cambió al construir **registros patronales, registros de obra, contratos y
SIROC** (D-65 a D-72). Es el mensaje de cierre del plan
[`PLAN-OBRA-CONTRATOS.md`](./PLAN-OBRA-CONTRATOS.md), sus ocho fases.

El detalle por endpoint está en [`ENDPOINTS-PROYECTOS.md`](./ENDPOINTS-PROYECTOS.md)
y [`ENDPOINTS-ADSCRIPCIONES.md`](./ENDPOINTS-ADSCRIPCIONES.md); aquí va sólo lo
que hay que **hacer** o **saber**.

---

## Lo único que se rompe

**`registrosPatronales` de la empresa pasó de `string[]` a objetos** (D-65). Es la
ruptura que se anunció y se hizo a tiempo, antes de que hubiera proyectos
colgando de ella.

```jsonc
// ANTES — GET /empresas/:id
"registrosPatronales": ["R13-77767-10-5", "H67-29973-10-5"]

// AHORA
"registrosPatronales": [
  { "_id": "66f…", "numero": "R13-77767-10-5", "descripcion": null, "activo": true },
  { "_id": "66f…", "numero": "H67-29973-10-5", "descripcion": "Zapopan", "activo": true }
]
```

Y **`PATCH /empresas/:id` ya no los acepta**: tienen sus propias rutas
(`POST/PATCH /empresas/:id/registros-patronales…`, sólo administrador de
plataforma). Si el formulario de empresa los mandaba, hay que sacarlos de ahí.

Todo lo demás de este trabajo es **aditivo**.

---

## Lo que hay que capturar y no existía

### Un proyecto ahora exige dos registros más

`POST /proyectos` pide **`registroPatronalId`** y **`registroObraId`**, los dos
obligatorios (D-69). No son texto: son ids de dos catálogos distintos, y es fácil
confundirlos porque suenan parecido.

| Campo                | Sale de                       | Es de      |
| -------------------- | ----------------------------- | ---------- |
| `registroPatronalId` | `empresa.registrosPatronales` | la EMPRESA |
| `registroObraId`     | `cliente.registrosObra`       | el CLIENTE |

Los dos desplegables se llenan con lo que ya traen `GET /empresas/:id` y
`GET /clientes/:id`. `GET /proyectos/:id` los devuelve **resueltos** —con número y
descripción— además del id, así que para mostrarlos no hace falta cruzar nada.

### Y se traba conforme avanza la obra

Estos campos dejan de poderse cambiar según lo que cuelgue del proyecto (D-70).
Conviene deshabilitarlos en la interfaz en vez de dejar que el `400` los explique:

| Campo                | Se bloquea cuando             |
| -------------------- | ----------------------------- |
| `registroPatronalId` | hay ≥1 contrato               |
| `registroObraId`     | hay ≥1 contrato **con SIROC** |
| `clienteId`          | hay ≥1 contrato               |
| `empresaId`          | siempre                       |

**Cambiar de cliente exige mandar el `registroObraId` nuevo en la misma
petición**: el anterior era del cliente viejo y el campo ya no puede quedar vacío.

---

## Pantallas nuevas que hacen falta

1. **Registros patronales de la empresa** — alta, edición y baja. Sólo
   administrador de plataforma. Una empresa tiene varios: Maquinaria CAMES tiene
   cuatro y su gente está repartida entre ellos.
2. **Registros de obra del cliente** — igual, bajo el cliente (`rh_admin` y
   `jefe_area`).
3. **Contratos del proyecto**, que **son sus fases** — una sola entidad, no dos
   (`nombre` es la etiqueta de la fase y es opcional). Con su SIROC.

### Tres cosas del contrato que sorprenden

- **El `numero` lo pone el servidor.** Es una secuencia dentro del proyecto; no lo
  mandes ni lo dejes capturar.
- **`estado` y `activo` NO son lo mismo, y van por rutas distintas.**
  `finalizado` es un contrato que terminó bien (`POST /contratos/:id/finalizar`);
  `activo: false` es uno capturado por error (`PATCH /contratos/:id/estado`).
  Ojo con la colisión de nombres: `/estado` mueve `activo`.
- **El SIROC es único en TODO el sistema.** Repetirlo responde `409
SIROC_DUPLICADO` **con el contrato y el proyecto que ya lo tienen**: muéstralos,
  que es lo que necesita quien está capturando. Se registra con
  `PUT /contratos/:id/siroc` (reemplaza el SIROC entero) y se quita con `DELETE`.

---

## Lo que avisa sin bloquear — no lo trates como error

Una persona puede cotizar en un registro patronal **distinto** al del proyecto al
que se le asigna. Eso **se permite** (D-71): Maquinaria CAMES tiene 144 personas
repartidas en cuatro registros, y moverlas es un trámite ante el IMSS, no un
error de captura.

`POST /proyectos/:id/asignaciones` responde **`201` igual**, con el aviso en
`data.avisos` y repetido en `message`. **El error fácil es pintar eso como
fallo.** La asignación se hizo.

`registroPatronalCoincide` tiene **tres estados**, y `null` no es `false`:

| Valor   | Significa               | Qué hacer                      |
| ------- | ----------------------- | ------------------------------ |
| `true`  | coinciden               | nada                           |
| `false` | cotiza en otro registro | marca de atención, no de error |
| `null`  | **no se pudo comparar** | falta capturar un dato         |

Sale en cada renglón de `GET /proyectos/:id/asignaciones`. No normalices los
números por tu cuenta para compararlos: el backend ya ignora guiones, espacios y
mayúsculas.

**`GET /asignaciones/:id`** es nuevo y devuelve la cadena completa resuelta —
`empleado → empresa → registro patronal → proyecto → registro de obra`— en
`trazabilidad`. Es la respuesta a «¿de qué obra y de qué registro es esta
persona?» sin cruzar nada del lado del navegador.

---

## Un campo más en la adscripción, y no es el que parece

`registroPatronalId` (D-72) vincula la relación laboral con el catálogo de su
empresa. **Convive con `condiciones.registroPatronal`, que sigue siendo texto**:

| Campo                          | Qué es                                  | ¿Confiable?  |
| ------------------------------ | --------------------------------------- | ------------ |
| `registroPatronalId`           | el vínculo validado contra el catálogo  | sí           |
| `condiciones.registroPatronal` | lo que dijo el archivo de nómina, crudo | no se valida |

**No asumas que el id está.** Hoy está en las 144 personas que vinieron de la
nómina, pero cualquiera que se dé de alta a mano sin él se queda en `null`. Para
mostrar el registro patronal de alguien, usa `condiciones.registroPatronal`, o el
`registroPatronalEmpleado` ya resuelto que dan las asignaciones.

Se corrige con `PATCH /adscripciones/:id`, y `null` desvincula.

---

## Lo que NO cambió, por si acaso

- **Empresa ↔ Cliente sigue siendo N:M**, por cartera. No se volvió 1:N: el
  catálogo de clientes es compartido entre las empresas del grupo.
- **`condiciones.registroPatronal` no se borró** ni se renombró.
- **Salario, SBC y cuenta bancaria siguen sin devolverse** en ninguna respuesta,
  a la espera de decidir quién puede verlos (LFPDPPP). Sigue bloqueando cualquier
  pantalla de nómina.
- Ningún endpoint anterior cambió de forma, salvo `registrosPatronales`.
