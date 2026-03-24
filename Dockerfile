FROM node:18-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY config ./config
COPY src ./src

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]
