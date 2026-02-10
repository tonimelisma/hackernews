# Heroku to VPS Migration Plan

## Current Architecture

| Component | Current Setup |
|-----------|--------------|
| **Web process** | Heroku web dyno running `node ./bin/www` (Express on `$PORT`) |
| **Worker process** | Heroku worker dyno running `node worker.js` (background sync every 10 min) |
| **Database** | MongoDB hosted externally (Atlas or similar), connected via `DB_URI_PROD` |
| **Frontend** | React SPA pre-built and served as static files from Express |
| **Domain** | `besthackernews.herokuapp.com` (README) / `tonidemo.herokuapp.com` (frontend code) |
| **TLS** | Managed by Heroku |
| **Environment vars** | `DB_URI_PROD`, `DB_URI_CLOUD`, `SECRET`, `PORT`, `NODE_ENV` |
| **Process management** | Heroku dyno manager + `throng` in worker |
| **Logging** | Heroku log drain (stdout) |

---

## Pre-Migration Code Fixes

These must be done before migration — they affect the new deployment:

### 1. Fix hardcoded frontend URLs

`hackernews-frontend/src/services/storyService.js` and `loginService.js` both hardcode `https://tonidemo.herokuapp.com/api/v1/`. Since Express serves the frontend on the same origin, change to relative paths:

```js
// storyService.js
const baseUrl = "/api/v1/";

// loginService.js
const baseUrl = "/api/v1/login";
```

### 2. Remove committed build directory

Add `hackernews-frontend/build/` to `.gitignore` and remove it from git. The build should happen during the Docker image build.

### 3. Remove deprecated Mongoose options

`topdump.js` uses `useNewUrlParser`, `useCreateIndex`, `useFindAndModify` — these are no-ops in Mongoose 8 and produce deprecation warnings.

---

## Target Architecture

```
VPS (Ubuntu 24.04 LTS)
├── Docker Compose
│   ├── nginx      (reverse proxy + TLS termination + security headers)
│   ├── web        (Express app, port 3000, internal only)
│   ├── worker     (worker.js, same image, different CMD)
│   ├── mongodb    (Mongo 7, persistent volume)
│   └── certbot    (TLS certificate renewal sidecar)
├── systemd        (auto-start Docker on boot)
└── cron           (database backups)
```

---

## Phase 1: Containerize the Application

### 1.1 Dockerfile (multi-stage)

```dockerfile
# Stage 1: Build frontend
FROM node:20-alpine AS frontend
WORKDIR /app/hackernews-frontend
COPY hackernews-frontend/package.json hackernews-frontend/package-lock.json ./
RUN npm ci
COPY hackernews-frontend/ .
RUN npm run build

# Stage 2: Production image
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
COPY --from=frontend /app/hackernews-frontend/build ./hackernews-frontend/build
EXPOSE 3000
CMD ["node", "./bin/www"]
```

Multi-stage build keeps the production image lean — frontend build tools and `node_modules` don't ship. Same image is used for both `web` and `worker` (CMD overridden in compose).

### 1.2 .dockerignore

```
node_modules
hackernews-frontend/node_modules
hackernews-frontend/build
.git
.env
*.md
```

### 1.3 docker-compose.yml

```yaml
services:
  mongodb:
    image: mongo:7
    restart: unless-stopped
    volumes:
      - mongo-data:/data/db
    environment:
      MONGO_INITDB_ROOT_USERNAME: ${MONGO_USER}
      MONGO_INITDB_ROOT_PASSWORD: ${MONGO_PASSWORD}
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5

  web:
    build: .
    restart: unless-stopped
    expose:
      - "3000"
    environment:
      NODE_ENV: production
      PORT: "3000"
      DB_URI_PROD: mongodb://${MONGO_USER}:${MONGO_PASSWORD}@mongodb:27017/hackernews?authSource=admin
      SECRET: ${SECRET}
    depends_on:
      mongodb:
        condition: service_healthy

  worker:
    build: .
    restart: unless-stopped
    command: ["node", "worker.js"]
    environment:
      NODE_ENV: production
      DB_URI_PROD: mongodb://${MONGO_USER}:${MONGO_PASSWORD}@mongodb:27017/hackernews?authSource=admin
      DB_URI_CLOUD: ${DB_URI_CLOUD}
    depends_on:
      mongodb:
        condition: service_healthy

  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
      - certbot-etc:/etc/letsencrypt:ro
      - certbot-var:/var/lib/letsencrypt
    depends_on:
      - web

  certbot:
    image: certbot/certbot
    volumes:
      - certbot-etc:/etc/letsencrypt
      - certbot-var:/var/lib/letsencrypt
    entrypoint: "/bin/sh -c 'trap exit TERM; while :; do sleep 12h & wait $${!}; certbot renew --quiet; done'"

volumes:
  mongo-data:
  certbot-etc:
  certbot-var:
```

