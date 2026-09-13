#!/usr/bin/env bash
# Daedalus — one command to bring the whole stack up.
#
#   ./run.sh              build (if needed) and start
#   ./run.sh --rebuild    force a clean image rebuild first
#   ./run.sh --with-ollama  also run Ollama as a container
#   ./run.sh --logs       follow logs of a running stack
#   ./run.sh --down       stop everything
#
# The app is one container: FastAPI serves the API and the built React
# dashboard from the same port. Ollama runs on the host unless you ask
# otherwise.

set -euo pipefail

cd "$(dirname "$0")"

PORT="${DAEDALUS_PORT:-8000}"
PROFILE_ARGS=()
COMPOSE_ARGS=()
ACTION="up"

# Support both `docker compose` (v2) and the legacy `docker-compose`.
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "error: docker compose is not installed or not on PATH." >&2
  exit 1
fi

for arg in "$@"; do
  case "$arg" in
    --rebuild)     COMPOSE_ARGS+=(--build --force-recreate) ;;
    --with-ollama) PROFILE_ARGS+=(--profile with-ollama) ;;
    --logs)        ACTION="logs" ;;
    --down)        ACTION="down" ;;
    -h|--help)     sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "error: unknown option '$arg' (try --help)" >&2; exit 1 ;;
  esac
done

case "$ACTION" in
  down)
    "${COMPOSE[@]}" "${PROFILE_ARGS[@]}" down
    exit 0
    ;;
  logs)
    "${COMPOSE[@]}" "${PROFILE_ARGS[@]}" logs -f
    exit 0
    ;;
esac

# State lives on the host so a rebuild never loses data.
mkdir -p data logs backend/data

# Warn early rather than letting the first chat query fail mysteriously.
if [[ ${#PROFILE_ARGS[@]} -eq 0 ]] && ! curl -fsS --max-time 2 http://localhost:11434/api/tags >/dev/null 2>&1; then
  echo "note: no Ollama detected on the host at :11434."
  echo "      Start it with 'ollama serve', or run './run.sh --with-ollama'."
  echo "      The dashboard still works — only model inference needs it."
  echo
fi

echo "Starting Daedalus…"
"${COMPOSE[@]}" "${PROFILE_ARGS[@]}" up -d "${COMPOSE_ARGS[@]}"

# Wait for the healthcheck rather than guessing.
printf 'Waiting for the API'
for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
    echo
    echo
    echo "  Daedalus is up →  http://localhost:${PORT}"
    echo "  API docs       →  http://localhost:${PORT}/docs"
    echo
    echo "  Logs:  ./run.sh --logs"
    echo "  Stop:  ./run.sh --down"
    exit 0
  fi
  printf '.'
  sleep 1
done

echo
echo "error: the API did not become healthy in 60s. Recent logs:" >&2
"${COMPOSE[@]}" "${PROFILE_ARGS[@]}" logs --tail=40 daedalus >&2
exit 1
