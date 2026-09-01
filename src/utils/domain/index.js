/**
 * Lógica de dominio de expedientes: funciones PURAS, sin Mongoose y sin HTTP.
 *
 * Es la réplica de lo que el front ya tiene probado en `src/utils/expediente.ts`
 * y `src/utils/checklist.ts`. Vive aquí y no en los servicios para poder probar
 * los casos borde sin base de datos: son los que enumera `backend-spec.md` §13 y
 * los que es fácil equivocar (el día del vencimiento cuenta como vigente, 30 es
 * `expiring` y 31 no, lo que no está validado no vence).
 *
 *   const { computeProgress, deriveAlerts } = require('../../utils/domain')
 */
module.exports = {
  ...require('./documentStatus'),
  ...require('./progress'),
  ...require('./alerts'),
  ...require('./checklist'),
  ...require('./expiry'),
  ...require('./registries'),
  ...require('./siroc')
}
