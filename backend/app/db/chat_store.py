"""Chat transcript store — durable conversation state.

## What this is for

Ollama is stateless. "The assistant remembers" only ever means the orchestrator
re-sent the transcript, so the transcript is the memory and it has to live
somewhere. Here.

Both halves of the problem reduce to this one store:

- **Within a session** — every turn rebuilds the prompt from these rows.
- **Across sessions** — reopening a chat reads the same rows back.

The difference is only *how much* is replayed, which is the orchestrator's
concern (Layer 7), not this module's.

## Why the server owns it, not the browser

The obvious shortcut is to let the client hold the transcript and post it back
with each query. That makes conversation history a **client-supplied input to
the prompt**: anything that can call the API can forge `assistant: "CO₂ is
9999 ppm"` and the model will narrate it as fact. Server-owned history removes
the forgery surface entirely, and is also what makes a transcript survive a
page reload or a second browser tab.

## Failure contract — the opposite of `audit_store`

`audit_store.log()` swallows errors: a failed log must never take down a chat
response. This module **raises**. A transcript that silently fails to persist
looks fine until the user reopens the chat and their conversation is gone.
Losing evidence of a turn is recoverable; losing the turn is not.
"""

from __future__ import annotations

import json
import re
import secrets
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Any, Final

from . import migrations, sqlite_util
from .paths import CHAT_DB

DB_PATH = CHAT_DB

STORE = "chat"

ROLES: Final = ("user", "assistant")

# A generous ceiling on one message, so a runaway client cannot fill the disk
# with a single row. Well above any real question or grounded answer.
MAX_CONTENT_BYTES: Final = 64 * 1024
MAX_TITLE_CHARS: Final = 200
MAX_SUMMARY_CHARS: Final = 4_000

# Titles derived from the first user message; long enough to disambiguate in
# the sidebar, short enough not to wrap.
TITLE_CHARS: Final = 60

# Rough tokens-per-character for context budgeting. Deliberately crude — the
# real figure comes from Ollama's `prompt_eval_count`, logged to
# `model_logs.prompt_token_count`. Calibrate this constant from that data
# rather than trusting it.
CHARS_PER_TOKEN: Final = 4

_init_lock = threading.Lock()
_initialised = False

_WHITESPACE = re.compile(r"\s+")


class ChatStoreError(RuntimeError):
    """Base class for every error this module raises."""


class SessionNotFoundError(ChatStoreError):
    """No session with that id — maps to 404."""


class ContentTooLargeError(ChatStoreError):
    """A message exceeded MAX_CONTENT_BYTES — maps to 413."""


class _Unset:
    """Sentinel distinguishing "leave alone" from an explicit `None`."""


_UNSET: Final = _Unset()


def init_db() -> None:
    """Bring the schema up to date. Cheap and safe to call repeatedly.

    Normally the app does this once at startup, but any script importing this
    module gets a usable database without having to know that.
    """
    global _initialised
    with _init_lock:
        if _initialised:
            return
        migrations.migrate(STORE)
        _initialised = True


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_session_id() -> str:
    """`s_YYYYMMDD_HHMMSSffffff_xxxx` — sortable, and unique under a race.

    The timestamp alone would collide if two sessions were created in the same
    microsecond; on a PRIMARY KEY that is a hard failure, so four random hex
    characters make it a non-issue.
    """
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S%f")
    return f"s_{stamp}_{secrets.token_hex(2)}"


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // CHARS_PER_TOKEN)


def derive_title(content: str) -> str:
    """A sidebar label from the first user message."""
    flat = _WHITESPACE.sub(" ", content).strip()
    if len(flat) <= TITLE_CHARS:
        return flat or "New chat"
    return flat[: TITLE_CHARS - 1].rstrip() + "…"


def _session_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "session_id": row["session_id"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "title": row["title"],
        "device_id": row["device_id"],
        "summary": row["summary"],
        "summary_upto_seq": row["summary_upto_seq"],
        "ephemeral": bool(row["ephemeral"]),
        "archived_at": row["archived_at"],
        # Present only on list queries, which join the count in.
        "message_count": row["message_count"] if "message_count" in row.keys() else None,
    }


def _message_row(row: sqlite3.Row) -> dict[str, Any]:
    evidence: Any = None
    if row["evidence_json"]:
        try:
            evidence = json.loads(row["evidence_json"])
        except json.JSONDecodeError:
            # A corrupt evidence blob must not make the whole transcript
            # unreadable — the message text is the part that matters.
            evidence = None
    return {
        "id": row["id"],
        "session_id": row["session_id"],
        "seq": row["seq"],
        "role": row["role"],
        "content": row["content"],
        "query_id": row["query_id"],
        "evidence": evidence,
        "token_estimate": row["token_estimate"],
        "created_at": row["created_at"],
    }


