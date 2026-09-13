#!/usr/bin/env bash
# Daedalus — bring your checkout back into a working state after a `git pull`,
# a branch switch, or a merge.
#
# Everything here is safe to re-run and nothing destroys data. Use ./reset.sh
# if you actually want the databases wiped.
#
#   ./sync.sh            do it all
#   ./sync.sh --check    report what WOULD change; touch nothing
#   ./sync.sh --upgrade  reinstall dependencies even if the lockfiles look current
#
set -euo pipefail
cd "$(dirname "$0")"

# shellcheck source=scripts/common.sh
. ./scripts/common.sh

CHECK_ONLY=0
FORCE_DEPS=0

for arg in "$@"; do
  case "$arg" in
    --check|-n) CHECK_ONLY=1 ;;
    --upgrade)  FORCE_DEPS=1 ;;
    -h|--help)  sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) err "unknown option '$arg' (try --help)"; exit 1 ;;
  esac
done

# Two lists, because they end differently: WOULD is what `./sync.sh` fixes
# by itself, MANUAL is what it can only tell you about. Lumping them together
# produced a summary that promised to rebuild a container image it never
# touches.
WOULD=()
MANUAL=()
note()   { WOULD+=("$1"); }
manual() { MANUAL+=("$1"); }

if [ "$CHECK_ONLY" -eq 1 ]; then
  printf '\n%sCHECK MODE%s — reporting only, nothing will be changed.\n' "$YELLOW" "$RESET"
fi

# ─────────────────────────────────────────────────────────────────────────────
head_ "Prerequisites"
# ─────────────────────────────────────────────────────────────────────────────
have python3 || fail "python3 not found. Run ./daedalus.sh setup."
ok "python3 $(python3 --version 2>&1 | cut -d' ' -f2)"

if have pnpm; then
  ok "pnpm $(pnpm --version)"
else
  warn "pnpm not found — frontend dependencies will be skipped"
fi

# Docker is optional for sync: the dev servers and the migration CLI both run
# on the host, so a checkout can be brought up to date with Docker stopped.
if have docker && docker info >/dev/null 2>&1; then
  ok "Docker is running"
  DOCKER_UP=1
else
  warn "Docker is not running — container checks skipped"
  DOCKER_UP=0
fi

# ─────────────────────────────────────────────────────────────────────────────
head_ "Configuration"
# ─────────────────────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  warn ".env is missing"
  if [ "$CHECK_ONLY" -eq 1 ]; then
    note "create .env from .env.example"
  else
    cp .env.example .env
    ok "created .env from .env.example"
  fi
else
  MISSING=()
  mapfile -t MISSING < <(env_missing_keys)
  if [ ${#MISSING[@]} -gt 0 ]; then
    warn "${#MISSING[@]} setting(s) in .env.example are missing from your .env:"
    for k in "${MISSING[@]}"; do info "$k"; done
    if [ "$CHECK_ONLY" -eq 1 ]; then
      note "copy ${#MISSING[@]} missing key(s) into .env"
    else
      env_backfill >/dev/null
      ok "appended them with the values from .env.example"
      warn "check those values suit your machine before relying on them"
    fi
  else
    ok ".env has every key .env.example does"
  fi
fi

load_env
ensure_dirs

# ─────────────────────────────────────────────────────────────────────────────
head_ "Backend dependencies"
# ─────────────────────────────────────────────────────────────────────────────
if [ ! -d backend/.venv ]; then
  warn "backend/.venv is missing"
  if [ "$CHECK_ONLY" -eq 1 ]; then
    note "create backend/.venv and install requirements"
  else
    python3 -m venv backend/.venv
    backend/.venv/bin/pip install --quiet --upgrade pip
    backend/.venv/bin/pip install --quiet -r backend/requirements.txt
    touch "$BACKEND_STAMP"
    ok "virtualenv created and requirements installed"
  fi
elif backend_deps_stale || [ "$FORCE_DEPS" -eq 1 ]; then
  warn "requirements.txt is newer than the installed packages"
  if [ "$CHECK_ONLY" -eq 1 ]; then
    note "reinstall backend requirements"
  else
    backend/.venv/bin/pip install --quiet -r backend/requirements.txt
    # pip leaves no reliable marker of its own, so stamp it ourselves —
    # otherwise this would report stale on every future run.
    touch "$BACKEND_STAMP"
    ok "backend packages updated"
  fi
else
  ok "backend packages match requirements.txt"
fi

# ─────────────────────────────────────────────────────────────────────────────
head_ "Frontend dependencies"
# ─────────────────────────────────────────────────────────────────────────────
if ! have pnpm; then
  warn "skipped — pnpm is not installed (npm i -g pnpm, or corepack enable)"
elif [ ! -d frontend/node_modules ]; then
  warn "frontend/node_modules is missing"
  if [ "$CHECK_ONLY" -eq 1 ]; then
    note "run pnpm install"
  else
    (cd frontend && pnpm install)
    ok "node modules installed"
  fi
elif frontend_deps_stale || [ "$FORCE_DEPS" -eq 1 ]; then
  warn "pnpm-lock.yaml is newer than node_modules — dependencies changed"
  if [ "$CHECK_ONLY" -eq 1 ]; then
    note "run pnpm install"
  else
    (cd frontend && pnpm install)
    # pnpm does not always touch the directory, so advance the stamp itself.
    touch frontend/node_modules
    ok "node modules updated"
  fi
else
  ok "node modules match pnpm-lock.yaml"
fi

# ─────────────────────────────────────────────────────────────────────────────
head_ "Database schema"
# ─────────────────────────────────────────────────────────────────────────────
# This is the section that matters most after a pull: a teammate's new
# migration arrives as a file, and until it runs the code and the database
# disagree about the shape of the data.
if [ ! -x "$PY" ]; then
  warn "skipped — backend/.venv is not installed yet"
elif [ "$CHECK_ONLY" -eq 1 ]; then
  # `status` exits 2 when migrations are pending, 1 when something is wrong.
  set +e
  OUTPUT="$(migrate_cli status 2>&1)"; RC=$?
  set -e
  printf '%s\n' "$OUTPUT" | sed 's/^/  /'
  case "$RC" in
    0) ok "every store is up to date" ;;
    2) note "apply pending migrations" ;;
    *) warn "the migration runner reported a problem — see above" ;;
  esac
