"""Ariadne's Thread — the provenance of one answer (MODULES.md §1.5).

Read-only, served from `ai_logs.db` and the transcript's stored evidence, and
never on the chat path. The logic lives in `services/thread.py`.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from ..db import sqlite_util
from ..services import thread

router = APIRouter(prefix="/api/trace", tags=["trace"])


@router.get("")
def recent(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session_id: str | None = None,
    intent: str | None = None,
    grounded: Literal["yes", "no", "unchecked"] | None = None,
    q: str | None = Query(default=None, max_length=200),
) -> dict:
    """Recent chat turns, newest first, filterable by chat, intent and verdict."""
    try:
        return thread.recent(
            limit=limit, offset=offset, session_id=session_id, intent=intent,
            grounded=grounded, search=q.strip() if q else None,
        )
    except sqlite_util.DatabaseUnavailableError as exc:
        raise HTTPException(status_code=503, detail=f"store unavailable: {exc}") from exc


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
