"""The agent tool layer — Layer 8, and the boundary Rule 3 is enforced on.

Five categories, and what each one is for:

| Category | What it answers | Integrity of what it returns |
|---|---|---|
| `search` | "What does the corpus say about X?" | corpus text — untrusted, citable |
| `knowledge` | "What do we know, and what don't we?" | system + graph — trusted |
| `session` | "What was said before?" | transcript — untrusted **and** stale |
| `system` | "Is the machinery working?" | system — trusted |
| `other` | The clock, and asking rather than guessing | system |

`PROJECT.md` §7.2's sensor tools (`get_live_reading`, `get_trend`,
`get_anomaly_summary`) are not here. They are M3's, they read the telemetry of
record, and they deserve their own module and their own review — the registry
already carries a `READ_SENSOR` effect for them so that adding them is a
registration rather than a redesign.

Importing this package registers every tool. That is the only place the
registry is populated, so a tool that is not imported here does not exist as far
as the dispatcher is concerned — which is the intended way to retire one.
"""

from __future__ import annotations

from . import knowledge, other, search, session, system  # noqa: F401 — registration
from . import extended  # noqa: F401 — registers the unlockable tools, refused until unlocked
from .registry import (
    CATEGORIES,
    EXCLUDED,
    Effect,
    Integrity,
    Param,
    Surface,
    Tool,
    ToolError,
    ToolNotFound,
    ToolRefused,
    call,
    catalogue,
    get,
    render_all,
    render_for_prompt,
    schemas,
)

__all__ = [
    "CATEGORIES",
    "EXCLUDED",
    "Effect",
    "Integrity",
    "Param",
    "Surface",
    "Tool",
    "ToolError",
    "ToolNotFound",
    "ToolRefused",
    "call",
    "catalogue",
    "get",
    "render_all",
    "render_for_prompt",
    "schemas",
]
