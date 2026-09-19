"""Web search — six providers behind one interface, for setup work only.

## Why a networked feature exists in an offline project

`PROJECT.md` Rule 1: the production runtime is 100% local. A web search is
network egress, so it cannot be part of the answer path, and it is not: nothing
in `chat_service`, `inference` or the retrieval tracks imports this module, and
`search_config.purpose` carries a CHECK admitting only `'setup'`.

What it is for is the work *around* the corpus. M2 has to find, check and
version the manuals, SOPs and anomaly records it ingests, and the Forge's model
sizing regularly needs a model card. §8.2 already draws this line for model
weights — *"model downloading is a one-time setup activity performed when
internet is available; the production runtime remains fully offline"* — and this
is the same line for documents. What reaches an answer is the ingested corpus,
reviewed and cited, never a search result.

Rule 5 makes the same point from the other side: setup tools are not runtime
tools, and nothing here is exposed to the model as a tool.

## Why the chain reports instead of returning empty

Every provider here can fail for a reason worth reading — a missing key, a
rate limit, a SearXNG instance that is up but has no working engines. Returning
an empty list for all of those makes an unreachable provider and a genuinely
empty result set look identical, so each attempt records what happened and
`search()` hands back the whole ledger. The panel shows it, and the fallback
chain becomes something you can watch work rather than infer.
"""

from __future__ import annotations

import html
import json
import logging
import os
import time
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any, Final
from urllib.parse import parse_qs, urlparse

import httpx

from ..db import search_store as store

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT: Final = 15.0

# A plain, honest identifier. Not a browser string: pretending to be Firefox to
# get past a block is exactly the kind of thing a safety-adjacent project should
# not be doing quietly.
USER_AGENT: Final = "Daedalus/0.1 (research assistant; setup surface)"

DISABLED: Final = "disabled"

# Where the `with-search` compose profile publishes SearXNG. A default, not an
# override: a URL saved in the panel wins, so pointing at an instance that is
# not the bundled one stays a matter of typing an address.
#
# The container is the recommended way to run this provider — it is the only
# one where the query reaches a process on this machine instead of a company
# with a log of what a reactor operator searched for.
def _env_searxng_url() -> str:
    return (os.environ.get("SEARXNG_URL") or "").strip().rstrip("/")


def searxng_url(stored: str | None = None) -> str:
    """The instance a SearXNG search would hit: stored first, then the env."""
    return (stored or "").strip().rstrip("/") or _env_searxng_url()


class SearchError(RuntimeError):
    """A provider could not answer, with a reason worth showing."""


class SearchDisabled(SearchError):
    """No provider is selected. Distinct from a provider that failed."""


@dataclass(frozen=True)
class Provider:
    id: str
    label: str
    needs_key: bool
    needs_url: bool
    needs_engine_id: bool
    key_label: str
    hint: str
    docs_url: str | None


PROVIDERS: Final[tuple[Provider, ...]] = (
    Provider(
        id="searxng",
        label="SearXNG",
        needs_key=False,
        needs_url=True,
        needs_engine_id=False,
        key_label="",
        hint=(
            "Self-hosted and private — the query reaches a container on this "
            "machine, which fans out to public engines with no key and no "
            "account. Bundled: `./daedalus.sh start --with-search`."
        ),
        docs_url="https://docs.searxng.org/",
    ),
    Provider(
        id="duckduckgo",
        label="DuckDuckGo",
        needs_key=False,
        needs_url=False,
        needs_engine_id=False,
        key_label="",
        hint=(
            "No key, no account. Rate-limited in return, so heavy use starts "
            "returning nothing — worth a fallback underneath it."
        ),
        docs_url=None,
    ),
    Provider(
        id="brave",
        label="Brave Search",
        needs_key=True,
        needs_url=False,
        needs_engine_id=False,
        key_label="Brave API key",
        hint="Independent index. Free tier covers occasional setup work.",
        docs_url="https://brave.com/search/api/",
    ),
    Provider(
        id="google_pse",
        label="Google PSE",
        needs_key=True,
        needs_url=False,
        needs_engine_id=True,
        key_label="Google API key",
        hint=(
            "Google's Programmable Search Engine. Needs both an API key and the "
            "engine id (CX) of a search engine you created. Caps at 10 results."
        ),
        docs_url="https://programmablesearchengine.google.com/",
    ),
    Provider(
        id="tavily",
        label="Tavily",
        needs_key=True,
        needs_url=False,
        needs_engine_id=False,
        key_label="Tavily API key",
        hint="Built for machine reading — returns longer extracts than a SERP.",
        docs_url="https://tavily.com/",
    ),
    Provider(
        id="serper",
        label="Serper",
        needs_key=True,
        needs_url=False,
        needs_engine_id=False,
        key_label="Serper API key",
        hint="Google's results through an API, without a PSE to configure.",
        docs_url="https://serper.dev/",
    ),
)

