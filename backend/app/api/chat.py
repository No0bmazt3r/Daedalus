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

from typing import Any
from collections.abc import Iterator

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import StreamingResponse

from ..services import inference, model_config, ollama_client

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


@router.post("")
def chat(
    session_id: str = Body(..., embed=True),
    message: str = Body(..., embed=True),
    model: str | None = Body(default=None, embed=True),
) -> StreamingResponse:
    """Answer one message in a session, streaming the response."""
    if not message.strip():
        raise HTTPException(status_code=400, detail="message is empty")

    def events() -> Iterator[str]:
        try:
            for event in inference.answer_stream(session_id, message.strip(), model=model):
                yield f"data: {json.dumps(event)}\n\n"
        except inference.NoModelAvailable as exc:
            yield f"data: {json.dumps({'phase': 'error', 'error': str(exc)})}\n\n"
        except ollama_client.OllamaUnavailable as exc:
            yield f"data: {json.dumps({'phase': 'error', 'error': str(exc)})}\n\n"
        except ollama_client.OllamaError as exc:
            yield f"data: {json.dumps({'phase': 'error', 'error': str(exc)})}\n\n"
        except KeyError as exc:
            yield f"data: {json.dumps({'phase': 'error', 'error': f'no such session: {exc}'})}\n\n"
        except Exception as exc:  # noqa: BLE001
            yield f"data: {json.dumps({'phase': 'error', 'error': f'{exc.__class__.__name__}: {exc}'})}\n\n"

    from fastapi.responses import StreamingResponse
    import json
    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
