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
import math
from typing import Any

from ..db import audit_store, chat_store
from . import thread_settings
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


def status(row: dict[str, Any], settings: dict[str, Any] | None = None) -> str:
    """One word for how a turn ended — the list's badge.

    `error` the model call or the pipeline failed · `refused` the safety guard
    stopped it · `no_model` answered by the pipeline alone (out of scope, a
    clarifying question) · `blocked` the validator replaced the answer with the
    fallback · `grounded` passed, and met what Settings → Ariadne's Thread says
    grounded requires (by default: had evidence and cited it, the validator's
    own definition) · `ungrounded` passed but did not.
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
    s = settings or thread_settings.DEFAULTS
    # The validator only accepts citations the evidence issued, so citing implies evidence.
    cited = bool(validation.get("cited"))
    had_evidence = cited or (row.get("ok_tool_count") or 0) > 0
    if (cited or not s["require_citation"]) and (had_evidence or not s["require_evidence"]):
        return "grounded"
    return "ungrounded"


def chat_of(row: dict[str, Any], sessions: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    """Which chat a turn came from, as the list and the trace name it.

    `exists` is False once the chat was deleted (or purged, if incognito): the
    audit row outlives it, so the Thread can say where a turn came from but
    not open it. An incognito turn says so even after its chat is purged,
    because its question was stored as `audit_store.REDACTED`.
    """
    session_id = row.get("session_id")
    if not session_id:
        return None
    session = sessions.get(session_id)
    return {
        "session_id": session_id,
        "title": ((session or {}).get("title") or "").strip() or None,
        "exists": session is not None,
        "incognito": bool(session and session.get("ephemeral")) or row.get("user_query") == audit_store.REDACTED,
    }


def summary(
    row: dict[str, Any],
    sessions: dict[str, dict[str, Any]] | None = None,
    settings: dict[str, Any] | None = None,
    label: dict[str, Any] | None = None,
) -> dict[str, Any]:
    s = settings or thread_settings.read()
    question = row.get("user_query") or ""
    turn_status = status(row, s)
    return {
        "query_id": row["query_id"],
        "timestamp": row["timestamp"],
        "session_id": row.get("session_id"),
        "chat": chat_of(row, sessions or {}),
        "question": question[:200],
        "intent": row.get("intent"),
        "model": row.get("model_used"),
        "status": turn_status,
        "bucket": s["buckets"][turn_status],
        # What the validator recorded, whatever the settings say.
        "grounded": None if row.get("grounded_flag") is None else bool(row["grounded_flag"]),
        "latency_ms": row.get("total_latency_ms"),
        "tool_count": row.get("tool_count", 0),
        "retrieval_count": row.get("retrieval_count", 0),
        "error_count": row.get("error_count", 0),
        "tracks": [t for t in (row.get("tracks") or "").split(",") if t],
        "label": label,
    }


def _percentile(values: list[int], p: float) -> int | None:
    """Nearest-rank percentile — the same definition `evaluation.py` reports."""
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, min(len(ordered) - 1, math.ceil(len(ordered) * p / 100) - 1))]


def _stats(items: list[dict[str, Any]]) -> dict[str, Any]:
    by_status: dict[str, int] = {}
    by_bucket: dict[str, int] = {}
    for t in items:
        by_status[t["status"]] = by_status.get(t["status"], 0) + 1
        by_bucket[t["bucket"]] = by_bucket.get(t["bucket"], 0) + 1
    latencies = [t["latency_ms"] for t in items if t["latency_ms"] is not None]
    labelled = [t for t in items if t["label"]]
    return {
        "total": len(items),
        "by_status": by_status,
        "by_bucket": by_bucket,
        "latency_p50_ms": _percentile(latencies, 50),
        "latency_p95_ms": _percentile(latencies, 95),
        "labelled": len(labelled),
        "hallucinated": sum(1 for t in labelled if t["label"]["hallucinated"]),
    }


def recent(
    *,
    limit: int = 50,
    offset: int = 0,
    bucket: str | None = None,
    labelled: str | None = None,
    **filters: Any,
) -> dict[str, Any]:
    """A page of turns, plus figures over *every* turn the filters match.

    Classified here rather than in SQL, because the bucket a turn falls in is a
    setting (`thread_settings`).
    """
    # ponytail: classifies every matching turn in Python on each read; fine for
    # thousands, move the status into SQL if the audit log reaches the millions.
    settings = thread_settings.read()
    labels = audit_store.latest_labels()
    items = [summary(r, None, settings, labels.get(r["query_id"])) for r in audit_store.recent_queries(**filters)]
    if bucket:
        items = [t for t in items if t["bucket"] == bucket]
    if labelled == "yes":
        items = [t for t in items if t["label"]]
    elif labelled == "no":
        items = [t for t in items if not t["label"]]
    page = items[offset:offset + limit]
    sessions = chat_store.sessions_by_id([t["session_id"] for t in page])
    for t in page:
        t["chat"] = chat_of({"session_id": t["session_id"], "user_query": t["question"]}, sessions)
    return {
        "items": page, "total": len(items), "stats": _stats(items),
        # How Settings files the statuses, so the filters can say what each holds.
        "labels": settings["labels"], "buckets": settings["buckets"],
    }


def set_label(query_id: str, hallucinated: bool | None, note: str | None) -> dict[str, Any] | None:
    """Record a person's verdict on a logged answer; returns the label now in force (None once withdrawn)."""
    rows = audit_store.trace(query_id).get("conversation_logs") or [{}]
    audit_store.add_label(query_id, hallucinated, note, rows[-1].get("session_id"))
    return audit_store.latest_labels([query_id]).get(query_id)


