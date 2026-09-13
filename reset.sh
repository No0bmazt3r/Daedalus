#!/usr/bin/env bash
# Daedalus — wipe the local databases and rebuild them from the migrations.
#
# DESTRUCTIVE. Use ./sync.sh for the safe "get my checkout working" path.
#
#   ./reset.sh               wipe chat, audit and prefs; leave sensor data alone
#   ./reset.sh --sensor      also wipe the sensor database and reseed demo data
#   ./reset.sh --seed        reseed demo telemetry if the sensor DB is empty
#   ./reset.sh --no-backup   skip the safety snapshot (not recommended)
#   ./reset.sh --yes         don't ask (for scripts; think before you use it)
#
# The sensor database is excluded by default on purpose. Daedalus does not own
# it — the SCADA ingestion subsystem does, and on a lab machine that file may
# be real reactor data. Destroying it needs to be something you asked for
# explicitly, not something a reset quietly did.
#
set -euo pipefail
cd "$(dirname "$0")"

# shellcheck source=scripts/common.sh
. ./scripts/common.sh

WIPE_SENSOR=0
SEED=0
BACKUP=1
ASSUME_YES=0

for arg in "$@"; do
  case "$arg" in
    --sensor)    WIPE_SENSOR=1; SEED=1 ;;
    --seed)      SEED=1 ;;
    --no-backup) BACKUP=0 ;;
    --yes|-y)    ASSUME_YES=1 ;;
    -h|--help)   sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) err "unknown option '$arg' (try --help)"; exit 1 ;;
  esac
done

load_env
require_venv
ensure_dirs

# A SQLite file deleted while a process holds it open leaves that process
# writing to a deleted inode — the app appears to work, then loses everything
# on restart. Refuse rather than produce that.
if have docker && docker info >/dev/null 2>&1 && stack_running; then
  err "the container stack is running."
  info "Stop it first so nothing is holding the database files open:"
  info "  ./daedalus.sh stop && ./reset.sh"
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
head_ "What this will destroy"
# ─────────────────────────────────────────────────────────────────────────────
# Counts come from the app's own path resolution, so this reports the files
# that will actually be deleted rather than a hardcoded guess.
host_py - "$WIPE_SENSOR" <<'PYEOF'
import sqlite3, sys
from pathlib import Path

from app.db import paths

wipe_sensor = sys.argv[1] == "1"

targets = [
    ("chat",   paths.CHAT_DB,   [("chat_sessions", "sessions"), ("chat_messages", "messages")]),
    ("audit",  paths.AUDIT_DB,  [("conversation_logs", "conversations"), ("tool_logs", "tool calls")]),
    ("prefs",  paths.PREFS_DB,  [("user_prefs", "preferences")]),
]
if wipe_sensor:
    targets.append(("sensor", paths.SENSOR_DB, [("sensor_readings", "readings")]))

for name, path, tables in targets:
    if not Path(path).exists():
        print(f"  {name:<7} (not created yet)")
        continue
    parts = []
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        for table, label in tables:
            try:
                n = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                parts.append(f"{n} {label}")
            except sqlite3.Error:
                pass
        conn.close()
    except sqlite3.Error as exc:
        parts.append(f"unreadable: {exc}")
    print(f"  {name:<7} {path}")
    if parts:
        print(f"          {' · '.join(parts)}")
PYEOF

if [ "$WIPE_SENSOR" -eq 1 ]; then
  printf '\n'
  warn "--sensor was given: the sensor database will be deleted too."
  info "Daedalus does not own that file. On a lab machine it may hold real"
  info "reactor telemetry that nothing else has a copy of."
fi

printf '\n'
if [ "$ASSUME_YES" -eq 0 ]; then
  read -rp "  Destroy the databases listed above? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { say "  Cancelled."; exit 0; }
  if [ "$WIPE_SENSOR" -eq 1 ]; then
    read -rp "  The sensor database too — type 'sensor' to confirm: " reply
    [ "$reply" = "sensor" ] || { say "  Cancelled."; exit 0; }
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
if [ "$BACKUP" -eq 1 ]; then
  head_ "Snapshot first"
  # VACUUM INTO, not cp: copying a live WAL database captures the main file
  # without its pending frames. This is what makes the reset recoverable.
  migrate_cli backup || warn "snapshot failed — continuing anyway"
fi

# ─────────────────────────────────────────────────────────────────────────────
head_ "Deleting"
# ─────────────────────────────────────────────────────────────────────────────
# The -wal and -shm sidecars must go too. Leaving a WAL behind next to a fresh
# main file is how a "reset" database comes back with the old rows in it.
delete_db() {
  local label="$1" path="$2"
  local removed=0
  for suffix in "" "-wal" "-shm"; do
    if [ -e "${path}${suffix}" ]; then rm -f "${path}${suffix}"; removed=1; fi
  done
  [ "$removed" -eq 1 ] && ok "removed $label" || info "$label was not there"
}

eval "$(
  host_py - <<'PYEOF'
import shlex

from app.db import paths
print(f'CHAT_DB={shlex.quote(str(paths.CHAT_DB))}')
print(f'AUDIT_DB={shlex.quote(str(paths.AUDIT_DB))}')
print(f'PREFS_DB={shlex.quote(str(paths.PREFS_DB))}')
print(f'SENSOR_DB={shlex.quote(str(paths.SENSOR_DB))}')
PYEOF
)"

delete_db "chat transcripts" "$CHAT_DB"
delete_db "audit logs"       "$AUDIT_DB"
delete_db "UI preferences"   "$PREFS_DB"
[ "$WIPE_SENSOR" -eq 1 ] && delete_db "sensor telemetry" "$SENSOR_DB"

# ─────────────────────────────────────────────────────────────────────────────
head_ "Rebuilding schema"
# ─────────────────────────────────────────────────────────────────────────────
migrate_cli up

# ─────────────────────────────────────────────────────────────────────────────
if [ "$SEED" -eq 1 ]; then
  head_ "Demo telemetry"
  # seed_demo() refuses when rows already exist, so this can never overwrite a
  # real run — it only fills an empty database.
  host_py - <<'PYEOF'
from app.db import sensor_store
try:
    inserted = sensor_store.seed_demo()
except Exception as exc:  # noqa: BLE001
    print(f"  could not seed: {exc}")
else:
    print(f"  {inserted} reading(s) generated" if inserted
          else "  already populated — nothing written")
PYEOF
fi

head_ "Reset complete"
migrate_cli status
say ""
[ "$BACKUP" -eq 1 ] && say "  ${DIM}Snapshot of the old data:${RESET} backups/"
say "  ${DIM}Start it:${RESET} ./daedalus.sh dev   ${DIM}or${RESET}   ./daedalus.sh start"
say ""