_BY_ID: Final = {p.id: p for p in PROVIDERS}

# SafeSearch is one canonical setting here and six different knobs out there.
_SAFESEARCH: Final[dict[str, dict[str, str | None]]] = {
    "searxng": {"strict": "2", "moderate": "1", "off": "0"},
    "brave": {"strict": "strict", "moderate": "moderate", "off": "off"},
    "duckduckgo": {"strict": "1", "moderate": "-1", "off": "-2"},
    "google_pse": {"strict": "active", "moderate": "active", "off": None},
    "serper": {"strict": "active", "moderate": "active", "off": None},
    "tavily": {"strict": None, "moderate": None, "off": None},
}


def catalogue() -> list[dict[str, Any]]:
    """The providers offered, with what each one needs configured."""
    return [
        {
            "id": p.id,
            "label": p.label,
            "needs_key": p.needs_key,
            "needs_url": p.needs_url,
            "needs_engine_id": p.needs_engine_id,
            "key_label": p.key_label,
            "hint": p.hint,
            "docs_url": p.docs_url,
        }
        for p in PROVIDERS
    ]


# How long to wait when checking that a configured SearXNG is actually there.
# Short: this runs while a settings panel renders, and an instance that needs
# more than a second to answer a HEAD is not one a search will succeed against.
_REACHABILITY_TIMEOUT: Final = 1.5


def _reachable(base_url: str) -> tuple[bool, str]:
    """Whether a SearXNG instance answers at all.

    Added because "configured" and "working" were the same field, and they are
    not the same thing. `SEARXNG_URL` is set in the container's environment
    whether or not the `with-search` profile is running, so a panel that only
    checked for a URL reported the provider **ready** while every search failed
    with a DNS error. A setup surface whose readiness light is wrong is worse
    than one with no light.
    """
    try:
        response = _get(base_url, timeout=_REACHABILITY_TIMEOUT)
    except httpx.ConnectError:
        return False, f"nothing is listening at {base_url}"
    except httpx.RequestError as exc:
        return False, f"{base_url} did not answer ({exc.__class__.__name__})"
    # Any HTTP answer means something is there; SearXNG's own quirks (a 403 from
    # the limiter, a redirect) are the search path's problem, not reachability's.
    return True, f"answering at {base_url} (HTTP {response.status_code})"


def _configured(provider_id: str, row: dict[str, Any] | None) -> tuple[bool, str]:
    """Whether a provider could run, and what it is waiting for if not."""
    spec = _BY_ID.get(provider_id)
    if spec is None:
        return False, "unknown provider"
    if spec.needs_key and not (row and row["has_key"]):
        return False, f"needs {spec.key_label or 'an API key'}"
    if spec.needs_url:
        base_url = searxng_url((row or {}).get("base_url"))
        if not base_url:
            return False, "needs the URL of a SearXNG instance"
        alive, detail = _reachable(base_url)
        if not alive:
            return False, (
                f"{detail} — start it with `./daedalus.sh dev --with-search` "
                "(or `start --with-search`)"
            )
        return True, detail
    if spec.needs_engine_id and not (row and row["engine_id"]):
        return False, "needs a Programmable Search Engine id"
    return True, "ready"


