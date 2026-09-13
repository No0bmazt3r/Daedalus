"""System/diagnostics endpoints.

Backs the Settings → Databases panel: one call reports the health of all four
stores, so a broken deployment is visible in the UI instead of surfacing later
as a confusing query failure.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from ..db import audit_store, paths, prefs_store, sensor_store, vector_store

router = APIRouter(prefix="/api/system", tags=["system"])


def _file_size(path: Any) -> int | None:
    try:
        return path.stat().st_size
    except OSError:
        return None


@router.get("/databases")
def databases() -> dict[str, Any]:
    """Status of every store Daedalus owns.

    Deliberately reports the *four* separate databases rather than one
    aggregate: their separation is the architecture's safety argument, so the
    UI should make it visible.
    """
    sensor = sensor_store.stats()
    audit = audit_store.stats()
    vector = vector_store.stats()

    return {
        "databases": [
            {
                "id": "sensor",
                "label": "Sensor Telemetry",
                "engine": "SQLite",
                # SQLite is embedded — a file this process opens directly, with
                # no server and no container of its own. Worth stating: seeing
                # one container for four databases otherwise looks like three
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
                "metrics": audit,
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