else
  if ! migrate_cli up; then
    fail "migrations failed. Run './daedalus.sh migrate status' for detail."
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
head_ "Database integrity"
# ─────────────────────────────────────────────────────────────────────────────
# Cheap (`PRAGMA quick_check`) and worth running after a branch switch, when a
# database may have been written by code from a different schema version.
if [ ! -x "$PY" ]; then
  warn "skipped — backend/.venv is not installed yet"
else
  if ! migrate_cli check; then
    warn "a database reported corruption — restore from ./backups, or ./reset.sh"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
head_ "Orphaned databases"
# ─────────────────────────────────────────────────────────────────────────────
# Before the host-path mapping in scripts/common.sh existed, `daedalus.sh dev`
# sourced .env and inherited the *container* paths, so `paths.py` fell back to
# `backend/data/...` while the container wrote to `data/` and `logs/`. Anyone
# who ran the dev servers back then has a second, stale copy of each database.
# They are harmless and git-ignored, but they are not what the app reads now,
# and finding them later is confusing.
STRAYS=()
for stray in backend/data/logs/ai_logs.db backend/data/sqlite/chat.db              backend/data/sqlite/sensor_readings.db; do
  [ -f "$stray" ] && STRAYS+=("$stray")
done
if [ ${#STRAYS[@]} -gt 0 ]; then
  warn "${#STRAYS[@]} database(s) left by the pre-fix dev path — not read any more:"
  for stray in "${STRAYS[@]}"; do info "$stray"; done
  info "The live ones are data/sqlite/ and logs/. Delete the above when you are"
  info "sure nothing in them is wanted; ./sync.sh will not touch them."
else
  ok "no stale database copies"
fi

# ─────────────────────────────────────────────────────────────────────────────
head_ "Containers"
# ─────────────────────────────────────────────────────────────────────────────
# The image bakes in the built frontend and the backend source, so a running
# stack keeps serving pre-pull code until it is rebuilt. The dev servers do
# not have this problem — they reload from disk.
if [ "$DOCKER_UP" -eq 0 ]; then
  info "not checked"
elif stack_running; then
  warn "the stack is running code from the image it was built with"
  info "pulled changes reach it only after: ./daedalus.sh rebuild"
  manual "./daedalus.sh rebuild   — the image predates your current code"
else
  ok "stack is not running — it will pick up the new code when started"
fi

# ─────────────────────────────────────────────────────────────────────────────
if [ "$CHECK_ONLY" -eq 1 ]; then
  head_ "Summary"
  if [ ${#WOULD[@]} -eq 0 ] && [ ${#MANUAL[@]} -eq 0 ]; then
    ok "nothing to do — your checkout is already in sync"
  fi
  if [ ${#WOULD[@]} -gt 0 ]; then
    warn "${#WOULD[@]} thing(s) ./sync.sh will fix:"
    for w in "${WOULD[@]}"; do info "- $w"; done
    printf '\n    Run %s./sync.sh%s to apply them.\n' "$BOLD" "$RESET"
  fi
  if [ ${#MANUAL[@]} -gt 0 ]; then
    # Separator only when a WOULD block precedes it.
    [ ${#WOULD[@]} -gt 0 ] && printf '\n'
    warn "${#MANUAL[@]} thing(s) only you can do — ./sync.sh will not:"
    for m in "${MANUAL[@]}"; do info "- $m"; done
  fi
  printf '\n'
  exit 0
fi

head_ "Done — your checkout is in sync"
if [ ${#MANUAL[@]} -gt 0 ]; then
  warn "but ${#MANUAL[@]} thing(s) still need you:"
  for m in "${MANUAL[@]}"; do info "- $m"; done
  printf '\n'
fi
say "  ${DIM}Containers:${RESET}  ./daedalus.sh start"
say "  ${DIM}Hot reload:${RESET}  ./daedalus.sh dev"
say ""
say "  ${DIM}If something still looks wrong:${RESET}"
say "    ./daedalus.sh setup    reinstall dependencies from scratch"
say "    ./reset.sh             wipe and rebuild the local databases"
say ""
