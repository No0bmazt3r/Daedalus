"""Where each store lives.

Daedalus keeps five physically separate databases on purpose — see
PROJECT.md §6.3. The separation is the safety argument: a bug in ingestion or
logging cannot reach the sensor data of record, because it is a different file
opened with different permissions.

| Store    | Path                                | AI layer access |
|----------|-------------------------------------|-----------------|
| sensor   | $DATA_DIR/sqlite/sensor_readings.db | READ-ONLY |
| audit    | $LOG_DIR/ai_logs.db                 | read/write (its own logs) |
| chat     | $DATA_DIR/sqlite/chat.db            | read/write (transcripts) |
| vector   | $DATA_DIR/chroma (or server)        | read/write (its own index) |
| prefs    | $APP_DIR/prefs.db                   | read/write (UI state) |

**Why `chat` is separate from `audit`**, when both hold conversation text: they
have opposite lifecycles. A user renames, archives and deletes their own chats;
audit rows are append-only evidence that a response was grounded, and the
evaluation chapter rests on them. Separate files make "deleting a chat cannot
delete the evidence" a property of the filesystem rather than a promise about
our DELETE statements. `query_id` still links the two — ATTACH to join.

## Keep these on a native filesystem

All five use WAL, which coordinates readers and writers through an mmapped
`-shm` file. Network mounts (NFS, SMB) and Windows-hosted paths under WSL
(`/mnt/c/...`) do not reliably provide that, and the failure mode is silent
corruption rather than an error. Under WSL keep `DAEDALUS_DATA_DIR` somewhere
under `/home`; in Docker keep the volume on the Linux side.
"""

from __future__ import annotations

import os
from pathlib import Path

# Container defaults come from docker-compose; the fallbacks keep a bare
# `uvicorn app.main:app` working from the backend/ directory.
_BACKEND_ROOT = Path(__file__).resolve().parents[2]

DATA_DIR = Path(os.environ.get("DAEDALUS_DATA_DIR", _BACKEND_ROOT / "data"))
LOG_DIR = Path(os.environ.get("DAEDALUS_LOG_DIR", _BACKEND_ROOT / "data" / "logs"))

SENSOR_DB = DATA_DIR / "sqlite" / "sensor_readings.db"
AUDIT_DB = LOG_DIR / "ai_logs.db"
CHAT_DB = Path(os.environ.get("DAEDALUS_CHAT_DB", DATA_DIR / "sqlite" / "chat.db"))
PREFS_DB = Path(os.environ.get("DAEDALUS_PREFS_DB", _BACKEND_ROOT / "data" / "prefs.db"))

# ChromaDB: a URL means the containerised server, otherwise an embedded
# persistent client writing to this directory.
CHROMA_DIR = DATA_DIR / "chroma"
CHROMA_URL = os.environ.get("CHROMA_URL", "").strip()

# The model the orchestrator runs, written by the Forge and read by FastAPI.
# PROJECT.md 8.1: "Selected via config/model_config.json — never hardcoded."
#
# Outside the five stores on purpose. It is configuration, not data: a human
# reads it, a human may edit it by hand, and it belongs in version control
# alongside the code it configures rather than in a database nobody can diff.
CONFIG_DIR = Path(os.environ.get("DAEDALUS_CONFIG_DIR", _BACKEND_ROOT.parent / "config"))
MODEL_CONFIG = CONFIG_DIR / "model_config.json"


def ensure_dirs() -> None:
    """Create every directory the stores need. Safe to call repeatedly."""
    for path in (
        SENSOR_DB.parent,
        AUDIT_DB.parent,
        CHAT_DB.parent,
        PREFS_DB.parent,
        CHROMA_DIR,
        CONFIG_DIR,
    ):
        path.mkdir(parents=True, exist_ok=True)
