#!/usr/bin/env bash
# Daedalus — single entry point for everything you'd want to run.
#
#   ./daedalus.sh setup      one-time: install dependencies for local development
#   ./daedalus.sh start      build (if needed) and start the container stack
#   ./daedalus.sh dev        hot-reload dev stack, in containers
#   ./daedalus.sh stop       stop the stack
#   ./daedalus.sh logs       follow the stack's logs
#   ./daedalus.sh rebuild    force a clean image rebuild, then start
#   ./daedalus.sh status     what's running, and the health of all five stores
#   ./daedalus.sh migrate    apply pending schema migrations (see: migrate --help)
#
# Flags:
#   --with-ollama            run Ollama as a container too (default: use the host)
#   --with-search            run SearXNG as a container too (corpus sourcing only)
#   --host                   dev only: run the two servers on the host, not in
#                            containers (faster to attach a debugger to)
#   --gpu / --no-gpu         force GPU passthrough on or off. The default is
#                            auto: on when this host has an NVIDIA GPU
#
# Related scripts:
#   ./sync.sh                after a git pull: deps, .env, migrations  (safe)
#   ./reset.sh               wipe and rebuild the local databases (destructive)
#
# The stack is one container serving both the API and the built dashboard,
# plus ChromaDB for the vector store. `dev` layers docker-compose.dev.yml over
# it: same image, source bind-mounted, uvicorn and vite reloading in place.
# SearXNG is available behind a flag: the
# runtime is offline (Rule 1), so a search engine is something you start while
# sourcing the corpus and stop afterwards, not part of the deployed stack.

set -euo pipefail
cd "$(dirname "$0")"

# Output helpers, .env backfill, compose shim, migration CLI — see the file
# for why each is shared rather than repeated in three scripts.
# shellcheck source=scripts/common.sh
. ./scripts/common.sh

# docker compose reads .env by itself; the dev servers do not, so load it here
# and let anything already exported win.
load_env

PORT="${DAEDALUS_PORT:-8000}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

usage() { sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; }

# ── argument parsing ─────────────────────────────────────────────────────────
CMD="${1:-start}"
[ $# -gt 0 ] && shift || true

PROFILE_ARGS=()
MIGRATE_ARGS=()
DEV_ON_HOST=0
# auto | on | off. Auto asks the host once, in `gpu_overlay`.
GPU_MODE=auto

# `migrate` forwards its arguments to the Python CLI, which owns their meaning
# (including its own --help). Every other command accepts only known flags.
if [ "$CMD" = "migrate" ]; then
  MIGRATE_ARGS=("$@")
else
  for arg in "$@"; do
    case "$arg" in
      --with-ollama) PROFILE_ARGS+=(--profile with-ollama) ;;
      --with-search) PROFILE_ARGS+=(--profile with-search) ;;
      --host)        DEV_ON_HOST=1 ;;
      --gpu)         GPU_MODE=on ;;
      --no-gpu)      GPU_MODE=off ;;
      -h|--help)     usage; exit 0 ;;
      *) err "unknown option '$arg' (try --help)"; exit 1 ;;
    esac
  done
fi

# ── GPU passthrough ──────────────────────────────────────────────────────────
# A container cannot see the host's GPU unless it is asked for, and asking for
# one that is not there is a hard failure to create the container. So: added
# when the host says it has one, forced with --gpu, skipped with --no-gpu.
#
# The detection is `nvidia-smi -L` rather than a probe container, because it is
# the same question with none of the cost, and being wrong about it is handled —
# `compose_up` retries without the overlay when Docker rejects the device.
gpu_overlay() {
  case "$GPU_MODE" in
    off) return 1 ;;
    on)  printf -- '-f docker-compose.gpu.yml'; return 0 ;;
  esac
  if have nvidia-smi && nvidia-smi -L 2>/dev/null | grep -q '^GPU '; then
    printf -- '-f docker-compose.gpu.yml'
    return 0
  fi
  return 1
}

