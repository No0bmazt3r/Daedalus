"""Audit and evaluation log store (Layer 10).

The AI layer is read-only toward the *reactor*; it must still write its own
audit trail. Those logs live here, in a database entirely separate from the
sensor data, so the read-only boundary is never weakened to accommodate them.

Every row of every table carries a `query_id`, so one question can be traced
end to end: intent → tool calls → retrieved evidence → model inference →
final response → error → user feedback.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

from .paths import AUDIT_DB, ensure_dirs

_SCHEMA = """
-- One row per user question.
CREATE TABLE IF NOT EXISTS conversation_logs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    query_id          TEXT NOT NULL,
    timestamp         TEXT NOT NULL,
    session_id        TEXT,
    user_query        TEXT,
    intent            TEXT,
    selected_tools    TEXT,
    model_used        TEXT,
    response_text     TEXT,
    grounded_flag     INTEGER,
    hallucination_flag INTEGER,
    total_latency_ms  INTEGER,
    error_message     TEXT,
    user_feedback     TEXT
);

-- One row per deterministic tool invocation.
CREATE TABLE IF NOT EXISTS tool_logs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    query_id            TEXT NOT NULL,
    timestamp           TEXT NOT NULL,
    tool_name           TEXT NOT NULL,
    tool_input_json     TEXT,
    tool_output_summary TEXT,
    status              TEXT,
    latency_ms          INTEGER,
    error_message       TEXT
);

-- One row per retrieval, for precision/recall scoring later.
CREATE TABLE IF NOT EXISTS rag_logs (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    query_id             TEXT NOT NULL,
    timestamp            TEXT NOT NULL,
    track                TEXT,          -- 'vector' | 'graph'
    vector_db_used       TEXT,
    query_text           TEXT,
    top_k                INTEGER,
    retrieved_chunk_ids  TEXT,
    retrieval_scores     TEXT,
    source_files         TEXT,
    hop_count            INTEGER,
    retrieval_latency_ms INTEGER
);

-- One row per model call, for the latency chapter.
CREATE TABLE IF NOT EXISTS model_logs (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    query_id               TEXT NOT NULL,
    timestamp              TEXT NOT NULL,
    model_name             TEXT,
    temperature            REAL,
    prompt_token_count     INTEGER,
    completion_token_count INTEGER,
    time_to_first_token_ms INTEGER,
    total_inference_ms     INTEGER,
    status                 TEXT,
    error_message          TEXT
);

CREATE TABLE IF NOT EXISTS error_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    error_id    TEXT NOT NULL,
    timestamp   TEXT NOT NULL,
    query_id    TEXT,
    component   TEXT,
    level       TEXT,
    error_type  TEXT,
    message     TEXT,
    stack_trace TEXT
);

CREATE TABLE IF NOT EXISTS feedback_logs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    query_id          TEXT NOT NULL,
    timestamp         TEXT NOT NULL,
    evaluator_role    TEXT,
    usefulness_score  INTEGER,
    correctness_score INTEGER,
    comment           TEXT
);

-- Agent memory: durable facts the assistant may recall across sessions.
CREATE TABLE IF NOT EXISTS memory_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id  TEXT NOT NULL,
    timestamp  TEXT NOT NULL,
    session_id TEXT,
    query_id   TEXT,
    kind       TEXT,      -- 'fact' | 'preference' | 'summary'
    content    TEXT,
    source     TEXT,
    expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_conv_query   ON conversation_logs(query_id);
CREATE INDEX IF NOT EXISTS idx_conv_time    ON conversation_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_conv_session ON conversation_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_query   ON tool_logs(query_id);
CREATE INDEX IF NOT EXISTS idx_rag_query    ON rag_logs(query_id);
CREATE INDEX IF NOT EXISTS idx_model_query  ON model_logs(query_id);
CREATE INDEX IF NOT EXISTS idx_error_query  ON error_logs(query_id);
CREATE INDEX IF NOT EXISTS idx_feedback_q   ON feedback_logs(query_id);
CREATE INDEX IF NOT EXISTS idx_memory_sess  ON memory_logs(session_id);
"""

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


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    ensure_dirs()
    conn = sqlite3.connect(AUDIT_DB, timeout=5.0)
    try:
        conn.row_factory = sqlite3.Row
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


def new_query_id() -> str:
    """`q_YYYYMMDD_HHMMSSffffff` — sortable and unique within a run."""
    return "q_" + datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S%f")


def log(table: str, **fields: Any) -> None:
    """Insert one row. Unknown tables are rejected rather than created.

    Never raises: a failed write must not take down a chat response. Logging
    is evidence, not control flow.
    """
    if table not in LOG_TABLES:
        raise ValueError(f"unknown log table '{table}'")
    init_db()
    fields.setdefault("timestamp", _now())
    # Dicts/lists are stored as JSON text so callers can pass structures.
    payload = {
        k: (json.dumps(v, separators=(",", ":")) if isinstance(v, (dict, list)) else v)
        for k, v in fields.items()
    }
    columns = ", ".join(payload)
    placeholders = ", ".join("?" for _ in payload)
    try:
        with _connect() as conn:
            conn.execute(
                f"INSERT INTO {table} ({columns}) VALUES ({placeholders})",
                tuple(payload.values()),
            )
    except sqlite3.Error:
        # Swallowed deliberately — see docstring.
        pass


def trace(query_id: str) -> dict[str, list[dict[str, Any]]]:
    """Every logged row for one query, across all tables.

    This is what answers "prove this response was grounded".
    """
    init_db()
    out: dict[str, list[dict[str, Any]]] = {}
    with _connect() as conn:
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
    with _connect() as conn:
        return {
            table: conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]
            for table in LOG_TABLES
        }
