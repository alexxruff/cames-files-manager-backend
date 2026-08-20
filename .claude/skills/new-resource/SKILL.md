---
name: new-resource
description: Receta para agregar un recurso nuevo a la API (expedientes, alertas, plantillas, reportes, clientes) con las cuatro capas, validaciones, rutas, pruebas y documentación. Úsala al empezar cualquier módulo nuevo de src/api/v1.
---

# Agregar un recurso a la API

Cada recurso vive en `src/api/v1/<recurso>/` con cuatro archivos y una
responsabilidad clara por archivo. El nombre de la carpeta va en **inglés**
(`records`, `alerts`, `checklistTemplates`); la ruta que se monta va en
**español** porque es contrato (`/expedientes`, `/alertas`).

```
src/api/v1/records/
  recordModel.js        Esquema de Mongoose. Sin lógica de negocio.
  recordService.js      Reglas de negocio. No sabe que existe HTTP.
  recordController.js   Parsea la petición, llama al servicio, responde.
  recordRoutes.js       Rutas + validaciones + middlewares.
src/validations/recordValidation.js
tests/integracion/records.test.js
```

## Orden de trabajo

1. **Modelo.** Sigue la skill `mongo-modeling`: `clienteId`, `collection`
   explícita, `toJSON` que expone `_id` string, índices, invariantes en
   `pre('validate')`.

2. **Lógica de dominio pura → `src/utils/domain/`.** Cálculo de avance,
   semáforo, vigencias, alertas y generación de checklist NO van en el servicio:
   van en funciones puras que se prueban sin base de datos ni HTTP. Ver la skill
   `records-domain`.

3. **Servicio.** Recibe `(datos, contexto)` y devuelve documentos o lanza
   `AppError`. El contexto trae siempre lo que decide qué se ve:

```js
async list(filtros, { scopeFilter = {}, areaFilter = {} } = {}) {
  const filtro = { ...scopeFilter, ...areaFilter, /* … */ }
  return Record.find(filtro)
}
```

**Toda consulta parte de `scopeFilter`.** Si un método no lo recibe, es un
agujero de seguridad, no una simplificación.

4. **Controlador.** Sin lógica. Traduce query/body → servicio → envelope:

```js
async list(req, res) {
  const expedientes = await recordService.list(
    { busqueda: req.query.busqueda, area: req.query.area },
    { scopeFilter: req.scopeFilter, areaFilter: req.areaFilter }
  )
  return ok(res, { expedientes })
}
```

5. **Validaciones** en `src/validations/<recurso>Validation.js`, con mensajes en
   español mostrables al usuario. Reutiliza los patrones que ya existen
   (`PATRON_NOMBRE`, `PATRON_PASSWORD`, `isCalendarDate`).

6. **Rutas.** El orden de los middlewares no es negociable:

```js
router.use(protect, applyScope) // sesión y alcance, en ese orden

router
  .route('/')
  .get(listValidation, validateRequest, asyncHandler(controller.list))
  .post(
    requireCapability(CAPABILITIES.MANAGE_EMPLOYEES),
    createValidation,
    validateRequest,
    asyncHandler(controller.create)
  )
```

7. **Montar** en `src/api/v1/routes/index.js` con la ruta en español.

8. **Pruebas** (skill `testing`): camino feliz, 401 sin sesión, 403 por
   capacidad, 404 por alcance ajeno, y los casos borde del dominio.

9. **Documentar**: `docs/CONTRATO-API.md` (forma exacta de la respuesta) y
   `docs/ESTADO.md` (marcar el módulo como hecho). Si algo se desvía del spec,
   anótalo en `docs/DECISIONES.md` con el motivo.

## Qué NO hacer

- Lógica de negocio en el controlador o en las rutas.
- Consultas de Mongoose desde el controlador.
- `res.json` a mano en vez de `utils/response`.
- `try/catch` en el controlador: para eso está `asyncHandler`.
- Un método de servicio que consulte sin `scopeFilter`.
- Persistir estatus derivados (`expiring`, `expired`, `avance`).
