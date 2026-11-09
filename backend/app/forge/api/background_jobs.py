"""Settings → Background Jobs: which model names chats and which summarises them.

See `forge/background_models.py` for why each job has its own model and why
only local models are accepted.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, HTTPException

from .. import background_models
from ...chat import job_runs, persona
from ...db import chat_store

router = APIRouter(prefix="/api/background-jobs", tags=["background-jobs"])


@router.get("")
def read() -> dict[str, Any]:
    """The config, the local models a job may use, and what each job resolves to now."""
    return background_models.status()


@router.put("")
def write(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Change either job. Fields left out keep their current value."""
    try:
        background_models.write(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return background_models.status()


@router.get("/runs")
def runs() -> dict[str, Any]:
    """Each job's recent runs, newest first, with the chat each was on.

    In memory since the backend started (`chat/job_runs.py`). An incognito
    chat's title is never sent: Settings is not off the record.
    """
    recent = job_runs.recent()
    ids = sorted({r["session_id"] for rs in recent.values() for r in rs})
    try:
        sessions = chat_store.sessions_by_id(ids)
    except Exception:  # noqa: BLE001 — the list is still useful without titles
        sessions = {}
    for rs in recent.values():
        for r in rs:
            s = sessions.get(r["session_id"])
            r["chat"] = (
                None if s is None
                else {"incognito": True, "title": None} if s.get("ephemeral")
                else {"incognito": False, "title": chat_store.capitalised(s.get("title"))}
            )
            if r["chat"] and r["chat"]["incognito"]:
                r["session_id"] = None
    return {"runs": recent, "persona_enabled": persona.enabled(), "keep": job_runs.KEEP}
