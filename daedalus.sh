#!/usr/bin/env bash
# Daedalus — single entry point for everything you'd want to run.
#
#   ./daedalus.sh setup      one-time: install dependencies
#   ./daedalus.sh dev        hot-reload: uvicorn + vite on the host (default)
#   ./daedalus.sh start      build the dashboard once, serve it and the API on one port
#   ./daedalus.sh stop       stop the optional SearXNG container
#   ./daedalus.sh status     the health of all five stores
#   ./daedalus.sh migrate    apply pending schema migrations (see: migrate --help)
#
# Flags:
#   --with-search            also start SearXNG (corpus sourcing only — needs Docker)
#
# Related scripts:
#   ./sync.sh                after a git pull: deps, .env, migrations  (safe)
#   ./reset.sh               wipe and rebuild the local databases (destructive)
#
# Everything runs on the host — no Docker. The API is one uvicorn process with
# ChromaDB embedded in it (data/chroma); Ollama is the host's own install. The
# only container left is SearXNG, which has no host install and is a setup
# surface anyway: the runtime is offline (Rule 1), so a search engine is
# something you start while sourcing the corpus and stop afterwards.

set -euo pipefail
cd "$(dirname "$0")"

# Output helpers, .env backfill, host path mapping, migration CLI — see the file
# for why each is shared rather than repeated in three scripts.
# shellcheck source=scripts/common.sh
. ./scripts/common.sh

# The servers do not read .env by themselves, so load it here and let anything
# already exported win.
load_env

PORT="${DAEDALUS_PORT:-8000}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

usage() { sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; }

# ── argument parsing ─────────────────────────────────────────────────────────
CMD="${1:-dev}"
[ $# -gt 0 ] && shift || true

MIGRATE_ARGS=()
WITH_SEARCH=0

# `migrate` forwards its arguments to the Python CLI, which owns their meaning
# (including its own --help). Every other command accepts only known flags.
if [ "$CMD" = "migrate" ]; then
  MIGRATE_ARGS=("$@")
else
  for arg in "$@"; do
    case "$arg" in
      --with-search) WITH_SEARCH=1 ;;
      -h|--help)     usage; exit 0 ;;
      *) err "unknown option '$arg' (try --help)"; exit 1 ;;
    esac
  done
fi

# ── commands ─────────────────────────────────────────────────────────────────

cmd_setup() {
  head_ "Checking prerequisites"
  local missing=0
  if have node; then ok "node $(node --version 2>/dev/null | head -1)"
  else err "node is not installed"; missing=1; fi
  have python3 && ok "python3 $(python3 --version 2>&1 | cut -d' ' -f2)" \
                || { err "python3 is not installed"; missing=1; }
  if have pnpm; then ok "pnpm $(pnpm --version)"
  elif have corepack; then warn "pnpm missing — enabling via corepack"; corepack enable || true
  else err "pnpm is not installed (npm i -g pnpm)"; missing=1; fi
  [ "$missing" -eq 0 ] || { err "install the missing tools above, then re-run"; exit 1; }

  head_ "Configuration"
  ensure_env

  head_ "Frontend dependencies"
  (cd frontend && pnpm install)
  ok "node modules installed"

  head_ "Backend virtualenv"
  if [ ! -d backend/.venv ]; then
    python3 -m venv backend/.venv
    ok "created backend/.venv"
  else
    ok "backend/.venv already exists"
  fi
  backend/.venv/bin/pip install --quiet --upgrade pip
  backend/.venv/bin/pip install --quiet -r backend/requirements.txt
  ensure_embedded_chroma
  # Stamped so sync.sh can tell whether requirements.txt has changed since.
  touch "$BACKEND_STAMP"
  ok "python packages installed"

  head_ "Runtime directories"
  ensure_dirs
  ok "data/ and logs/ ready"

  head_ "Database schema"
  migrate_cli up

  head_ "Optional"
  check_ollama

  head_ "Done"
  say "  ${DIM}Hot reload:${RESET}  ./daedalus.sh dev"
  say "  ${DIM}One port:${RESET}    ./daedalus.sh start"
  say "  ${DIM}After a pull:${RESET} ./sync.sh"
  say ""
}

# The steps both run modes share before a server starts.
prepare_host() {
  require_venv
  ensure_env
  ensure_dirs
  ensure_embedded_chroma
  # Migrations normally run at app startup too; doing it here as well means a
  # failure is reported before the servers start writing to the terminal.
  migrate_cli up >/dev/null || fail "migrations failed — run './daedalus.sh migrate status'"
  check_ollama
}

# SearXNG after the API is up: the provider selection lives in prefs.db and the
# API reads it. `--with-search` starts it regardless of the selection.
after_api_up() {
  local port="$1"
  if [ "$WITH_SEARCH" = "1" ]; then start_searxng
  else ensure_searxng "$port"; fi
}

