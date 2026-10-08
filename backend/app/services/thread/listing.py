"""The Thread's list: how each turn ended, which bucket it is filed in, and the figures.

`status()` is the one place a turn's outcome is decided; Settings →
Ariadne's Thread (`thread_settings`) only decides what "grounded" requires and
which bucket each outcome goes in.
"""

from __future__ import annotations

import math
from typing import Any

from ...db import audit_store, chat_store
from .. import thread_settings
from .common import parse_json


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
    validation = parse_json(row.get("validation_json"))
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
    status: str | None = None,
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
    if status:
        items = [t for t in items if t["status"] == status]
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
