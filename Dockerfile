FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm pkg delete scripts.prepare && npm ci --omit=dev
COPY hackernews-frontend/package.json hackernews-frontend/package-lock.json ./hackernews-frontend/
RUN cd hackernews-frontend && npm ci
COPY . .
RUN cd hackernews-frontend && npm run build
RUN mkdir -p /data && node scripts/import-json-to-sqlite.js /data/hackernews.db

FROM node:20-alpine
RUN apk add --no-cache wget
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/hackernews-frontend/build ./hackernews-frontend/build
COPY --from=builder /data/hackernews.db /data/hackernews.db
COPY package.json ./
COPY app.js worker.js ./
COPY bin ./bin
COPY routes ./routes
COPY services ./services
COPY util ./util
EXPOSE 3000
CMD ["node", "bin/www"]