# Hot reload: uvicorn and vite both reloading from disk. --reload-dir keeps
# uvicorn's watcher on the backend source instead of the whole repo — watching
# frontend/node_modules as well costs CPU for nothing.
# --timeout-graceful-shutdown: every open tab holds GET /api/events, and without
# it a reload waits for those streams to end — which they never do by themselves.
cmd_dev() {
  [ -d frontend/node_modules ] || fail "frontend/node_modules missing — run './daedalus.sh setup' first"
  prepare_host

  head_ "Starting Daedalus"
  host_uvicorn app.main:app --reload --port "$BACKEND_PORT" --app-dir backend \
    --reload-dir backend/app --timeout-graceful-shutdown 3 &
  # Global, not local: the trap runs after the function has returned.
  api_pid=$!
  # Stop the backend when this script exits, however it exits.
  trap 'kill ${api_pid:-} 2>/dev/null || true' EXIT INT TERM
  wait_for_api "$BACKEND_PORT" && after_api_up "$BACKEND_PORT" \
    || warn "the API is not answering yet — its log is above"
  ok "backend   http://localhost:${BACKEND_PORT}  (pid $api_pid)"
  ok "frontend  http://localhost:${FRONTEND_PORT}"
  say "  ${DIM}Stop:${RESET} Ctrl+C"
  say ""
  (cd frontend && DAEDALUS_API_URL="http://localhost:${BACKEND_PORT}" pnpm dev --port "$FRONTEND_PORT")
}

# One process on one port, no watchers: the dashboard is built once into
# frontend/dist and the API serves it (DAEDALUS_STATIC_DIR, see app/main.py).
# Lighter than `dev` while you are using the app rather than changing it.
cmd_start() {
  [ -d frontend/node_modules ] || fail "frontend/node_modules missing — run './daedalus.sh setup' first"
  prepare_host

  head_ "Building the dashboard"
  (cd frontend && pnpm build >/dev/null) || fail "the frontend build failed — run 'cd frontend && pnpm build' to see why"
  ok "frontend/dist"

  head_ "Starting Daedalus"
  DAEDALUS_STATIC_DIR="$PWD/frontend/dist" \
    host_uvicorn app.main:app --port "$PORT" --app-dir backend --timeout-graceful-shutdown 3 &
  # Global, not local: the trap runs after the function has returned.
  api_pid=$!
  trap 'kill ${api_pid:-} 2>/dev/null || true' EXIT INT TERM
  if wait_for_api "$PORT"; then
    after_api_up "$PORT"
    ok "dashboard   http://localhost:${PORT}"
    ok "API docs    http://localhost:${PORT}/docs"
    say "  ${DIM}Stop:${RESET} Ctrl+C"
    say ""
  else
    err "the API did not become healthy in 60s — its log is above"
    exit 1
  fi
  wait "$api_pid"
}

# The servers stop with Ctrl+C in their own terminal; the only thing left
# running in the background is the SearXNG container, if it was started.
cmd_stop() { stop_searxng; }

# Migrations normally run at startup; this is for applying a schema change
# without a restart, for inspecting state, and for CI. Every subcommand of
# `python -m app.db.migrate` is passed straight through:
#
#   ./daedalus.sh migrate            apply everything pending
#   ./daedalus.sh migrate status     what's applied, what's pending
#   ./daedalus.sh migrate check      integrity-check each database
#   ./daedalus.sh migrate backup     consistent snapshot of each database
cmd_migrate() {
  require_venv
  ensure_env
  ensure_dirs
  head_ "Migrations"
  # Default to `up`; anything else is the user's own subcommand.
  if [ ${#MIGRATE_ARGS[@]} -eq 0 ]; then MIGRATE_ARGS=(up); fi
  migrate_cli "${MIGRATE_ARGS[@]}"
}

cmd_status() {
  head_ "Stores"
  # Fetch first, then parse. Piping curl straight into python hides which half
  # failed — under pipefail a mere parse error reports as an unreachable API.
  local payload
  if ! payload=$(curl -fsS --max-time 3 "http://localhost:${PORT}/api/system/databases" 2>/dev/null); then
    warn "API not reachable on :${PORT} - is it running?"
    say ""
    return 0
  fi
  printf '%s' "$payload" | python3 -c '
import json, sys
try:
    rows = json.load(sys.stdin)["databases"]
except Exception as exc:
    sys.exit(f"  could not parse the store report: {exc}")
for d in rows:
    mark = "up  " if d["available"] else "DOWN"
    label, engine, access = d["label"], d["engine"], d["access"]
    print(f"  [{mark}] {label:<26} {engine:<9} {access}")
'
  say ""
}

case "$CMD" in
  setup)        cmd_setup ;;
  start|up)     cmd_start ;;
  dev|local)    cmd_dev ;;
  stop|down)    cmd_stop ;;
  status)       cmd_status ;;
  migrate)      cmd_migrate ;;
  -h|--help|help) usage ;;
  *) err "unknown command '$CMD'"; say ""; usage; exit 1 ;;
esac
