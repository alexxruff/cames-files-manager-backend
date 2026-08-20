const js = require('@eslint/js')
const globals = require('globals')
const prettier = require('eslint-config-prettier')

module.exports = [
  { ignores: ['node_modules/**', 'coverage/**', 'logs/**'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_|^next$' }],
      'no-console': ['warn', { allow: ['error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      // El envelope se construye con utils/response, no a mano.
      'no-restricted-properties': [
        'warn',
        {
          object: 'res',
          property: 'send',
          message:
            'Usa utils/response (ok, created, noContent) para respetar el envelope.'
        }
      ]
    }
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: { 'no-console': 'off' }
  },
  {
    files: ['src/config/env.js', 'scripts/**/*.js'],
    rules: { 'no-console': 'off' }
  },
  prettier
]
