"""Ariadne's Thread — the provenance of one answer (MODULES.md §1.5).

Read-only toward the record: served from `ai_logs.db` and the transcript's
stored evidence, never on the chat path. Two writes, neither of which changes
what happened: a person's label on an answer (appended to `feedback_logs`),
and Settings → Ariadne's Thread (a preference). The logic lives in
`services/thread.py` and `services/thread_settings.py`.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Body, HTTPException, Query
from pydantic import BaseModel, Field

from ..db import audit_store, sqlite_util
from ..services import live_events, thread, thread_settings

router = APIRouter(prefix="/api/trace", tags=["trace"])

MAX_NOTE_CHARS = 2000


@router.get("")
def recent(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session_id: str | None = None,
    intent: str | None = None,
    model: str | None = None,
    track: Literal["vector", "graph"] | None = None,
    since: str | None = Query(default=None, max_length=40, description="ISO timestamp, inclusive"),
    until: str | None = Query(default=None, max_length=40, description="ISO timestamp, exclusive"),
    bucket: Literal["grounded", "ungrounded", "unchecked"] | None = None,
    status: Literal["grounded", "ungrounded", "blocked", "refused", "no_model", "error"] | None = None,
    labelled: Literal["yes", "no"] | None = None,
    q: str | None = Query(default=None, max_length=200),
) -> dict:
    """Recent chat turns, newest first, with figures over everything the filters match."""
    try:
        return thread.recent(
            limit=limit, offset=offset, bucket=bucket, status=status, labelled=labelled,
            session_id=session_id, intent=intent, model=model, track=track,
            since=since, until=until, search=q.strip() if q else None,
        )
    except sqlite_util.DatabaseUnavailableError as exc:
        raise HTTPException(status_code=503, detail=f"store unavailable: {exc}") from exc


# Declared before `/{query_id}` so "settings" is never read as an id.
@router.get("/settings")
def read_settings() -> dict[str, Any]:
    """Settings → Ariadne's Thread, with the defaults beside them for a reset."""
    return {"settings": thread_settings.read(), "defaults": thread_settings.DEFAULTS}


@router.put("/settings")
def write_settings(patch: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        settings = thread_settings.write(patch)
    except thread_settings.SettingsError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    # An open Thread window re-reads, so the new labels show at once.
    live_events.publish("trace")
    return {"settings": settings, "defaults": thread_settings.DEFAULTS}


@router.get("/{query_id}")
def trace(query_id: str) -> dict:
    """One turn as an ordered chain of steps."""
    result = thread.trace(query_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"no trace for '{query_id}'")
    return result


@router.get("/{query_id}/groundedness")
def groundedness(query_id: str) -> dict:
    """Every number in the answer, marked against the evidence."""
    result = thread.groundedness(query_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"no trace for '{query_id}'")
    return result


@router.get("/{query_id}/retrieval")
def retrieval(query_id: str) -> dict:
    """What this turn retrieved — chunks and their chunking (Track 1), or the walk (Track 2)."""
    result = thread.retrieval(query_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"no trace for '{query_id}'")
    return result


class LabelBody(BaseModel):
    #: True: the answer hallucinated. False: it did not. None: withdraw the label.
    hallucinated: bool | None
    note: str | None = Field(default=None, max_length=MAX_NOTE_CHARS)


@router.put("/{query_id}/label")
def label(query_id: str, body: LabelBody) -> dict:
    """A person's verdict on one answer — the evaluation's ground truth (MODULES.md §1.4)."""
    if not audit_store.has_query(query_id):
        raise HTTPException(status_code=404, detail=f"no trace for '{query_id}'")
    current = thread.set_label(query_id, body.hallucinated, body.note)
    live_events.publish("trace", query_id=query_id)
    # `label` is null once withdrawn.
    return {"query_id": query_id, "label": current}
