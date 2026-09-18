"""Wire contracts for the chat session API.

These describe what crosses HTTP. They are deliberately *not* the store's row
shape: `chat_messages.evidence_json` is stored as text and surfaces here as a
parsed object, and internal columns like `summary_upto_seq` stay out of list
responses entirely.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

# Mirrors chat_store.MAX_TITLE_CHARS / MAX_CONTENT_BYTES. Validating here too
# turns an oversized payload into a 422 with a field name, rather than a 413
# raised from inside the store.
MAX_TITLE_CHARS = 200
MAX_CONTENT_CHARS = 16_000


class SessionCreate(BaseModel):
    """Open a new chat. Everything is optional — the common case is `{}`."""

    title: str | None = Field(
        default=None,
        max_length=MAX_TITLE_CHARS,
        description="Usually omitted; the first user message names the chat.",
    )
    device_id: str = Field(
        default="co2_reactor",
        max_length=64,
        description="Forward-compatibility for Phase 2 multi-device. "
        "Single-device for FYP2 — see PROJECT.md §2.2 #3.",
    )
    ephemeral: bool = Field(
        default=False,
        description="Incognito: never listed, swept on restart, and its "
        "content is kept out of the audit log.",
    )


class SessionUpdate(BaseModel):
    """Rename and/or archive. Unset fields are left untouched.

    `title: null` explicitly clears the title; omitting it entirely does not.
    The endpoint distinguishes the two with `exclude_unset`.
    """

    title: str | None = Field(default=None, max_length=MAX_TITLE_CHARS)
    archived: bool | None = None


class MessageCreate(BaseModel):
    """Append a user message.

    There is no `role` field, and that is the point: **only user messages may
    be written over HTTP.** Assistant messages are written by the orchestrator
    after it has actually produced them. If a client could post an assistant
    message, it could put words — and numbers — into the model's own context
    and have them narrated back as fact. See `db/chat_store.py`.
    """

    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1, max_length=MAX_CONTENT_CHARS)


class MessageOut(BaseModel):
    id: int
    session_id: str
    seq: int
    role: str
    content: str
    query_id: str | None = None
    evidence: Any = None
    token_estimate: int
    created_at: str
    # Which model produced this turn. Declared here because `response_model`
    # drops anything it does not name: the store wrote `model_tag` and the
    # store read it back, but the API silently stripped it, so the transcript
    # could never say what answered — and a cloud-answered turn could not be
    # told apart from a local one after the fact.
    model_tag: str | None = None


class SessionOut(BaseModel):
    session_id: str
    created_at: str
    updated_at: str
    title: str | None = None
    device_id: str
    ephemeral: bool
    archived_at: str | None = None
    message_count: int | None = None


class SessionDetail(SessionOut):
    """A single session, including the fields the orchestrator needs."""

    summary: str | None = None
    summary_upto_seq: int = 0


class SessionListOut(BaseModel):
    sessions: list[SessionOut]


class MessageListOut(BaseModel):
    session_id: str
    messages: list[MessageOut]


class DeleteOut(BaseModel):
    ok: bool = True
    deleted: bool