# ── the trace ────────────────────────────────────────────────────────────────


_KIND_TABLE = {
    "query": "conversation_logs", "understanding": "conversation_logs", "tool": "tool_logs",
    "retrieval": "rag_logs", "context": "memory_logs", "model": "model_logs",
    "validation": "conversation_logs", "answer": "conversation_logs", "error": "error_logs",
    "feedback": "feedback_logs", "label": "feedback_logs",
}


def _counts(rows: dict[str, list[dict[str, Any]]]) -> dict[str, int]:
    """The per-turn counts `recent_queries` computes in SQL, from a trace's rows."""
    tools = rows.get("tool_logs") or []
    return {
        "tool_count": len(tools),
        "ok_tool_count": sum(1 for t in tools if t.get("status") == "ok"),
        "retrieval_count": len(rows.get("rag_logs") or []),
        "error_count": len(rows.get("error_logs") or []),
    }


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
                "prompt_sha256": model.get("prompt_sha256"),
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

    feedback = rows.get("feedback_logs") or []
    labels = [f for f in feedback if f.get("evaluator_role") == audit_store.LABEL_ROLE]
    if labels:
        last = labels[-1]
        score = last.get("correctness_score")
        steps.append(_step(
            "label", {0: "Labelled: hallucinated", 1: "Labelled: correct"}.get(score, "Label withdrawn"),
            at=last.get("timestamp"), status="error" if score == 0 else "ok",
            detail={"note": last.get("comment"), "history": len(labels)},
        ))

    ratings = [f for f in feedback if f.get("rating") is not None]
    if ratings:
        rating = ratings[-1]["rating"]
        steps.append(_step(
            "feedback", {1: "Rated helpful", -1: "Rated unhelpful"}.get(rating, "Rating withdrawn"),
            at=ratings[-1].get("timestamp"), detail={"rating": rating, "history": len(ratings)},
        ))

    # Where each step's row lives, so the UI can point at it in Data stores.
    for step in steps:
        step["table"] = _KIND_TABLE.get(step["kind"])

    return {
        "query_id": query_id,
        "summary": summary(
            {**convo, **_counts(rows), "query_id": query_id,
             "tracks": ",".join(sorted({r.get("track") or "" for r in rows.get("rag_logs") or []} - {""}))},
            chat_store.sessions_by_id([convo.get("session_id")]),
            thread_settings.read(),
            audit_store.latest_labels([query_id]).get(query_id),
        ) if convo else None,
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
    trace_rows = audit_store.trace(query_id)
    rows = trace_rows.get("conversation_logs")
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
        "status": status({**convo, **_counts(trace_rows)}, thread_settings.read()),
        # An incognito turn kept no text, so there is nothing to mark.
        "redacted": answer == audit_store.REDACTED,
        "grounded": None if convo.get("grounded_flag") is None else bool(convo["grounded_flag"]),
        "validation": validation,
        "numbers": marks,
        "counts": counts,
        "citations": [{"label": c, "line": lines.get(c)} for c in cited],
        "evidence_available": message is not None,
    }
