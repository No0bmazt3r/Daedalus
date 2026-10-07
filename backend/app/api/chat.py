"""The answering endpoint — Layer 7's front door.

`POST /api/chat` takes a question and returns an answer. It is the only place in
the API that runs a model on behalf of a user, which makes it the boundary Rule 5
draws: everything under `/api/forge` configures this path and must never be
called from it.

The route is HTTP only. The whole of `PROJECT.md` §7.1 — understanding the
question, the safety guard, tool planning, the evidence pack, the model call and
the validator — runs in `services/inference.answer_stream`, so the flow is the
same whether this endpoint or a test drives it.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..db import audit_store
from ..services import inference, model_config

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.get("/model")
def active_model() -> dict[str, Any]:
    """Which model would answer right now, and why.

    The chat UI reads this to label its picker, so the operator can see whether
    they are talking to the committed choice or to an override. In `auto` mode
    the answer depends on the machine and on what is installed, so it has to be
    resolved rather than read from a file.
    """
    resolved = model_config.resolve()
    return {
        "tag": resolved.get("tag"),
        "mode": resolved["mode"],
        "resolved": resolved["resolved"],
        "reason": resolved["reason"],
    }


def _sse(event: dict[str, Any]) -> str:
    """One server-sent event frame. The blank line is what ends a frame."""
    return f"data: {json.dumps(event)}\n\n"


@router.post("")
def chat(
    session_id: str = Body(..., embed=True),
    message: str = Body(..., embed=True),
    model: str | None = Body(default=None, embed=True),
) -> StreamingResponse:
    """Answer one message in a session, streamed as server-sent events.

    `model` overrides the committed choice for this request only: the `done`
    event says which model actually answered and why, so an override that was
    refused is visible rather than silent, and a cloud override is logged as
    `chat_cloud` (see `inference.choose_model`).

    Tokens stream as the model produces them, but they are provisional — the
    validator runs after the last one, and `done.result.answer` is what the
    operator keeps.

    The only failure that gets a status code is the empty message, because it is
    the only one detectable before the response starts. Everything after that is
    a terminal `error` event: once the first byte is out the status line is
    already sent, and a 503 has nowhere left to go.
    """
    if not message.strip():
        raise HTTPException(status_code=400, detail="message is empty")

    def events() -> Iterator[str]:
        try:
            for event in inference.answer_stream(session_id, message.strip(), model=model):
                yield _sse(event)
        except KeyError as exc:
            # `chat_service` raises this for an unknown session id.
            yield _sse({"phase": "error", "error": f"no such session: {exc}"})
        except Exception as exc:  # noqa: BLE001
            yield _sse({"phase": "error", "error": f"{exc.__class__.__name__}: {exc}"})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/feedback")
def feedback(
    query_id: str = Body(..., embed=True),
    rating: int = Body(..., embed=True),
    session_id: str | None = Body(default=None, embed=True),
    comment: str | None = Body(default=None, embed=True, max_length=2000),
) -> dict[str, Any]:
    """Rate an answer up (+1) or down (-1), or withdraw a rating (0).

    Appended to `feedback_logs`, never updated: the audit store is append-only,
    and a changed mind is itself a data point. The newest row is the rating.
    The answer must be a logged turn — a rating that points at nothing would
    land in the evaluation set as though it were about something.
    """
    if rating not in (-1, 0, 1):
        raise HTTPException(status_code=400, detail="rating must be -1, 0 or 1")
    if not audit_store.has_query(query_id):
        raise HTTPException(status_code=404, detail=f"no logged answer '{query_id}'")
    audit_store.log(
        "feedback_logs",
        query_id=query_id,
        session_id=session_id,
        rating=rating,
        evaluator_role="operator",
        comment=(comment or "").strip() or None,
    )
    return {"ok": True, "query_id": query_id, "rating": rating}


@router.get("/feedback")
def feedback_for_session(session_id: str = Query(...)) -> dict[str, Any]:
    """The current rating of each rated answer in a chat, for redrawing the thumbs."""
    return {"session_id": session_id, "ratings": audit_store.latest_ratings(session_id)}


@router.get("/{session_id}/status")
def chat_status(session_id: str) -> dict[str, Any]:
    """Check if a background generation is actively running for this session."""
    state = inference.ACTIVE_GENERATIONS.get(session_id)
    if not state:
        return {"generating": False}

    return {
        "generating": True,
        "model": state["model"],
        "started_at": state["started_at"],
    }