Notes:
- `web` uses `expose` not `ports` — only nginx is publicly accessible
- `certbot` runs as a sidecar with automatic 12-hour renewal checks
- `worker` shares the same image but overrides CMD

### 1.4 nginx/default.conf

```nginx
upstream app {
    server web:3000;
}

server {
    listen 80;
    server_name yourdomain.com;

    location /.well-known/acme-challenge/ {
        root /var/lib/letsencrypt;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # Security headers (the app currently has none)
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy strict-origin-when-cross-origin;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;

    location / {
        proxy_pass http://app;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 1.5 .env.example

```
MONGO_USER=hackernews
MONGO_PASSWORD=<generate-strong-password>
SECRET=<same-jwt-secret-as-heroku>
DB_URI_CLOUD=<atlas-uri-only-if-running-topdump>
```

---

## Phase 2: Provision and Configure VPS

### 2.1 VPS requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 1 GB | 2 GB |
| Disk | 20 GB SSD | 40 GB SSD |
| OS | Ubuntu 24.04 LTS | Ubuntu 24.04 LTS |

This is a lightweight app — a small VPS is sufficient. Hetzner CX22 (~$4/mo) or DigitalOcean ($6/mo).

### 2.2 Initial server setup

```bash
# Update system
apt update && apt upgrade -y

# Create non-root user
adduser deploy
usermod -aG sudo deploy

# SSH hardening
# - Disable root login
# - Disable password auth
# - Use SSH keys only

# Firewall
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# Install Docker Engine
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy

# Verify Docker Compose
docker compose version

# Automatic security updates
apt install unattended-upgrades -y
dpkg-reconfigure -plow unattended-upgrades
```

---

## Phase 3: Database Migration

### 3.1 Export from current MongoDB

```bash
# From a machine with access to the current Atlas/hosted MongoDB
mongodump --uri="<current-DB_URI_PROD>" --out=./dump
```

### 3.2 Import into VPS MongoDB

```bash
# Start only the mongodb service first
docker compose up -d mongodb

# Copy dump to VPS, then restore
mongorestore --uri="mongodb://hackernews:<password>@localhost:27017/hackernews?authSource=admin" ./dump
```

### 3.3 Verify data integrity

- Compare document counts across all collections (stories, users)
- Spot-check a few records for correctness

---

## Phase 4: Deploy to VPS

### 4.1 Clone and configure

```bash
# On VPS as deploy user
git clone <repo-url> ~/hackernews
cd ~/hackernews

# Create .env from template
cp .env.example .env
nano .env  # fill in secrets
```

### 4.2 Obtain TLS certificate

```bash
# Start nginx in HTTP-only mode for ACME challenge
docker compose up -d nginx

docker compose run --rm certbot certonly --webroot \
  -w /var/lib/letsencrypt \
  -d yourdomain.com \
  --agree-tos --email you@example.com

# Restart nginx with full TLS config
docker compose restart nginx
```

### 4.3 Start all services

```bash
docker compose up -d --build
docker compose ps       # verify all services running
docker compose logs -f  # check for errors
```

### 4.4 Auto-start on boot

```bash
# Docker with restart: unless-stopped handles container restarts.
# Enable Docker service itself:
sudo systemctl enable docker
```

---

## Phase 5: DNS Cutover

### 5.1 Pre-cutover checklist

- [ ] All containers running (`docker compose ps`)
- [ ] Web accessible internally at port 3000
- [ ] Worker syncing stories (check `docker compose logs worker`)
- [ ] MongoDB has current data
- [ ] TLS certificate valid
- [ ] HTTPS works end-to-end

### 5.2 DNS changes

1. Lower TTL to 300s (5 min) a day before migration
2. Point A record to VPS IP address
3. If currently on `*.herokuapp.com` — register a proper domain or update existing

### 5.3 Post-cutover validation

- [ ] HTTPS works end-to-end
- [ ] Frontend loads and displays stories
- [ ] Login works (JWT auth)
- [ ] Story hiding works
- [ ] Worker continues syncing (monitor logs for 10+ minutes)
- [ ] Restore TTL to 3600s

---

## Phase 6: Multi-Environment Support

To run staging + production on the same VPS, use separate project directories:

```
~/hackernews-prod/
  ├── docker-compose.yml     (web expose: 3000)
  ├── .env                   (production secrets)
  └── nginx/default.conf     (server_name: besthackernews.com)

