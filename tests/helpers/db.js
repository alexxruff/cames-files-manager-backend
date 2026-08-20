const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const { connect, disconnect } = require('../../src/config/database')

/**
 * Base de datos en memoria para las pruebas.
 *
 * Se usa `mongodb-memory-server` en vez de una base compartida para que las
 * pruebas sean aisladas y reproducibles: nadie pisa datos de nadie y no hace
 * falta Mongo instalado.
 *
 * Entre pruebas se limpian las colecciones, no se recrea el servidor: es órdenes
 * de magnitud más rápido y el aislamiento es el mismo.
 */
let memoria

beforeAll(async () => {
  memoria = await MongoMemoryServer.create()
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
