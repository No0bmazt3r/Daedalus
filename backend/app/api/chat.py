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

from fastapi import APIRouter, Body, HTTPException

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
) -> dict[str, Any]:
    """Answer one message in a session.

    `model` overrides the committed choice for this request only. It is honoured
    only for a locally installed model: the response says which model actually
    answered and why, so an override that was refused is visible rather than
    silent. Rule 1 means a cloud endpoint can never serve this path.

    Synchronous for now. Streaming belongs here eventually — a small model on a
    slow machine is several seconds to first token — but the shape of the
    response is the thing worth settling first.
    """
    if not message.strip():
        raise HTTPException(status_code=400, detail="message is empty")

    try:
        return inference.answer(session_id, message.strip(), model=model)
    except inference.NoModelAvailable as exc:
        # 503 rather than 500: nothing is broken, there is just nothing to run.
        # The message names the fix, which is usually "pull a model".
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ollama_client.OllamaUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ollama_client.OllamaError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"no such session: {exc}") from exc
