"""Pairing for the rig link: one token, made by Connect rig, stored only as a hash.

The token is shown once, when it is made; `data/rig_link.json` keeps its
SHA-256 so a copied file cannot be used to send readings. Pairing again
replaces it, and Disconnect deletes it, so MainUI's next send is refused.

Kept out of prefs on purpose: `/api/prefs` returns everything stored there.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
from datetime import datetime, timezone
from typing import Any

from ..db import paths, sensor_store

FILE = "rig_link.json"
# Rows newer than this mean the rig is live; otherwise paired but waiting.
LIVE_WITHIN_S = 10


def _path():  # noqa: ANN202
    return paths.DATA_DIR / FILE


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def pairing() -> dict[str, Any] | None:
    try:
        return json.loads(_path().read_text())
    except (FileNotFoundError, ValueError):
        return None


def pair() -> str:
    """A new token; the previous one stops working."""
    token = secrets.token_urlsafe(24)
    paths.ensure_dirs()
    _path().write_text(json.dumps({
        "token_sha256": _hash(token),
        "paired_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    }))
    return token


def unpair() -> None:
    _path().unlink(missing_ok=True)


def accepts(token: str) -> bool:
    saved = pairing()
    return bool(saved and token) and hmac.compare_digest(_hash(token), saved["token_sha256"])


def status() -> dict[str, Any]:
    """off · waiting · live · frozen, for the Rig chip."""
    saved = pairing()
    out: dict[str, Any] = {"state": "off", "paired_at": None, "device_id": sensor_store.device_id(),
                           "last_row": None, "age_seconds": None, "frozen_seconds": {}}
    if not saved:
        return out
    out.update(state="waiting", paired_at=saved.get("paired_at"))
    from ..tools.agent_tools import sensor as sensor_tools  # noqa: PLC0415 — tools import the registry

    try:
        data = sensor_tools.get_live_reading("all", None)["data"]
    except Exception:  # noqa: BLE001 — no database yet is "waiting", not an error
        return out
    if not data.get("found"):
        return out
    out.update(last_row=data["timestamp"], age_seconds=data["age_seconds"])
    if data["age_seconds"] <= LIVE_WITHIN_S:
        frozen = data.get("frozen_seconds") or {}
        out.update(state="frozen" if frozen else "live", frozen_seconds=frozen)
    return out
