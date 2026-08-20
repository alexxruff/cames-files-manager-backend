module.exports = {
  testEnvironment: 'node',
  // `env.js` corre ANTES de cargar módulos: fija el entorno de pruebas para que
  // `config/env` valide contra él y no contra el .env de desarrollo.
  setupFiles: ['<rootDir>/tests/helpers/env.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/helpers/db.js'],
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/server.js'],
  testTimeout: 60000,
  clearMocks: true,
  verbose: false
}
