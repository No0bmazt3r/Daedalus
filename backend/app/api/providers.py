"""Cloud model endpoints — Settings → Add Models.

**Benchmark configuration, not runtime configuration.** Rule 1 keeps cloud
APIs out of the live query path; these endpoints exist so the evaluation
harness has reference models to compare the local SLM against, and so
LLM-as-a-judge can run post hoc over exported logs (`PROJECT.md` §3, §2.2 #7).

The stored `purpose` is CHECK-constrained to `'benchmark'` at the schema
level, so this API cannot be used to register a cloud model for live use even
if a future handler tried.

Keys are write-only over HTTP: they go in through `POST`/`PATCH` and come back
only as a masked hint.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..db import model_endpoint_store as store
from ..db import sqlite_util
from ..models.providers import (
    DeleteOut,
    EndpointCreate,
    EndpointListOut,
    EndpointOut,
    EndpointUpdate,
    ProviderListOut,
)
from ..services import live_events, model_endpoints

router = APIRouter(prefix="/api/providers", tags=["providers"])


def _unavailable(exc: Exception) -> HTTPException:
    return HTTPException(status_code=503, detail=f"endpoint store unavailable: {exc}")


@router.get("/catalogue", response_model=ProviderListOut)
def catalogue() -> dict:
    """The providers the UI offers, with their published base URLs.

    Declared before `/{endpoint_id}` so the path parameter cannot swallow it.
    """
    return {"providers": model_endpoints.providers()}


@router.get("", response_model=EndpointListOut)
def list_endpoints() -> dict:
    try:
        return {"endpoints": model_endpoints.list_endpoints()}
    except sqlite_util.DatabaseUnavailableError as exc:
        raise _unavailable(exc) from exc


@router.post("", response_model=EndpointOut, status_code=201)
def create_endpoint(body: EndpointCreate) -> dict:
    try:
        created = model_endpoints.create_endpoint(
            provider=body.provider,
            base_url=body.base_url,
            api_key=body.api_key or None,
            label=body.label,
        )
    except store.DuplicateEndpointError as exc:
        raise HTTPException(
            status_code=409, detail=f"{exc} is already configured"
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except sqlite_util.DatabaseUnavailableError as exc:
        raise _unavailable(exc) from exc
    live_events.publish("endpoints")
    return created


@router.patch("/{endpoint_id}", response_model=EndpointOut)
def update_endpoint(endpoint_id: str, body: EndpointUpdate) -> dict:
    changes = body.model_dump(exclude_unset=True)
    try:
        updated = model_endpoints.update_endpoint(endpoint_id, **changes)
    except store.EndpointNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"no endpoint '{endpoint_id}'") from exc
    except sqlite_util.DatabaseUnavailableError as exc:
        raise _unavailable(exc) from exc
    live_events.publish("endpoints")
    return updated


@router.post("/{endpoint_id}/test", response_model=EndpointOut)
def test_endpoint(endpoint_id: str) -> dict:
    """Ask the provider for its model list and record the verdict.

    The one outbound network call in this router, and only on an explicit
    click. A failed test is a **200 with `last_test_ok: false`**, not an HTTP
    error: the request succeeded, and its finding — "your key was rejected" —
    is the answer, not a fault.
    """
    try:
        tested = model_endpoints.test_endpoint(endpoint_id)
    except store.EndpointNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"no endpoint '{endpoint_id}'") from exc
    except sqlite_util.DatabaseUnavailableError as exc:
        raise _unavailable(exc) from exc
    live_events.publish("endpoints")
    return tested


@router.delete("/{endpoint_id}", response_model=DeleteOut)
def delete_endpoint(endpoint_id: str) -> dict:
    try:
        deleted = model_endpoints.delete_endpoint(endpoint_id)
    except sqlite_util.DatabaseUnavailableError as exc:
        raise _unavailable(exc) from exc
    live_events.publish("endpoints")
    return {"ok": True, "deleted": deleted}
