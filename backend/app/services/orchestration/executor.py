"""Step 6 of PROJECT.md §7.1: run the plan through the tool layer.

Every call goes through `agent_tools.call` on the runtime surface with the
turn's `query_id`. That one choice does most of the work: the registry
validates the arguments, applies the effect and track gates, writes a
`tool_logs` row per call and a `rag_logs` row per retrieval. The executor adds
nothing to those rules, so it cannot weaken them.

Track 2's multi-hop retrieval is one call (`graph_walk`), not a loop here: the
walk has to be one `TraversalPath` for Blueprints to replay it from one
`rag_logs` row. See `agent_tools/search.graph_walk`.

Calls run one after another. The sensor reads are milliseconds, and a
retrieval embedding the query is the only slow call — running them in parallel
would save little and make the order of `tool_logs` rows depend on timing.
"""

from __future__ import annotations

from typing import Any

from .. import agent_tools
from .planner import Plan


def execute(plan: Plan, query_id: str | None) -> list[dict[str, Any]]:
    """Every envelope the plan produced, in call order. Never raises.

    `query_id=None` runs the plan without writing any log row — for tests and
    for inspecting a plan by hand. The chat path always passes one.
    """
    envelopes: list[dict[str, Any]] = []
    for call in plan.calls:
        try:
            envelope = agent_tools.call(call.tool, call.arguments, query_id=query_id)
        except agent_tools.ToolNotFound as exc:
            envelope = {
                "tool": call.tool, "ok": False, "status": "not_found", "integrity": "system",
                "citable": False, "data": None, "detail": str(exc), "elapsed_ms": 0,
            }
        envelopes.append(envelope)
    return envelopes
