"""Settings → Google: connect, change and disconnect the account the evaluation
export writes to (`system/google_link`, docs/EVAL_SHEETS.md)."""

from __future__ import annotations

from html import escape
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse

from .. import google_link

router = APIRouter(prefix="/api/google", tags=["google"])


def _fail(exc: google_link.GoogleError) -> HTTPException:
    return HTTPException(status_code=exc.status, detail=str(exc))


@router.get("/status")
def status() -> dict[str, Any]:
    return google_link.status()


@router.post("/connect")
def connect(request: Request) -> dict[str, str]:
    """The Google sign-in URL. Google sends the browser back to this backend's callback."""
    # Loopback by IP, as Google's installed-app flow expects; same port as this request.
    port = request.url.port or 8000
    try:
        return {"auth_url": google_link.start(f"http://127.0.0.1:{port}/api/google/callback")}
    except google_link.GoogleError as exc:
        raise _fail(exc) from exc


_PAGE = """<!doctype html><meta charset="utf-8"><title>Daedalus · Google</title>
<body style="font-family:system-ui;max-width:32rem;margin:15vh auto;line-height:1.5">
<h2>{title}</h2><p>{body}</p><p>You can close this tab and return to Daedalus.</p></body>"""


@router.get("/callback", response_class=HTMLResponse)
def callback(state: str = "", code: str = "", error: str = "") -> HTMLResponse:
    if error:
        return HTMLResponse(_PAGE.format(title="Not connected", body=f"Google said: {escape(error)}"), 400)
    try:
        out = google_link.finish(state, code)
    except google_link.GoogleError as exc:
        return HTMLResponse(_PAGE.format(title="Not connected", body=escape(str(exc))), exc.status)
    who = escape(out.get("email") or "your Google account")
    return HTMLResponse(_PAGE.format(title="Connected", body=f"Daedalus can now create evaluation sheets in {who}."))


@router.post("/disconnect")
def disconnect() -> dict[str, Any]:
    google_link.disconnect()
    return google_link.status()
