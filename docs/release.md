# Releases and Runtime Contract

This repo produces one thing: a container image. It does not know or care
where the image runs. Nothing here deploys, holds deployment credentials, or
reaches any machine; hosts pull releases on their own schedule, in whatever
way they choose. `tests/unit/compose.test.js` keeps it that way: it fails if
any workflow gains ssh/scp, a dispatch trigger, a secret other than
`GITHUB_TOKEN`, or an action from outside `actions/`, `docker/` and
`sigstore/`.

## What a release is

Every commit merged to `main` whose CI is green is a release. CI:

1. builds the image natively for **linux/amd64** (`ubuntu-24.04`) and
   **linux/arm64** (`ubuntu-24.04-arm`), from a Dockerfile whose base image is
   pinned by digest;
2. pushes each platform image **untagged, by digest**, with SLSA provenance
   (`mode=max`) and an SPDX SBOM attached;
3. pulls that exact image back and runs `scripts/image-smoke.sh` on it (the
   runtime contract below). A failing image never gets a tag;
4. combines both platforms into one index, tags it, and **signs it** with
   cosign keyless signing (Sigstore; identity = this repo's `ci.yml` on
   `refs/heads/main`), then verifies the signature the way a host would.

Pull requests run steps 1 and 3 without pushing anything.

## Tags

| Tag | Meaning |
|-----|---------|
| `ghcr.io/tonimelisma/hackernews:latest` | The newest release. Moves on every release |
| `ghcr.io/tonimelisma/hackernews:<commit sha>` | One release, immutable (full 40-character SHA) |

The package is public: pulling needs no login. Labels on every image:
`org.opencontainers.image.revision` and `.version` (the commit SHA),
`.created` (commit time), `.source`, `.title`, `.description`.

## Consuming releases (pick any)

- **Track `:latest`**: poll its digest and roll forward when it changes, e.g.
  `docker buildx imagetools inspect ghcr.io/tonimelisma/hackernews:latest --format '{{json .Manifest}}' | jq -r .digest`,
  or a registry-watching updater.
- **Pin a commit**: run `:<sha>` and move the pin deliberately.
- **Pin a digest**: `ghcr.io/tonimelisma/hackernews@sha256:…` for byte-exact
  deployments.
- **Accept only signed releases** (recommended for any host that pulls
  unattended):

  ```bash
  cosign verify ghcr.io/tonimelisma/hackernews:latest \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com \
    --certificate-identity https://github.com/tonimelisma/hackernews/.github/workflows/ci.yml@refs/heads/main
  ```

  Verify the digest you are about to run, not just the tag: resolve the tag
  to a digest once, verify `…@sha256:<digest>`, then run that digest.
- **Inspect provenance / SBOM**:
  `docker buildx imagetools inspect ghcr.io/tonimelisma/hackernews:<sha> --format '{{json .Provenance}}'`
  (or `'{{json .SBOM}}'`).

A host that wants to know about releases without polling can watch this
repo's `main` CI runs; the `release` job's summary names the tag and
digest it published.

## Runtime contract

What the image needs and promises, and nothing more. `scripts/image-smoke.sh`
checks every item marked ✓ on every build.

| | |
|---|---|
| **User** ✓ | Runs as `USER node` (uid 1000). Works with all capabilities dropped and `no-new-privileges` |
| **Filesystem** ✓ | Works with a read-only root filesystem. Writes only to `/data` (SQLite DB and WAL files) and `/tmp`. `/data` is owned by uid 1000 in the image, so a fresh volume gets the right owner (a root-owned `/data` crashes the app with `SQLITE_CANTOPEN`/`SQLITE_READONLY_DIRECTORY`) |
| **Database** ✓ | One SQLite file at `SQLITE_PATH`. Created, and migrated to the current schema, on startup |
| **Port** ✓ | `3000` (`PORT`), plain HTTP. TLS and the public hostname belong to the host. The app trusts one proxy hop for the client IP (login rate limit), so put exactly one reverse proxy in front |
| **Health** ✓ | `GET /api/v1/stories?timespan=Day&limit=1` → 200. Allow ≥ 10 s timeout: under disk contention a healthy app has taken > 5 s |
| **Env** | `SECRET` (required; JWT signing key — changing it logs everyone out), `SQLITE_PATH` (e.g. `/data/hackernews.db`), `NODE_ENV=production`, optional `PORT`. The worker syncs from the public Hacker News API (`hacker-news.firebaseio.com`) every 15 minutes |
| **Shutdown** ✓ | SIGTERM/SIGINT: stops the worker, closes the server and DB, exits 0 |
| **Admin CLI** ✓ | `node scripts/users.js list \| add <user> \| set-password <user> \| revoke-sessions <user>`, run inside the container. Passwords are read from a TTY or stdin (two lines: password, confirmation), never argv. There is no signup or reset flow in the app |
| **Backup** | `sqlite3` is in the image: `sqlite3 /data/hackernews.db ".backup '<file>'"` makes a consistent hot copy; restore with `.restore` run as uid 1000. Scheduling and storage are the host's |
| **Size** | ~160 MB per platform; one Node process plus SQLite, sized for a small machine (1 GB RAM, slow disk) |

`docker-compose.yml` runs the published image under this contract for local
checks; `docker-compose.dev.yml` builds from source.
