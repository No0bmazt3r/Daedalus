"""Which forbidden effects the runtime tool surface may use, and why.

The gate in `services/agent_tools/registry` refuses `network_egress`, `write`,
`admin` and `execute_code` on the runtime surface. This store is the only thing
that can lift one of those refusals, and it is empty by default.

## Open by default, and why the machinery still exists

005 seeds all four effects open. Daedalus is a single-operator console: the
person who would unlock these is the person who built them, and four
confirmation clicks between them and their own tools protect nobody.

What the table is still for:

1. **The gate is exercised rather than theoretical.** Locking an effect is one
   click, it takes effect on the next call, and the refusal path runs in
   production rather than only in a test.
2. **`PROJECT.md` §3's configuration is reachable.** *Lock all* returns the
   system to the fully-offline, read-only shape the report describes — which is
   what to do before recording a groundedness number intended to be cited.
3. **`unlocked_at` and `note` answer the question that mattered:** what was this
   system allowed to do when that benchmark was recorded? A code flag or an
   environment variable cannot be read back off a running instance months later;
   a row can, and the catalogue stamps it onto every response.

An absent row still means locked, so a database restored from before 004 or a
half-applied migration fails closed rather than open.
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any, Final

from . import migrations, sqlite_util
from .paths import PREFS_DB

DB_PATH = PREFS_DB
STORE = "prefs"

# Mirrors the CHECK in 004. Kept here as well so a bad value is rejected with a
# readable message instead of an IntegrityError from the driver.
UNLOCKABLE: Final[tuple[str, ...]] = ("network_egress", "write", "admin", "execute_code")

MAX_NOTE_CHARS: Final = 500

_init_lock = threading.Lock()
_initialised = False


class ToolPolicyError(RuntimeError):
    """An unlock that cannot be written — maps to 400."""


def init_db() -> None:
    global _initialised
    with _init_lock:
        if _initialised:
            return
        migrations.migrate(STORE)
        _initialised = True


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def unlocked() -> dict[str, dict[str, Any]]:
    """Currently unlocked effects, keyed by effect. Empty is the default."""
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        rows = conn.execute("SELECT * FROM tool_policy").fetchall()
    return {
        row["effect"]: {"effect": row["effect"], "unlocked_at": row["unlocked_at"], "note": row["note"]}
        for row in rows
    }


def unlock(effect: str, note: str) -> dict[str, Any]:
    """Permit one effect on the runtime surface, with a reason."""
    if effect not in UNLOCKABLE:
        raise ToolPolicyError(f"{effect!r} is not an unlockable effect; expected one of {', '.join(UNLOCKABLE)}")
    note = (note or "").strip()
    if not note:
        raise ToolPolicyError("an unlock needs a reason — it is what makes it reviewable later")

    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT INTO tool_policy (effect, unlocked_at, note) VALUES (?, ?, ?)
            ON CONFLICT(effect) DO UPDATE SET unlocked_at = excluded.unlocked_at, note = excluded.note
            """,
            (effect, _now(), note[:MAX_NOTE_CHARS]),
        )
        conn.commit()
    return unlocked()[effect]


def lock(effect: str) -> bool:
    """Take the permission away again. True when something was actually removed."""
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        cursor = conn.execute("DELETE FROM tool_policy WHERE effect = ?", (effect,))
        conn.commit()
        return cursor.rowcount > 0


def lock_all() -> int:
    """Back to the project's default. Returns how many were open."""
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        cursor = conn.execute("DELETE FROM tool_policy")
        conn.commit()
        return cursor.rowcount
