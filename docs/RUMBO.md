# Rumbo — hacia dónde va la plataforma

> **Esto NO es un diseño ni una especificación.** Nada de lo que está aquí está
> decidido, aprobado ni implementado, y **no cambia nada de lo que existe hoy**.
> Es contexto de dirección, para que quien retome el proyecto sepa hacia dónde
> apunta y no tome decisiones que estorben después.
>
> Ante cualquier discrepancia, mandan los documentos de siempre:
> `ARQUITECTURA-DATOS.md` para lo que hay, `DECISIONES.md` para el porqué,
> `CONTRATO-API.md` para la forma de las respuestas.
>
> **No implementes desde este archivo.** Cuando toque, se diseña con el cliente y
> se registra en `DECISIONES.md` como todo lo demás.

## Lo que la plataforma es hoy

Expedientes laborales: checklist de documentos por persona, carga de archivos,
validación por RH, vigencias, alertas y auditoría. El eje es **la persona y su
relación laboral con cada empresa del grupo**.

## Hacia dónde va

Dos cosas, en palabras del cliente:

### 1. Roles armables, en vez de tres niveles fijos

Hoy el acceso son tres valores de un enum (`rh_admin`, `rh_consulta`,
`jefe_area`) con una matriz de capacidades escrita en el código. La idea es que
**todos tengan un acceso base** y que el administrador general pueda **armar
roles como legos** —nuevos, o partiendo de unos por defecto— definiendo desde
configuración qué ve y qué no cada uno. Ahí es donde se resuelve quién puede ver
sueldos y datos bancarios.

### 2. Checklists operativos, dinámicos y asignables

Un jefe de área con operadores a su cargo podrá:

- asignar un grupo de operadores a un proyecto,
- armarles un checklist **construido como legos** —tipos de pregunta,
  formularios, subida de fotos, incidencias—,
- asignárselo a ese grupo, que lo llena cada quien por su cuenta,
- y ver **avances y bloqueos por persona** según lo que hayan respondido,
- con recurrencia: periódicos, por obra, o por tiempo determinado.

## Cuatro cosas que conviene no equivocar

Salieron de conversar el rumbo. No obligan a nada ahora; evitan trabajo perdido
después.

**El checklist operativo NO es el expediente.** Comparten la palabra y nada más.
El expediente es **uno por persona**, permanente, derivado de su contrato y sus
áreas, con custodia legal y vigencias. El operativo sería **una instancia por
persona, proyecto y periodo**, con respuestas en vez de documentos, que se
archiva cuando la obra termina. Estirar `records` y `checklist_templates` para
cubrir los dos rompería el expediente: van en colecciones aparte.

**Roles dinámicos sí; capacidades dinámicas no.** Las **capacidades** son verbos
que el código comprueba (`subir documento`, `validar`, `asignar a proyecto`, `ver
nómina`) y viven en el código, porque cada comprobación del backend apunta a una.
Los **roles** son colecciones de capacidades y son datos: el administrador arma
los que quiera. Si las capacidades también fueran datos, nadie podría responder
«¿por qué este usuario ve esto?».

**El rol dice _qué_ puede hacer; la adscripción dice _sobre quién_.** Es la misma
lección de D-60: trabajar en un área no es dirigirla. Un rol «Jefe de
operaciones» no debe traer implícito a qué gente alcanza — eso lo sigue diciendo
`dirigeAreas`. Si el rol carga las dos cosas, se acaba con un rol por persona.

**Ver la nómina no es una capacidad, es un campo.** «Puede asignar a proyecto» es
un verbo; «puede ver el salario» es un sustantivo. El rol necesitará las dos
listas —qué acciones ejecuta y qué secciones o campos ve— y conviene nombrarlas
distinto desde el principio, o no se sabrá por qué unas cosas se comprueban en la
ruta y otras al armar la respuesta.

## Lo que ya existe y sirve tal cual

- **`assignments`** (proyecto ↔ persona): es donde se colgaría a quién se le
  asigna un checklist operativo.
- **R2 con URL firmada**: la subida de fotos no empieza de cero.
- **El patrón plantilla → instancia derivada**: ya está resuelto y probado en el
  expediente.
- **Las áreas y las jefaturas** (D-58, D-60): el jefe ya tiene definido a qué
  gente alcanza.

## Dónde está el trabajo de verdad

**El constructor de formularios**, más que los roles. Tipos de pregunta,
validaciones, lógica condicional, respuestas sin esquema fijo, fotos y su
almacenamiento. Los roles son acotados; el constructor no.

## Preguntas abiertas para cuando toque

- ¿Qué secciones tiene el front, y qué debería ver cada perfil? Conviene
  responderlo **antes** de modelar los roles, no después.
- ¿La recurrencia genera instancias por adelantado o al vencer?
- ¿Un checklist operativo puede exigir documentos del expediente, o son mundos
  separados?
- ¿Las incidencias son un tipo de respuesta o una entidad propia con su
  seguimiento?

## Sobre comprar en vez de construir

La parte de checklists operativos —formularios armables, asignados a cuadrillas,
con fotos e incidencias y seguimiento— es el terreno de productos que ya existen,
como Checklist Fácil. Vale la pena evaluarlo antes de construir, aunque sea para
acotar el alcance.

Lo que no se compra hecho es lo que ya está: expedientes con vigencias,
versionado, bitácora legal de accesos y el modelo multiempresa con expediente
único por persona.
