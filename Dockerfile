FROM node:20-alpine

WORKDIR /app

# Sólo dependencias de producción; la capa se reaprovecha si no cambia el lock.
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts

ENV NODE_ENV=production
EXPOSE 8080

# Usuario sin privilegios (la imagen de node ya lo trae).
USER node

CMD ["node", "src/server.js"]
