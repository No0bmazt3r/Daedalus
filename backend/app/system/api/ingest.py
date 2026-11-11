"""The rig link: CO2SorptionDT's MainUI posts its Data-tab rows here.

Off until the Rig chip's Connect rig makes a token (`system/rig_link`); every
MainUI request must carry it as `Authorization: Bearer <token>`. The backend
listens on 127.0.0.1 only, so the link works from the same PC and nowhere else.

Pair and Disconnect are called by the Daedalus UI. Pair takes a JSON body so a
page on another site cannot trigger it: a cross-origin JSON POST needs a CORS
preflight, which only Daedalus' own origins pass.

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


def _authorise(authorization: str | None) -> None:
    if not rig_link.pairing():
        raise HTTPException(status_code=403, detail="The rig link is off. Press Connect rig in Daedalus.")
    if not rig_link.accepts((authorization or "").removeprefix("Bearer ").strip()):
        raise HTTPException(status_code=401, detail="Wrong or revoked token. Pair again from Daedalus.")


class PairBody(BaseModel):
    confirm: bool


@router.get("/status")
def status() -> dict[str, Any]:
    """The Rig chip: off, waiting, live or frozen."""
    return rig_link.status()


@router.post("/pair")
def pair(body: PairBody) -> dict[str, Any]:
    """A new token, shown once. Replaces any earlier pairing."""
    if not body.confirm:
        raise HTTPException(status_code=400, detail="confirm must be true")
    return {"token": rig_link.pair(), **rig_link.status()}


@router.delete("/pair")
def unpair() -> dict[str, Any]:
    rig_link.unpair()
    return rig_link.status()


@router.get("/ping")
def ping(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """MainUI's Test connection: reachable, token accepted, ready for rows."""
    _authorise(authorization)
    return {"ok": True, "device_id": sensor_store.device_id()}


@router.post("/readings")
def readings(batch: Batch, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    _authorise(authorization)
    return {"device_id": sensor_store.device_id(), **sensor_store.ingest([r.model_dump() for r in batch.rows], sensor_store.device_id())}
