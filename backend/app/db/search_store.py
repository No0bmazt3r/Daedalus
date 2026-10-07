"""Web search configuration — the provider, its credential, and the last test.

The sibling of `model_endpoint_store`, and fenced the same way. Rule 1 keeps
the production runtime local; `search_config.purpose` carries a CHECK admitting
only `'setup'`, so a row claiming a runtime web search cannot be written. See
`migrations/prefs/003_web_search.sql` for what the surface is actually for.

## The credential

`api_key` is stored as written, with the same three protections 002 has:

- `public()` is the only shape that leaves this module, and it returns
  `key_hint` (`tvl…9f4a`) rather than the key.
- `secret_for(provider)` is the single accessor that returns the real value,
  named so a call site making an outbound request with it is obvious in review.
- `services/log_browser.py` does not list these tables, so the raw-log viewer
  cannot render them.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Any, Final

from . import migrations, sqlite_util
from .paths import PREFS_DB

DB_PATH = PREFS_DB
STORE = "prefs"

MAX_URL_CHARS: Final = 500
MAX_KEY_CHARS: Final = 400
MAX_ENGINE_ID_CHARS: Final = 200

_init_lock = threading.Lock()
_initialised = False


class SearchStoreError(RuntimeError):
    """Base class for this module's errors."""


class UnknownProviderError(SearchStoreError):
    """No such provider id — maps to 400."""


def init_db() -> None:
    global _initialised
    with _init_lock:
        if _initialised:
            return
        migrations.migrate(STORE)
        _initialised = True


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def mask(key: str | None) -> str | None:
    """`tvly-AbCdEf…9f4a` → `tvl…9f4a`. `None` when no key is stored.

    Enough to tell two keys apart, not enough to use. Same rule as
    `model_endpoint_store.mask`, and deliberately a separate copy: these are
    different tables with different lifetimes, and importing one store into the
    other to share nine lines would couple them for no gain.
    """
    if not key:
        return None
    cleaned = key.strip()
    if len(cleaned) < 12:
        return "•" * len(cleaned)
    return f"{cleaned[:3]}…{cleaned[-4:]}"


def public(row: sqlite3.Row) -> dict[str, Any]:
    """The only shape that leaves this module. Never contains `api_key`."""
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "base_url": row["base_url"],
        "engine_id": row["engine_id"],
        "key_hint": mask(row["api_key"]),
        "has_key": bool(row["api_key"]),
        "last_tested_at": row["last_tested_at"],
        "last_test_ok": None if row["last_test_ok"] is None else bool(row["last_test_ok"]),
        "last_test_detail": row["last_test_detail"],
        "last_test_count": row["last_test_count"],
        "last_test_ms": row["last_test_ms"],
    }


def list_providers() -> dict[str, dict[str, Any]]:
    """Configured providers, keyed by id. A provider with no row is unconfigured."""
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        rows = conn.execute("SELECT * FROM search_providers").fetchall()
    return {row["id"]: public(row) for row in rows}


def get_provider(provider_id: str) -> dict[str, Any] | None:
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        row = conn.execute(
            "SELECT * FROM search_providers WHERE id = ?", (provider_id,)
        ).fetchone()
    return public(row) if row else None


def secret_for(provider_id: str) -> tuple[str | None, str | None, str | None]:
    """`(base_url, api_key, engine_id)` — the only path to the real credential.

    Deliberately not part of `public()`. A call site that needs this is about to
    make an outbound request on the user's account.
    """
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        row = conn.execute(
            "SELECT base_url, api_key, engine_id FROM search_providers WHERE id = ?",
            (provider_id,),
        ).fetchone()
    if row is None:
        return (None, None, None)
    return (row["base_url"], row["api_key"], row["engine_id"])


