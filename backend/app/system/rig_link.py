"""Rig tokens: what lets CO2SorptionDT's MainUI send readings and use the chat.

Made in Settings → Rig connection. Each token has a name and an expiry
(30 days, 90 days, a year, or never), is shown once when it is made, and is
kept here only as its SHA-256, so a copied `data/rig_link.json` cannot be used
to connect. Revoking one leaves the others working. Like API keys: valid until
revoked or expired.

Kept out of prefs on purpose: `/api/prefs` returns everything stored there.

`status()` is the Rig chip: off (no tokens) · waiting (tokens, but MainUI has not
connected lately) · connected (MainUI used a token in the last minute, no
readings arriving: its COM ports are not connected) · live · frozen.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from ..db import paths, sensor_store

FILE = "rig_link.json"
# Rows newer than this mean the rig is live; otherwise paired but waiting.
LIVE_WITHIN_S = 10
# MainUI used a token this recently: it is connected, whatever the readings say.
SEEN_WITHIN_S = 60
EXPIRY_DAYS = (30, 90, 365, None)  # None = never
# `last_used_at` is written at most this often: the data link calls every second.
_USE_WRITE_EVERY_S = 30
MAX_NAME = 60

_lock = threading.Lock()
_last_seen = 0.0  # monotonic; MainUI's latest accepted request


class Refused(Exception):
    """Why a token was not accepted: `status` is the HTTP code, the message says what to do."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


def _path():  # noqa: ANN202
    return paths.DATA_DIR / FILE


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def _read() -> list[dict[str, Any]]:
    try:
        raw = json.loads(_path().read_text())
    except (FileNotFoundError, ValueError):
        return []
    if isinstance(raw, dict) and "token_sha256" in raw:
        # The single token from before named tokens (2026-11-11): carried over as
        # "MainUI", never expiring, so a paired dashboard keeps working.
        return [{"id": "legacy", "name": "MainUI", "prefix": None, "token_sha256": raw["token_sha256"],
                 "created_at": raw.get("paired_at"), "expires_at": None, "last_used_at": None}]
    return raw.get("tokens", []) if isinstance(raw, dict) else []


def _write(tokens: list[dict[str, Any]]) -> None:
    paths.ensure_dirs()
    tmp = _path().with_suffix(".tmp")
    tmp.write_text(json.dumps({"tokens": tokens}, indent=2))
    tmp.replace(_path())


def _expired(row: dict[str, Any]) -> bool:
    return bool(row.get("expires_at")) and datetime.fromisoformat(row["expires_at"]) <= _now()


def _public(row: dict[str, Any]) -> dict[str, Any]:
    return {**{k: v for k, v in row.items() if k != "token_sha256"}, "expired": _expired(row)}


def tokens() -> list[dict[str, Any]]:
    """Every token, newest first, without its hash."""
    return [_public(r) for r in sorted(_read(), key=lambda r: r.get("created_at") or "", reverse=True)]


def paired() -> bool:
    """At least one token that has not expired."""
    return any(not _expired(r) for r in _read())


def create(name: str, expires_days: int | None) -> tuple[str, dict[str, Any]]:
    """A new token, returned once, and its row. Raises ValueError for a bad name or expiry."""
    name = " ".join(str(name or "").split())
    if not name:
        raise ValueError("give the token a name, e.g. Lab PC MainUI")
    if len(name) > MAX_NAME:
        raise ValueError(f"the name is longer than {MAX_NAME} characters")
    if expires_days not in EXPIRY_DAYS:
        raise ValueError("expiry must be 30, 90 or 365 days, or never")
    token = secrets.token_urlsafe(24)
    now = _now()
    row = {
        "id": secrets.token_hex(6), "name": name, "prefix": token[:4], "token_sha256": _hash(token),
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(days=expires_days)).isoformat() if expires_days else None,
        "last_used_at": None,
    }
    with _lock:
        _write([*_read(), row])
    return token, _public(row)


def revoke(token_id: str) -> bool:
    with _lock:
        rows = _read()
        kept = [r for r in rows if r["id"] != token_id]
        if len(kept) == len(rows):
            return False
        _write(kept)
    return True


def check(token: str) -> dict[str, Any]:
    """The token's row if it may connect now; raises Refused otherwise. Records the use."""
    global _last_seen
    rows = _read()
    if not any(not _expired(r) for r in rows):
        raise Refused(403, "No rig token is active. Make one in Daedalus → Settings → Rig connection.")
    digest = _hash(token or "")
    row = next((r for r in rows if token and hmac.compare_digest(digest, r["token_sha256"])), None)
    if row is None:
        raise Refused(401, "Wrong or revoked token. Make a new one in Daedalus → Settings → Rig connection.")
    if _expired(row):
        raise Refused(401, f"The token \"{row['name']}\" has expired. Make a new one in Daedalus → Settings → Rig connection.")
    _last_seen = time.monotonic()
    last = row.get("last_used_at")
    if not last or (_now() - datetime.fromisoformat(last)).total_seconds() >= _USE_WRITE_EVERY_S:
        with _lock:
            fresh = _read()
            for r in fresh:
                if r["id"] == row["id"]:
                    r["last_used_at"] = _now().isoformat()
            _write(fresh)
    return _public(row)


def status() -> dict[str, Any]:
    """off · waiting · connected · live · frozen, for the Rig chip."""
    active = [r for r in _read() if not _expired(r)]
    seen_ago = int(time.monotonic() - _last_seen) if _last_seen else None
    out: dict[str, Any] = {"state": "off", "tokens": len(active), "device_id": sensor_store.device_id(),
                           "seen_seconds": seen_ago, "last_row": None, "age_seconds": None,
                           "frozen_seconds": {}}
    if not active:
        return out
    connected = seen_ago is not None and seen_ago <= SEEN_WITHIN_S
    out["state"] = "connected" if connected else "waiting"
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
