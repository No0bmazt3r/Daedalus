"""Ariadne's Thread — one chat turn, reassembled from the audit log (MODULES.md §1).

Three reads, all from `ai_logs.db` plus the evidence pack the transcript keeps
beside each answer:

- `recent()` — the turns, newest first, each with one status word.
- `trace()` — one turn as an ordered chain: question → understanding → tools
  and retrieval → evidence → context → model → validation → answer.
- `groundedness()` — every number in the answer, marked against the evidence.

## The verdict mirrors the validator, it does not re-decide

The validator (`orchestration/validator.py`) ran at answer time against the
whole of what the model was shown — labelled lines *and* the unlabelled series
samples and headers around them. The transcript keeps only the labelled lines.
Re-deciding here against that smaller set would mark a number red that the
validator rightly passed, and the Thread would contradict the record it is
meant to explain. So the stored verdict is the authority: a number it listed as
unsupported is red, as stale is amber, and every other quantity it checked is
green. What this module adds is *where* each green number came from — the
labelled line, or "an unlabelled part of the evidence" when no line carries it.

The same rules decide what is not a claim (a small bare count, a number from
the question), because the same `numbers` functions and thresholds are used.

## What it cannot show

- The assembled prompt. It is not stored; the evidence lines and the context
  record (`memory_logs`) are what was in it, minus the fixed instructions.
- Evidence for a turn whose chat was deleted or purged (incognito). The audit
  rows outlive the transcript by design, so the trace still reads, but the
  per-number sources and the evidence step are missing, and the response says
  so (`evidence_available: false`).
"""

from __future__ import annotations

import json
from typing import Any

from ..db import audit_store, chat_store
from .orchestration import numbers
from .orchestration.evidence import RETRIEVAL_TOOLS

# The validator's threshold for a count that is not a measurement (`_SMALL_INT`).
_SMALL_INT = 10


def _json(value: Any) -> Any:
    if not isinstance(value, str) or not value:
        return value
    try:
        return json.loads(value)
    except ValueError:
        return value


def status(row: dict[str, Any]) -> str:
    """One word for how a turn ended — the list's badge.

    `error` the model call or the pipeline failed · `refused` the safety guard
    stopped it · `no_model` answered by the pipeline alone (out of scope, a
    clarifying question) · `blocked` the validator replaced the answer with the
    fallback · `grounded` passed, had evidence and cited it · `ungrounded`
    passed but with no evidence cited.
    """
    if row.get("error_message"):
        return "error"
    if row.get("guard_reason"):
        return "refused"
    validation = _json(row.get("validation_json"))
    if not isinstance(validation, dict):
        return "no_model"
    if not validation.get("passed"):
        return "blocked"
    return "grounded" if row.get("grounded_flag") else "ungrounded"


def summary(row: dict[str, Any]) -> dict[str, Any]:
    question = row.get("user_query") or ""
    return {
        "query_id": row["query_id"],
        "timestamp": row["timestamp"],
        "session_id": row.get("session_id"),
        "question": question[:200],
        "intent": row.get("intent"),
        "model": row.get("model_used"),
        "status": status(row),
        "grounded": None if row.get("grounded_flag") is None else bool(row["grounded_flag"]),
        "latency_ms": row.get("total_latency_ms"),
        "tool_count": row.get("tool_count", 0),
        "retrieval_count": row.get("retrieval_count", 0),
        "error_count": row.get("error_count", 0),
    }


def recent(**filters: Any) -> dict[str, Any]:
    rows, total = audit_store.recent_queries(**filters)
    return {"items": [summary(r) for r in rows], "total": total}


# ── the trace ────────────────────────────────────────────────────────────────


def _step(kind: str, title: str, *, at: str | None = None, ms: int | None = None,
          status: str = "ok", detail: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"kind": kind, "title": title, "at": at, "ms": ms, "status": status,
            "detail": detail or {}}


def _tool_step(row: dict[str, Any]) -> dict[str, Any]:
    return _step(
        "tool", row["tool_name"], at=row["timestamp"], ms=row.get("latency_ms"),
        status=row.get("status") or "ok",
        detail={
            "input": _json(row.get("tool_input_json")),
            "output_summary": row.get("tool_output_summary"),
            "error": row.get("error_message"),
        },
    )


def _retrieval_step(row: dict[str, Any]) -> dict[str, Any]:
    ms = (row.get("retrieval_latency_ms") or 0) + (row.get("rerank_latency_ms") or 0)
    track = row.get("track") or "?"
    return _step(
        "retrieval", f"{track} retrieval", at=row["timestamp"], ms=ms or None,
        detail={
            "track": track,
            "query": row.get("query_text"),
            "top_k": row.get("top_k"),
            "store": row.get("vector_db_used"),
            "chunk_ids": _json(row.get("retrieved_chunk_ids")),
            "scores": _json(row.get("retrieval_scores")),
            "source_files": _json(row.get("source_files")),
            "origins": _json(row.get("retrieved_origins")),
            "hop_count": row.get("hop_count"),
            "traversal_path": _json(row.get("traversal_path")),
            "entry_strategy": row.get("entry_strategy"),
            "candidates": row.get("candidate_count"),
            "rerank_model": row.get("rerank_model"),
            "rerank_scores": _json(row.get("rerank_scores")),
            "retrieval_ms": row.get("retrieval_latency_ms"),
            "rerank_ms": row.get("rerank_latency_ms"),
        },
    )


