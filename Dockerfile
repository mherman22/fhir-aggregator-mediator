FROM node:18-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY config ./config
COPY src ./src

EXPOSE 3000

CMD ["node", "src/index.js"]
