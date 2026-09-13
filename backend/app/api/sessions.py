"""Chat session endpoints.

Conversation state that survives a reload, a second tab, and tomorrow. The
answering endpoint (`POST /api/chat`) is Layer 7's and mounts alongside these;
it will call `chat_service` directly rather than looping back through HTTP.

## Only user messages are writable here

`POST /{id}/messages` takes no `role` — assistant turns are written by the
orchestrator once it has actually produced them. The reason is not tidiness:
history is replayed into the model's context, so a client able to post an
assistant message could put a fabricated sensor reading where the model will
read it as its own previous answer. Keeping that write server-side means the
transcript can only ever contain things the system really said.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..db import chat_store, sqlite_util
from ..models.chat import (
    DeleteOut,
    MessageCreate,
    MessageListOut,
    MessageOut,
    SessionCreate,
    SessionDetail,
    SessionListOut,
    SessionOut,
    SessionUpdate,
)
from ..services import chat_service

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def _not_found(session_id: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"no session '{session_id}'")


def _unavailable(exc: Exception) -> HTTPException:
    """503, not 500: the store is busy or missing, not the request malformed.

    The distinction matters to the UI — a 503 is worth retrying, a 500 is not.
    """
    return HTTPException(status_code=503, detail=f"chat store unavailable: {exc}")


@router.post("", response_model=SessionDetail, status_code=201)
def create_session(body: SessionCreate | None = None) -> dict:
    """Open a new chat. `{}` or no body at all is the normal call."""
    payload = body or SessionCreate()
    try:
        return chat_service.create_session(
            title=payload.title,
            device_id=payload.device_id,
            ephemeral=payload.ephemeral,
        )
    except sqlite_util.DatabaseUnavailableError as exc:
        raise _unavailable(exc) from exc


@router.get("", response_model=SessionListOut)
def list_sessions(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    include_archived: bool = Query(default=False),
) -> dict:
    """The sidebar list, most recently updated first.

    Incognito sessions are never listed — that is what makes them incognito.
    """
    try:
        sessions = chat_service.list_sessions(
            limit=limit, offset=offset, include_archived=include_archived
        )
    except sqlite_util.DatabaseUnavailableError as exc:
        raise _unavailable(exc) from exc
    return {"sessions": sessions}


@router.get("/{session_id}", response_model=SessionDetail)
def get_session(session_id: str) -> dict:
    try:
        return chat_service.get_session(session_id)
    except chat_store.SessionNotFoundError as exc:
        raise _not_found(session_id) from exc
    except sqlite_util.DatabaseUnavailableError as exc:
        raise _unavailable(exc) from exc


@router.patch("/{session_id}", response_model=SessionDetail)
def update_session(session_id: str, body: SessionUpdate) -> dict:
    """Rename and/or archive.

    `exclude_unset` is what separates "clear the title" (`{"title": null}`)
    from "leave the title alone" (`{}`) — both send `None` otherwise.
    """
    changes = body.model_dump(exclude_unset=True)
    if "archived" in changes and changes["archived"] is None:
        del changes["archived"]
    try:
        return chat_service.update_session(session_id, **changes)
    except chat_store.SessionNotFoundError as exc:
        raise _not_found(session_id) from exc
    except sqlite_util.DatabaseUnavailableError as exc:
        raise _unavailable(exc) from exc


@router.delete("/{session_id}", response_model=DeleteOut)
def delete_session(session_id: str) -> dict:
    """Delete a chat and its messages.

    Audit rows in `ai_logs.db` are deliberately untouched: they are the
    evidence that a response was grounded, and the evaluation chapter rests on
    them. A user owns their transcript, not the system's audit trail.
    """
    try:
        return {"ok": True, "deleted": chat_service.delete_session(session_id)}
    except sqlite_util.DatabaseUnavailableError as exc:
        raise _unavailable(exc) from exc


@router.get("/{session_id}/messages", response_model=MessageListOut)
def list_messages(
    session_id: str,
    limit: int | None = Query(default=None, ge=1, le=5000),
) -> dict:
    """The full transcript, oldest first — what the UI renders on reopen."""
    try:
        messages = chat_service.get_messages(session_id, limit=limit)
    except chat_store.SessionNotFoundError as exc:
        raise _not_found(session_id) from exc
    except sqlite_util.DatabaseUnavailableError as exc:
        raise _unavailable(exc) from exc
    return {"session_id": session_id, "messages": messages}


@router.post("/{session_id}/messages", response_model=MessageOut, status_code=201)
def add_message(session_id: str, body: MessageCreate) -> dict:
    """Append a **user** message. See the module docstring for why only user."""
    try:
        return chat_service.add_user_message(session_id, body.content)
    except chat_store.SessionNotFoundError as exc:
        raise _not_found(session_id) from exc
    except chat_store.ContentTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except sqlite_util.DatabaseUnavailableError as exc:
        raise _unavailable(exc) from exc
