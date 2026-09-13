"""Cloud model endpoints for the offline evaluation baseline.

Rule 1 keeps cloud APIs out of the live runtime and permits them only as
offline benchmark references. These rows describe those references: a base
URL, a credential, and the result of the last connection test.

**Nothing in the query path reads this table.** It exists for the evaluation
harness and for the Settings UI that configures it. The `purpose` column
carries a CHECK that admits only `'benchmark'`, so a row claiming runtime use
cannot be written — see `migrations/prefs/002_model_endpoints.sql`.

## The credential

`api_key` is stored as written. The protections around it are:

- `public()` is the only shape that leaves this module, and it returns
  `key_hint` (`sk-…f4a2`) rather than the key.
- `secret_for(id)` is the single accessor that returns the real value, named
  so that a call site using it is obvious in review.
- `services/log_browser.py` does not list this table, so the raw-log viewer
  cannot render it.
"""

from __future__ import annotations

import secrets
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Any, Final

from . import migrations, sqlite_util
from .paths import PREFS_DB

DB_PATH = PREFS_DB
STORE = "prefs"

MAX_LABEL_CHARS: Final = 120
MAX_URL_CHARS: Final = 500
MAX_KEY_CHARS: Final = 400

_init_lock = threading.Lock()
_initialised = False


class ModelEndpointError(RuntimeError):
    """Base class for this module's errors."""


class EndpointNotFoundError(ModelEndpointError):
    """No endpoint with that id — maps to 404."""


class DuplicateEndpointError(ModelEndpointError):
    """That base URL is already configured — maps to 409."""


def init_db() -> None:
    global _initialised
    with _init_lock:
        if _initialised:
            return
        migrations.migrate(STORE)
        _initialised = True


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_endpoint_id() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S%f")
    return f"ep_{stamp}_{secrets.token_hex(2)}"


