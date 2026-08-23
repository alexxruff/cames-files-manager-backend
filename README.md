# Backend de expedientes laborales — Urbacames

API REST del gestor de expedientes laborales: checklist de documentos por
colaborador, carga de archivos con versionado, validación por RH, control de
vigencias, alertas y reportes de auditoría.

**Stack:** Node.js 20 · Express 4 · MongoDB 8 (Mongoose) · JWT · Jest

- Especificación del contrato con el front: [`backend-spec.md`](./backend-spec.md)
- Guía para agentes y convenciones: [`CLAUDE.md`](./CLAUDE.md)
- Arquitectura: [`docs/ARQUITECTURA.md`](./docs/ARQUITECTURA.md)
- Endpoints: [`docs/CONTRATO-API.md`](./docs/CONTRATO-API.md)
- Guía para el equipo de front: [`docs/INTEGRACION-FRONTEND.md`](./docs/INTEGRACION-FRONTEND.md)
- Ajustes pendientes del front: [`docs/CAMBIOS-FRONTEND.md`](./docs/CAMBIOS-FRONTEND.md)
- Carteras, proyectos y asignaciones: [`docs/ENDPOINTS-PROYECTOS.md`](./docs/ENDPOINTS-PROYECTOS.md)
- Qué está hecho y qué falta: [`docs/ESTADO.md`](./docs/ESTADO.md)

## Requisitos

- **Node.js 20.11+**
- **MongoDB 4.2 o superior.** Mongoose 8 usa el driver 6 y con un servidor más
  viejo falla al arrancar con `maximum wire version`. Si tienes un `mongo:3.6` en
  el 27017 (el que usa `talentlink-backend`), **no sirve** para este proyecto.
- **Docker**, si quieres usar el Mongo local que trae el repo (recomendado).

## Arrancar

```bash
npm install
cp .env.example .env
npm run db:up        # MongoDB 8 en el puerto 27018, vía docker compose
```

Llena en `.env` al menos:

| Variable          | Qué es                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`     | URI del cluster, o `mongodb://127.0.0.1:27018` para el Mongo local. La base la fija `MONGODB_DB_NAME`, no el URI |
| `MONGODB_DB_NAME` | `cames_expedientes` — base propia, nunca la de talentlink                                                        |
| `JWT_SECRET`      | Mínimo 32 caracteres: `openssl rand -base64 48`                                                                  |
| `CORS_ORIGINS`    | Orígenes permitidos, separados por comas                                                                         |

Después:

```bash
npm run dev           # nodemon en http://localhost:8080
curl localhost:8080/api/v1/health
```

### Primer acceso

Con la base vacía, el arranque crea el administrador inicial y lo dice en los
logs:

| Variable                   | Default               |
| -------------------------- | --------------------- |
| `BOOTSTRAP_ADMIN_EMAIL`    | `alexxruff@yahoo.com` |
| `BOOTSTRAP_ADMIN_PASSWORD` | `1234`                |
| `BOOTSTRAP_ADMIN_ENABLED`  | `true`                |

Sólo corre si **no hay ningún usuario**, así que reiniciar no sobreescribe nada y
cambiar esa contraseña es permanente. Entra, cámbiala con
`POST /auth/cambiar-password` y pon `BOOTSTRAP_ADMIN_ENABLED=false`.

> ⚠️ `1234` es una credencial de arranque para desarrollo. **No expongas el
> backend a internet sin haberla cambiado**: es una cuenta de administrador con
> acceso a datos personales sensibles. Para producción, define
> `BOOTSTRAP_ADMIN_PASSWORD` con algo fuerte o usa `npm run seed:admin`.

Alternativa manual, en cualquier momento (idempotente, exige contraseña fuerte):

```bash
SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… npm run seed:admin
```

## Comandos

| Comando                        | Qué hace                                                       |
| ------------------------------ | -------------------------------------------------------------- |
| `npm run dev`                  | Desarrollo con recarga                                         |
| `npm start`                    | Producción                                                     |
| `npm test`                     | Pruebas (MongoDB en memoria, no hace falta tenerlo instalado)  |
| `npm test -- users`            | Sólo las pruebas que empatan con el nombre                     |
| `npm run test:coverage`        | Cobertura                                                      |
| `npm run lint` / `lint:fix`    | ESLint                                                         |
| `npm run format`               | Prettier                                                       |
| `npm run db:up` / `db:down`    | Levanta/apaga el MongoDB local (docker compose)                |
| `npm run db:logs` / `db:shell` | Logs del contenedor / `mongosh` dentro de él                   |
| `npm run db:reset`             | Borra los datos locales y vuelve a levantar la base            |
| `npm run seed:admin`           | Crea el primer administrador                                   |
| `npm run db:indices`           | Sincroniza índices (obligatorio en producción tras cambiarlos) |

## Estructura

```
src/
  api/v1/<recurso>/    Model → Service → Controller → Routes
  config/              env validado + conexión a Mongo
  constants/           enums del contrato
  middlewares/         auth, alcance, validación, errores, contexto, rate limit
  utils/               envelope, fechas, texto, permisos, logger, domain/
  validations/         express-validator por recurso
scripts/               semillas y mantenimiento
tests/                 unitarias/ · integracion/
```

## Convenciones

El código va en **inglés**; las rutas, las llaves JSON del dominio, los valores
de los enums y los mensajes al usuario van en **español**, porque son el contrato
que el front ya consume. Toda respuesta usa el envelope
`{ status, message?, data }` con los datos anidados bajo llave nombrada.

El detalle está en [`CLAUDE.md`](./CLAUDE.md) y en las skills de
`.claude/skills/`, que son la guía operativa de cada tarea (contrato de API,
recurso nuevo, modelado, pruebas, dominio de expedientes).

## Despliegue

`Dockerfile` listo (`node:20-alpine`, dependencias de producción, usuario sin
privilegios). El contenedor lee la configuración del entorno y escribe los logs
en stdout como JSON. Tras un despliegue que cambie índices:
`npm run db:indices`.

Checks para el balanceador: `GET /api/v1/health` (liveness) y
`GET /api/v1/ready` (readiness, verifica la base).
