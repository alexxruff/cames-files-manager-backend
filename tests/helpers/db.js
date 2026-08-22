const mongoose = require('mongoose')
const { MongoMemoryReplSet } = require('mongodb-memory-server')
const { connect, disconnect } = require('../../src/config/database')

/**
 * Base de datos en memoria para las pruebas, como REPLICA SET de un nodo.
 *
 * Tiene que ser replica set y no un servidor suelto porque el código usa
 * transacciones (crear un empleado con su expediente, dar acceso escribiendo
 * `empleados` y `credenciales`). Con `MongoMemoryServer` a secas, cada
 * `startSession().withTransaction()` falla con
 * "Transaction numbers are only allowed on a replica set member or mongos".
 *
 * Se levanta una vez por archivo de pruebas y entre pruebas sólo se limpian las
 * colecciones: recrear el servidor por prueba multiplicaría el tiempo sin ganar
 * aislamiento.
 */
let memoria

beforeAll(async () => {
  memoria = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' }
  })
  await connect({ uri: memoria.getUri(), dbName: 'cames_expedientes_test' })
})

afterEach(async () => {
  const colecciones = await mongoose.connection.db.collections()
  await Promise.all(colecciones.map((c) => c.deleteMany({})))
})

afterAll(async () => {
  await disconnect()
  if (memoria) await memoria.stop()
})
