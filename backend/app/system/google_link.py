"""Google connection for the evaluation export: docs/EVAL_SHEETS.md.

Settings → Google connects one Google account so `cli_eval sheets` / `pull` can
write and read the evaluation workbooks. It is a setup surface (Rule 5): nothing
on the chat path imports this module.

## The sign-in

Google's OAuth flow for installed apps: the browser goes to Google, Google sends
it back to `http://127.0.0.1:<port>/api/google/callback`, and the code is traded
for a refresh token with PKCE. The OAuth client is the user's own "Desktop app"
client (`DAEDALUS_GOOGLE_CLIENT_ID` / `_SECRET` in `.env`). Google says a desktop
client's secret is not confidential; PKCE is what protects the exchange.

Scope `drive.file` only: Daedalus can see the files it created and nothing else
in the account. `openid email` add the account's address, shown in the panel.

## Gating

Only in Advanced mode with `network_egress` unlocked. Simple mode is local-only
and stays provably so; `allowed()` fails closed.

## The stored grant

`data/google_link.json`, mode 0600, like `rig_link.json`: the refresh token,
the email and when it was connected. Never logged, never returned by the API.
In Google's "Testing" publishing status a refresh token dies after 7 days, so
`access_token()` turns `invalid_grant` into "reconnect in Settings → Google".
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import threading
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

from ..db import paths

FILE = "google_link.json"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
SCOPES = ("openid", "email", "https://www.googleapis.com/auth/drive.file")
TESTING_DAYS = 7  # refresh-token life while the OAuth app is in "Testing"
_PENDING_TTL_S = 600  # a sign-in started more than 10 min ago is abandoned

_lock = threading.Lock()
_pending: dict[str, dict[str, Any]] = {}  # state -> {verifier, redirect_uri, at}
_access: dict[str, Any] = {}  # {"token", "expires"}; memory only


class GoogleError(RuntimeError):
    """A Google step that failed, worded for the person who has to fix it."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


# ── gate and config ──────────────────────────────────────────────────────────


def allowed() -> tuple[bool, str | None]:
    """Advanced mode and `network_egress` unlocked. Fails closed."""
    try:
        from ..db import tool_policy_store  # noqa: PLC0415

        if tool_policy_store.is_simple():
            return False, "Google is off in Simple mode (local-only). Switch to Advanced in Settings → General."
        if "network_egress" in tool_policy_store.locked():
            return False, "network_egress is locked in Settings → Agent Tools, so Daedalus may not reach Google."
    except Exception:  # noqa: BLE001
        return False, "Could not read the tool policy, so Google stays off."
    return True, None


def client() -> tuple[str, str] | None:
    cid = os.environ.get("DAEDALUS_GOOGLE_CLIENT_ID", "").strip()
    secret = os.environ.get("DAEDALUS_GOOGLE_CLIENT_SECRET", "").strip()
    return (cid, secret) if cid and secret else None


def _require() -> tuple[str, str]:
    ok, why = allowed()
    if not ok:
        raise GoogleError(why or "Google is not allowed", 403)
    pair = client()
    if pair is None:
        raise GoogleError("Set DAEDALUS_GOOGLE_CLIENT_ID and DAEDALUS_GOOGLE_CLIENT_SECRET in .env "
                          "(a Google Cloud OAuth client of type Desktop app), then restart.", 409)
    return pair


# ── the stored grant ─────────────────────────────────────────────────────────


def _path():  # noqa: ANN202
    return paths.DATA_DIR / FILE


def _read() -> dict[str, Any] | None:
    try:
        data = json.loads(_path().read_text())
    except (FileNotFoundError, ValueError):
        return None
    return data if isinstance(data, dict) and data.get("refresh_token") else None


def _write(data: dict[str, Any] | None) -> None:
    paths.ensure_dirs()
    if data is None:
        _path().unlink(missing_ok=True)
        return
    tmp = _path().with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        json.dump(data, fh, indent=2)
    os.replace(tmp, _path())
    os.chmod(_path(), 0o600)


def status() -> dict[str, Any]:
    ok, why = allowed()
    grant = _read()
    out: dict[str, Any] = {"allowed": ok, "reason": why, "configured": client() is not None,
                           "connected": bool(grant), "email": None, "connected_at": None,
                           "expires_hint": None, "expired": bool(grant and grant.get("expired"))}
    if grant:
        out.update(email=grant.get("email"), connected_at=grant.get("connected_at"))
        at = datetime.fromisoformat(grant["connected_at"]).timestamp() if grant.get("connected_at") else None
        if at:
            out["expires_hint"] = datetime.fromtimestamp(at + TESTING_DAYS * 86400, timezone.utc).isoformat()
    return out


