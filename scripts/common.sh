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
# host_ollama_url — where Ollama is, as seen *from the host*.
#
# .env holds the container's view, `host.docker.internal`, which does not
# resolve outside Docker. Left as-is the backend pays a full DNS timeout on
# every call before falling back. Unset stays unset rather than becoming the
# empty string: the backend reads that literally and ends up with no candidate
# URL at all, which is worse than the default it would otherwise use.
host_ollama_url() {
  case "${OLLAMA_BASE_URL:-}" in
    "") return 0 ;;
    "http://host.docker.internal:11434") printf 'http://127.0.0.1:11434' ;;
    *) printf '%s' "$OLLAMA_BASE_URL" ;;
  esac
}

# host_chroma_url — where ChromaDB is, as seen *from the host*.
#
# Same problem as Ollama above and the same cure. .env holds the container's
# view, `http://chromadb:8000`, which is a compose service name: it does not
# resolve on the host, so the dev servers report the vector store as
# unreachable rather than as "not running". docker-compose.yml publishes the
# service on 127.0.0.1:${CHROMA_PORT:-8001}, and that is the host's address for
# the same container.
#
# Unset stays unset — but note that embedded mode needs the full `chromadb`
# package, and requirements.txt ships `chromadb-client`, which is HTTP-only. So
# on a default install an unset URL is not a working fallback; it is no vector
# store at all. `ensure_chroma` below is what makes the URL true.
host_chroma_url() {
  case "${CHROMA_URL:-}" in
    "") return 0 ;;
    "http://chromadb:8000") printf 'http://127.0.0.1:%s' "${CHROMA_PORT:-8001}" ;;
    *) printf '%s' "$CHROMA_URL" ;;
  esac
}

# ensure_chroma — start just the vector store, for `dev`.
#
# `dev` deliberately runs the app without Docker, but ChromaDB is a server the
# app talks to rather than part of the app, and there is no host equivalent
# short of installing the full package. So the one container starts, and the
# dev servers point at its published port.
#
# Not fatal when it cannot start: Track 2 (GraphRAG), the chat path, the Forge
# and every SQLite store work without a vector store, and refusing to run the
# whole stack because the RAG half is unavailable would be the wrong trade. It
# says so and carries on.
ensure_chroma() {
  [ -n "${CHROMA_URL:-}" ] || { info "CHROMA_URL is unset — skipping the vector store."; return 0; }
  local url; url="$(host_chroma_url)"
  if curl -fsS --max-time 2 "${url}/api/v2/heartbeat" >/dev/null 2>&1; then
    ok "chromadb  ${url}  (already running)"
    return 0
  fi
  if ! have docker; then
    warn "docker not found — the vector store will be unreachable at ${url}."
    warn "Track 1 (vector RAG) needs it; Track 2 (GraphRAG) does not."
    return 0
  fi
  info "starting chromadb"
  if compose up -d chromadb >/dev/null 2>&1; then
    for _ in $(seq 1 30); do
      if curl -fsS --max-time 2 "${url}/api/v2/heartbeat" >/dev/null 2>&1; then
        ok "chromadb  ${url}"
        return 0
      fi
      sleep 1
    done
    warn "chromadb started but did not answer at ${url} within 30s."
  else
    warn "could not start chromadb — the vector store will be unreachable."
  fi
}

# host_searxng_url — where SearXNG is, as seen *from the host*.
#
# Third instance of the same problem as Ollama and Chroma: .env holds the
# container's view, `http://searxng:8080`, which is a compose service name and
# does not resolve on the host. docker-compose.yml publishes it on
# 127.0.0.1:${SEARXNG_PORT:-8081}.
#
# No `ensure_searxng` to match `ensure_chroma`, and that is deliberate. Track 1
# cannot work without a vector store, so `dev` starts one; nothing in Daedalus
# needs a search engine to run, and a project whose first rule is "the runtime
# is offline" should not quietly start one every time somebody runs the dev
# servers. Start it when you want it: `./daedalus.sh start --with-search`.
host_searxng_url() {
  case "${SEARXNG_URL:-}" in
    "") return 0 ;;
    "http://searxng:8080") printf 'http://127.0.0.1:%s' "${SEARXNG_PORT:-8081}" ;;
    *) printf '%s' "$SEARXNG_URL" ;;
  esac
}

