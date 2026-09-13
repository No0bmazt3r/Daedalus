"""Where each store lives.

Daedalus keeps four physically separate databases on purpose — see
PROJECT.md §6.3. The separation is the safety argument: a bug in ingestion or
logging cannot reach the sensor data of record, because it is a different file
opened with different permissions.

| Store    | Path                         | AI layer access |
|----------|------------------------------|-----------------|
| sensor   | $DATA_DIR/sqlite/sensor_readings.db | READ-ONLY |
| audit    | $LOG_DIR/ai_logs.db          | read/write (its own logs) |
| vector   | $DATA_DIR/chroma (or server) | read/write (its own index) |
| prefs    | $APP_DIR/prefs.db            | read/write (UI state) |
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
PREFS_DB = Path(os.environ.get("DAEDALUS_PREFS_DB", _BACKEND_ROOT / "data" / "prefs.db"))

# ChromaDB: a URL means the containerised server, otherwise an embedded
# persistent client writing to this directory.
CHROMA_DIR = DATA_DIR / "chroma"
CHROMA_URL = os.environ.get("CHROMA_URL", "").strip()


def ensure_dirs() -> None:
    """Create every directory the stores need. Safe to call repeatedly."""
    for path in (SENSOR_DB.parent, AUDIT_DB.parent, PREFS_DB.parent, CHROMA_DIR):
        path.mkdir(parents=True, exist_ok=True)
