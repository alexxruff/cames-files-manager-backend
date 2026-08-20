---
name: testing
description: Cómo escribir y correr pruebas en este proyecto (Jest, supertest, mongodb-memory-server, fábricas de usuarios). Úsala al agregar pruebas o cuando una prueba falle y haya que entender el andamiaje.
---

# Pruebas

```bash
npm test                      # todo
npm test -- tests/unitarias   # sólo unitarias (rápidas, sin base)
npm test -- users             # por nombre de archivo
LOG_VERBOSE=true npm test     # con logs de la app (por defecto callados)
npm run test:coverage
```

## Cómo está armado

- `tests/helpers/env.js` fija el entorno **antes** de cargar módulos, así
  `config/env` valida contra valores de prueba y no contra tu `.env`.
- `tests/helpers/db.js` levanta un MongoDB en memoria una vez por archivo,
  limpia las colecciones después de cada prueba y lo apaga al final. No hace
  falta Mongo instalado y las pruebas no se pisan entre sí.
- `tests/helpers/factories.js` crea usuarios y sesiones:

```js
const {
  crearUsuario,
  crearUsuarioConSesion,
  auth,
  PASSWORD_VALIDA
} = require('../helpers/factories')

const { usuario, token } = await crearUsuarioConSesion({ nivelAcceso: 'rh_admin' })
const res = await request(app).get('/api/v1/usuarios').set(auth(token))
```

- `tests/unitarias/` para funciones puras (fechas, permisos, dominio):
  sin base de datos, milisegundos.
- `tests/integracion/` para la API por HTTP con supertest.

## Qué debe cubrir un endpoint nuevo

1. **Camino feliz** y la **forma exacta de la respuesta** (envelope + llave
   nombrada + `_id` string + opcionales en `null`).
2. **401** sin token y con token inválido.
3. **403** con un nivel de acceso que no tiene la capacidad.
4. **404 por alcance**: un usuario de cliente A pidiendo algo de cliente B.
   Es la prueba que evita filtrar datos entre clientes; no la omitas.
5. **400** de validación, comprobando `errors[0].msg` y que el mensaje esté en
   español.
6. Los **casos borde del dominio** que estén en `backend-spec.md` §13.

## Reglas de estilo de las pruebas

- Nombres de prueba en español, describiendo la regla de negocio, no la
  implementación: `'un documento con vigencia hoy es expiring'`.
- Verifica el efecto en la base cuando importa (`await User.findById(...)`), no
  sólo la respuesta HTTP.
- Nunca dependas del orden entre pruebas: cada una crea lo que necesita.
- Fechas fijas y explícitas; para "hoy" inyecta la fecha
  (`today('America/Mexico_City', instante)`), no dependas del reloj.
