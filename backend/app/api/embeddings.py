"""The embedding model — selection, pulling and the index it produced.

`architecture/04` Step 5 made local embedding a requirement; this is the surface
that makes the choice, and `services/embedding_models.py` carries the reasoning.

Rule 5 — a setup surface. Choosing and pulling an embedding model is ingestion
preparation, not a runtime capability, and the orchestrator must never reach it.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import StreamingResponse

from ..services import embedding_models, live_events, ollama_client

router = APIRouter(prefix="/api/embeddings", tags=["embeddings"])


@router.get("/config")
def get_config() -> dict[str, Any]:
    """The selected model, what is installed, and whether the index matches."""
    return embedding_models.status()


@router.put("/config")
def set_config(
    provider: str = Body(..., embed=True),
    model: str = Body(..., embed=True),
    endpoint_id: str | None = Body(default=None, embed=True),
    dimensions: int | None = Body(default=None, embed=True),
) -> dict[str, Any]:
    """Select an embedding model.

    Selecting one that is not installed is allowed: the panel reports it, and
    refusing would mean you could not record an intended choice before pulling.
    Selecting a *different* model than the index was built with is also allowed,
    and is precisely what `index_state: stale` exists to report — the alternative
    is a config that cannot express "this needs re-ingesting", which is the state
    you most need to see.
    """
    try:
        embedding_models.write(
            provider=provider, model=model, endpoint_id=endpoint_id, dimensions=dimensions
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    live_events.publish("embeddings")
    return embedding_models.status()


@router.post("/pull")
def pull(tag: str = Body(..., embed=True)) -> StreamingResponse:
    """Pull an embedding model, streaming progress as server-sent events.

    The same mechanism the Forge uses for chat models, because it is the same
    `ollama pull` — an embedding model is an Ollama model. What differs is the
    surface it belongs to: the Forge shapes the *answering* model to the
    machine, and this choice belongs with the corpus it will embed.
    """

    def events() -> Iterator[str]:
        try:
            for event in ollama_client.pull(tag):
                yield f"data: {json.dumps(event)}\n\n"
        except (ollama_client.OllamaError, ollama_client.OllamaUnavailable) as exc:
            yield f"data: {json.dumps({'error': str(exc), 'done': True})}\n\n"
        except Exception as exc:  # noqa: BLE001
            yield f"data: {json.dumps({'error': f'{exc.__class__.__name__}: {exc}', 'done': True})}\n\n"
        finally:
            live_events.publish("models", source="pull", tag=tag)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/verify")
def verify(tag: str = Body(..., embed=True)) -> dict[str, Any]:
    """Embed a probe string and record the width the model actually returns.

    The one call in this module that runs a model. Everything else reads
    metadata, so this is the only place a request costs a model load — brief,
    one forward pass over a few words, and it buys the only figure that is ground
    truth for what a vector store receives.

    Rule 5 still holds: it is a setup action on a setup surface, and the
    orchestrator cannot reach it.
    """
    try:
        record = embedding_models.verify(tag)
    except (ollama_client.OllamaError, ollama_client.OllamaUnavailable) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"{exc.__class__.__name__}: {exc}") from exc
    live_events.publish("embeddings")
    return {"ok": True, **record, **embedding_models.status()}