# ── sessions ─────────────────────────────────────────────────────────────────


def create_session(
    *,
    title: str | None = None,
    device_id: str = "co2_reactor",
    ephemeral: bool = False,
) -> dict[str, Any]:
    """Open a new session. `title` is usually left to the first message."""
    init_db()
    session_id = new_session_id()
    now = _now()
    clean_title = title.strip()[:MAX_TITLE_CHARS] if title and title.strip() else None

    def _write() -> None:
        with sqlite_util.transaction(DB_PATH) as conn:
            conn.execute(
                "INSERT INTO chat_sessions "
                "(session_id, created_at, updated_at, title, device_id, ephemeral) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (session_id, now, now, clean_title, device_id, int(ephemeral)),
            )

    sqlite_util.with_retry(_write, what="create_session")
    created = get_session(session_id)
    if created is None:  # pragma: no cover - the insert just succeeded
        raise ChatStoreError(f"session {session_id} vanished immediately after insert")
    return created


def get_session(session_id: str) -> dict[str, Any] | None:
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        row = conn.execute(
            "SELECT * FROM chat_sessions WHERE session_id = ?", (session_id,)
        ).fetchone()
    return _session_row(row) if row else None


def list_sessions(
    *,
    limit: int = 50,
    offset: int = 0,
    include_archived: bool = False,
    include_ephemeral: bool = False,
) -> list[dict[str, Any]]:
    """Sessions for the sidebar, most recently updated first.

    Incognito sessions are hidden by default: they exist so in-session memory
    works, not to be browsed later.
    """
    init_db()
    clauses: list[str] = []
    params: list[Any] = []
    if not include_archived:
        clauses.append("s.archived_at IS NULL")
    if not include_ephemeral:
        clauses.append("s.ephemeral = 0")
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    params.extend([max(1, min(limit, 500)), max(0, offset)])
    with sqlite_util.connect(DB_PATH) as conn:
        rows = conn.execute(
            f"""
            SELECT s.*,
                   (SELECT COUNT(*) FROM chat_messages m
                     WHERE m.session_id = s.session_id) AS message_count
              FROM chat_sessions s
              {where}
             ORDER BY s.updated_at DESC, s.session_id DESC
             LIMIT ? OFFSET ?
            """,
            params,
        ).fetchall()
    return [_session_row(row) for row in rows]


def update_session(
    session_id: str,
    *,
    title: str | None | _Unset = _UNSET,
    archived: bool | _Unset = _UNSET,
) -> dict[str, Any]:
    """Rename and/or archive. Omitted fields are left untouched."""
    init_db()
    assignments: list[str] = []
    params: list[Any] = []

    if not isinstance(title, _Unset):
        cleaned = title.strip()[:MAX_TITLE_CHARS] if title and title.strip() else None
        assignments.append("title = ?")
        params.append(cleaned)
    if not isinstance(archived, _Unset):
        assignments.append("archived_at = ?")
        params.append(_now() if archived else None)

    if assignments:
        assignments.append("updated_at = ?")
        params.extend([_now(), session_id])

        def _write() -> None:
            with sqlite_util.transaction(DB_PATH) as conn:
                cursor = conn.execute(
                    f"UPDATE chat_sessions SET {', '.join(assignments)} "
                    f"WHERE session_id = ?",
                    params,
                )
                if cursor.rowcount == 0:
                    raise SessionNotFoundError(session_id)

        sqlite_util.with_retry(_write, what="update_session")

    session = get_session(session_id)
    if session is None:
        raise SessionNotFoundError(session_id)
    return session


def delete_session(session_id: str) -> bool:
    """Delete a session and its messages. Audit rows are untouched.

    They live in a different file, which is the point — see `paths.py`. The
    message cascade relies on `PRAGMA foreign_keys`, which `sqlite_util`
    enables on every connection.
    """
    init_db()

    def _write() -> bool:
        with sqlite_util.transaction(DB_PATH) as conn:
            cursor = conn.execute(
                "DELETE FROM chat_sessions WHERE session_id = ?", (session_id,)
            )
            return cursor.rowcount > 0

    return sqlite_util.with_retry(_write, what="delete_session")


def set_summary(session_id: str, summary: str, upto_seq: int) -> None:
    """Record the rolling summary of turns up to `upto_seq`.

    Written by the background summariser after a response has been sent —
    never on the request path, where it would spend the latency budget the
    <3s target is measured against.
    """
    init_db()
    clean = summary.strip()[:MAX_SUMMARY_CHARS]

    def _write() -> None:
        with sqlite_util.transaction(DB_PATH) as conn:
            cursor = conn.execute(
                "UPDATE chat_sessions SET summary = ?, summary_upto_seq = ? "
                "WHERE session_id = ?",
                (clean, max(0, upto_seq), session_id),
            )
            if cursor.rowcount == 0:
                raise SessionNotFoundError(session_id)

    sqlite_util.with_retry(_write, what="set_summary")


