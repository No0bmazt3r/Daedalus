"""Raw store browser — Settings → Databases → View rows.

Answers "what is actually in the database right now", which is the other half
of the observability story: `audit_store.trace(query_id)` proves one response
was grounded, this shows everything that has been recorded.

Read-only by construction — see `services/log_browser.py` for the allowlist
and the reasons it exists.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..db import sqlite_util
from ..services import log_browser

router = APIRouter(prefix="/api/logs", tags=["logs"])


@router.get("/catalogue")
def catalogue() -> dict:
    """Every browsable table with its current row count."""
    return {"stores": log_browser.catalogue()}


@router.get("/{store}/{table}")
def read_table(
    store: str,
    table: str,
    limit: int = Query(default=log_browser.DEFAULT_LIMIT, ge=1, le=log_browser.MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    newest_first: bool = Query(default=True),
) -> dict:
    """A page of raw rows.

    404 rather than 403 for a table that is not on the allowlist: whether some
    other table exists is not something this endpoint should confirm.
    """
    try:
        return log_browser.read(
            store, table, limit=limit, offset=offset, newest_first=newest_first
        )
    except log_browser.UnknownTableError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except sqlite_util.DatabaseUnavailableError as exc:
        raise HTTPException(status_code=503, detail=f"store unavailable: {exc}") from exc
