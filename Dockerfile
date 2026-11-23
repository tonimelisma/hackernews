FROM node:24-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm pkg delete scripts.prepare && npm ci --omit=dev
COPY hackernews-frontend/package.json hackernews-frontend/package-lock.json ./hackernews-frontend/
RUN cd hackernews-frontend && npm ci
COPY . .
RUN cd hackernews-frontend && npm run build
RUN mkdir -p /data

FROM node:24-alpine
RUN apk add --no-cache wget sqlite
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/hackernews-frontend/build ./hackernews-frontend/build
# Runtime contract: the app runs as uid 1000 (node) with no capabilities; a
# fresh volume takes /data's owner from here, so it must belong to node. The
# database file and schema are created by the migrations on first start.
COPY --from=builder --chown=node:node /data /data
COPY package.json ./
COPY app.js worker.js ./
COPY bin ./bin
COPY routes ./routes
COPY services ./services
COPY util ./util
COPY migrations ./migrations
COPY scripts/users.js scripts/migrate.js ./scripts/
USER node
EXPOSE 3000
CMD ["node", "bin/www"]