def trace(query_id: str) -> dict[str, Any] | None:
    """The turn as an ordered list of steps, or None for an unknown id."""
    rows = audit_store.trace(query_id)
    if not rows:
        return None
    convo = (rows.get("conversation_logs") or [{}])[-1]
    message = chat_store.message_for_query(query_id)
    evidence = message.get("evidence") if message else None
    steps: list[dict[str, Any]] = []

    if convo:
        steps.append(_step("query", "Question", at=convo.get("timestamp"), detail={
            "question": convo.get("user_query"),
            "standalone": convo.get("standalone_query"),
            "rewrite_method": convo.get("rewrite_method"),
            "session_id": convo.get("session_id"),
        }))
        steps.append(_step(
            "understanding", f"Intent: {convo.get('intent') or 'none'}",
            status="refused" if convo.get("guard_reason") else "ok",
            detail={
                "intent": convo.get("intent"),
                "intent_method": convo.get("intent_method"),
                "guard_reason": convo.get("guard_reason"),
                "selected_tools": _json(convo.get("selected_tools")),
            },
        ))

    # Each retrieval tool writes its own `rag_logs` row, in the order the tools
    # ran, so the n-th retrieval row belongs to the n-th retrieval tool.
    retrievals = list(rows.get("rag_logs") or [])
    for tool in rows.get("tool_logs") or []:
        steps.append(_tool_step(tool))
        if tool["tool_name"] in RETRIEVAL_TOOLS and retrievals:
            steps.append(_retrieval_step(retrievals.pop(0)))
    steps.extend(_retrieval_step(r) for r in retrievals)

    if isinstance(evidence, dict) and (evidence.get("lines") or evidence.get("failures")):
        lines = evidence.get("lines") or {}
        steps.append(_step(
            "evidence", f"Evidence: {len(lines)} line{'s' if len(lines) != 1 else ''}",
            status="warning" if evidence.get("failures") else "ok",
            detail={
                "lines": lines,
                "failures": evidence.get("failures") or [],
                "notes": evidence.get("notes") or [],
                "no_documents": evidence.get("no_documents", False),
            },
        ))

    for mem in rows.get("memory_logs") or []:
        content = _json(mem.get("content"))
        replayed = content.get("replayed_messages") if isinstance(content, dict) else None
        steps.append(_step(
            "context", f"Context: {replayed} earlier message{'s' if replayed != 1 else ''}"
            if replayed is not None else "Context",
            at=mem.get("timestamp"), detail=content if isinstance(content, dict) else {"content": content},
        ))

    for model in rows.get("model_logs") or []:
        tokens = model.get("completion_token_count")
        steps.append(_step(
            "model", model.get("model_name") or "model", at=model.get("timestamp"),
            ms=model.get("total_inference_ms"), status=model.get("status") or "ok",
            detail={
                "prompt_tokens": model.get("prompt_token_count"),
                "completion_tokens": tokens,
                "prompt_chars": model.get("prompt_chars"),
                "time_to_first_token_ms": model.get("time_to_first_token_ms"),
                "prefill_ms": model.get("prefill_ms"),
                "generation_ms": model.get("generation_ms"),
                "load_ms": model.get("load_ms"),
                "source": model.get("source"),
                "host": model.get("host"),
                "error": model.get("error_message"),
            },
        ))

    validation = _json(convo.get("validation_json"))
    if isinstance(validation, dict):
        steps.append(_step(
            "validation", "Validation: passed" if validation.get("passed") else "Validation: failed",
            status="ok" if validation.get("passed") else "error", detail=validation,
        ))

    if convo:
        steps.append(_step(
            "answer", "Answer", at=convo.get("timestamp"), ms=convo.get("total_latency_ms"),
            status="error" if convo.get("error_message") else "ok",
            detail={
                "delivered": convo.get("response_text"),
                "model_text": convo.get("model_response_text"),
                "replaced": bool(convo.get("model_response_text")),
                "error": convo.get("error_message"),
            },
        ))

    for err in rows.get("error_logs") or []:
        steps.append(_step(
            "error", err.get("component") or "error", at=err.get("timestamp"),
            status=err.get("level") or "error",
            detail={"type": err.get("error_type"), "message": err.get("message"),
                    "stack": err.get("stack_trace")},
        ))

    ratings = [f for f in rows.get("feedback_logs") or [] if f.get("rating") is not None]
    if ratings:
        rating = ratings[-1]["rating"]
        steps.append(_step(
            "feedback", {1: "Rated helpful", -1: "Rated unhelpful"}.get(rating, "Rating withdrawn"),
            at=ratings[-1].get("timestamp"), detail={"rating": rating, "history": len(ratings)},
        ))

    return {
        "query_id": query_id,
        "summary": summary({**convo, "query_id": query_id,
                            "tool_count": len(rows.get("tool_logs") or []),
                            "retrieval_count": len(rows.get("rag_logs") or []),
                            "error_count": len(rows.get("error_logs") or [])})
        if convo else None,
        "total_ms": convo.get("total_latency_ms"),
        "steps": steps,
        "evidence_available": message is not None,
    }


# ── the groundedness check ──────────────────────────────────────────────────


def groundedness(query_id: str) -> dict[str, Any] | None:
    """Every quantity in the answer the model wrote, marked. None for an unknown id.

    Verdicts: `supported` (green), `unsupported` (red, a Rule 3 violation),
    `stale` (amber — found only in replayed history), `not_a_claim` (grey — a
    small count or the question's own number), `unchecked` (no validation ran:
    no model, or the call failed).
    """
    rows = audit_store.trace(query_id).get("conversation_logs")
    if not rows:
        return None
    convo = rows[-1]
    validation = _json(convo.get("validation_json"))
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
        "status": status(convo),
        "grounded": None if convo.get("grounded_flag") is None else bool(convo["grounded_flag"]),
        "validation": validation,
        "numbers": marks,
        "counts": counts,
        "citations": [{"label": c, "line": lines.get(c)} for c in cited],
        "evidence_available": message is not None,
    }
