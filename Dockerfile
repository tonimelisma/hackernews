FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production
COPY hackernews-frontend/package.json hackernews-frontend/package-lock.json ./hackernews-frontend/
RUN cd hackernews-frontend && npm ci
COPY . .
RUN cd hackernews-frontend && npm run build
EXPOSE 3000
CMD ["node", "bin/www"]
