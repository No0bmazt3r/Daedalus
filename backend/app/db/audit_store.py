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

import contextvars
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

# ── incognito ────────────────────────────────────────────────────────────────
#
# An incognito chat promises its text is not kept. The audit rows of its turns
# are still written — the counts, timings and verdicts are evidence the
# evaluation needs, and they reveal nothing said — but every field that would
# hold what was asked or answered is replaced by `REDACTED`. Set per turn with
# `redact_this_context()`: the chat worker runs in its own context, so the flag
# reaches every row that turn writes (tools and retrieval run on the same
# thread) and nothing else.
REDACTED = "[not recorded: incognito]"
_TEXT_FIELDS = frozenset({
    "user_query", "response_text", "model_response_text", "standalone_query",
    "query_text", "tool_input_json", "tool_output_summary",
})
# Parts of the validator's verdict that quote the answer.
_VALIDATION_TEXT = ("control_claim", "uncited_causes")
_redact: contextvars.ContextVar[bool] = contextvars.ContextVar("audit_redact", default=False)


def redact_this_context() -> None:
    """From here on, rows written in this context keep no question or answer text."""
    _redact.set(True)


def _redacted(fields: dict[str, Any]) -> dict[str, Any]:
    out = {k: (REDACTED if k in _TEXT_FIELDS and v is not None else v) for k, v in fields.items()}
    validation = out.get("validation_json")
    if isinstance(validation, dict):
        out["validation_json"] = {
            k: (None if k == "control_claim" else []) if k in _VALIDATION_TEXT and v else v
            for k, v in validation.items()
        }
    return out


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
    if _redact.get():
        fields = _redacted(fields)
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


def recent_queries(
    *,
    session_id: str | None = None,
    intent: str | None = None,
    model: str | None = None,
    track: str | None = None,
    since: str | None = None,
    until: str | None = None,
    search: str | None = None,
) -> list[dict[str, Any]]:
    """Every chat turn the filters match, newest first, with its tool, retrieval and error counts.

    One row per `query_id` — the latest `conversation_logs` row for it, which is
    the one that records how the turn ended. Unpaged: how a turn is *classified*
    (grounded or not) depends on Settings → Ariadne's Thread, so the caller
    classifies, filters and pages (`services/thread.py`). `since`/`until` are
    ISO timestamps, `until` exclusive; `track` is a `rag_logs.track`.
    """
    init_db()
    where = ["c.id IN (SELECT MAX(id) FROM conversation_logs GROUP BY query_id)"]
    params: list[Any] = []
    if session_id:
        where.append("c.session_id = ?")
        params.append(session_id)
    if intent:
        where.append("c.intent = ?")
        params.append(intent)
    if model:
        where.append("c.model_used = ?")
        params.append(model)
    if track:
        where.append("EXISTS (SELECT 1 FROM rag_logs r WHERE r.query_id = c.query_id AND r.track = ?)")
        params.append(track)
    if since:
        where.append("c.timestamp >= ?")
        params.append(since)
    if until:
        where.append("c.timestamp < ?")
        params.append(until)
    if search:
        where.append("(c.user_query LIKE ? ESCAPE '\\' OR c.query_id LIKE ? ESCAPE '\\')")
        like = "%" + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        params += [like, like]
    clause = " AND ".join(where)
    with sqlite_util.connect(AUDIT_DB) as conn:
        rows = conn.execute(
            f"""
            SELECT c.*,
                   (SELECT COUNT(*) FROM tool_logs t WHERE t.query_id = c.query_id) AS tool_count,
                   (SELECT COUNT(*) FROM tool_logs t
                     WHERE t.query_id = c.query_id AND t.status = 'ok') AS ok_tool_count,
                   (SELECT COUNT(*) FROM rag_logs r WHERE r.query_id = c.query_id) AS retrieval_count,
                   (SELECT COUNT(*) FROM error_logs e WHERE e.query_id = c.query_id) AS error_count,
                   (SELECT GROUP_CONCAT(DISTINCT r.track) FROM rag_logs r
                     WHERE r.query_id = c.query_id) AS tracks
              FROM conversation_logs c
             WHERE {clause}
             ORDER BY c.timestamp DESC, c.id DESC
            """,
            params,
        ).fetchall()
    return [dict(r) for r in rows]


# ── human labels ─────────────────────────────────────────────────────────────
#
# The validator's verdict is a detector; whether an answer actually
# hallucinated is a person's call (MODULES.md §1.4), and the evaluation needs
# that call as ground truth. Stored in `feedback_logs` — the table for human
# judgement — with `evaluator_role = 'label'`: `correctness_score` 1 for a
# correct answer, 0 for a hallucinated one, NULL for a withdrawn label, and the
# note in `comment`. Appended, never updated, like the ratings: the newest wins.
LABEL_ROLE = "label"


def add_label(query_id: str, hallucinated: bool | None, note: str | None, session_id: str | None) -> None:
    log(
        "feedback_logs",
        query_id=query_id,
        evaluator_role=LABEL_ROLE,
        correctness_score=None if hallucinated is None else (0 if hallucinated else 1),
        comment=(note or "").strip() or None,
        session_id=session_id,
    )


def latest_labels(query_ids: list[str] | None = None) -> dict[str, dict[str, Any]]:
    """The newest label per answer, `{query_id: {hallucinated, note, timestamp}}`.

    Withdrawn labels are left out. `None` reads every label.
    """
    init_db()
    sql = """
        SELECT f.query_id, f.correctness_score, f.comment, f.timestamp
          FROM feedback_logs f
         WHERE f.evaluator_role = ?
           AND f.id = (SELECT MAX(id) FROM feedback_logs g
                        WHERE g.query_id = f.query_id AND g.evaluator_role = ?)
    """
    params: list[Any] = [LABEL_ROLE, LABEL_ROLE]
    if query_ids is not None:
        if not query_ids:
            return {}
        sql += f" AND f.query_id IN ({','.join('?' for _ in query_ids)})"
        params += query_ids
    with sqlite_util.connect(AUDIT_DB) as conn:
        rows = conn.execute(sql, params).fetchall()
    return {
        r["query_id"]: {
            "hallucinated": r["correctness_score"] == 0,
            "note": r["comment"],
            "timestamp": r["timestamp"],
        }
        for r in rows if r["correctness_score"] is not None
    }


def stats() -> dict[str, int]:
    """Row counts per table — surfaced in the Settings → System → Storage health panel."""
    init_db()
    with sqlite_util.connect(AUDIT_DB) as conn:
        return {
            table: conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]
            for table in LOG_TABLES
        }
