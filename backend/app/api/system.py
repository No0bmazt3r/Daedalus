"""System/diagnostics endpoints.

Backs the Settings → Databases panel: one call reports the health of all five
stores, so a broken deployment is visible in the UI instead of surfacing later
as a confusing query failure.
"""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, HTTPException

from ..db import (
    audit_store,
    chat_store,
    migrations,
    paths,
    prefs_store,
    sensor_store,
    sqlite_util,
    vector_store,
)

router = APIRouter(prefix="/api/system", tags=["system"])


def _file_size(path: Any) -> int | None:
    """Size including the WAL sidecar — see `sqlite_util.file_size`."""
    return sqlite_util.file_size(path)


def _schema(store: str) -> dict[str, Any]:
    """Migration state, so a database that needs migrating is visible in the UI.

    Reported per store rather than as one aggregate: they version
    independently, and "which one is behind" is the question worth answering.
    """
    state = migrations.status(store)
    return {
        "version": state["current_version"],
        "latest": state["latest_version"],
        "pending": state["pending"],
        "error": state["error"],
    }


@router.get("/observability")
def observability() -> dict[str, Any]:
    """Where to go when a store is reported unhealthy.

    The dashboard answers *whether* something is wrong; the metrics stack —
    Prometheus scraping this app, Grafana over it, container logs alongside —
    answers *why*. That runs as its own service on its own port, so the only
    thing this app can usefully say is where it is.

    Unset is a normal state, not an error: the stack is optional and is not
    running in most development setups. The UI says so rather than offering a
    link into nothing. See TODO.md, M7.
    """
    url = (os.environ.get("DAEDALUS_OBSERVABILITY_URL") or "").strip()
    return {"url": url, "configured": bool(url)}


@router.get("/databases")
def databases() -> dict[str, Any]:
    """Status of every store Daedalus owns.

    Deliberately reports the *five* separate databases rather than one
    aggregate: their separation is the architecture's safety argument, so the
    UI should make it visible.
    """
    sensor = sensor_store.stats()
    audit = audit_store.stats()
    vector = vector_store.stats()
    chat = chat_store.stats()

    return {
        "databases": [
            {
                "id": "sensor",
                "label": "Sensor Telemetry",
                "engine": "SQLite",
                # SQLite is embedded — a file this process opens directly, with
                # no server and no container of its own. Worth stating: seeing
                # one container for five databases otherwise looks like four
                # are missing.
                "deployment": "embedded file",
                "access": "read-only",
                "purpose": "IoT device readings written by the SCADA ingestion subsystem.",
                "path": str(paths.SENSOR_DB),
                "size_bytes": _file_size(paths.SENSOR_DB),
                "available": sensor["exists"],
                "metrics": {
                    "rows": sensor["rows"],
                    "anomalies": sensor["anomalies"],
                    "earliest": sensor["earliest"],
                    "latest": sensor["latest"],
                },
            },
            {
                "id": "audit",
                "label": "Audit & Evaluation Logs",
                "engine": "SQLite",
                "deployment": "embedded file",
                "access": "read-write",
                "purpose": "Chat, tool-call, retrieval, model, error, feedback and memory logs.",
                "path": str(paths.AUDIT_DB),
                "size_bytes": _file_size(paths.AUDIT_DB),
                "available": True,
                "schema": _schema("audit"),
                "metrics": audit,
            },
            {
                "id": "chat",
                "label": "Chat Transcripts",
                "engine": "SQLite",
                "deployment": "embedded file",
                "access": "read-write",
                # Separate from the audit log on purpose: a user owns their
                # transcript and may delete it; audit rows are the evidence a
                # response was grounded. See db/paths.py.
                "purpose": "Conversation sessions and messages — the assistant's memory across sessions.",
                "path": str(paths.CHAT_DB),
                "size_bytes": _file_size(paths.CHAT_DB),
                "available": True,
                "schema": _schema("chat"),
                "metrics": chat,
            },
            {
                "id": "vector",
                "label": "Knowledge Vector Store",
                "engine": "ChromaDB",
                # The only store that runs as a server, hence the one container.
                "deployment": "service" if vector["mode"] == "server" else "embedded file",
                "access": "read-write",
                "purpose": "Embedded SOP, manual, anomaly and UAUC chunks for RAG retrieval.",
                "path": vector["target"],
                "size_bytes": None,
                "available": vector["available"],
                "metrics": {
                    "documents": vector["documents"],
                    "collection": vector["collection"],
                    "mode": vector["mode"],
                    "error": vector["error"],
                },
            },
            {
                "id": "prefs",
                "label": "UI Preferences",
                "engine": "SQLite",
                "deployment": "embedded file",
                "access": "read-write",
                "purpose": "Theme and interface state, kept server-side instead of in the browser.",
                "path": str(prefs_store.DB_PATH),
                "size_bytes": _file_size(prefs_store.DB_PATH),
                "available": True,
                "schema": _schema("prefs"),
                "metrics": {"keys": len(prefs_store.get_all_prefs())},
            },
        ]
    }


@router.post("/seed-demo")
def seed_demo() -> dict[str, Any]:
    """Populate the sensor DB with a demo run — development only.

    Refuses when data already exists, so it can never overwrite a real run.
    """
    try:
        inserted = sensor_store.seed_demo()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {
        "ok": True,
        "rows_inserted": inserted,
        "note": "already populated — nothing written" if inserted == 0 else "demo run generated",
    }


@router.get("/models")
def list_models() -> dict[str, Any]:
    """Dynamically discover models on hand.
    
    Queries the local Ollama instance (fast fail if absent) and lists configured
    cloud benchmark endpoints.
    """
    import os
    import httpx
    from ..services import model_endpoints
    
    models = []
    
    # 1. Fetch from Ollama
    ollama_url = os.environ.get("OLLAMA_BASE_URL", "http://host.docker.internal:11434").rstrip("/")
    try:
        # short timeout so the UI doesn't hang if Ollama is off
        with httpx.Client(timeout=1.5) as client:
            resp = client.get(f"{ollama_url}/api/tags")
            if resp.status_code == 200:
                data = resp.json()
                for m in data.get("models", []):
                    models.append({
                        "id": f"ollama:{m['name']}",
                        "name": m["name"],
                        "provider": "ollama",
                        "type": "local",
                        "details": m.get("details", {})
                    })
    except Exception:
        pass
        
    # 2. Fetch configured cloud endpoints
    try:
        endpoints = model_endpoints.list_endpoints()
        for ep in endpoints:
            models.append({
                "id": f"cloud:{ep['id']}",
                "name": ep["label"],
                "provider": ep["provider"],
                "type": "cloud",
                "details": {"base_url": ep["base_url"]}
            })
    except Exception:
        pass
        
    return {"models": models}
