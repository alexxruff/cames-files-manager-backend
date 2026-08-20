---
name: records-domain
description: Reglas de negocio de expedientes — estatus efectivo, vigencias, avance, semáforo, alertas, generación y re-sincronización del checklist, ciclo de vida de un documento. Úsala al implementar o modificar cualquier cosa de expedientes, documentos, alertas o métricas.
---

# Dominio de expedientes

Estas reglas ya están implementadas y **probadas en el front**
(`src/utils/expediente.ts`, `src/utils/checklist.ts` y sus `__tests__/` en
`~/Documents/projects/cames-files-manager`). Son la referencia de
comportamiento: **cópialas al pie de la letra**, no las reinterpretes.

Van en `src/utils/domain/` como **funciones puras** (sin Mongoose, sin HTTP) y
se prueban en `tests/unitarias/`. Los servicios las llaman; los controladores no
las conocen.

## 1. Estatus efectivo de un documento

```
si estatus almacenado ≠ 'validated' → devolver el estatus almacenado
si no hay vigenciaHasta             → 'validated'

dias = vigenciaHasta − hoy
  dias <  0   → 'expired'
  dias <= 30  → 'expiring'      (DIAS_ALERTA_VENCIMIENTO, configurable)
  dias >  30  → 'validated'
```

Fácil de equivocar, y hay prueba para cada uno:

- **El día del vencimiento todavía cuenta como vigente**: `dias === 0` es
  `expiring`, no `expired`. Vence al día siguiente.
- **El umbral es inclusivo**: exactamente 30 días es `expiring`; 31 es
  `validated`.
- **Lo que no está validado no vence**: un `in_review` con vigencia pasada sigue
  siendo `in_review`.

## 2. Avance

```
requeridos = documentos con requerido = true
entregados = de los requeridos, los que quedan en 'validated' o 'expiring'
faltantes  = de los requeridos, los que quedan en 'pending'
porcentaje = requeridos === 0 ? 100 : redondear(entregados / requeridos × 100)

enRevision = TODOS los documentos en 'in_review'
rechazados = TODOS los documentos en 'rejected'
porVencer  = TODOS los documentos en 'expiring'
vencidos   = TODOS los documentos en 'expired'
```

Tres asimetrías deliberadas:

- El **porcentaje sólo mira los requeridos**: un opcional sin subir no impide
  llegar al 100 %.
- Los **contadores miran todos** los documentos: un opcional vencido también
  exige que alguien actúe.
- **Un documento por vencer cuenta como entregado**: el checklist está completo,
  sólo hay que renovarlo.

`requeridos === 0` devuelve 100 y no divide entre cero.

## 3. Semáforo del expediente

En este orden exacto:

```
vencidos > 0            → 'expired'
entregados < requeridos → 'incomplete'
porVencer > 0           → 'expiring'
en otro caso            → 'complete'
```

## 4. Alertas (derivadas, nunca almacenadas)

Sólo de **colaboradores activos**; los dados de baja no generan ninguna.

| Estatus efectivo                               | Alerta                    |
| ---------------------------------------------- | ------------------------- |
| `expired`                                      | `vencido` (severidad 0)   |
| `rejected`                                     | `documento_rechazado` (1) |
| `expiring`                                     | `por_vencer` (2)          |
| `pending` **y requerido**                      | `documento_faltante` (3)  |
| `pending` y opcional, `validated`, `in_review` | ninguna                   |

- **`id` estable entre recálculos**: `` `${expedienteId}:${tipoDocumento}:${tipoAlerta}` ``.
  El front lo usa como `key` de React; si cambia, la lista parpadea.
- **Orden**: severidad, luego `diasRestantes` ascendente, luego nombre del
  colaborador con `localeCompare` español (`utils/text.js → compareNames`).
- **`diasRestantes`** es negativo si ya venció y se omite si el documento no
  tiene vigencia.
- **`mensaje`** es texto listo para pintar, en español:
  `'Contrato de trabajo firmado venció hace 4 días.'` ·
  `'Examen médico de ingreso vence en 7 días.'` / `'…vence hoy.'` ·
  `'CURP fue rechazado y hay que volver a subirlo.'` ·
  `'Falta subir Alta ante el IMSS.'`

## 5. Checklist: generación y re-sincronización

**Generar** (al crear el expediente): resolver la plantilla por especificidad
(cliente+área+contrato → cliente+contrato → global+área+contrato →
global+contrato → `plantilla-general`), crear cada documento en `pending` con
`versiones: []`, copiando `requerido` y `vigenciaMeses`, y guardar el
`plantillaId` usado.

**Re-sincronizar** (cambia el área o el tipo de contrato del colaborador, o se
edita la plantilla). **Nunca se borra trabajo hecho:**

- Documento que sigue en la plantilla → se conserva con su estatus, archivo y
  versiones; sólo se actualizan `requerido` y `vigenciaMeses`.
- Documento que ya no está: con versiones → se conserva como
  `requerido: false`; sin nada subido → se descarta.
- Documento nuevo → se agrega en `pending`.

## 6. Vigencia sugerida al subir

- `contrato`: si el contrato es temporal, la vigencia es la
  `fechaTerminoContrato` del colaborador; si es `indeterminado`, **sin vigencia**.
- Los demás que caducan (`examen_medico`): hoy + `vigenciaMeses` de la plantilla.
- Al sumar meses, **respetar el fin de mes**: usa `addMonths` de `utils/dates.js`.

## 7. Ciclo de vida de un documento

```
pending ──subir──▶ in_review ──validar──▶ validated ──(tiempo)──▶ expiring ──▶ expired
                       │
                       └──rechazar──▶ rejected ──subir (nueva versión)──▶ in_review
```

- **Subir se permite desde cualquier estatus** (así se reemplaza).
- **Validar y rechazar sólo desde `in_review`**; desde otro estatus, `400`.
- **Rechazar exige motivo** de al menos 10 caracteres útiles.
- Al subir una versión nueva: numerarla `versiones.length + 1`, marcar
  `reemplazadaEn` en la anterior, insertarla **al inicio** del arreglo
  (`versiones[0]` es la vigente), poner el documento en `in_review` y **limpiar
  `motivoRechazo`, `revisadoPor` y `revisadoEn`**: el rechazo anterior no debe
  contaminar la entrega nueva.
- **Colaborador dado de baja ⟹ expediente en sólo lectura**: subir, validar y
  rechazar responden `400`.
- Si el documento exige vigencia y no viene `vigenciaHasta`, `400`.

## 8. Permisos que toca el dominio

- `jefe_area` ve el listado, el avance y el historial de metadatos de **su
  área**, pero **no se le emite URL firmada** de un documento sensible (`403`).
- `rh_consulta` sube pero no valida ni rechaza (`403`).
- Cada emisión de URL firmada y cada exportación de reporte **se registran en la
  bitácora**: es requisito legal (LFPDPPP), no un extra.
