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
from ..services import model_endpoints, ollama_client

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
    """Every model the console can name, and whether it may answer a query.

    Two kinds, and the difference is Rule 1:

    - **local** — installed Ollama weights on this machine. These may serve a
      live query.
    - **cloud** — Ollama's own cloud-hosted tags (a `*-cloud` entry is a
      384-byte pointer at ollama.com, not weights), and the configured
      benchmark endpoints. These are evaluation baselines and may never answer.

    Both are selectable. A cloud model answering a live query is an explicitly
    marked evaluation override, not the production path: the turn is logged as
    `chat_cloud` and the transcript says so. `note` carries that warning and the
    picker shows it on the row.

    `capabilities` comes from Ollama's `/api/show` — `thinking`, `tools`,
    `vision` and friends. It is worth having in the picker because the choice
    is not only about speed: a reasoning model answers a troubleshooting
    question differently, and structurally slower, than one that cannot.

    The local half goes through `ollama_client.list_models()` rather than
    calling `/api/tags` here. That client owns the base-URL fallback and the
    `remote` detection, and a second copy of either would eventually disagree
    with `choose_model` about which tags are real — which is precisely the
    disagreement Rule 1 is enforced against.
    """
    models: list[dict[str, Any]] = []

    try:
        for m in ollama_client.list_models():
            remote = bool(m.get("remote"))
            # One `/api/show` per model, served from the Forge's cache after the
            # first call. Failing soft: a model with unknown capabilities shows
            # no badges, which is better than no model.
            try:
                capabilities = ollama_client.show(m["name"]).get("capabilities") or []
            except Exception:
                capabilities = []
            models.append({
                "id": f"ollama:{m['name']}",
                "name": m["name"],
                "provider": "ollama",
                "type": "cloud" if remote else "local",
                "capabilities": capabilities,
                "note": (
                    "Runs on Ollama's cloud, not this machine. Rule 1 keeps it "
                    "out of the production path: choosing it logs the turn as "
                    "chat_cloud and excludes it from the local latency figures."
                    if remote
                    else None
                ),
                "details": {
                    "family": m.get("family"),
                    "parameter_size": m.get("parameter_size"),
                    "quantization_level": m.get("quantization_level"),
                },
            })
    except Exception:
        # A dead Ollama is a normal state, not an error: the dashboard works
        # without it. The picker says "no local models" on an empty list.
        pass

    try:
        for ep in model_endpoints.list_endpoints():
            models.append({
                "id": f"cloud:{ep['id']}",
                "name": ep["label"],
                "provider": ep["provider"],
                "type": "cloud",
                "capabilities": [],
                "note": (
                    "A configured benchmark endpoint. Rule 1 allows it as an "
                    "offline evaluation baseline, never as a runtime model."
                ),
                "details": {"base_url": ep["base_url"]},
            })
    except Exception:
        pass

    return {"models": models}
