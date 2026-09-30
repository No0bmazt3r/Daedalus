"""Settings → Background Jobs: which model names chats and which summarises them.

See `services/background_models.py` for why each job has its own model and why
only local models are accepted.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, HTTPException

from ..services import background_models

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
