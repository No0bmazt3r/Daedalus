"""System tools — the health and inventory of this machine, read-only.

Odysseus' equivalent category manages endpoints, MCP servers, webhooks, tokens
and settings. All of that is refused here under Rule 5: configuration is changed
by a person in Settings, never by the thing being configured. What is left is
the half a model can legitimately use — knowing whether the system it is part of
is actually working.

That is not a luxury for this project. §7.1 step 10 has the orchestrator fall
back to *"I could not generate a grounded answer from the available data"*, and
the difference between *"the vector store is down"* and *"there is nothing on
that topic"* is the difference between a fixable operational fault and a gap in
the corpus. A model that can tell them apart can say which one happened.
"""

from __future__ import annotations

from typing import Any

from .. import ollama_client
from .registry import Effect, Param, register


@register(
    name="get_system_status",
    category="system",
    summary=(
        "Whether the parts this answer depends on are working: the stores, the model "
        "runtime, and which retrieval track is active."
    ),
    effects={Effect.READ_SYSTEM},
    params=(),
)
def get_system_status() -> dict[str, Any]:
    """One call, five stores, no numbers invented.

    Every field here is read from the store it describes rather than cached, so a
    model reporting "the vector store is unreachable" is reporting something that
    was true when it asked.
    """
    from ...db import audit_store, chat_store, sensor_store, vector_store  # noqa: PLC0415
    from .. import rag_config  # noqa: PLC0415 — import cycle at boot

    vector = vector_store.stats()
    sensor = sensor_store.stats()

    return {
        "data": {
            "active_track": rag_config.resolve(),
            "stores": {
                "sensor": {
                    "available": sensor.get("exists"),
                    "readings": sensor.get("readings"),
                    "access": "read-only",
                },
                "vector": {
                    "available": vector["available"],
                    "chunks": vector["documents"],
                    "collection": vector["collection"],
                    "embedding_model": vector["embedding_model"],
                    "error": vector["error"],
                },
                "audit": {"rows": audit_store.stats()},
                "chat": {"sessions": chat_store.stats().get("sessions")},
            },
            "model_runtime": {
                "ollama_available": ollama_client.available(),
            },
        },
        "detail": "store health as of this call",
    }


@register(
    name="list_models",
    category="system",
    summary="Which language models are installed on this machine and can answer locally.",
    effects={Effect.READ_SYSTEM},
    params=(
        Param("limit", int, "How many to list.", default=20, minimum=1, maximum=50),
    ),
)
def list_models(limit: int) -> dict[str, Any]:
    """Local inventory only.

    Cloud rows are filtered out rather than labelled. Rule 1 makes them offline
    benchmark references, so a model that could see them in its own tool output
    could suggest one as an answer path — and a suggestion is how a rule starts
    getting argued with.
    """
    if not ollama_client.available():
        return {"data": {"models": []}, "detail": "the model runtime is not reachable"}

    models = []
    for row in ollama_client.list_models()[:limit]:
        if row.get("remote"):
            continue
        models.append({
            "name": row.get("name") or row.get("model"),
            "size_bytes": row.get("size"),
            "parameter_size": row.get("parameter_size"),
            "quantization": row.get("quantization_level"),
        })
    return {
        "data": {"models": models},
        "detail": f"{len(models)} local models installed"
                  if models else "no local models are installed",
    }
