"""The rig link: CO2SorptionDT's MainUI posts its Data-tab rows here.

Off until a token is made in Settings → Rig connection (`system/rig_link`);
every MainUI request must carry one as `Authorization: Bearer <token>`. The backend
listens on 127.0.0.1 only, so the link works from the same PC and nowhere else.

Making and revoking tokens are called by the Daedalus UI (Settings → Rig connection).

MainUI decides *when* to send (only while COM4 and COM6 are both connected);
this side only checks what arrives and stores it via `sensor_store.ingest`,
which keeps the AI query path read-only.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from ...db import sensor_store
from .. import rig_link

router = APIRouter(prefix="/api/ingest", tags=["ingest"])

# An hour at MainUI's one row per second: the most its send queue holds.
MAX_BATCH = 3600


class Reading(BaseModel):
    timestamp: str
    temp_c: float | None = None
    pressure_barg: float | None = None
    ph: float | None = None
    co2_ppm: float | None = None
    mode: str | None = Field(default=None, max_length=32)

    @field_validator("timestamp")
    @classmethod
    def utc(cls, value: str) -> str:
        """Stored as ISO UTC with `+00:00`, the form the sensor tools compare as text."""
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("timestamp must be ISO-8601, e.g. 2026-11-11T08:05:49Z") from exc
        if parsed.tzinfo is None:
            raise ValueError("timestamp must carry a UTC offset; MainUI sends UTC")
        return parsed.astimezone(timezone.utc).replace(microsecond=0).isoformat()


class Batch(BaseModel):
    rows: list[Reading] = Field(max_length=MAX_BATCH)


def authorise(authorization: str | None) -> dict[str, Any]:
    """The rig token check: 403 while no token is active, 401 for a wrong, revoked or expired one.

    Shared by every endpoint MainUI calls (the data link and `rig_chat`), so
    revoking a token in Daedalus cuts both.
    """
    try:
        return rig_link.check((authorization or "").removeprefix("Bearer ").strip())
    except rig_link.Refused as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc


class TokenBody(BaseModel):
    name: str = Field(max_length=rig_link.MAX_NAME)
    # 30, 90 or 365; null for a token that never expires.
    expires_days: int | None = 90


@router.get("/status")
def status() -> dict[str, Any]:
    """The Rig chip: off, waiting, connected, live or frozen."""
    return rig_link.status()


@router.get("/tokens")
def list_tokens() -> dict[str, Any]:
    """Settings → Rig connection: every token without its secret, newest first."""
    return {"tokens": rig_link.tokens(), "expiry_days": list(rig_link.EXPIRY_DAYS)}


@router.post("/tokens", status_code=201)
def create_token(body: TokenBody) -> dict[str, Any]:
    """A new named token, returned in full this once.

    A JSON body, so a page on another site cannot make one: a cross-origin JSON
    POST needs a CORS preflight, which only Daedalus' own origins pass.
    """
    try:
        token, row = rig_link.create(body.name, body.expires_days)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"token": token, **row}


@router.delete("/tokens/{token_id}")
def revoke_token(token_id: str) -> dict[str, Any]:
    if not rig_link.revoke(token_id):
        raise HTTPException(status_code=404, detail="no such token")
    return {"ok": True}


@router.get("/ping")
def ping(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """MainUI's Test connection: reachable, token accepted, ready for rows."""
    authorise(authorization)
    return {"ok": True, "device_id": sensor_store.device_id()}


@router.post("/readings")
def readings(batch: Batch, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    authorise(authorization)
    return {"device_id": sensor_store.device_id(), **sensor_store.ingest([r.model_dump() for r in batch.rows], sensor_store.device_id())}
