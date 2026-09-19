"""System maintenance — the process log, backups, and the Danger Zone.

Rule 5 — a setup surface. Nothing here is reachable from the chat path, and no
agent tool wraps it: a model that could call `wipe` could end a study.

Three groups, matching the three cards in Settings → System:

* `GET /api/system/logs` tails the process log, filtered.
* `GET /api/system/export` and `POST /api/system/import` move configuration
  between machines. **Neither carries a credential** — see
  `services/maintenance.py` for why a backup file is the wrong place for one.
* `GET /api/system/wipe` lists the categories, `DELETE /api/system/wipe/{kind}`
  empties one.

The sensor database is absent from all three. Rule 2: the SCADA subsystem owns
that file and this application opens it read-only.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import JSONResponse

from ..services import app_logs, containers, maintenance

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/logs")
def get_logs(
    limit: int = Query(default=200, ge=1, le=2000),
    level: str | None = Query(default=None),
    q: str | None = Query(default=None),
) -> dict[str, Any]:
    """The end of the process log.

    Filtered here rather than in the browser: the viewer polls, and sending the
    whole tail each time to have it discarded client-side is the difference
    between a feature and a background load.
    """
    return app_logs.tail(limit=limit, level=level, query=q)


@router.get("/export")
def export_data() -> JSONResponse:
    """Everything worth carrying to another machine, as a downloadable file."""
    payload = maintenance.export_data()
    stamp = payload["exported_at"].replace(":", "").replace("-", "")
    return JSONResponse(
        content=payload,
        headers={
            "Content-Disposition": f'attachment; filename="daedalus-backup-{stamp}.json"'
        },
    )


@router.post("/import")
def import_data(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Restore a backup. Additive — nothing is deleted first."""
    try:
        return maintenance.import_data(payload)
    except maintenance.MaintenanceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/containers")
def container_status() -> dict[str, Any]:
    """State of the optional side-car containers, and whether we may touch them."""
    return {
        "control_available": containers.available(),
        "containers": containers.status(),
    }


@router.post("/containers/{name}/{action}")
def container_action(name: str, action: str) -> dict[str, Any]:
    """Start or stop one managed container.

    Deliberately not `create` or `remove`: what those containers *are* is
    described in `docker-compose.yml`, and duplicating an image, an entrypoint,
    a volume and a network here would make that file stop being the answer.
    """
    if action not in ("start", "stop"):
        raise HTTPException(status_code=400, detail=f"unknown action {action!r}")
    try:
        result = containers.start(name) if action == "start" else containers.stop(name)
    except containers.ContainerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {**result, "containers": containers.status()}


@router.get("/wipe")
def wipe_categories() -> dict[str, Any]:
    """What the Danger Zone can empty, and what each one costs."""
    return {"categories": maintenance.categories()}


@router.delete("/wipe/{kind}")
def wipe(kind: str) -> dict[str, Any]:
    """Empty one category, or every one when `kind` is `everything`.

    `everything` runs each category in turn and reports per-category results
    rather than stopping at the first failure: a vector store that is down
    should not prevent the transcripts from being cleared, and a caller needs to
    know which half happened.
    """
    if kind == "everything":
        return maintenance.wipe_all()
    try:
        return maintenance.wipe(kind)
    except maintenance.MaintenanceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