def status() -> dict[str, Any]:
    """The selection, the catalogue, and what each provider still needs."""
    config = store.read_config()
    rows = store.list_providers()

    providers = []
    for entry in catalogue():
        row = rows.get(entry["id"])
        ready, detail = _configured(entry["id"], row)
        providers.append({
            **entry,
            "ready": ready,
            "ready_detail": detail,
            "base_url": (row or {}).get("base_url"),
            # What it would use with nothing saved — the compose service, when
            # one is configured. The panel shows it as the placeholder so an
            # empty field reads as "the bundled one" rather than "broken".
            "base_url_default": _env_searxng_url() if entry["needs_url"] else None,
            "engine_id": (row or {}).get("engine_id"),
            "key_hint": (row or {}).get("key_hint"),
            "has_key": bool((row or {}).get("has_key")),
            "last_tested_at": (row or {}).get("last_tested_at"),
            "last_test_ok": (row or {}).get("last_test_ok"),
            "last_test_detail": (row or {}).get("last_test_detail"),
            "last_test_count": (row or {}).get("last_test_count"),
            "last_test_ms": (row or {}).get("last_test_ms"),
        })

    selected = next((p for p in providers if p["id"] == config["provider"]), None)
    return {
        **config,
        "enabled": config["provider"] != DISABLED,
        "ready": bool(selected and selected["ready"]),
        "ready_detail": selected["ready_detail"] if selected else "no provider selected",
        "providers": providers,
        # Said once, here, so every surface that renders this config renders the
        # same sentence about what it is allowed to be used for.
        "purpose_detail": (
            "A setup surface (Rule 5). Web results are for finding and checking "
            "the documents M2 ingests — they never reach an answer, and the "
            "query path cannot call this."
        ),
    }


def known(provider_id: str) -> bool:
    return provider_id in _BY_ID


# ── Result shape ──────────────────────────────────────────────────────────────

def _result(title: str, url: str, snippet: str, age: str = "") -> dict[str, str]:
    return {
        "title": (title or "").strip(),
        "url": (url or "").strip(),
        "snippet": (snippet or "").strip(),
        "age": (age or "").strip(),
    }


def _get(url: str, **kwargs: Any) -> httpx.Response:
    headers = {"User-Agent": USER_AGENT, **kwargs.pop("headers", {})}
    kwargs.setdefault("timeout", REQUEST_TIMEOUT)
    return httpx.get(url, headers=headers, **kwargs)


def _post(url: str, **kwargs: Any) -> httpx.Response:
    headers = {"User-Agent": USER_AGENT, **kwargs.pop("headers", {})}
    return httpx.post(url, headers=headers, timeout=REQUEST_TIMEOUT, **kwargs)


def _raise_for_status(response: httpx.Response, label: str) -> None:
    if response.status_code == 429:
        raise SearchError(f"{label} rate limit — try again later or add a fallback")
    if response.status_code in (401, 403):
        raise SearchError(f"{label} rejected the credential ({response.status_code})")
    # Brave answers 422 to an invalid subscription token rather than 401, and
    # "HTTP 422" sends you looking at the query instead of at the key.
    if response.status_code == 422:
        raise SearchError(f"{label} rejected the request (422) — most often an invalid key")
    if response.status_code >= 400:
        raise SearchError(f"{label} returned HTTP {response.status_code}")


def _json(response: httpx.Response, label: str) -> Any:
    try:
        return response.json()
    except (json.JSONDecodeError, ValueError) as exc:
        raise SearchError(f"{label} returned something that is not JSON") from exc


# ── Providers ─────────────────────────────────────────────────────────────────

def _searxng(query: str, count: int, creds: tuple, safesearch: str) -> list[dict[str, str]]:
    base_url = searxng_url(creds[0])
    if not base_url:
        raise SearchError(
            "no SearXNG URL configured — start the bundled one with "
            "`./daedalus.sh start --with-search`, or enter an address"
        )
    params = {
        "q": query,
        "format": "json",
        "language": "en",
        "safesearch": _SAFESEARCH["searxng"][safesearch],
    }
    try:
        response = _get(f"{base_url}/search", params=params)
    except httpx.RequestError as exc:
        raise SearchError(f"SearXNG unreachable at {base_url} ({exc.__class__.__name__})") from exc
    # A SearXNG with the JSON format disabled answers 403 to a valid query, and
    # "check your key" would be the wrong advice — it has no key.
    if response.status_code == 403:
        raise SearchError(
            "SearXNG refused the JSON API. Add `- json` to `search.formats` in its settings.yml"
        )
    _raise_for_status(response, "SearXNG")
    data = _json(response, "SearXNG")

    results = [
        _result(r.get("title", ""), r.get("url", ""), r.get("content", ""))
        for r in (data.get("results") or [])
        if r.get("url")
    ][:count]
    if not results:
        dead = data.get("unresponsive_engines") or []
        if dead:
            names = ", ".join(sorted({str(d[0]) for d in dead if d}))
            raise SearchError(f"SearXNG returned nothing; unresponsive engines: {names}")
    return results


