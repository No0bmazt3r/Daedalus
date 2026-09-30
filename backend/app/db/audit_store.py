"""Audit and evaluation log store (Layer 10).

The AI layer is read-only toward the *reactor*; it must still write its own
audit trail. Those logs live here, in a database entirely separate from the
sensor data, so the read-only boundary is never weakened to accommodate them.

Every row of every table carries a `query_id`, so one question can be traced
end to end: intent → tool calls → retrieved evidence → model inference →
final response → error → user feedback.

Schema lives in `migrations/audit/`; connection handling in `sqlite_util`.

## Not the same thing as `chat_store`

Both hold conversation text, and they are deliberately different files with
opposite contracts. These rows are append-only evidence that a response was
grounded — the evaluation chapter rests on them, and a user deleting a chat
must not be able to delete them. `chat_store` holds the transcript the user
owns. `query_id` links the two.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import traceback
import uuid
from datetime import datetime, timezone
from typing import Any

from . import migrations, sqlite_util
from .paths import AUDIT_DB

STORE = "audit"

LOG_TABLES = (
    "conversation_logs",
    "tool_logs",
    "rag_logs",
    "model_logs",
    "error_logs",
    "feedback_logs",
    "memory_logs",
)

_init_lock = threading.Lock()
_initialised = False


def init_db() -> None:
    """Bring the schema up to date. Cheap and safe to call repeatedly."""
    global _initialised
    with _init_lock:
        if _initialised:
            return
        migrations.migrate(STORE)
        _initialised = True


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_query_id() -> str:
    """`q_YYYYMMDD_HHMMSSffffff` — sortable and unique within a run."""
    return "q_" + datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S%f")


def log(table: str, **fields: Any) -> None:
    """Insert one row. Unknown tables are rejected rather than created.

    Never raises: a failed write must not take down a chat response. Logging
    is evidence, not control flow.

    This is the opposite contract to `chat_store`, which *does* raise — losing
    the record of a turn is recoverable, losing the turn itself is not.
    """
    if table not in LOG_TABLES:
        raise ValueError(f"unknown log table '{table}'")
    fields.setdefault("timestamp", _now())
    # Dicts/lists are stored as JSON text so callers can pass structures.
    payload = {
        k: (json.dumps(v, separators=(",", ":")) if isinstance(v, (dict, list)) else v)
        for k, v in fields.items()
    }
    columns = ", ".join(payload)
    placeholders = ", ".join("?" for _ in payload)

    def _write() -> None:
        with sqlite_util.transaction(AUDIT_DB) as conn:
            conn.execute(
                f"INSERT INTO {table} ({columns}) VALUES ({placeholders})",
                tuple(payload.values()),
            )

    try:
        init_db()
        sqlite_util.with_retry(_write, what=f"log to {table}")
    except (sqlite3.Error, sqlite_util.DatabaseUnavailableError, migrations.MigrationError):
        # Swallowed deliberately — see docstring.
        pass


def log_error(
    component: str,
    error: BaseException | str,
    *,
    query_id: str | None = None,
    level: str = "error",
) -> None:
    """One `error_logs` row. Never raises, like `log`.

    `error` is the exception when there is one — its type and stack go in the
    row — or a message when the failure was reported rather than raised (a tool
    envelope with `ok: False`). `query_id` is None for background work that
    belongs to no single turn: the summariser, the title job.
    """
    if isinstance(error, BaseException):
        error_type = error.__class__.__name__
        message = str(error)
        stack = "".join(traceback.format_exception(error))[-8000:]
    else:
        error_type, message, stack = None, error, None
    log(
        "error_logs",
        error_id=f"err_{uuid.uuid4().hex[:12]}",
        query_id=query_id,
        component=component,
        level=level,
        error_type=error_type,
        message=message[:2000],
        stack_trace=stack,
    )


def has_query(query_id: str) -> bool:
    """Whether a chat turn with this id was logged — what a rating must refer to."""
    init_db()
    with sqlite_util.connect(AUDIT_DB) as conn:
        return conn.execute(
            "SELECT 1 FROM conversation_logs WHERE query_id = ? LIMIT 1", (query_id,)
        ).fetchone() is not None


def latest_ratings(session_id: str) -> dict[str, int]:
    """The newest thumbs rating per answer in one chat, `{query_id: +1 | -1}`.

    Ratings are appended, never updated — changing your mind is a second row —
    so "the rating" is the latest one. A withdrawn rating is stored as 0 and
    left out here.
    """
    init_db()
    with sqlite_util.connect(AUDIT_DB) as conn:
        rows = conn.execute(
            """
            SELECT f.query_id, f.rating
              FROM feedback_logs f
             WHERE f.session_id = ? AND f.rating IS NOT NULL
               AND f.id = (SELECT MAX(id) FROM feedback_logs g
                            WHERE g.query_id = f.query_id AND g.rating IS NOT NULL)
            """,
            (session_id,),
        ).fetchall()
    return {r["query_id"]: r["rating"] for r in rows if r["rating"]}


def trace(query_id: str) -> dict[str, list[dict[str, Any]]]:
    """Every logged row for one query, across all tables.

    This is what answers "prove this response was grounded".
    """
    init_db()
    out: dict[str, list[dict[str, Any]]] = {}
    with sqlite_util.connect(AUDIT_DB) as conn:
        for table in LOG_TABLES:
            rows = conn.execute(
                f"SELECT * FROM {table} WHERE query_id = ? ORDER BY id", (query_id,)
            ).fetchall()
            if rows:
                out[table] = [dict(r) for r in rows]
    return out


def stats() -> dict[str, int]:
    """Row counts per table — surfaced in the Settings → Databases panel."""
    init_db()
    with sqlite_util.connect(AUDIT_DB) as conn:
        return {
            table: conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]
            for table in LOG_TABLES
        }