# `compose up`, with two things the bare call does not do: the GPU overlay is
# dropped rather than fatal when Docker will not honour it, and a failing build
# says why.
#
# COMPOSE_UP_QUIET=1 buffers the output instead of streaming it. `dev` wants
# that — build progress is noise on a run that usually rebuilds nothing — and
# `start`/`rebuild` do not, because a first build takes minutes and silence for
# minutes reads as a hang. Either way the output is captured, because compose
# writes build *errors* to the same stream as build progress: discarding it
# turned every cause (a TypeScript error, a missing file, no disk) into one
# message with nothing to act on.
_compose_up_once() {
  local log="$1"; shift
  if [ "${COMPOSE_UP_QUIET:-0}" = "1" ]; then
    compose "${PROFILE_ARGS[@]}" up "$@" >/dev/null 2>"$log"
    return $?
  fi
  compose "${PROFILE_ARGS[@]}" up "$@" 2>&1 | tee "$log"
  return "${PIPESTATUS[0]}"
}

compose_up() {
  local log rc
  log="$(mktemp)"
  _compose_up_once "$log" "$@"
  rc=$?
  # Only when the overlay was this script's idea. `--gpu` is somebody stating a
  # requirement, and quietly starting without it would be answering a different
  # question than the one they asked.
  if [ $rc -ne 0 ] && [ -n "${GPU_FILES:-}" ] && [ "$GPU_MODE" != "on" ] \
     && grep -qiE 'nvidia|could not select device driver|gpu' "$log"; then
    warn "this host advertises a GPU but Docker will not pass it through — continuing without it"
    say "  ${DIM}install the NVIDIA Container Toolkit, or pass --no-gpu to stop asking${RESET}"
    GPU_FILES=""
    export COMPOSE_FILES="$BASE_COMPOSE_FILES"
    _compose_up_once "$log" "$@"
    rc=$?
  fi
  [ $rc -eq 0 ] || [ "${COMPOSE_UP_QUIET:-0}" != "1" ] || tail -40 "$log" >&2
  rm -f "$log"
  return $rc
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
  say "  ${DIM}Containers:${RESET}  ./daedalus.sh start"
  say "  ${DIM}Hot reload:${RESET}  ./daedalus.sh dev"
  say "  ${DIM}After a pull:${RESET} ./sync.sh"
  say ""
}