class _DuckDuckGoParser(HTMLParser):
    """Pulls titles, links and snippets out of DuckDuckGo's HTML endpoint.

    `html.parser` from the standard library rather than BeautifulSoup: this is
    the only HTML any part of Daedalus parses, and one scraper is not worth a
    dependency the rest of the backend would then be free to reach for.
    """

    def __init__(self) -> None:
        super().__init__()
        self.results: list[dict[str, str]] = []
        self._capture: str | None = None
        # The tag that opened the capture, and how deep we are inside it.
        # DuckDuckGo wraps matched terms in <b>, so ending on the first close
        # tag truncates every snippet at its first highlighted word.
        self._capture_tag = ""
        self._depth = 0
        self._href = ""
        self._buffer: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self._capture:
            if tag == self._capture_tag:
                self._depth += 1
            return
        if tag not in ("a", "td", "div"):
            return
        classes = dict(attrs).get("class") or ""
        if tag == "a" and "result__a" in classes:
            self._capture = "title"
            self._capture_tag = tag
            self._depth = 0
            self._href = dict(attrs).get("href") or ""
            self._buffer = []
        elif "result__snippet" in classes:
            self._capture = "snippet"
            self._capture_tag = tag
            self._depth = 0
            self._buffer = []

    def handle_data(self, data: str) -> None:
        if self._capture:
            self._buffer.append(data)

    def handle_entityref(self, name: str) -> None:
        if self._capture:
            self._buffer.append(html.unescape(f"&{name};"))

    def handle_charref(self, name: str) -> None:
        if self._capture:
            self._buffer.append(html.unescape(f"&#{name};"))

    def handle_endtag(self, tag: str) -> None:
        if not self._capture:
            return
        if tag != self._capture_tag:
            return
        if self._depth:
            self._depth -= 1
            return
        text = html.unescape("".join(self._buffer)).strip()
        if self._capture == "title":
            self.results.append(_result(text, _resolve_ddg(self._href), ""))
        elif self._capture == "snippet" and self.results:
            if not self.results[-1]["snippet"]:
                self.results[-1]["snippet"] = text
        self._capture = None
        self._capture_tag = ""
        self._buffer = []


def _resolve_ddg(raw: str) -> str:
    """DuckDuckGo wraps every result in its own redirector. Unwrap it.

    Only for DuckDuckGo's own host: following an arbitrary `uddg=` from an
    arbitrary domain would be an open redirect this code walks into willingly.
    """
    if not raw:
        return ""
    candidate = f"https:{raw}" if raw.startswith("//") else raw
    parsed = urlparse(candidate)
    host = (parsed.hostname or "").lower()
    if host == "duckduckgo.com" or host.endswith(".duckduckgo.com"):
        target = parse_qs(parsed.query).get("uddg")
        if target:
            return target[0]
    return candidate


def _duckduckgo(query: str, count: int, creds: tuple, safesearch: str) -> list[dict[str, str]]:
    try:
        response = _get(
            "https://html.duckduckgo.com/html/",
            params={"q": query, "kp": _SAFESEARCH["duckduckgo"][safesearch]},
            follow_redirects=True,
        )
    except httpx.RequestError as exc:
        raise SearchError(f"DuckDuckGo unreachable ({exc.__class__.__name__})") from exc
    _raise_for_status(response, "DuckDuckGo")

    parser = _DuckDuckGoParser()
    parser.feed(response.text)
    results = [r for r in parser.results if r["url"]][:count]
    if not results:
        # The rate-limit page is a 200 with no results, which is why this is
        # checked rather than left to the status code.
        if "anomaly" in response.text or "blocked" in response.text.lower():
            raise SearchError("DuckDuckGo is rate-limiting this address")
        raise SearchError("DuckDuckGo returned no parseable results")
    return results


