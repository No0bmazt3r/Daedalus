"""Liveness probe — also what the UI uses to tell "backend down" from
"no preferences saved yet"."""

from __future__ import annotations

from fastapi import APIRouter

from ..db import prefs_store

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
def health() -> dict[str, object]:
    prefs_store.init_db()
    return {"status": "ok", "store": str(prefs_store.DB_PATH)}
