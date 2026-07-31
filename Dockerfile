FROM node:22-slim

WORKDIR /app

RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN chown -R appuser:appgroup /app
USER appuser

EXPOSE 8080

CMD ["node", "server/server.js"]
