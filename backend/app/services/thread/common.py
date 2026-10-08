"""Helpers shared by the Thread's modules."""

from __future__ import annotations

import json
from typing import Any


def parse_json(value: Any) -> Any:
    if not isinstance(value, str) or not value:
        return value
    try:
        return json.loads(value)
    except ValueError:
        return value


def counts(rows: dict[str, list[dict[str, Any]]]) -> dict[str, int]:
    """The per-turn counts `recent_queries` computes in SQL, from a trace's rows."""
    tools = rows.get("tool_logs") or []
    return {
        "tool_count": len(tools),
        "ok_tool_count": sum(1 for t in tools if t.get("status") == "ok"),
        "retrieval_count": len(rows.get("rag_logs") or []),
        "error_count": len(rows.get("error_logs") or []),
    }
