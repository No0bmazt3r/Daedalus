"""Memory and the interface — `manage_memory` and `ui_control`.

Both were on the "not offered" list for reasons that turn out to be about *how*
rather than *whether*.

## `manage_memory` writes to the audit store, and never to the corpus

The objection was that a model adding to its own knowledge base could add
something nobody approved, and that Track 1 and Track 2 would stop being
comparable to what was ingested. That objection survives intact and is the
design here: this writes to `memory_logs` in the audit database, which is a
different store from the corpus and a different store from the graph. Neither
retrieval track reads it. Nothing here can become a citation.

What it is for is the thing conversation memory genuinely needs — *"the operator
prefers pressures in bar"*, *"this loop was serviced on Tuesday"* — facts about
working with a person rather than facts about the plant.

`forget` sets `expires_at` rather than removing the row. `ai_logs.db` is
append-only evidence, and a memory that was acted on and later withdrawn is more
useful to a trace than one that quietly vanished.

## `ui_control` proposes rather than acts

*"What is on screen should be what the operator put there"* was the objection,
and it is right about the screen. So the navigation half returns an intent — the
UI decides whether to honour it, exactly as `ask_user` returns a question rather
than blocking on an answer. The one thing it does write is a display preference,
which is reversible, visible, and nobody's evidence.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Any

from ....db import audit_store, prefs_store, sqlite_util
from ....db.paths import AUDIT_DB
from ..registry import Effect, Integrity, Param, ToolError, register

_MEMORY_KINDS = ("fact", "preference", "summary")
_MAX_RECALL = 20

# The panels a tool may ask the UI to open. A whitelist, so a hallucinated panel
# name is an error rather than a blank screen.
_PANELS = ("services", "added-models", "hardware", "databases", "knowledge",
           "search", "tools", "appearance", "shortcuts")

_SCALES = ("100", "125")


@register(
    name="manage_memory",
    category="knowledge",
    summary=(
        "Remember, recall or withdraw a working fact about the operator or the session "
        "— preferences and context, never plant data. Retrieval never reads these."
    ),
    effects={Effect.WRITE},
    integrity=Integrity.TRANSCRIPT,
    citable=False,
    params=(
        Param("action", str, "What to do.", required=True, enum=("remember", "recall", "forget")),
        Param("content", str, "The fact, for `remember`.", default=None, max_length=1000),
        Param("kind", str, "What sort of memory.", default="fact", enum=_MEMORY_KINDS),
        Param("session_id", str, "Scope it to one conversation.", default=None, max_length=100),
        Param("query", str, "Substring to match, for `recall`.", default=None, max_length=200),
        Param("memory_id", str, "Which memory, for `forget`.", default=None, max_length=100),
    ),
)
def manage_memory(
    action: str,
    content: str | None,
    kind: str,
    session_id: str | None,
    query: str | None,
    memory_id: str | None,
) -> dict[str, Any]:
    audit_store.init_db()
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    if action == "remember":
        if not content:
            raise ToolError("remember needs content")
        new_id = f"mem_{secrets.token_hex(6)}"
        audit_store.log(
            "memory_logs",
            memory_id=new_id,
            session_id=session_id,
            kind=kind,
            content=content,
            source="manage_memory tool",
        )
        return {"data": {"memory_id": new_id, "kind": kind}, "detail": f"remembered as {new_id}"}

    if action == "forget":
        if not memory_id:
            raise ToolError("forget needs a memory_id")
        with sqlite_util.transaction(AUDIT_DB) as conn:
            cursor = conn.execute(
                "UPDATE memory_logs SET expires_at = ? "
                "WHERE memory_id = ? AND expires_at IS NULL",
                (now, memory_id),
            )
        if not cursor.rowcount:
            return {"data": None, "detail": f"no active memory with id {memory_id!r}"}
        return {"data": {"memory_id": memory_id}, "detail": f"withdrew {memory_id}"}

    # recall. Every clause is a fixed string and every value is a bound
    # parameter — the only thing the caller influences is which clauses apply.
    clauses = ["(expires_at IS NULL OR expires_at > ?)"]
    params: list[Any] = [now]
    if session_id:
        clauses.append("session_id = ?")
        params.append(session_id)
    if query:
        clauses.append("content LIKE ?")
        params.append(f"%{query}%")
    params.append(_MAX_RECALL)

    statement = (
        "SELECT memory_id, kind, content, session_id, timestamp FROM memory_logs "
        f"WHERE {' AND '.join(clauses)} ORDER BY id DESC LIMIT ?"
    )
    with sqlite_util.connect(AUDIT_DB) as conn:
        rows = conn.execute(statement, params).fetchall()

    memories = [
        {
            "memory_id": r["memory_id"],
            "kind": r["kind"],
            "content": r["content"],
            "session_id": r["session_id"],
            "remembered_at": r["timestamp"],
        }
        for r in rows
    ]
    return {
        "data": {"memories": memories},
        "detail": f"{len(memories)} memories" if memories else "nothing remembered matches that",
    }


@register(
    name="ui_control",
    category="other",
    summary=(
        "Ask the operator's interface to open a panel, or set a display preference. "
        "Navigation is a request the UI may decline, not an action."
    ),
    effects={Effect.WRITE},
    params=(
        Param("action", str, "What to do.", required=True, enum=("open_panel", "set_scale")),
        Param("panel", str, "Which settings panel, for `open_panel`.",
              default=None, enum=_PANELS),
        Param("scale", str, "Interface scale, for `set_scale`.", default=None, enum=_SCALES),
    ),
)
def ui_control(action: str, panel: str | None, scale: str | None) -> dict[str, Any]:
    """A request for the screen, or one reversible preference.

    `open_panel` writes nothing. It returns an intent with `awaiting_ui`, the
    same shape `ask_user` uses, and the front end decides. On a monitoring
    console the screen belongs to the operator, and the difference between
    suggesting a panel and yanking them to one is the difference between a tool
    and an interruption.
    """
    if action == "open_panel":
        if not panel:
            raise ToolError("open_panel needs a panel")
        return {
            "data": {"intent": "open_panel", "panel": panel, "awaiting_ui": True},
            "detail": f"asked the interface to open {panel}",
        }

    if not scale:
        raise ToolError("set_scale needs a scale")
    prefs_store.set_pref("ui-scale", scale)
    return {
        "data": {"setting": "ui-scale", "value": scale},
        "detail": f"interface scale set to {scale}%",
    }