host_py() {
  local root="$PWD"
  (cd backend && env \
      ${OLLAMA_BASE_URL:+OLLAMA_BASE_URL="$(host_ollama_url)"} \
      ${CHROMA_URL:+CHROMA_URL="$(host_chroma_url)"} \
      ${SEARXNG_URL:+SEARXNG_URL="$(host_searxng_url)"} \
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
    ${OLLAMA_BASE_URL:+OLLAMA_BASE_URL="$(host_ollama_url)"} \
    ${CHROMA_URL:+CHROMA_URL="$(host_chroma_url)"} \
    ${SEARXNG_URL:+SEARXNG_URL="$(host_searxng_url)"} \
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
  local url; url="$(host_ollama_url)"
  [ -n "$url" ] || url="http://localhost:11434"
  if curl -fsS --max-time 2 "${url}/api/tags" >/dev/null 2>&1; then
    ok "Ollama reachable at ${url}"
    return 0
  fi

  warn "no Ollama reachable at ${url}"

  if have ollama; then
    info "Ollama is installed but not running. Attempting to start it automatically..."
    local started=0
    if [ "$(uname -s)" = "Linux" ]; then
      if have systemctl && systemctl list-unit-files ollama.service >/dev/null 2>&1; then
        sudo systemctl start ollama >/dev/null 2>&1 && started=1
      elif have brew && brew services list 2>/dev/null | grep -q '^ollama'; then
        brew services start ollama >/dev/null 2>&1 && started=1
      fi
    elif [ "$(uname -s)" = "Darwin" ]; then
      if have brew && brew services list 2>/dev/null | grep -q '^ollama'; then
        brew services start ollama >/dev/null 2>&1 && started=1
      else
        open -a Ollama >/dev/null 2>&1 && started=1
      fi
    fi

    if [ "$started" -eq 1 ]; then
      sleep 2
      if curl -fsS --max-time 2 "${url}/api/tags" >/dev/null 2>&1; then
        ok "Ollama started successfully!"
        return 0
      fi
    fi
    info "Could not start it automatically. Start it with 'ollama serve' in another terminal,"
    info "or use '--with-ollama' to run it via Docker."
  else
    info "Ollama is not installed on your machine."
    if [ -t 0 ]; then
      printf "    Would you like to install it natively now? [y/N]: "
      read -r ans
      case "$ans" in
        [Yy]* )
          local os; os="$(uname -s)"
          if [ "$os" = "Linux" ]; then
            if [ -f /etc/os-release ] && grep -Eq '(OSTREE_VERSION|VARIANT_ID="?silverblue"?)' /etc/os-release 2>/dev/null; then
              say "    Detected immutable OS (Silverblue/Bluefin). Installing via Homebrew..."
              if brew install ollama; then
                brew services start ollama >/dev/null 2>&1
                ok "Install complete and service started!"
              else
                err "Homebrew installation failed."
              fi
            else
              say "    Running Linux installer (may prompt for sudo)..."
              if curl -fsSL https://ollama.com/install.sh | sh; then
                ok "Install complete!"
              fi
            fi
          elif [ "$os" = "Darwin" ]; then
            say "    Opening the macOS download page..."
            open "https://ollama.com/download/mac" || true
          else
            say "    Please visit https://ollama.com/download to install for your OS."
          fi
          ;;
        * )
          info "Skipping. (The dashboard works without it — only model inference needs it.)"
          ;;
      esac
    else
      info "Install it from https://ollama.com/download to enable model inference."
    fi
  fi
}

# stack_running — true when the app container is up.
stack_running() {
  compose ps --status running 2>/dev/null | grep -q daedalus
}

# Touched after every successful build, and compared against source mtimes.
BUILD_STAMP=".daedalus-build-stamp"

mark_build() { touch "$BUILD_STAMP" 2>/dev/null || true; }

# image_is_stale — true when source files are newer than the last build.
#
# The image bakes in the backend source and the built frontend, so a running
# stack serves whatever it was built with. This answers "would rebuilding
# actually change anything?" — far more useful than warning on every run just
# because the stack happens to be up.
#
# The reference time is the *later* of the image's creation date and our own
# build stamp, and the stamp is what makes this correct. Docker keys its COPY
# layers on file **content**, so a rebuild after a whitespace-only change is a
# full cache hit: it returns the existing image, with its original Created
# date, and an mtime comparison alone would then report "stale" forever.
# Touching the stamp on a successful build records "you have rebuilt since
# these edits", which is the question actually being asked.
#
# Unknown (no image, no docker, unparseable date) is reported as *not* stale:
# a check that cannot tell should stay quiet rather than cry wolf.
image_is_stale() {
  have docker || return 1

  local created epoch stamp newest
  created=$(docker image inspect daedalus:latest --format '{{.Created}}' 2>/dev/null) || return 1
  [ -n "$created" ] || return 1

  epoch=$(date -d "$created" +%s 2>/dev/null) || return 1

  if [ -f "$BUILD_STAMP" ]; then
    stamp=$(stat -c %Y "$BUILD_STAMP" 2>/dev/null || echo 0)
    [ "$stamp" -gt "$epoch" ] && epoch="$stamp"
  fi

  # Newest mtime across everything the Dockerfile copies in.
  newest=$(find backend/app frontend/src frontend/package.json frontend/index.html \
             backend/requirements.txt -type f -newermt "@$epoch" -print -quit 2>/dev/null)

  [ -n "$newest" ]
}
