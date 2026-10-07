#!/usr/bin/env bash
# Shared helpers for daedalus.sh, sync.sh and reset.sh. Sourced, not run.
#
# These three scripts need the same handful of things — coloured output, the
# host path mapping, and a .env that has every key .env.example declares. Keeping one copy here means a fix reaches all three, and a new
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

# Docker is optional: the app runs on the host, and docker-compose.yml holds
# only SearXNG, which has no host install. So "no Docker" is a normal answer
# here, not an error — callers check `have_compose` and carry on without it.
# Supports both `docker compose` (v2) and the legacy `docker-compose`.
have_compose() {
  { have docker && docker compose version >/dev/null 2>&1 && docker info >/dev/null 2>&1; } \
    || have docker-compose
}

compose() {
  if docker compose version >/dev/null 2>&1; then docker compose "$@"
  elif have docker-compose; then docker-compose "$@"
  else err "docker compose is not installed or not on PATH."; return 1
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
# `DAEDALUS_PORT=9000 ./daedalus.sh start` still works.
#
# The "already exported wins" half needs the save/restore below and did not have
# it. `set -a; . ./.env` is a plain assignment per line, and a plain assignment
# always beats the environment — so `DAEDALUS_PORT=9000 ./daedalus.sh start`
# silently published 8000 instead, and the only symptom was the app appearing on
# the wrong port while the script printed the one you asked for.
load_env() {
  [ -f .env ] || return 0
  local preserved=() key
  # Remember the values of any .env key that is already set in this environment.
  while IFS='=' read -r key _; do
    key="${key%%[[:space:]]*}"
    case "$key" in ''|'#'*) continue ;; esac
    [ -n "${!key+x}" ] && preserved+=("$key=${!key}")
  done < .env

  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a

  # …and put them back over whatever the file just wrote.
  local kv
  for kv in ${preserved[@]+"${preserved[@]}"}; do export "${kv?}"; done

  # A .env from before the move off Docker names the chromadb container, which
  # no longer exists. Unset is what selects the embedded store, so say so and
  # drop it rather than have the vector store report itself unreachable.
  if [ "${CHROMA_URL:-}" = "http://chromadb:8000" ]; then
    warn "CHROMA_URL in .env names the old chromadb container — ignoring it (embedded store)."
    info "Delete the value in .env to silence this: CHROMA_URL="
    unset CHROMA_URL
  fi
}

# ── runtime state ────────────────────────────────────────────────────────────
# Created up front so the first write to each store has somewhere to land.
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

# host_py — run the backend's interpreter against the repo's data directories.
#
# The five stores live under the repo: data/ (sensor, chat, documents, chroma),
# logs/ (audit) and backend/data/ (prefs). The paths are set here, absolute and
# per-command, rather than read from .env, so every entry point — the servers,
# the migration CLI, reset.sh — resolves the same files whatever the working
# directory, and an old .env still holding container paths (`/data`, `/logs`)
# cannot point the app at directories that do not exist on this machine.
# host_ollama_url — where Ollama is, as seen *from the host*.
#
# An older .env holds the container's view, `host.docker.internal`, which does
# not resolve outside Docker. Left as-is the backend pays a full DNS timeout on
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

# ensure_embedded_chroma — make sure the venv runs ChromaDB in-process.
#
# The vector store is embedded in the API (data/chroma), which needs the full
# `chromadb` package. Venvs created before the move off Docker have
# `chromadb-client` instead — HTTP-only, and it installs files under the same
# `chromadb` module — so it is removed, and if it was found alongside the full
# package the full package is reinstalled over the files it shared.
# Cheap when nothing needs doing: two `pip show` calls.
ensure_embedded_chroma() {
  local pip="backend/.venv/bin/pip"
  local had_client=0 had_full=0
  "$pip" show chromadb-client >/dev/null 2>&1 && had_client=1
  "$pip" show chromadb >/dev/null 2>&1 && had_full=1
  if [ "$had_client" = "0" ] && [ "$had_full" = "1" ]; then
    ok "chromadb  embedded  (data/chroma)"
    return 0
  fi
  info "installing the embedded vector store (full chromadb — one-time, a few minutes)"
  if [ "$had_client" = "1" ]; then "$pip" uninstall --quiet -y chromadb-client; fi
  "$pip" install --quiet "chromadb>=1.5,<2" \
    || fail "could not install chromadb — see the pip output above"
  # The client's uninstall removed files the full package also owns.
  if [ "$had_client" = "1" ] && [ "$had_full" = "1" ]; then
    "$pip" install --quiet --force-reinstall --no-deps "chromadb>=1.5,<2"
  fi
  ok "chromadb  embedded  (data/chroma)"
}

