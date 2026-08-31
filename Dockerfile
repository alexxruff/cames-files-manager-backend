FROM node:20-alpine

WORKDIR /app

# Sólo dependencias de producción; la capa se reaprovecha si no cambia el lock.
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts

# ─── Identidad del release ───────────────────────────────────────────────────
# Va DESPUÉS de copiar el código: si estuviera arriba, cada release invalidaría
# la capa de `npm ci` y reconstruiría dependencias sin haber cambiado el lock.
#
# La construcción FALLA si falta o viene malformado cualquiera de los dos. Es
# deliberado: una imagen con `commit: "unknown"` es peor que una que no existe,
# porque nadie puede decir qué está corriendo en producción.
ARG CAMES_GIT_COMMIT
ARG CAMES_BUILD_TIME
RUN echo "$CAMES_GIT_COMMIT" | grep -Eq '^[0-9a-f]{40}$' || \
    (echo "CAMES_GIT_COMMIT missing or malformed (expected 40 hex)" && exit 1)
RUN echo "$CAMES_BUILD_TIME" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' || \
    (echo "CAMES_BUILD_TIME missing or malformed (expected UTC ISO-8601 seconds)" && exit 1)
ENV CAMES_GIT_COMMIT=$CAMES_GIT_COMMIT
ENV CAMES_BUILD_TIME=$CAMES_BUILD_TIME

ENV NODE_ENV=production
EXPOSE 8080

# Usuario sin privilegios (la imagen de node ya lo trae).
USER node

CMD ["node", "src/server.js"]
