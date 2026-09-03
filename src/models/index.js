/**
 * Registro central de modelos de Mongoose.
 *
 * POR QUÉ EXISTE: `populate()` resuelve el modelo referenciado **por nombre**, y
 * si ese modelo no se ha cargado, Mongoose lanza
 * `MissingSchemaError: Schema hasn't been registered for model "X"` en tiempo de
 * ejecución. Pasó de verdad: `/auth/login` popula la empresa de las adscripciones
 * y en el servidor real nadie había requerido `Company` todavía, así que el login
 * de cualquiera con adscripción respondía 500. Las pruebas no lo vieron porque las
 * fábricas importan todos los modelos.
 *
 * Cargarlos todos al arrancar quita esa clase de error de raíz. El costo es cero:
 * son módulos que igual se cargan en cuanto se usa el recurso.
 *
 * **Al agregar un modelo nuevo, agrégalo aquí.** `tests/unitarias/models.test.js`
 * falla si falta alguno.
 */
const modelos = {
  Company: require('../api/v1/companies/companyModel'),
  Employee: require('../api/v1/employees/employeeModel'),
  Credential: require('../api/v1/credentials/credentialModel'),
  Client: require('../api/v1/clients/clientModel'),
  Category: require('../api/v1/categories/categoryModel'),
  Area: require('../api/v1/areas/areaModel'),
  Affiliation: require('../api/v1/affiliations/affiliationModel'),
  Portfolio: require('../api/v1/portfolios/portfolioModel'),
  Project: require('../api/v1/projects/projectModel'),
  Assignment: require('../api/v1/assignments/assignmentModel'),
  Contract: require('../api/v1/contracts/contractModel'),
  Machine: require('../api/v1/machines/machineModel'),
  ChecklistTemplate: require('../api/v1/checklistTemplates/checklistTemplateModel'),
  Record: require('../api/v1/records/recordModel'),
  AccessLog: require('../api/v1/accessLogs/accessLogModel'),
  Upload: require('../api/v1/uploads/uploadModel')
}

/** Nombres que deben estar registrados. Lo usa la prueba de humo. */
const NOMBRES_DE_MODELOS = Object.freeze(Object.keys(modelos))

module.exports = { ...modelos, NOMBRES_DE_MODELOS }
