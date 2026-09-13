#!/usr/bin/env bash
# Shared helpers for daedalus.sh, sync.sh and reset.sh. Sourced, not run.
#
# These three scripts need the same handful of things — coloured output, a
# working `docker compose`, and a .env that has every key .env.example
# declares. Keeping one copy here means a fix reaches all three, and a new
# setting is handled by whichever script the developer happens to run.
#
# Callers must `cd` to the repo root before sourcing.

# Running this file does nothing useful: it only defines functions, which are
# lost the moment the child shell it ran in exits. `.` (source) runs it in the
# *current* shell, which is what makes the definitions stick.
#
# Guarded rather than left to the missing execute bit, because "Permission
# denied" tells you nothing about which of the two you wanted.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  cat >&2 <<'USAGE'
scripts/common.sh is a library, not a command — there is nothing to run.

It defines the helpers that daedalus.sh, sync.sh and reset.sh share. They
pick it up with:

    . ./scripts/common.sh

To use the helpers yourself, source it into your own shell the same way:

    cd "$(git rev-parse --show-toplevel)"
    . ./scripts/common.sh
    host_py -c "from app.db import chat_store; print(chat_store.stats())"

You probably wanted one of:

    ./daedalus.sh --help     run, develop, migrate
    ./sync.sh --check        see what a pull changed
    ./reset.sh --help        wipe and rebuild the databases

Reference: docs/SCRIPTS.md
USAGE
  exit 1
fi

# ── output ───────────────────────────────────────────────────────────────────
# Colour only when attached to a terminal, so piping to a file or CI log does
# not fill it with escape codes.
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
  RED=$'\033[31m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; GREEN=''; YELLOW=''; RED=''; BLUE=''; RESET=''
fi