cmd_start() {
  ensure_env
  ensure_dirs
  [ ${#PROFILE_ARGS[@]} -gt 0 ] || check_ollama
  BASE_COMPOSE_FILES="${COMPOSE_FILES:--f docker-compose.yml}"
  GPU_FILES="$(gpu_overlay || true)"
  export COMPOSE_FILES="$BASE_COMPOSE_FILES${GPU_FILES:+ $GPU_FILES}"
  head_ "Starting Daedalus"
  compose_up -d "$@" || fail "the stack did not start — the output above says why"
  # Record that a build happened, so the staleness check in sync.sh knows the
  # source has been through a build even when Docker served it from cache.
  mark_build
  if wait_for_api; then
    ok "dashboard   http://localhost:${PORT}"
    ok "API docs    http://localhost:${PORT}/docs"
    ensure_searxng "$PORT"
    say ""
    say "  ${DIM}Logs:${RESET} ./daedalus.sh logs   ${DIM}Stop:${RESET} ./daedalus.sh stop"
    say ""
  else
    err "the API did not become healthy in 60s. Recent logs:"
    compose "${PROFILE_ARGS[@]}" logs --tail=40 daedalus >&2
    exit 1
  fi
}

# Hot reload in containers, which is the default because it removes a whole
# category of bug rather than a step.
#
# Every address in .env is written from the container's point of view —
# `http://chromadb:8000`, `http://searxng:8080` — and none of them resolve on the
# host, so the host path needs three functions in scripts/common.sh whose entire
# job is rewriting them back to published ports. In here they are simply the
# addresses, and `/data`, `/logs` and `/config` mean what they mean in the image
# that ships instead of being remapped by a shell function.
#
# Ollama still runs on the host: GPU passthrough is far simpler there, and
# `extra_hosts` already makes host.docker.internal resolve from inside.
cmd_dev() {
  [ "$DEV_ON_HOST" = "1" ] && { cmd_dev_host; return; }

  ensure_env
  ensure_dirs
  check_ollama

  BASE_COMPOSE_FILES="-f docker-compose.yml -f docker-compose.dev.yml"
  GPU_FILES="$(gpu_overlay || true)"
  export COMPOSE_FILES="$BASE_COMPOSE_FILES${GPU_FILES:+ $GPU_FILES}"

  head_ "Starting dev stack"
  say "  ${DIM}source is bind-mounted; uvicorn and vite both reload in place${RESET}"
  [ -n "$GPU_FILES" ] \
    && say "  ${DIM}GPU passed through — Settings → Hardware describes the real card${RESET}" \
    || say "  ${DIM}no GPU passthrough; hardware detection will say so rather than report none${RESET}"
  say ""
  COMPOSE_UP_QUIET=1 compose_up -d --build daedalus chromadb \
    || fail "could not start the backend — the build output above says why. To iterate on it: COMPOSE_FILES='$COMPOSE_FILES' docker compose \$COMPOSE_FILES up --build daedalus"

  if wait_for_api; then
    ok "backend   http://localhost:${BACKEND_PORT}"
    # After the API is up: the selection lives in prefs.db and the API reads it.
    ensure_searxng "$BACKEND_PORT"
  else
    err "the API did not become healthy in 60s. Recent logs:"
    compose logs --tail=40 daedalus >&2
    exit 1
  fi
  ok "frontend  http://localhost:${FRONTEND_PORT}  ${DIM}(starting — first run installs deps)${RESET}"
  say ""
  say "  ${DIM}Stop:${RESET} ./daedalus.sh stop   ${DIM}Backend logs:${RESET} ./daedalus.sh logs"
  say ""
  # Vite in the foreground, so Ctrl-C ends the session the way it always has.
  # The backend keeps running deliberately: it is a container now, `stop` owns
  # its lifetime, and killing it on Ctrl-C would restart it on every UI restart.
  compose up frontend
}

# The older path: two processes on the host. Kept, not deprecated — a debugger
# attaches to a local process in one step, and a container that will not start
# is not a reason to be unable to run anything.
cmd_dev_host() {
  require_venv
  [ -d frontend/node_modules ] || fail "frontend/node_modules missing — run './daedalus.sh setup' first"
  ensure_env
  ensure_dirs
  # Migrations normally run at app startup too; doing it here as well means a
  # failure is reported before two dev servers start writing to the terminal.
  migrate_cli up >/dev/null || fail "migrations failed — run './daedalus.sh migrate status'"
  check_ollama
  # ChromaDB is a server, not part of the app, so this starts the one container
  # rather than pretending the vector store exists. Non-fatal if it cannot.
  ensure_chroma

  head_ "Starting dev servers on the host"
  host_uvicorn app.main:app --reload --port "$BACKEND_PORT" --app-dir backend &
  local api_pid=$!
  # Stop the backend when this script exits, however it exits.
  trap 'kill $api_pid 2>/dev/null || true' EXIT INT TERM
  ok "backend   http://localhost:${BACKEND_PORT}  (pid $api_pid)"
  ok "frontend  http://localhost:${FRONTEND_PORT}"
  say ""
  (cd frontend && pnpm dev --port "$FRONTEND_PORT")
}

# `--remove-orphans` is what makes one `stop` cover both stacks. `dev` layers an
# overlay that adds a service and renames a container; without the flag, a
# `down` run from the base file alone leaves those behind as containers compose
# no longer believes in.
cmd_stop()    { compose "${PROFILE_ARGS[@]}" down --remove-orphans; }
cmd_logs()    { compose "${PROFILE_ARGS[@]}" logs -f; }
cmd_rebuild() { ensure_dirs; cmd_start --build --force-recreate; }

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
  migrate)      cmd_migrate ;;
  -h|--help|help) usage ;;
  *) err "unknown command '$CMD'"; say ""; usage; exit 1 ;;
esac
