"""One turn as an ordered chain: question → understanding → tools and retrieval →
evidence → context → model → validation → answer, then errors and labels."""

from __future__ import annotations

from typing import Any

from ...db import audit_store, chat_store
from .. import thread_settings
from ..orchestration.evidence import RETRIEVAL_TOOLS
from .common import counts, parse_json
from .listing import summary

_KIND_TABLE = {
    "query": "conversation_logs", "understanding": "conversation_logs", "tool": "tool_logs",
    "retrieval": "rag_logs", "context": "memory_logs", "model": "model_logs",
    "validation": "conversation_logs", "answer": "conversation_logs", "error": "error_logs",
    "feedback": "feedback_logs", "label": "feedback_logs",
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
            "input": parse_json(row.get("tool_input_json")),
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
            "chunk_ids": parse_json(row.get("retrieved_chunk_ids")),
            "scores": parse_json(row.get("retrieval_scores")),
            "source_files": parse_json(row.get("source_files")),
            "origins": parse_json(row.get("retrieved_origins")),
            "hop_count": row.get("hop_count"),
            "traversal_path": parse_json(row.get("traversal_path")),
            "entry_strategy": row.get("entry_strategy"),
            "candidates": row.get("candidate_count"),
            "rerank_model": row.get("rerank_model"),
            "rerank_scores": parse_json(row.get("rerank_scores")),
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
                "selected_tools": parse_json(convo.get("selected_tools")),
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
        content = parse_json(mem.get("content"))
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

    validation = parse_json(convo.get("validation_json"))
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
            {**convo, **counts(rows), "query_id": query_id,
             "tracks": ",".join(sorted({r.get("track") or "" for r in rows.get("rag_logs") or []} - {""}))},
            chat_store.sessions_by_id([convo.get("session_id")]),
            thread_settings.read(),
            audit_store.latest_labels([query_id]).get(query_id),
        ) if convo else None,
        "total_ms": convo.get("total_latency_ms"),
        "steps": steps,
        "evidence_available": message is not None,
    }