def upsert_provider(
    provider_id: str,
    *,
    base_url: str | None = None,
    api_key: str | None = None,
    engine_id: str | None = None,
) -> dict[str, Any]:
    """Write one provider's settings.

    `None` means *leave alone*, which is what makes the key write-only from the
    UI's point of view: the panel never holds a stored key, so it re-submits the
    form without one and the stored credential survives. An empty string is the
    explicit clear.
    """
    init_db()
    now = _now()
    with sqlite_util.connect(DB_PATH) as conn:
        existing = conn.execute(
            "SELECT * FROM search_providers WHERE id = ?", (provider_id,)
        ).fetchone()

        if existing is None:
            conn.execute(
                """
                INSERT INTO search_providers (id, created_at, updated_at, base_url, api_key, engine_id)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    provider_id,
                    now,
                    now,
                    _clip(base_url, MAX_URL_CHARS),
                    _clip(api_key, MAX_KEY_CHARS),
                    _clip(engine_id, MAX_ENGINE_ID_CHARS),
                ),
            )
        else:
            conn.execute(
                """
                UPDATE search_providers
                   SET updated_at = ?,
                       base_url  = COALESCE(?, base_url),
                       api_key   = COALESCE(?, api_key),
                       engine_id = COALESCE(?, engine_id)
                 WHERE id = ?
                """,
                (
                    now,
                    _clip(base_url, MAX_URL_CHARS),
                    _clip(api_key, MAX_KEY_CHARS),
                    _clip(engine_id, MAX_ENGINE_ID_CHARS),
                    provider_id,
                ),
            )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM search_providers WHERE id = ?", (provider_id,)
        ).fetchone()
    return public(row)


def _clip(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    return value.strip()[:limit]


def record_test(
    provider_id: str,
    *,
    ok: bool,
    detail: str,
    count: int | None,
    elapsed_ms: int | None,
) -> None:
    """Remember how the last test went, so the panel need not re-run it."""
    init_db()
    now = _now()
    with sqlite_util.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT INTO search_providers (id, created_at, updated_at, last_tested_at,
                                          last_test_ok, last_test_detail, last_test_count,
                                          last_test_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                updated_at       = excluded.updated_at,
                last_tested_at   = excluded.last_tested_at,
                last_test_ok     = excluded.last_test_ok,
                last_test_detail = excluded.last_test_detail,
                last_test_count  = excluded.last_test_count,
                last_test_ms     = excluded.last_test_ms
            """,
            (provider_id, now, now, now, int(ok), detail[:500], count, elapsed_ms),
        )
        conn.commit()


def read_config() -> dict[str, Any]:
    """The singleton selection row. Always exists — 003 seeds it."""
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        row = conn.execute("SELECT * FROM search_config WHERE id = 1").fetchone()
    if row is None:  # pragma: no cover — the migration seeds it
        return {
            "provider": "disabled",
            "result_count": 5,
            "safesearch": "strict",
            "fallback_chain": [],
            "purpose": "setup",
            "updated_at": None,
        }
    try:
        chain = json.loads(row["fallback_chain"])
    except (TypeError, ValueError):
        chain = []
    return {
        "provider": row["provider"],
        "result_count": row["result_count"],
        "safesearch": row["safesearch"],
        "fallback_chain": [c for c in chain if isinstance(c, str)],
        "purpose": row["purpose"],
        "updated_at": row["updated_at"],
    }


def write_config(
    *,
    provider: str,
    result_count: int,
    safesearch: str,
    fallback_chain: list[str],
) -> dict[str, Any]:
    """Commit the selection. The CHECKs in 003 are the validation of record."""
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        try:
            conn.execute(
                """
                UPDATE search_config
                   SET updated_at = ?, provider = ?, result_count = ?,
                       safesearch = ?, fallback_chain = ?
                 WHERE id = 1
                """,
                (_now(), provider, result_count, safesearch, json.dumps(fallback_chain)),
            )
            conn.commit()
        except sqlite3.IntegrityError as exc:
            raise SearchStoreError(str(exc)) from exc
    return read_config()