def _brave(query: str, count: int, creds: tuple, safesearch: str) -> list[dict[str, str]]:
    _, api_key, _ = creds
    if not api_key:
        raise SearchError("no Brave API key configured")
    try:
        response = _get(
            "https://api.search.brave.com/res/v1/web/search",
            headers={"X-Subscription-Token": api_key, "Accept": "application/json"},
            params={"q": query, "count": count, "safesearch": _SAFESEARCH["brave"][safesearch]},
        )
    except httpx.RequestError as exc:
        raise SearchError(f"Brave unreachable ({exc.__class__.__name__})") from exc
    _raise_for_status(response, "Brave")
    data = _json(response, "Brave")
    return [
        _result(item.get("title", ""), item.get("url", ""),
                item.get("description", ""), item.get("page_age", ""))
        for item in ((data.get("web") or {}).get("results") or [])
        if item.get("url")
    ][:count]


def _google_pse(query: str, count: int, creds: tuple, safesearch: str) -> list[dict[str, str]]:
    _, api_key, engine_id = creds
    if not api_key:
        raise SearchError("no Google API key configured")
    if not engine_id:
        raise SearchError("no Programmable Search Engine id (CX) configured")
    params: dict[str, Any] = {
        "key": api_key,
        "cx": engine_id,
        "q": query,
        # Google PSE caps a single request at 10, and asking for more is a 400
        # rather than a truncation.
        "num": min(count, 10),
    }
    safe = _SAFESEARCH["google_pse"][safesearch]
    if safe:
        params["safe"] = safe
    try:
        response = _get("https://www.googleapis.com/customsearch/v1", params=params)
    except httpx.RequestError as exc:
        raise SearchError(f"Google PSE unreachable ({exc.__class__.__name__})") from exc
    if response.status_code == 400:
        raise SearchError("Google PSE rejected the request — check the engine id (CX)")
    _raise_for_status(response, "Google PSE")
    data = _json(response, "Google PSE")
    return [
        _result(item.get("title", ""), item.get("link", ""), item.get("snippet", ""))
        for item in (data.get("items") or [])
        if item.get("link")
    ][:count]


def _tavily(query: str, count: int, creds: tuple, safesearch: str) -> list[dict[str, str]]:
    _, api_key, _ = creds
    if not api_key:
        raise SearchError("no Tavily API key configured")
    try:
        response = _post(
            "https://api.tavily.com/search",
            json={"query": query, "max_results": count, "include_answer": False},
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        )
    except httpx.RequestError as exc:
        raise SearchError(f"Tavily unreachable ({exc.__class__.__name__})") from exc
    _raise_for_status(response, "Tavily")
    data = _json(response, "Tavily")
    return [
        _result(item.get("title", ""), item.get("url", ""),
                item.get("content", ""), item.get("published_date", ""))
        for item in (data.get("results") or [])
        if item.get("url")
    ][:count]


def _serper(query: str, count: int, creds: tuple, safesearch: str) -> list[dict[str, str]]:
    _, api_key, _ = creds
    if not api_key:
        raise SearchError("no Serper API key configured")
    payload: dict[str, Any] = {"q": query, "num": count}
    safe = _SAFESEARCH["serper"][safesearch]
    if safe:
        payload["safe"] = safe
    try:
        response = _post(
            "https://google.serper.dev/search",
            json=payload,
            headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
        )
    except httpx.RequestError as exc:
        raise SearchError(f"Serper unreachable ({exc.__class__.__name__})") from exc
    _raise_for_status(response, "Serper")
    data = _json(response, "Serper")
    return [
        _result(item.get("title", ""), item.get("link", ""),
                item.get("snippet", ""), item.get("date", ""))
        for item in (data.get("organic") or [])
        if item.get("link")
    ][:count]


_CALL: Final = {
    "searxng": _searxng,
    "duckduckgo": _duckduckgo,
    "brave": _brave,
    "google_pse": _google_pse,
    "tavily": _tavily,
    "serper": _serper,
}


