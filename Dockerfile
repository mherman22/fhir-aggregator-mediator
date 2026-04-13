FROM node:22-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY config ./config
COPY src ./src

# Issue 7: Run as non-root user
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Issue 7: Limit Node.js heap size to prevent container OOM (within 512M limit)
CMD ["node", "--max-old-space-size=384", "src/index.js"]
