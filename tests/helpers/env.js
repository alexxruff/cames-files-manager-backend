// Entorno de pruebas. Se fija antes de que cualquier módulo lea process.env, y
// como dotenv no sobreescribe variables existentes, gana sobre el .env local.
process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017'
process.env.MONGODB_DB_NAME = 'cames_expedientes_test'
process.env.JWT_SECRET = 'secreto-de-pruebas-con-mas-de-32-caracteres-1234567890'
process.env.JWT_EXPIRES_IN = '12h'
process.env.TIMEZONE = 'America/Mexico_City'
process.env.DIAS_ALERTA_VENCIMIENTO = '30'
process.env.LOG_TO_FILE = 'false'
