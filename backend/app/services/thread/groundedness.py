"""Every number in the answer, marked against the evidence — mirroring the validator."""

from __future__ import annotations

from typing import Any

from ...db import audit_store, chat_store
from .. import thread_settings
from ..orchestration import numbers
from .common import counts as turn_counts
from .common import parse_json
from .listing import status

# The validator's threshold for a count that is not a measurement (`_SMALL_INT`).
_SMALL_INT = 10


def groundedness(query_id: str) -> dict[str, Any] | None:
    """Every quantity in the answer the model wrote, marked. None for an unknown id.

    Verdicts: `supported` (green), `unsupported` (red, a Rule 3 violation),
    `stale` (amber — found only in replayed history), `not_a_claim` (grey — a
    small count or the question's own number), `unchecked` (no validation ran:
    no model, or the call failed).
    """
    trace_rows = audit_store.trace(query_id)
    rows = trace_rows.get("conversation_logs")
    if not rows:
        return None
    convo = rows[-1]
    validation = parse_json(convo.get("validation_json"))
    validation = validation if isinstance(validation, dict) else None
    # What the model said, which is what is being judged — when the validator
    # replaced it, the operator saw the fallback instead.
    answer = convo.get("model_response_text") or convo.get("response_text") or ""
    message = chat_store.message_for_query(query_id)
    evidence = message.get("evidence") if message else None
    lines: dict[str, str] = (evidence.get("lines") or {}) if isinstance(evidence, dict) else {}
    line_values = {label: numbers.values(line) for label, line in lines.items()}
    asked = numbers.values(convo.get("standalone_query") or convo.get("user_query") or "")
    unsupported = set((validation or {}).get("unsupported_numbers") or [])
    stale = set((validation or {}).get("stale_numbers") or [])

    marks: list[dict[str, Any]] = []
    for n, start, end in numbers.spans(answer):
        sources = [
            {"label": label, "line": lines[label]}
            for label, values in line_values.items() if numbers.supported(n, values)
        ]
        if validation is None:
            verdict, reason = "unchecked", "no validation ran for this turn"
        elif n.text in stale:
            verdict, reason = "stale", "found only in the replayed history, not this turn's evidence"
        elif n.text in unsupported:
            verdict, reason = "unsupported", "in no tool output or retrieved passage"
        elif n.decimals == 0 and n.value <= _SMALL_INT and n.unit is None:
            verdict, reason = "not_a_claim", "a small count, not a measurement"
        elif n.value in asked:
            verdict, reason = "not_a_claim", "the question's own number"
        elif sources:
            verdict, reason = "supported", "in the evidence"
        else:
            verdict, reason = "supported", "in an unlabelled part of the evidence"
        marks.append({
            "text": n.text, "start": start, "end": end, "value": n.value, "unit": n.unit,
            "verdict": verdict, "reason": reason, "sources": sources,
        })

    counts: dict[str, int] = {}
    for m in marks:
        counts[m["verdict"]] = counts.get(m["verdict"], 0) + 1
    cited = (validation or {}).get("cited") or []
    return {
        "query_id": query_id,
        "answer": answer,
        "delivered": convo.get("response_text"),
        "replaced": bool(convo.get("model_response_text")),
        "status": status({**convo, **turn_counts(trace_rows)}, thread_settings.read()),
        # An incognito turn kept no text, so there is nothing to mark.
        "redacted": answer == audit_store.REDACTED,
        "grounded": None if convo.get("grounded_flag") is None else bool(convo["grounded_flag"]),
        "validation": validation,
        "numbers": marks,
        "counts": counts,
        "citations": [{"label": c, "line": lines.get(c)} for c in cited],
        "evidence_available": message is not None,
    }
