"""The chat, for MainUI's Daedalus tab: the same chats and answers, behind the rig token.

Daedalus' own `/api/sessions` and `/api/chat` take no token: the web UI is
same-origin and the backend listens on 127.0.0.1. A desktop program is not held
by CORS, so MainUI gets this narrow copy instead, guarded like the data link
(`ingest.authorise`): unpaired is 403, a wrong or revoked token 401, and
Disconnect or New token in the Rig chip cuts the chat off with the data stream.

Thin on purpose. Every call goes to the same `chat_service` and
`inference.answer_stream` as the web UI, so a chat started in MainUI is in the
Daedalus sidebar and the other way round. Incognito chats are invisible here:
not listed, not readable, not writable, even by id. Read-only towards the rig,
like everything else: the answer path has no tool that acts on it.

The contract is `CO2SorptionDT/daedalus/CHAT_TAB.md` §5.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Header, HTTPException, Query
from fastapi.responses import StreamingResponse

from ...chat import chat_service
from ...chat.api import chat as chat_api
from ...db import chat_store, sensor_store
from .ingest import authorise

router = APIRouter(prefix="/api/rig-chat", tags=["rig-chat"])


def _visible(session_id: str) -> dict[str, Any]:
    """The session, or 404 for one that does not exist or is incognito."""
    session = chat_store.get_session(session_id)
    if session is None or session.get("ephemeral"):
        raise HTTPException(status_code=404, detail="no such chat")
    return session


@router.get("/status")
def status(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Paired and reachable, which rig, and which model would answer now."""
    authorise(authorization)
    from ...forge import model_config  # noqa: PLC0415 — scores installed models; only on this call

    resolved = model_config.resolve()
    return {"ok": True, "device_id": sensor_store.device_id(),
            "model": resolved.get("tag"), "model_reason": resolved.get("reason")}


@router.get("/sessions")
def sessions(limit: int = Query(default=20, ge=1, le=200),
             authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Saved chats, newest first. Incognito ones are never listed (`list_sessions` skips them)."""
    authorise(authorization)
    rows = chat_service.list_sessions(limit=limit)
    return {"sessions": [{k: s.get(k) for k in ("session_id", "title", "updated_at")} for s in rows]}


@router.post("/sessions", status_code=201)
def create(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    authorise(authorization)
    return chat_service.create_session(device_id=sensor_store.device_id(), origin="mainui")


@router.get("/sessions/{session_id}/messages")
def messages(session_id: str, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    authorise(authorization)
    _visible(session_id)
    return {"session_id": session_id, "messages": chat_service.get_messages(session_id)}


@router.post("")
def ask(session_id: str = Body(..., embed=True), message: str = Body(..., embed=True),
        authorization: str | None = Header(default=None)) -> StreamingResponse:
    """One question, answered as server-sent events: the web UI's own stream, unchanged.

    Logged as asked from 'mainui', labelled with the token's name, so the Thread,
    Observability and the sidebar can tell it from a question typed in the web app.
    """
    token = authorise(authorization)
    _visible(session_id)
    return chat_api.stream_answer(session_id, message, origin="mainui", origin_label=token["name"])
