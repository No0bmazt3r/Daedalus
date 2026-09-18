"""The answering endpoint — Layer 7's front door.

`POST /api/chat` takes a question and returns an answer. It is the only place in
the API that runs a model on behalf of a user, which makes it the boundary Rule 5
draws: everything under `/api/forge` configures this path and must never be
called from it.

Currently the thin slice of M4 — model resolution, conversation history, and the
call itself. Retrieval and tool-calling mount here as they land; `evidence` is
already threaded through `services/inference.py` so the prompt does not have to
be rearranged when they do.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import StreamingResponse

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

    `model` overrides the committed choice for this request only. It is honoured
    only for a locally installed model: the `done` event says which model
    actually answered and why, so an override that was refused is visible rather
    than silent. Rule 1 means a cloud endpoint can never serve this path.

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
