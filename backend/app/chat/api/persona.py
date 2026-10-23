"""Settings → Persona: what Daedalus has learned about this install's user.

See `chat/persona.py` for what may be learned, how a proposal is grounded,
and why nothing applies until the user accepts it.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, HTTPException

from ...db import chat_store
from .. import persona

router = APIRouter(prefix="/api/persona", tags=["persona"])


@router.get("")
def read() -> dict[str, Any]:
    """The switch, every trait with the messages it cites, and the globe's graph."""
    items = persona.traits()
    for t in items:
        t["evidence"] = persona.evidence_text(t["evidence"])
    return {"enabled": persona.enabled(), "traits": items, "graph": persona.graph()}


@router.put("/settings")
def settings(enabled: bool = Body(..., embed=True)) -> dict[str, Any]:
    persona.set_enabled(enabled)
    return read()


@router.post("/traits/{trait_id}/{decision}")
def decide(trait_id: str, decision: str) -> dict[str, Any]:
    if decision not in ("accept", "reject"):
        raise HTTPException(status_code=404, detail="decision must be accept or reject")
    if persona.decide(trait_id, decision == "accept") is None:
        raise HTTPException(status_code=404, detail=f"no trait {trait_id}")
    return read()


@router.delete("/traits/{trait_id}")
def forget_one(trait_id: str) -> dict[str, Any]:
    if not persona.forget(trait_id):
        raise HTTPException(status_code=404, detail=f"no trait {trait_id}")
    return read()


@router.delete("")
def forget_all() -> dict[str, Any]:
    """Forget everything learned. The chats themselves are untouched."""
    persona.forget()
    return read()


@router.post("/scan")
def scan_now() -> dict[str, Any]:
    """Read every chat's unread messages now, however few — for when you don't want to wait."""
    if not persona.enabled():
        raise HTTPException(status_code=409, detail="the persona is switched off")
    queued = []
    for s in chat_store.list_sessions(limit=500):
        queued += persona.scan(s["session_id"], force=True)
    return {**read(), "queued": len(queued)}
