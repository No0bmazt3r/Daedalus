"""Web search — provider selection, credentials, and a probe.

`services/web_search.py` carries the reasoning for why a networked feature
exists in an offline project at all. The short version, which every response
here repeats in `purpose_detail`: this is a **setup surface** for finding and
checking the documents M2 ingests, not a retrieval path.

**Rule 5 — setup tools are not runtime tools.** Nothing under `/api/search` is
exposed to the model as a tool, and the orchestrator must never call it. The
`purpose` CHECK in `migrations/prefs/003_web_search.sql` is the enforcement;
this docstring is only the explanation.

The API key is **write-only**: it goes in on a PUT and comes back only as a
masked hint, so the panel never holds a stored credential.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, HTTPException

from ..db import search_store as store
from ..services import web_search

router = APIRouter(prefix="/api/search", tags=["search"])

_SAFESEARCH_LEVELS = ("strict", "moderate", "off")


@router.get("/config")
def get_config() -> dict[str, Any]:
    """The selection, the catalogue, and what each provider still needs."""
    return web_search.status()


@router.put("/config")
def set_config(
    provider: str = Body(..., embed=True),
    result_count: int = Body(default=5, embed=True),
    safesearch: str = Body(default="strict", embed=True),
    fallback_chain: list[str] = Body(default=[], embed=True),
) -> dict[str, Any]:
    """Select a provider, how many results to ask for, and the fallback order.

    Selecting a provider that is not configured yet is allowed and reported —
    refusing would mean you could not record the intent before pasting a key,
    which is the same reasoning `/api/embeddings/config` follows.
    """
    if provider != web_search.DISABLED and not web_search.known(provider):
        raise HTTPException(status_code=400, detail=f"unknown provider {provider!r}")
    if safesearch not in _SAFESEARCH_LEVELS:
        raise HTTPException(status_code=400, detail=f"unknown safesearch level {safesearch!r}")
    if not 1 <= result_count <= 100:
        raise HTTPException(status_code=400, detail="result_count must be between 1 and 100")

    chain: list[str] = []
    for candidate in fallback_chain:
        if candidate == provider or candidate in chain:
            # A fallback to the provider that just failed is not a fallback, and
            # a repeated one only wastes a round trip.
            continue
        if not web_search.known(candidate):
            raise HTTPException(status_code=400, detail=f"unknown provider {candidate!r}")
        chain.append(candidate)

    try:
        store.write_config(
            provider=provider,
            result_count=result_count,
            safesearch=safesearch,
            fallback_chain=chain,
        )
    except store.SearchStoreError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return web_search.status()


@router.put("/providers/{provider_id}")
def set_provider(
    provider_id: str,
    base_url: str | None = Body(default=None, embed=True),
    api_key: str | None = Body(default=None, embed=True),
    engine_id: str | None = Body(default=None, embed=True),
) -> dict[str, Any]:
    """Write one provider's URL, key or engine id.

    An omitted field is left alone; an empty string clears it. That is what lets
    the panel re-submit a form it never received the key for without wiping the
    stored one.
    """
    if not web_search.known(provider_id):
        raise HTTPException(status_code=400, detail=f"unknown provider {provider_id!r}")
    store.upsert_provider(
        provider_id, base_url=base_url, api_key=api_key, engine_id=engine_id
    )
    return web_search.status()


@router.post("/test")
def test(
    provider: str = Body(..., embed=True),
    query: str | None = Body(default=None, embed=True),
) -> dict[str, Any]:
    """Run one provider once, and record how it went.

    Never 500s on a provider failure: "the key is wrong" is an answer to the
    question the button asked, not an error in answering it. The `ok` flag
    carries the verdict and `detail` carries the reason.
    """
    try:
        result = web_search.test_provider(provider, query)
    except web_search.SearchError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {**result, "config": web_search.status()}


@router.post("/query")
def query(
    query: str = Body(..., embed=True),
    count: int | None = Body(default=None, embed=True),
) -> dict[str, Any]:
    """Search with the configured chain, reporting every attempt it made.

    For the operator's own use on the setup surface. The ledger of attempts is
    part of the response rather than a log line, because "which provider
    actually answered this" is the question a fallback chain creates.
    """
    try:
        return web_search.search(query, count)
    except web_search.SearchDisabled as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except web_search.SearchError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