# ── sign-in ──────────────────────────────────────────────────────────────────


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def start(redirect_uri: str) -> str:
    """The Google sign-in URL; the browser opens it. One pending sign-in per state."""
    cid, _ = _require()
    verifier = _b64(secrets.token_bytes(48))
    state = secrets.token_urlsafe(24)
    now = time.monotonic()
    with _lock:
        for s in [s for s, p in _pending.items() if now - p["at"] > _PENDING_TTL_S]:
            del _pending[s]
        _pending[state] = {"verifier": verifier, "redirect_uri": redirect_uri, "at": now}
    return AUTH_URL + "?" + urlencode({
        "client_id": cid, "redirect_uri": redirect_uri, "response_type": "code",
        "scope": " ".join(SCOPES), "state": state,
        "code_challenge": _b64(hashlib.sha256(verifier.encode()).digest()),
        "code_challenge_method": "S256",
        # offline + consent: always get a refresh token; select_account: "change account" works.
        "access_type": "offline", "prompt": "consent select_account",
    })


def _email_from(id_token: str | None) -> str | None:
    """The email claim. Read without verifying the signature: the token came
    straight from Google's token endpoint over TLS, and it is only displayed."""
    try:
        payload = id_token.split(".")[1]  # type: ignore[union-attr]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))).get("email")
    except Exception:  # noqa: BLE001
        return None


def finish(state: str, code: str) -> dict[str, Any]:
    """Trade the callback's code for a grant and store it. Returns the public status."""
    import httpx  # noqa: PLC0415

    cid, secret = _require()
    with _lock:
        pending = _pending.pop(state or "", None)
    if pending is None or time.monotonic() - pending["at"] > _PENDING_TTL_S:
        raise GoogleError("This sign-in expired or was not started here. Press Connect again.")
    res = httpx.post(TOKEN_URL, timeout=20, data={
        "client_id": cid, "client_secret": secret, "code": code, "grant_type": "authorization_code",
        "redirect_uri": pending["redirect_uri"], "code_verifier": pending["verifier"],
    })
    body = res.json() if res.content else {}
    if res.status_code != 200 or not body.get("refresh_token"):
        raise GoogleError(f"Google refused the sign-in: {body.get('error_description') or body.get('error') or res.status_code}")
    granted = set((body.get("scope") or "").split())
    if SCOPES[2] not in granted:
        raise GoogleError("Drive access was not granted. Connect again and tick the Google Drive box.")
    with _lock:
        _write({"email": _email_from(body.get("id_token")), "refresh_token": body["refresh_token"],
                "scope": body.get("scope"), "connected_at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
        _access.clear()
        _access.update(token=body.get("access_token"), expires=time.time() + int(body.get("expires_in", 0)) - 60)
    return status()


def disconnect() -> bool:
    """Revoke at Google (best effort) and forget the grant. True when one existed."""
    grant = _read()
    if not grant:
        return False
    try:
        import httpx  # noqa: PLC0415

        httpx.post(REVOKE_URL, data={"token": grant["refresh_token"]}, timeout=10)
    except Exception:  # noqa: BLE001 — offline: forgetting it locally still disconnects
        pass
    with _lock:
        _write(None)
        _access.clear()
    return True


def access_token() -> str:
    """A live access token, refreshed when needed. Raises GoogleError with what to do."""
    import httpx  # noqa: PLC0415

    cid, secret = _require()
    with _lock:
        if _access.get("token") and _access.get("expires", 0) > time.time():
            return _access["token"]
    grant = _read()
    if not grant:
        raise GoogleError("Not connected to Google. Connect in Daedalus → Settings → Google.", 401)
    res = httpx.post(TOKEN_URL, timeout=20, data={
        "client_id": cid, "client_secret": secret, "refresh_token": grant["refresh_token"],
        "grant_type": "refresh_token",
    })
    body = res.json() if res.content else {}
    if res.status_code != 200:
        if body.get("error") == "invalid_grant":
            with _lock:
                _write({**grant, "expired": True})
            raise GoogleError("The Google connection expired (Testing apps expire after 7 days). "
                              "Reconnect in Daedalus → Settings → Google.", 401)
        raise GoogleError(f"Google token refresh failed: {body.get('error') or res.status_code}", 502)
    with _lock:
        _access.update(token=body["access_token"], expires=time.time() + int(body.get("expires_in", 3600)) - 60)
        return _access["token"]
