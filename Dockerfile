FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PASTA_DADOS=/app/data
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY . .
# Na primeira subida, importa dados-iniciais/ se o banco estiver vazio; depois inicia o servidor.
CMD ["sh", "-c", "node scripts/importar-dados.js && node server/index.js"]
EXPOSE 3000
VOLUME ["/app/data"]