# host_searxng_url — where SearXNG is, as seen *from the host*.
#
# An older .env holds the container network's view, `http://searxng:8080`,
# which is a compose service name and does not resolve on the host.
# docker-compose.yml publishes it on 127.0.0.1:${SEARXNG_PORT:-8081}.
#
# `ensure_searxng` below starts it, but only when it has been selected as the
# search provider — see the note there for why that is different from starting
# one every time somebody runs the servers.
host_searxng_url() {
  case "${SEARXNG_URL:-}" in
    "") return 0 ;;
    "http://searxng:8080") printf 'http://127.0.0.1:%s' "${SEARXNG_PORT:-8081}" ;;
    *) printf '%s' "$SEARXNG_URL" ;;
  esac
}

# ensure_searxng — start the search container, but only if it is the choice.
#
# There deliberately was no auto-start at first, on the reasoning that a
# project whose first rule is "the runtime is offline" should not quietly
# start a search engine. That reasoning still holds for *quietly*. It stops
# holding once an operator has gone into Settings and selected SearXNG as their
# provider: at that point refusing to start it is ignoring a stated choice, and
# the symptom is a Search panel that looks configured and fails on every query.
#
# So this reads the selection back from the running API and acts on it. Nothing
# starts for a provider nobody picked, and nothing starts when the instance is
# already answering — the API's `ready` flag now means *reachable*, not merely
# *configured*, which is what makes this check trustworthy.
#
# Requires the API to be up, so it is called after `wait_for_api`.
ensure_searxng() {
  local api="http://localhost:${1:-$PORT}"
  local state
  state="$(curl -fsS --max-time 5 "${api}/api/search/config" 2>/dev/null)" || return 0

  # Exit 0 — "please start it" — only when SearXNG is selected and unreachable.
  printf '%s' "$state" | python3 -c 'import json,sys; c=json.load(sys.stdin); sys.exit(0 if c.get("provider") == "searxng" and not c.get("ready") else 1)' 2>/dev/null || return 0

  info "SearXNG is the selected search provider but is not answering — starting it"
  start_searxng
}

# start_searxng — the one container Daedalus still has. Without Docker this
# warns and returns: web search is a setup surface, not the answer path.
start_searxng() {
  if ! have_compose; then
    warn "SearXNG needs Docker, which is not available — web search will be unavailable."
    warn "Everything else works: it is a setup surface, not the answer path."
    return 0
  fi
  if compose up -d searxng >/dev/null 2>&1; then
    local url; url="$(host_searxng_url)"
    [ -n "$url" ] || url="http://127.0.0.1:${SEARXNG_PORT:-8081}"
    for _ in $(seq 1 30); do
      if curl -fsS --max-time 2 "${url}/" >/dev/null 2>&1; then
        ok "searxng   ${url}"
        return 0
      fi
      sleep 1
    done
    warn "searxng started but did not answer at ${url} within 30s."
  else
    warn "could not start searxng — web search will be unavailable."
    warn "Everything else works: it is a setup surface, not the answer path."
  fi
}

stop_searxng() {
  if ! have_compose; then ok "nothing running in Docker"; return 0; fi
  compose down --remove-orphans
}

host_py() {
  local root="$PWD"
  (cd backend && env \
      ${OLLAMA_BASE_URL:+OLLAMA_BASE_URL="$(host_ollama_url)"} \
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
    info "Could not start it automatically. Start it with 'ollama serve' in another terminal."
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