def mask(key: str | None) -> str | None:
    """`sk-proj-AbCdEf…9f4a` → `sk-…9f4a`. `None` when no key is stored.

    Enough to tell two keys apart when you have several configured, not
    enough to use. Short keys collapse entirely rather than leaking a
    proportionally larger share of themselves.
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
        "label": row["label"],
        "provider": row["provider"],
        "base_url": row["base_url"],
        "key_hint": mask(row["api_key"]),
        "has_key": bool(row["api_key"]),
        "enabled": bool(row["enabled"]),
        "purpose": row["purpose"],
        "last_tested_at": row["last_tested_at"],
        "last_test_ok": None if row["last_test_ok"] is None else bool(row["last_test_ok"]),
        "last_test_detail": row["last_test_detail"],
        "last_test_models": row["last_test_models"],
    }


def list_endpoints() -> list[dict[str, Any]]:
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT * FROM model_endpoints ORDER BY created_at DESC"
        ).fetchall()
    return [public(r) for r in rows]


def get_endpoint(endpoint_id: str) -> dict[str, Any]:
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        row = conn.execute(
            "SELECT * FROM model_endpoints WHERE id = ?", (endpoint_id,)
        ).fetchone()
    if row is None:
        raise EndpointNotFoundError(endpoint_id)
    return public(row)


def secret_for(endpoint_id: str) -> tuple[str, str, str | None]:
    """`(provider, base_url, api_key)` — the only path to the real credential.

    Deliberately not part of `public()`. A call site that needs this is making
    an outbound request with the user's key, which should be easy to spot.
    """
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        row = conn.execute(
            "SELECT provider, base_url, api_key FROM model_endpoints WHERE id = ?",
            (endpoint_id,),
        ).fetchone()
    if row is None:
        raise EndpointNotFoundError(endpoint_id)
    return row["provider"], row["base_url"], row["api_key"]


def create_endpoint(
    *, label: str, provider: str, base_url: str, api_key: str | None
) -> dict[str, Any]:
    init_db()
    clean_url = base_url.strip().rstrip("/")[:MAX_URL_CHARS]
    clean_label = (label.strip() or provider)[:MAX_LABEL_CHARS]
    clean_key = (api_key or "").strip()[:MAX_KEY_CHARS] or None
    endpoint_id = new_endpoint_id()
    now = _now()

    def _write() -> None:
        with sqlite_util.transaction(DB_PATH) as conn:
            try:
                conn.execute(
                    """
                    INSERT INTO model_endpoints
                        (id, created_at, updated_at, label, provider,
                         base_url, api_key, enabled, purpose)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'benchmark')
                    """,
                    (endpoint_id, now, now, clean_label, provider, clean_url, clean_key),
                )
            except sqlite3.IntegrityError as exc:
                # The unique index on base_url. Reported as a conflict rather
                # than a 500, because it is a user mistake with an obvious fix.
                raise DuplicateEndpointError(clean_url) from exc

    sqlite_util.with_retry(_write, what="create_endpoint")
    return get_endpoint(endpoint_id)


def update_endpoint(
    endpoint_id: str,
    *,
    label: str | None = None,
    api_key: str | None = None,
    enabled: bool | None = None,
) -> dict[str, Any]:
    """Patch a stored endpoint. `api_key=""` clears the stored credential."""
    init_db()
    assignments: list[str] = []
    params: list[Any] = []

    if label is not None:
        assignments.append("label = ?")
        params.append(label.strip()[:MAX_LABEL_CHARS])
    if api_key is not None:
        cleaned = api_key.strip()[:MAX_KEY_CHARS]
        assignments.append("api_key = ?")
        params.append(cleaned or None)
        # A new key invalidates whatever the last test proved.
        assignments += ["last_test_ok = NULL", "last_test_detail = NULL",
                        "last_tested_at = NULL", "last_test_models = NULL"]
    if enabled is not None:
        assignments.append("enabled = ?")
        params.append(int(enabled))

    if assignments:
        assignments.append("updated_at = ?")
        params.extend([_now(), endpoint_id])

        def _write() -> None:
            with sqlite_util.transaction(DB_PATH) as conn:
                cursor = conn.execute(
                    f"UPDATE model_endpoints SET {', '.join(assignments)} WHERE id = ?",
                    params,
                )
                if cursor.rowcount == 0:
                    raise EndpointNotFoundError(endpoint_id)

        sqlite_util.with_retry(_write, what="update_endpoint")

    return get_endpoint(endpoint_id)


def record_test(
    endpoint_id: str, *, ok: bool, detail: str, models: int | None = None
) -> dict[str, Any]:
    """Store the outcome of a connection test.

    Cached so the UI can show a verdict without re-calling a paid endpoint on
    every render.
    """
    init_db()

    def _write() -> None:
        with sqlite_util.transaction(DB_PATH) as conn:
            cursor = conn.execute(
                "UPDATE model_endpoints SET last_tested_at = ?, last_test_ok = ?, "
                "last_test_detail = ?, last_test_models = ?, updated_at = ? "
                "WHERE id = ?",
                (_now(), int(ok), detail[:500], models, _now(), endpoint_id),
            )
            if cursor.rowcount == 0:
                raise EndpointNotFoundError(endpoint_id)

    sqlite_util.with_retry(_write, what="record_test")
    return get_endpoint(endpoint_id)


def delete_endpoint(endpoint_id: str) -> bool:
    init_db()

    def _write() -> bool:
        with sqlite_util.transaction(DB_PATH) as conn:
            return (
                conn.execute(
                    "DELETE FROM model_endpoints WHERE id = ?", (endpoint_id,)
                ).rowcount
                > 0
            )

    return sqlite_util.with_retry(_write, what="delete_endpoint")


def stats() -> dict[str, int]:
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        return {
            "endpoints": conn.execute(
                "SELECT COUNT(*) AS n FROM model_endpoints"
            ).fetchone()["n"],
        }
