#!/usr/bin/env bash
# Daedalus — single entry point for everything you'd want to run.
#
#   ./daedalus.sh setup      one-time: install dependencies for local development
#   ./daedalus.sh start      build (if needed) and start the container stack
#   ./daedalus.sh dev        run the hot-reload dev servers instead (no Docker)
#   ./daedalus.sh stop       stop the stack
#   ./daedalus.sh logs       follow the stack's logs
#   ./daedalus.sh rebuild    force a clean image rebuild, then start
#   ./daedalus.sh status     what's running, and the health of all four stores
#
# Flags:
#   --with-ollama            run Ollama as a container too (default: use the host)
#
# The stack is one container serving both the API and the built dashboard,
# plus ChromaDB for the vector store.

set -euo pipefail
cd "$(dirname "$0")"

# docker compose reads .env by itself; the dev servers do not, so load it here
# and let anything already exported win.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

PORT="${DAEDALUS_PORT:-8000}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

# ── output helpers ───────────────────────────────────────────────────────────
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
  RED=$'\033[31m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; GREEN=''; YELLOW=''; RED=''; RESET=''
fi
say()  { printf '%s\n' "$*"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
err()  { printf '  %s✗%s %s\n' "$RED" "$RESET" "$*" >&2; }
head_() { printf '\n%s%s%s\n' "$BOLD" "$*" "$RESET"; }

 usage() { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; }

have() { command -v "$1" >/dev/null 2>&1; }

# Support both `docker compose` (v2) and the legacy `docker-compose`.
compose() {
  if docker compose version >/dev/null 2>&1; then docker compose "$@"
  elif have docker-compose; then docker-compose "$@"
  else err "docker compose is not installed or not on PATH."; exit 1
  fi
}

# ── argument parsing ─────────────────────────────────────────────────────────
CMD="${1:-start}"
[ $# -gt 0 ] && shift || true

PROFILE_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --with-ollama) PROFILE_ARGS+=(--profile with-ollama) ;;
    -h|--help)     usage; exit 0 ;;
    *) err "unknown option '$arg' (try --help)"; exit 1 ;;
  esac
done

# State lives on the host, so a rebuild never loses data. Creating these here
# also stops Docker from creating them as root-owned bind-mount sources.
ensure_dirs() { mkdir -p data/sqlite data/documents logs backend/data; }

# Create .env on first run, then top it up on later runs.
#
# The backfill is deliberately generic. Adding a setting to .env.example is
# easy to do and easy to forget to mirror into an existing .env, and the
# failure mode is a confusing runtime error rather than an obvious one — so
# every new key is appended automatically instead of being hand-patched here
# one bug at a time. Existing values are never touched.
ensure_env() {
  if [ ! -f .env ]; then
    cp .env.example .env
    ok "created .env from .env.example"
    return 0
  fi

  local added="" key
  while IFS= read -r key; do
    if ! grep -q "^${key}=" .env; then
      grep -m1 "^${key}=" .env.example >> .env
      added="${added} ${key}"
    fi
  done < <(grep -E '^[A-Z_][A-Z0-9_]*=' .env.example | cut -d= -f1)

  if [ -n "$added" ]; then
    ok "added missing settings to .env:$added"
  else
    ok ".env present and complete"
  fi
}

wait_for_api() {
  printf '  waiting for the API'
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 2 "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
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
    say  "    Start it with 'ollama serve', or use --with-ollama."
    say  "    The dashboard works without it — only model inference needs it."
  fi
}

# ── commands ─────────────────────────────────────────────────────────────────

cmd_setup() {
  head_ "Checking prerequisites"
  local missing=0
  for tool in docker node; do
    if have "$tool"; then ok "$tool $($tool --version 2>/dev/null | head -1)"
    else err "$tool is not installed"; missing=1; fi
  done
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
  ok "python packages installed"

  head_ "Runtime directories"
  ensure_dirs
  ok "data/ and logs/ ready"

  head_ "Optional"
  check_ollama

  head_ "Done"
  say "  ${DIM}Containers:${RESET}  ./daedalus.sh start"
  say "  ${DIM}Hot reload:${RESET}  ./daedalus.sh dev"
  say ""
}

cmd_start() {
  ensure_env
  ensure_dirs
  [ ${#PROFILE_ARGS[@]} -gt 0 ] || check_ollama
  head_ "Starting Daedalus"
  compose "${PROFILE_ARGS[@]}" up -d "$@"
  if wait_for_api; then
    ok "dashboard   http://localhost:${PORT}"
    ok "API docs    http://localhost:${PORT}/docs"
    say ""
    say "  ${DIM}Logs:${RESET} ./daedalus.sh logs   ${DIM}Stop:${RESET} ./daedalus.sh stop"
    say ""
  else
    err "the API did not become healthy in 60s. Recent logs:"
    compose "${PROFILE_ARGS[@]}" logs --tail=40 daedalus >&2
    exit 1
  fi
}

cmd_dev() {
  # Hot reload, no Docker. Two processes; Vite proxies /api to uvicorn.
  [ -d backend/.venv ] || { err "backend/.venv missing — run './daedalus.sh setup' first"; exit 1; }
  [ -d frontend/node_modules ] || { err "frontend/node_modules missing — run './daedalus.sh setup' first"; exit 1; }
  ensure_env
  ensure_dirs
  check_ollama

  head_ "Starting dev servers"
  backend/.venv/bin/uvicorn app.main:app --reload --port "$BACKEND_PORT" --app-dir backend &
  local api_pid=$!
  # Stop the backend when this script exits, however it exits.
  trap 'kill $api_pid 2>/dev/null || true' EXIT INT TERM
  ok "backend   http://localhost:${BACKEND_PORT}  (pid $api_pid)"
  ok "frontend  http://localhost:${FRONTEND_PORT}"
  say ""
  (cd frontend && pnpm dev --port "$FRONTEND_PORT")
}

cmd_stop()    { compose "${PROFILE_ARGS[@]}" down; }
cmd_logs()    { compose "${PROFILE_ARGS[@]}" logs -f; }
cmd_rebuild() { ensure_dirs; cmd_start --build --force-recreate; }

cmd_status() {
  head_ "Containers"
  compose ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null || say "  none running"

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
  dev)          cmd_dev ;;
  stop|down)    cmd_stop ;;
  logs)         cmd_logs ;;
  rebuild)      cmd_rebuild ;;
  status)       cmd_status ;;
  -h|--help|help) usage ;;
  *) err "unknown command '$CMD'"; say ""; usage; exit 1 ;;
esac