def purge_ephemeral() -> int:
    """Delete every incognito session. Returns how many went.

    Called at startup and shutdown. A process restart ends an incognito
    session by definition — that is what incognito means — and sweeping at
    boot also clears anything a crash left behind.
    """
    init_db()

    def _write() -> int:
        with sqlite_util.transaction(DB_PATH) as conn:
            return conn.execute(
                "DELETE FROM chat_sessions WHERE ephemeral = 1"
            ).rowcount

    return sqlite_util.with_retry(_write, what="purge_ephemeral")


# ── messages ─────────────────────────────────────────────────────────────────


def append_message(
    session_id: str,
    role: str,
    content: str,
    *,
    query_id: str | None = None,
    evidence: Any = None,
) -> dict[str, Any]:
    """Append one message and return it, including its allocated `seq`.

    Allocation is `MAX(seq) + 1` computed inside the same `BEGIN IMMEDIATE`
    transaction that inserts, so no second writer can read the same maximum.
    The unique index on `(session_id, seq)` is the backstop if that reasoning
    is ever wrong: a duplicate fails loudly instead of scrambling the order.
    """
    if role not in ROLES:
        raise ValueError(f"role must be one of {ROLES}, got {role!r}")
    if len(content.encode("utf-8")) > MAX_CONTENT_BYTES:
        raise ContentTooLargeError(
            f"message exceeds {MAX_CONTENT_BYTES} bytes"
        )

    init_db()
    now = _now()
    evidence_json = (
        json.dumps(evidence, separators=(",", ":")) if evidence is not None else None
    )
    tokens = estimate_tokens(content)
    # Only a user message names an untitled chat; an assistant message passes
    # NULL so COALESCE leaves the existing title alone.
    candidate_title = derive_title(content) if role == "user" else None

    def _write() -> dict[str, Any]:
        with sqlite_util.transaction(DB_PATH) as conn:
            exists = conn.execute(
                "SELECT 1 FROM chat_sessions WHERE session_id = ?", (session_id,)
            ).fetchone()
            if exists is None:
                raise SessionNotFoundError(session_id)

            cursor = conn.execute(
                """
                INSERT INTO chat_messages
                    (session_id, seq, role, content, query_id,
                     evidence_json, token_estimate, created_at)
                VALUES (
                    ?,
                    (SELECT COALESCE(MAX(seq), 0) + 1
                       FROM chat_messages WHERE session_id = ?),
                    ?, ?, ?, ?, ?, ?
                )
                """,
                (
                    session_id,
                    session_id,
                    role,
                    content,
                    query_id,
                    evidence_json,
                    tokens,
                    now,
                ),
            )
            conn.execute(
                "UPDATE chat_sessions "
                "   SET updated_at = ?, title = COALESCE(title, ?) "
                " WHERE session_id = ?",
                (now, candidate_title, session_id),
            )
            row = conn.execute(
                "SELECT * FROM chat_messages WHERE id = ?", (cursor.lastrowid,)
            ).fetchone()
            return _message_row(row)

    return sqlite_util.with_retry(_write, what="append_message")


def get_messages(
    session_id: str,
    *,
    after_seq: int = 0,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    """Messages in order.

    `after_seq` is what the prompt builder uses to skip turns already folded
    into the rolling summary; `limit` caps a very long transcript for display.
    """
    init_db()
    sql = (
        "SELECT * FROM chat_messages "
        "WHERE session_id = ? AND seq > ? ORDER BY seq ASC"
    )
    params: list[Any] = [session_id, after_seq]
    if limit is not None:
        sql += " LIMIT ?"
        params.append(max(1, limit))
    with sqlite_util.connect(DB_PATH) as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_message_row(row) for row in rows]


def get_recent_messages(session_id: str, *, count: int) -> list[dict[str, Any]]:
    """The last `count` messages, still in ascending order.

    Ordering descending to take the tail and reversing in Python keeps SQLite
    on the `(session_id, seq)` index instead of scanning the whole transcript.
    """
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT * FROM chat_messages WHERE session_id = ? "
            "ORDER BY seq DESC LIMIT ?",
            (session_id, max(1, count)),
        ).fetchall()
    return [_message_row(row) for row in reversed(rows)]


def stats() -> dict[str, Any]:
    """Row counts for the Settings → Databases panel."""
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        return {
            "sessions": conn.execute(
                "SELECT COUNT(*) AS n FROM chat_sessions"
            ).fetchone()["n"],
            "messages": conn.execute(
                "SELECT COUNT(*) AS n FROM chat_messages"
            ).fetchone()["n"],
            "ephemeral": conn.execute(
                "SELECT COUNT(*) AS n FROM chat_sessions WHERE ephemeral = 1"
            ).fetchone()["n"],
        }
