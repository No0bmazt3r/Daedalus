"""The rig link: CO2SorptionDT's MainUI posts its Data-tab rows here.

Off until `.env` sets `DAEDALUS_INGEST_TOKEN`; every request must carry it as
`Authorization: Bearer <token>`. The backend listens on 127.0.0.1 only, so the
link works from the same PC and nowhere else.

MainUI decides *when* to send (only while COM4 and COM6 are both connected);
this side only checks what arrives and stores it via `sensor_store.ingest`,
which keeps the AI query path read-only.
"""

from __future__ import annotations

import hmac
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from ...db import sensor_store

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
    token = os.environ.get("DAEDALUS_INGEST_TOKEN", "").strip()
    if not token:
        raise HTTPException(status_code=403, detail="The rig link is off. Set DAEDALUS_INGEST_TOKEN in .env and restart.")
    sent = (authorization or "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(sent, token):
        raise HTTPException(status_code=401, detail="Wrong or missing token.")


@router.get("/ping")
def ping(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """MainUI's Test connection: reachable, token accepted, ready for rows."""
    _authorise(authorization)
    return {"ok": True, "device_id": sensor_store.device_id()}


@router.post("/readings")
def readings(batch: Batch, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    _authorise(authorization)
    return {"device_id": sensor_store.device_id(), **sensor_store.ingest([r.model_dump() for r in batch.rows], sensor_store.device_id())}
