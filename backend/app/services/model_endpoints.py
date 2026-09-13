"""Cloud provider endpoints — the offline evaluation baseline.

## Why this exists at all, given Rule 1

`PROJECT.md` §3 Rule 1: production is 100% local, and cloud APIs are forbidden
in the live runtime. The same rule permits them "strictly as offline
evaluation baselines", which the project actively needs:

- §5's dual-track comparison is only meaningful against a reference ceiling.
- §2.2 #7 adopts LLM-as-a-judge over *exported logs*, post hoc.

So this module configures credentials for work that happens **after** a run,
over data the local system already produced. Three things keep that honest:

1. `model_endpoints.purpose` has a CHECK admitting only `'benchmark'`, so a
   runtime-purposed cloud endpoint cannot be stored.
2. Nothing in the chat path imports this module. The only outbound call it
   ever makes is `test_endpoint()`, and only when a person clicks Test.
3. Rule 5: setup tools are not runtime tools. This is a setup tool.

## Testing a connection

`GET {base_url}/models` with the provider's auth header. That endpoint is the
OpenAI-compatible convention, costs nothing, and answers the two questions a
user actually has — is the URL right, and is the key accepted — without
spending tokens on a completion.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Final

from ..db import model_endpoint_store as store

# Providers offered in the UI. `base_url` prefills the form; the user can
# always override it, and `custom` exists for anything not listed.
#
# `auth` distinguishes the two header conventions in the wild: OpenAI and its
# many compatible clones use a bearer token, Anthropic uses its own header
# plus a required API version.


@dataclass(frozen=True)
class Provider:
    id: str
    label: str
    base_url: str
    auth: str  # 'bearer' | 'anthropic'
    docs: str


PROVIDERS: Final[tuple[Provider, ...]] = (
    Provider("deepseek", "DeepSeek", "https://api.deepseek.com/v1", "bearer",
             "https://platform.deepseek.com/api_keys"),
    Provider("openai", "OpenAI", "https://api.openai.com/v1", "bearer",
             "https://platform.openai.com/api-keys"),
    Provider("anthropic", "Anthropic", "https://api.anthropic.com/v1", "anthropic",
             "https://console.anthropic.com/settings/keys"),
    Provider("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "bearer",
             "https://openrouter.ai/keys"),
    Provider("groq", "Groq", "https://api.groq.com/openai/v1", "bearer",
             "https://console.groq.com/keys"),
    Provider("mistral", "Mistral", "https://api.mistral.ai/v1", "bearer",
             "https://console.mistral.ai/api-keys"),
    Provider("together", "Together AI", "https://api.together.xyz/v1", "bearer",
             "https://api.together.xyz/settings/api-keys"),
    Provider("google", "Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai",
             "bearer", "https://aistudio.google.com/apikey"),
    Provider("custom", "Custom (OpenAI-compatible)", "", "bearer", ""),
)

_BY_ID: Final = {p.id: p for p in PROVIDERS}

# The version header Anthropic requires on every request.
ANTHROPIC_VERSION: Final = "2023-06-01"

# A test must not hang the settings panel. Generous enough for a cold DNS
# lookup on a slow connection, short enough that a wrong URL fails promptly.
TEST_TIMEOUT_S: Final = 12.0


def providers() -> list[dict[str, Any]]:
    """The provider catalogue the UI renders in its dropdown."""
    return [
        {"id": p.id, "label": p.label, "base_url": p.base_url, "docs": p.docs}
        for p in PROVIDERS
    ]


def is_known_provider(provider_id: str) -> bool:
    return provider_id in _BY_ID


def _auth_headers(provider_id: str, api_key: str | None) -> dict[str, str]:
    provider = _BY_ID.get(provider_id)
    scheme = provider.auth if provider else "bearer"
    if not api_key:
        return {}
    if scheme == "anthropic":
        return {"x-api-key": api_key, "anthropic-version": ANTHROPIC_VERSION}
    return {"Authorization": f"Bearer {api_key}"}


def list_endpoints() -> list[dict[str, Any]]:
    return store.list_endpoints()


def create_endpoint(
    *, provider: str, base_url: str, api_key: str | None, label: str | None = None
) -> dict[str, Any]:
    resolved_url = (base_url or "").strip() or (
        _BY_ID[provider].base_url if provider in _BY_ID else ""
    )
    if not resolved_url:
        raise ValueError("a base URL is required for this provider")
    if not resolved_url.startswith(("http://", "https://")):
        raise ValueError("base URL must start with http:// or https://")

    resolved_label = label or (_BY_ID[provider].label if provider in _BY_ID else provider)
    return store.create_endpoint(
        label=resolved_label, provider=provider, base_url=resolved_url, api_key=api_key
    )


def update_endpoint(endpoint_id: str, **changes: Any) -> dict[str, Any]:
    return store.update_endpoint(endpoint_id, **changes)


def delete_endpoint(endpoint_id: str) -> bool:
    return store.delete_endpoint(endpoint_id)


def test_endpoint(endpoint_id: str) -> dict[str, Any]:
    """Call the provider's model list and record the verdict.

    **This is the one outbound network call in the whole module**, and it only
    happens when someone clicks Test. Every failure mode is turned into a
    sentence a person can act on, rather than a stack trace: a wrong key and an
    unreachable host need different fixes, so they must not read the same.
    """
    provider, base_url, api_key = store.secret_for(endpoint_id)

    try:
        import httpx
    except ImportError:  # pragma: no cover - httpx is a declared dependency
        return store.record_test(
            endpoint_id, ok=False,
            detail="httpx is not installed — run ./sync.sh to install backend deps",
        )

    url = f"{base_url.rstrip('/')}/models"
    started = time.monotonic()

    try:
        response = httpx.get(
            url, headers=_auth_headers(provider, api_key), timeout=TEST_TIMEOUT_S
        )
    except httpx.TimeoutException:
        return store.record_test(
            endpoint_id, ok=False,
            detail=f"timed out after {TEST_TIMEOUT_S:.0f}s — host unreachable or very slow",
        )
    except httpx.HTTPError as exc:
        # Covers DNS failure, refused connections and TLS problems. The class
        # name is more useful than the message, which is often empty.
        return store.record_test(
            endpoint_id, ok=False,
            detail=f"could not reach {url} ({type(exc).__name__})",
        )

    elapsed_ms = int((time.monotonic() - started) * 1000)

    if response.status_code in (401, 403):
        return store.record_test(
            endpoint_id, ok=False,
            detail=f"the key was rejected (HTTP {response.status_code})",
        )
    if response.status_code == 404:
        return store.record_test(
            endpoint_id, ok=False,
            detail=f"no /models endpoint at {base_url} — check the base URL",
        )
    if response.status_code >= 400:
        return store.record_test(
            endpoint_id, ok=False,
            detail=f"provider returned HTTP {response.status_code}",
        )

    # Both shapes are in the wild: OpenAI-compatible `{"data": [...]}` and the
    # plainer `{"models": [...]}`.
    count: int | None = None
    try:
        payload = response.json()
        if isinstance(payload, dict):
            items = payload.get("data") or payload.get("models")
            if isinstance(items, list):
                count = len(items)
    except ValueError:
        # 200 with an unparseable body still proves reachability and auth.
        pass

    detail = (
        f"connected in {elapsed_ms}ms · {count} models available"
        if count is not None
        else f"connected in {elapsed_ms}ms"
    )
    return store.record_test(endpoint_id, ok=True, detail=detail, models=count)