say()   { printf '%s\n' "$*"; }
ok()    { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn()  { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
err()   { printf '  %s✗%s %s\n' "$RED" "$RESET" "$*" >&2; }
info()  { printf '    %s\n' "$*"; }
head_() { printf '\n%s%s%s\n' "$BOLD" "$*" "$RESET"; }
fail()  { err "$*"; exit 1; }

have()  { command -v "$1" >/dev/null 2>&1; }

# Support both `docker compose` (v2) and the legacy `docker-compose`.
compose() {
  if docker compose version >/dev/null 2>&1; then docker compose "$@"
  elif have docker-compose; then docker-compose "$@"
  else err "docker compose is not installed or not on PATH."; exit 1
  fi
}

# ── environment file ─────────────────────────────────────────────────────────
# The failure this guards against: someone adds a setting to .env.example, you
# pull, and your own .env — git-ignored, so a pull never updates it — has no
# such key. The app then silently falls back to a default and misbehaves in a
# way that looks nothing like a missing variable.

# env_missing_keys — prints keys present in .env.example but absent from .env.
env_missing_keys() {
  [ -f .env ] && [ -f .env.example ] || return 0
  local key
  while IFS= read -r key; do
    grep -q "^${key}=" .env 2>/dev/null || printf '%s\n' "$key"
  done < <(grep -E '^[A-Z_][A-Z0-9_]*=' .env.example | cut -d= -f1)
}

# env_backfill — appends missing keys with .env.example's values, and prints
# what it added. Existing values are never touched.
env_backfill() {
  local missing=()
  mapfile -t missing < <(env_missing_keys)
  [ ${#missing[@]} -eq 0 ] && return 0
  {
    printf '\n# --- added automatically on %s ---\n' "$(date '+%Y-%m-%d %H:%M')"
    local key
    for key in "${missing[@]}"; do grep -m1 "^${key}=" .env.example; done
  } >> .env
  printf '%s\n' "${missing[@]}"
}

# ensure_env — create .env on first run, top it up on later runs.
ensure_env() {
  if [ ! -f .env ]; then
    cp .env.example .env
    ok "created .env from .env.example"
    return 0
  fi
  local added=()
  mapfile -t added < <(env_backfill)
  if [ ${#added[@]} -gt 0 ]; then
    ok "added missing settings to .env: ${added[*]}"
    warn "check those values suit your machine before relying on them"
  else
    ok ".env present and complete"
  fi
}

# load_env — export .env into this shell. Anything already exported wins, so
# `DAEDALUS_PORT=9000 ./daedalus.sh dev` still works.
load_env() {
  [ -f .env ] || return 0
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
}

# ── runtime state ────────────────────────────────────────────────────────────
# Created on the host so a rebuild never loses data, and so Docker does not
# create them as root-owned bind-mount sources.
ensure_dirs() { mkdir -p data/sqlite data/documents logs backend/data; }

# ── dependency staleness ─────────────────────────────────────────────────────
# Both use the same trick: compare the lockfile's mtime against a stamp file
# inside the installed tree. Newer lockfile means someone changed dependencies
# since you last installed them.

BACKEND_STAMP="backend/.venv/.requirements-stamp"

backend_deps_stale() {
  [ -d backend/.venv ] || return 0
  [ -f "$BACKEND_STAMP" ] || return 0
  [ backend/requirements.txt -nt "$BACKEND_STAMP" ]
}

frontend_deps_stale() {
  [ -d frontend/node_modules ] || return 0
  [ -f frontend/pnpm-lock.yaml ] || return 1
  [ frontend/pnpm-lock.yaml -nt frontend/node_modules ]
}

# ── backend python ───────────────────────────────────────────────────────────
PY="backend/.venv/bin/python"

require_venv() {
  [ -x "$PY" ] || fail "backend/.venv is missing — run './daedalus.sh setup' first"
}

# host_py — run the backend's interpreter against the HOST's data directories.
#
# The paths in .env are as seen *inside the container* (`/data`, `/logs`,
# `/app/data`). Sourcing .env and then running the backend on the host points
# it at directories that do not exist there — or, worse, at real ones. The
# mapping below is the same one docker-compose.yml mounts, so the dev servers
# and the container read and write exactly the same files.
#
# Applied per-command rather than exported, because `docker compose` reads the
# shell environment in preference to .env: exporting host paths globally would
# hand them to the container, which is precisely backwards.
host_py() {
  local root="$PWD"
  (cd backend && env \
      DAEDALUS_DATA_DIR="$root/data" \
      DAEDALUS_LOG_DIR="$root/logs" \
      DAEDALUS_PREFS_DB="$root/backend/data/prefs.db" \
      DAEDALUS_CHAT_DB="$root/data/sqlite/chat.db" \
      .venv/bin/python "$@")
}

# host_uvicorn — the dev server, with the same host-path mapping.
host_uvicorn() {
  local root="$PWD"
  env \
    DAEDALUS_DATA_DIR="$root/data" \
    DAEDALUS_LOG_DIR="$root/logs" \
    DAEDALUS_PREFS_DB="$root/backend/data/prefs.db" \
    DAEDALUS_CHAT_DB="$root/data/sqlite/chat.db" \
    backend/.venv/bin/uvicorn "$@"
}

migrate_cli() { host_py -m app.db.migrate "$@"; }

wait_for_api() {
  local port="${1:-${DAEDALUS_PORT:-8000}}"
  printf '  waiting for the API'
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 2 "http://localhost:${port}/api/health" >/dev/null 2>&1; then
      printf '\n'; return 0
    fi
    printf '.'; sleep 1
  done
  printf '\n'; return 1
}

check_ollama() {
  local url="${OLLAMA_BASE_URL:-http://localhost:11434}"
  if curl -fsS --max-time 2 "${url}/api/tags" >/dev/null 2>&1; then
    ok "Ollama reachable at ${url}"
  else
    warn "no Ollama at ${url}"
    info "Start it with 'ollama serve', or use --with-ollama."
    info "The dashboard works without it — only model inference needs it."
  fi
}

# stack_running — true when the app container is up.
stack_running() {
  compose ps --status running 2>/dev/null | grep -q daedalus
}
