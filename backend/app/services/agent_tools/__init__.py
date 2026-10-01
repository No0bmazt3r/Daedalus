"""The agent tool layer — Layer 8, and the boundary Rule 3 is enforced on.

Six categories, and what each one is for:

| Category | What it answers | Integrity of what it returns |
|---|---|---|
| `sensor` | "What is / was the reactor reading?" | system — trusted, the only source of a number |
| `search` | "What does the corpus say about X?" | corpus text — untrusted, citable |
| `knowledge` | "What do we know, and what don't we?" | system + graph — trusted |
| `session` | "What was said before?" | transcript — untrusted **and** stale |
| `system` | "Is the machinery working?" | system — trusted |
| `other` | The clock, and asking rather than guessing | system |

`PROJECT.md` §7.2's sensor tools (`get_live_reading`, `get_trend`) live in
`sensor.py`, in their own module because they
read the telemetry of record and deserve their own review. They declare only
`READ_SENSOR`, which the gate permits on the runtime surface.

§7.2's fourth tool, `rag_retrieve`, is deliberately *two* tools here —
`search_corpus` (Track 1) and `search_graph` (Track 2) — with the registry
offering only the selected track's. The orchestrator asks for "retrieval" and
the planner picks whichever the gate allows (`services/orchestration/planner`).

Importing this package registers every tool. That is the only place the
registry is populated, so a tool that is not imported here does not exist as far
as the dispatcher is concerned — which is the intended way to retire one.
"""

from __future__ import annotations

from . import knowledge, other, search, sensor, session, system  # noqa: F401 — registration
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
