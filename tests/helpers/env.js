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
// Sin bucket a propósito: las pruebas no hablan con R2. Las variables de R2 se
// fijan vacías porque dotenv SÍ carga el `.env` del desarrollador para todo lo
// que no esté puesto aquí, y un prefijo real cambiaría las claves esperadas.
process.env.STORAGE_DRIVER = 'memoria'
process.env.R2_ACCOUNT_ID = ''
process.env.R2_BUCKET = ''
process.env.R2_PREFIX = ''
process.env.R2_ACCESS_KEY_ID = ''
process.env.R2_SECRET_ACCESS_KEY = ''