# ── The chain ─────────────────────────────────────────────────────────────────

def call_provider(provider_id: str, query: str, count: int, safesearch: str = "strict") -> list[dict[str, str]]:
    """One provider, no fallback. Raises `SearchError` with a readable reason."""
    fn = _CALL.get(provider_id)
    if fn is None:
        raise SearchError(f"unknown provider {provider_id!r}")
    return fn(query, count, store.secret_for(provider_id), safesearch)


def provider_chain(config: dict[str, Any] | None = None) -> list[str]:
    """Primary first, then the configured fallbacks, deduplicated.

    No implicit default fallback. Odysseus appends DuckDuckGo when the chain is
    empty, which is friendly on a personal assistant and wrong here: a silent
    second provider is a second party seeing the query that nobody chose.
    """
    config = config or store.read_config()
    primary = config["provider"]
    if primary == DISABLED:
        return []
    chain = [primary]
    for candidate in config["fallback_chain"]:
        if candidate and candidate != DISABLED and candidate in _CALL and candidate not in chain:
            chain.append(candidate)
    return chain


def search(query: str, count: int | None = None) -> dict[str, Any]:
    """Run the chain until one provider answers, and report every attempt."""
    query = (query or "").strip()
    if not query:
        raise SearchError("a query is required")

    config = store.read_config()
    if config["provider"] == DISABLED:
        raise SearchDisabled("web search is disabled")

    count = count or config["result_count"]
    attempts: list[dict[str, Any]] = []

    for provider_id in provider_chain(config):
        started = time.perf_counter()
        try:
            results = call_provider(provider_id, query, count, config["safesearch"])
        except SearchError as exc:
            attempts.append({
                "provider": provider_id,
                "ok": False,
                "detail": str(exc),
                "elapsed_ms": int((time.perf_counter() - started) * 1000),
            })
            logger.info("web search: %s failed (%s)", provider_id, exc)
            continue

        elapsed_ms = int((time.perf_counter() - started) * 1000)
        attempts.append({
            "provider": provider_id,
            "ok": True,
            "detail": f"{len(results)} results",
            "elapsed_ms": elapsed_ms,
        })
        return {
            "query": query,
            "provider": provider_id,
            "results": results,
            "attempts": attempts,
            "elapsed_ms": elapsed_ms,
        }

    raise SearchError(
        "; ".join(f"{a['provider']}: {a['detail']}" for a in attempts)
        or "no provider is configured"
    )


# The probe. Fixed, short and dull on purpose: a test should cost one query's
# quota and tell you nothing about the person running it.
#
# Plain words, no operators. `site:` is a SERP convention, and a provider backed
# by a literature API treats it as three more words to match — so a probe using
# it reported a working Crossref as broken.
PROBE_QUERY: Final = "nuclear reactor safety"


def test_provider(provider_id: str, query: str | None = None) -> dict[str, Any]:
    """Run one provider once and remember how it went.

    Deliberately skips the fallback chain: the question a Test button answers is
    "is *this* provider configured correctly", and a chain that quietly answered
    from a different provider would report a pass for a broken key.
    """
    if not known(provider_id):
        raise SearchError(f"unknown provider {provider_id!r}")

    probe = (query or PROBE_QUERY).strip() or PROBE_QUERY
    safesearch = store.read_config()["safesearch"]
    started = time.perf_counter()
    try:
        results = call_provider(provider_id, probe, 3, safesearch)
    except SearchError as exc:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        store.record_test(
            provider_id, ok=False, detail=str(exc), count=None, elapsed_ms=elapsed_ms
        )
        return {
            "provider": provider_id, "ok": False, "detail": str(exc),
            "results": [], "count": 0, "elapsed_ms": elapsed_ms,
        }

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    top = results[0]["title"] or results[0]["url"] if results else ""
    detail = f"{len(results)} results · top: {top}" if results else "no results returned"
    store.record_test(
        provider_id, ok=bool(results), detail=detail, count=len(results), elapsed_ms=elapsed_ms
    )
    return {
        "provider": provider_id,
        "ok": bool(results),
        "detail": detail,
        "results": results,
        "count": len(results),
        "elapsed_ms": elapsed_ms,
    }
