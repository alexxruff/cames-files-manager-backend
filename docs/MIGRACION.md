# Migración desde el backend prestado

Hoy el front autentica contra `talentlink-backend`, compartido con Humenta. Este
es el plan para pasar a este backend. Spec §12.

**No hay expedientes que migrar**: los actuales son de demostración y viven en el
navegador de cada usuario.

## 1. Seleccionar los usuarios de Urbacames

En la base de talentlink conviven usuarios de Humenta y de otros proyectos. Hay
que elegir **sólo** los de Urbacames — normalmente por dominio de correo, pero
confírmalo con una lista de personas antes de mover nada.

```js
// En la base de talentlink (colección `users`), sólo para revisar:
db.users.find({ email: /@urbacames\.com$/i }, { email: 1, name: 1, role: 1, active: 1 })
```

## 2. Traducir el documento

| Origen (`users` de talentlink) | Destino (`app_users`)                   |
| ------------------------------ | --------------------------------------- |
| `name`                         | `name`                                  |
| `email`                        | `email`                                 |
| `password` (hash bcrypt)       | `password` — **se copia tal cual**      |
| `role: 'admin'`                | `nivelAcceso: 'rh_admin'`               |
| `role: 'user'`                 | `nivelAcceso: 'rh_consulta'`            |
| `active`                       | `active`                                |
| `createdAt` / `updatedAt`      | se conservan                            |
| —                              | `area: null`                            |
| —                              | `alcance: 'interno'`, `clienteId: null` |
| —                              | `ultimoAccesoEn: null`                  |

**El hash de bcrypt se copia sin tocarlo**: el coste es 12 en los dos lados y
`comparePassword` funciona igual, así que nadie tiene que restablecer su
contraseña.

Los **jefes de área** no existen en el origen: se dan de alta a mano con
`POST /usuarios`, cada uno con su `area`.

## 3. Cómo ejecutarla

Escribe la migración como script en `scripts/` (por ejemplo
`migrateUsersFromTalentlink.js`), no a mano en la consola de Atlas:

- Debe ser **idempotente**: si el correo ya existe en destino, no lo toca.
- Debe insertar **sin disparar el hook de hasheo**, o volvería a hashear un hash.
  Usa `User.collection.insertMany(...)` (el driver crudo, sin middleware de
  Mongoose) o `insertMany(docs, { rawResult: true })` verificando el resultado.
- Debe imprimir un resumen: cuántos leyó, cuántos insertó, cuántos omitió.
- Corre primero con `--dry-run` contra la base de producción y revisa la lista.

## 4. Lado del front

1. Cambiar `VITE_API_BASE_URL` al nuevo backend.
2. Apagar `VITE_USE_MOCKS`.
3. Sustituir las cuatro llamadas a `endpointPendiente(...)` por `request(...)` —
   están marcadas en el código, en
   `src/modules/{expedientes,alertas,configuracion,reportes}/*-service.ts`.
4. Cuando este backend esté en producción, quitar el mapeo de `role` y leer
   `nivelAcceso` (ver D-08 en `docs/DECISIONES.md`).

## 5. Verificación

- [ ] Cada persona de la lista puede entrar con su contraseña de siempre.
- [ ] Los administradores llegan como `rh_admin` y ven `/usuarios`.
- [ ] Todos quedaron con `alcance: 'interno'` y `clienteId: null`.
- [ ] Los jefes de área tienen su `area` y sólo ven lo suyo.
- [ ] Nadie de Humenta quedó en `app_users`.
- [ ] `npm run db:indices` corrido en la base nueva.
