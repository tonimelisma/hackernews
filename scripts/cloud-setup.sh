#!/usr/bin/env bash
# SessionStart hook (.claude/settings.json): prepares a Claude Code cloud
# session (claude.ai/code VM: Ubuntu 24.04, Node 20/21/22 preinstalled, network
# limited to npm/GitHub/apt). Does nothing anywhere else (a laptop, CI).
#
#   1. Puts Node <.node-version> (24) on PATH. The VM has no Node 24, and
#      nodejs.org may be unreachable, so it installs the official binary from
#      the npm registry (package node-linux-<arch>), cached in ~/.cache.
#   2. Runs `npm ci` for the backend and the frontend, skipped when
#      node_modules already matches the lockfile and Node version.
#
# The hook is killed after 600 s; a cold run takes about a minute.
set -euo pipefail
export npm_config_update_notifier=false

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"
WANT="$(tr -d '[:space:]v' < .node-version)"   # major version, e.g. 24

log() { echo "[cloud-setup] $*" >&2; }

node_major() { "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || true; }

NODE_BIN=""
if command -v node >/dev/null && [ "$(node_major node)" = "$WANT" ]; then
  NODE_BIN="$(dirname "$(command -v node)")"
fi
if [ -z "$NODE_BIN" ] && [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null 2>&1 || true
  if p="$(nvm which "$WANT" 2>/dev/null)" && [ -x "$p" ]; then
    NODE_BIN="$(dirname "$p")"
  fi
fi
if [ -z "$NODE_BIN" ]; then
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) log "unsupported arch $(uname -m)"; exit 1 ;;
  esac
  prefix="$HOME/.cache/hackernews-node$WANT"
  NODE_BIN="$prefix/node_modules/node-linux-$arch/bin"
  if [ "$(node_major "$NODE_BIN/node")" != "$WANT" ]; then
    log "installing Node $WANT from the npm registry (node-linux-$arch)"
    npm install --prefix "$prefix" --no-save --no-audit --no-fund --loglevel=error \
      "node-linux-$arch@$WANT" >&2
  fi
fi
export PATH="$NODE_BIN:$PATH"
log "node $(node -v), npm $(npm -v)"

# Later Bash calls in this session pick up Node 24 too.
line="export PATH=\"$NODE_BIN:\$PATH\""
if [ -n "${CLAUDE_ENV_FILE:-}" ] && ! grep -qxF "$line" "$CLAUDE_ENV_FILE" 2>/dev/null; then
  echo "$line" >> "$CLAUDE_ENV_FILE"
fi

install() {
  local dir="$1" stamp="$1/node_modules/.cloud-setup-stamp" want
  want="$(node -v) $(sha256sum "$dir/package-lock.json" | cut -d' ' -f1)"
  if [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$want" ]; then
    log "$dir: node_modules up to date"
    return
  fi
  log "$dir: npm ci"
  (cd "$dir" && npm ci --no-audit --no-fund --loglevel=error >&2)
  echo "$want" > "$stamp"
}

install .
install hackernews-frontend
log "done"
