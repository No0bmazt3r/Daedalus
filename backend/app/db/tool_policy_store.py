"""Which of the four extended effects are closed. Empty means everything is open.

The gate in `services/agent_tools/registry` can refuse `network_egress`,
`write`, `admin` and `execute_code` on the runtime surface. This store is what
tells it to, and it is empty by default.

## Why it records locks rather than unlocks

It used to be the other way round, with a migration seeding four rows to make
the default open. That works exactly once: *lock all* deletes the rows, and a
migration runs a single time, so the default never comes back — the console
silently reverts to fully-refused and stays there. A default that depends on a
one-time seed is not a default, it is an initial condition.

Recording locks makes "open" the meaning of an empty table, which is the right
default for a single-operator console where the operator is the admin, and it
makes restoring that default a delete — idempotent, and impossible to get
half-done.

## What is still worth recording

Closing an effect is now the event, and `locked_at` plus `note` capture it.
That is the direction that matters for the write-up anyway: before recording a
groundedness number you lock everything, and the rows are the evidence that you
did. `services/agent_tools` stamps the resulting policy onto every catalogue
response, so a screenshot of the panel carries the state it was taken in.
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any, Final

from . import migrations, sqlite_util
from .paths import PREFS_DB

DB_PATH = PREFS_DB
STORE = "prefs"

# Mirrors the CHECK in 006. Kept here as well so a bad value is rejected with a
# readable message instead of an IntegrityError from the driver.
UNLOCKABLE: Final[tuple[str, ...]] = ("network_egress", "write", "admin", "execute_code")

MAX_NOTE_CHARS: Final = 500

_init_lock = threading.Lock()
_initialised = False


class ToolPolicyError(RuntimeError):
    """A policy change that cannot be written — maps to 400."""


def init_db() -> None:
    global _initialised
    with _init_lock:
        if _initialised:
            return
        migrations.migrate(STORE)
        _initialised = True


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def locked() -> dict[str, dict[str, Any]]:
    """Effects currently refused at runtime, keyed by effect. Empty by default."""
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        rows = conn.execute("SELECT * FROM tool_locks").fetchall()
    return {
        row["effect"]: {
            "effect": row["effect"],
            "locked_at": row["locked_at"],
            "note": row["note"],
        }
        for row in rows
    }


def unlocked() -> dict[str, dict[str, Any]]:
    """Effects permitted at runtime — the complement of `locked()`.

    Derived rather than stored, which is the point of 006: there is one fact in
    the database and both views are computed from it, so they cannot disagree.
    """
    closed = locked()
    return {
        effect: {"effect": effect, "unlocked_at": None, "note": "open by default"}
        for effect in UNLOCKABLE
        if effect not in closed
    }


def lock(effect: str, note: str | None = None) -> dict[str, Any]:
    """Refuse one effect at runtime."""
    if effect not in UNLOCKABLE:
        raise ToolPolicyError(
            f"{effect!r} is not a lockable effect; expected one of {', '.join(UNLOCKABLE)}"
        )
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT INTO tool_locks (effect, locked_at, note) VALUES (?, ?, ?)
            ON CONFLICT(effect) DO UPDATE SET locked_at = excluded.locked_at, note = excluded.note
            """,
            (effect, _now(), (note or "").strip()[:MAX_NOTE_CHARS] or None),
        )
        conn.commit()
    return locked()[effect]


def lock_all(note: str | None = None) -> int:
    """Close all four — the fully-offline, read-only shape §3 describes."""
    for effect in UNLOCKABLE:
        lock(effect, note or "locked all from Settings → Agent Tools")
    return len(UNLOCKABLE)


def unlock(effect: str, note: str | None = None) -> bool:
    """Permit one effect again. True when something was actually reopened.

    `note` is accepted and ignored: unlocking is a delete, and there is nowhere
    for a reason to live on a row that no longer exists. The parameter stays so
    callers that want to explain themselves are not made to care where the
    explanation goes — the `tool_logs` row for whatever they run next is the
    record that matters.
    """
    if effect not in UNLOCKABLE:
        raise ToolPolicyError(
            f"{effect!r} is not a lockable effect; expected one of {', '.join(UNLOCKABLE)}"
        )
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        cursor = conn.execute("DELETE FROM tool_locks WHERE effect = ?", (effect,))
        conn.commit()
        return cursor.rowcount > 0


def unlock_all() -> int:
    """Back to the default. Returns how many were closed."""
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        cursor = conn.execute("DELETE FROM tool_locks")
        conn.commit()
        return cursor.rowcount


# ── per-tool on/off ──────────────────────────────────────────────────────────
# A second axis, and deliberately not the same one as above. The locks are a
# statement about this machine — what it is permitted to do while a result is
# being recorded. These are a statement about the *tool list*: which of the
# registered tools the model is offered at all. Closing `network_egress` to stop
# the model reaching for one tool would also close the three that share the
# effect, and turning one tool off says nothing about the safety envelope.
#
# Names are not validated here. The registry is the only authority on what a
# tool is called, and importing it from the database layer is the import cycle
# `registry._unlocked_effects` already goes out of its way to avoid — so the API
# resolves the name against the registry first, and this stores a string.


def disabled() -> dict[str, dict[str, Any]]:
    """Tools switched off, keyed by name. Empty by default."""
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        rows = conn.execute("SELECT * FROM tool_disabled").fetchall()
    return {
        row["tool"]: {
            "tool": row["tool"],
            "disabled_at": row["disabled_at"],
            "note": row["note"],
        }
        for row in rows
    }


def disable(tool: str, note: str | None = None) -> dict[str, Any]:
    """Stop offering one tool. The caller has already checked the name exists."""
    name = (tool or "").strip()
    if not name:
        raise ToolPolicyError("a tool name is required")
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT INTO tool_disabled (tool, disabled_at, note) VALUES (?, ?, ?)
            ON CONFLICT(tool) DO UPDATE SET
                disabled_at = excluded.disabled_at, note = excluded.note
            """,
            (name, _now(), (note or "").strip()[:MAX_NOTE_CHARS] or None),
        )
        conn.commit()
    return disabled()[name]


def enable(tool: str) -> bool:
    """Offer it again. True when something was actually switched back on."""
    name = (tool or "").strip()
    if not name:
        raise ToolPolicyError("a tool name is required")
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        cursor = conn.execute("DELETE FROM tool_disabled WHERE tool = ?", (name,))
        conn.commit()
        return cursor.rowcount > 0


def enable_all() -> int:
    """Back to the default — every registered tool offered. Returns how many."""
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        cursor = conn.execute("DELETE FROM tool_disabled")
        conn.commit()
        return cursor.rowcount