~/hackernews-staging/
  ├── docker-compose.yml     (web expose: 3001)
  ├── .env                   (staging secrets, separate DB)
  └── nginx/default.conf     (server_name: staging.besthackernews.com)
```

A shared nginx on the host can proxy both:

```nginx
server {
    server_name besthackernews.com;
    location / { proxy_pass http://127.0.0.1:3000; }
}
server {
    server_name staging.besthackernews.com;
    location / { proxy_pass http://127.0.0.1:3001; }
}
```

---

## Phase 7: Operational Concerns

### 7.1 Backups

```bash
# Daily cron job for MongoDB backups
0 3 * * * docker compose -f ~/hackernews/docker-compose.yml exec -T mongodb mongodump --archive | gzip > /backups/mongo-$(date +\%F).gz

# Retain 14 days
0 4 * * * find /backups -name "mongo-*.gz" -mtime +14 -delete
```

Consider also shipping backups off-VPS (S3, another server) for disaster recovery.

### 7.2 Monitoring

- **Container health**: `docker compose ps`, healthchecks in compose file
- **Uptime monitoring**: External ping (UptimeRobot free tier, Healthchecks.io)
- **Resource monitoring**: `docker stats`, or lightweight agent (Netdata) for a dashboard
- **Log aggregation**: `docker compose logs` or ship to a centralized service

### 7.3 Updates and deployments

```bash
cd ~/hackernews
git pull
docker compose up -d --build --remove-orphans
docker compose logs -f --tail=50
```

Express starts fast enough that downtime is negligible for this use case. For zero-downtime, the `--remove-orphans` flag cleans up stale containers.

### 7.4 TLS certificate renewal

Handled automatically by the certbot sidecar container (checks every 12 hours). Verify with:

```bash
docker compose run --rm certbot renew --dry-run
```

### 7.5 Log rotation

Add to `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

---

## Phase 8: Decommission Heroku

Only after the VPS has been stable for at least a week:

1. Remove Heroku auto-deploy integration
2. Scale Heroku dynos to 0 (`heroku ps:scale web=0 worker=0`)
3. Verify no traffic is hitting Heroku (wait a few days)
4. Delete the Heroku app
5. Cancel any paid Heroku add-ons

---

## Rollback Plan

If VPS deployment fails or is unstable:

1. Point DNS back to Heroku (or restore `*.herokuapp.com` URL)
2. Heroku app remains intact and running until explicitly decommissioned
3. No data loss risk — MongoDB is either external (Atlas) or backed up before migration

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `Dockerfile` | **Create** | Multi-stage build for app + frontend |
| `.dockerignore` | **Create** | Exclude node_modules, .git, .env from build |
| `docker-compose.yml` | **Create** | Orchestrate web, worker, mongodb, nginx, certbot |
| `nginx/default.conf` | **Create** | Reverse proxy + TLS + security headers |
| `.env.example` | **Create** | Template for environment variables |
| `hackernews-frontend/src/services/storyService.js` | **Modify** | Replace hardcoded Heroku URL with relative path |
| `hackernews-frontend/src/services/loginService.js` | **Modify** | Replace hardcoded Heroku URL with relative path |
| `.gitignore` | **Modify** | Add `hackernews-frontend/build/` |
| `topdump.js` | **Modify** | Remove deprecated Mongoose options |
| `README.md` | **Modify** | Update deployment instructions and URL |

---

## Cost Comparison

| | Heroku | VPS |
|---|--------|-----|
| Web dyno | ~$7/mo (Eco) or ~$25/mo (Basic) | Included |
| Worker dyno | ~$7/mo (Eco) or ~$25/mo (Basic) | Included |
| MongoDB Atlas | Free tier or ~$9+/mo | Included (self-hosted) |
| **Total** | **$14–59/mo** | **$4–12/mo** |
