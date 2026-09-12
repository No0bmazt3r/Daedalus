"""SQLite-backed user preference store.

Deliberately a separate database file from the sensor DB: Layer 3 opens
`sensor_readings` strictly read-only, so user preferences — the one thing the
UI genuinely needs to write — live in their own store rather than weakening
that contract.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

DB_PATH = Path(__file__).resolve().parents[2] / "data" / "prefs.db"

# Single-user local deployment. Kept as a column so a future multi-user
# build does not need a migration.
DEFAULT_USER = "local"

# Guards against a runaway client filling the disk with one pref.
MAX_VALUE_BYTES = 256 * 1024

_SCHEMA = """
CREATE TABLE IF NOT EXISTS user_prefs (
    user_id    TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
);
"""

_init_lock = threading.Lock()
_initialised = False


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=5.0)
    try:
        conn.row_factory = sqlite3.Row
        # WAL keeps a read during a write from blocking, which matters once
        # the chat endpoints share this process.
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    global _initialised
    with _init_lock:
        if _initialised:
            return
        with _connect() as conn:
            conn.executescript(_SCHEMA)
        _initialised = True


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class PrefTooLargeError(ValueError):
    """Raised when a single preference exceeds MAX_VALUE_BYTES."""


def get_pref(key: str, user_id: str = DEFAULT_USER) -> Any | None:
    init_db()
    with _connect() as conn:
        row = conn.execute(
            "SELECT value FROM user_prefs WHERE user_id = ? AND key = ?",
            (user_id, key),
        ).fetchone()
    if row is None:
        return None
    try:
        return json.loads(row["value"])
    except json.JSONDecodeError:
        # A corrupt row should read as "unset" rather than break the UI.
        return None


def get_all_prefs(user_id: str = DEFAULT_USER) -> dict[str, Any]:
    init_db()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT key, value FROM user_prefs WHERE user_id = ?", (user_id,)
        ).fetchall()
    out: dict[str, Any] = {}
    for row in rows:
        try:
            out[row["key"]] = json.loads(row["value"])
        except json.JSONDecodeError:
            continue
    return out


def set_pref(key: str, value: Any, user_id: str = DEFAULT_USER) -> str:
    init_db()
    encoded = json.dumps(value, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > MAX_VALUE_BYTES:
        raise PrefTooLargeError(
            f"preference '{key}' exceeds {MAX_VALUE_BYTES} bytes"
        )
    updated_at = _now()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO user_prefs (user_id, key, value, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, key)
            DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """,
            (user_id, key, encoded, updated_at),
        )
    return updated_at


def delete_pref(key: str, user_id: str = DEFAULT_USER) -> bool:
    init_db()
    with _connect() as conn:
        cur = conn.execute(
            "DELETE FROM user_prefs WHERE user_id = ? AND key = ?", (user_id, key)
        )
        return cur.rowcount > 0
