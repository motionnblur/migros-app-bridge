FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

ENV NODE_ENV=production
ENV NODE_OPTIONS=--dns-result-order=ipv4first
EXPOSE 3000

USER node

CMD ["node", "server.js"]
