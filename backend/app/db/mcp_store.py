"""MCP servers — the rows, and the tool-list snapshot that keeps them honest.

Sibling of `model_endpoint_store` and `search_store`, with the same credential
discipline: `public()` is the only shape that leaves this module and it never
contains `headers_json`, `secret_for()` is the single accessor that returns it,
and `prefs` is absent from `log_browser.BROWSABLE` so the raw viewer cannot
render any of it.

The part that is specific to MCP is `pin_tools` / `tools_drifted`. See
`migrations/prefs/007_mcp_servers.sql` for why a protocol that lets a server
declare its own tools needs the list written down.
"""

from __future__ import annotations

import hashlib
import json
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
MAX_COMMAND_CHARS: Final = 500
MAX_URL_CHARS: Final = 500

_init_lock = threading.Lock()
_initialised = False


class McpStoreError(RuntimeError):
    """Base class for this module's errors."""


class ServerNotFound(McpStoreError):
    """No server with that id — maps to 404."""


class DuplicateServer(McpStoreError):
    """That label is already used — maps to 409."""


def init_db() -> None:
    global _initialised
    with _init_lock:
        if _initialised:
            return
        migrations.migrate(STORE)
        _initialised = True


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_server_id() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S%f")
    return f"mcp_{stamp}_{secrets.token_hex(2)}"


def tools_hash(tools: list[dict[str, Any]]) -> str:
    """A stable fingerprint of a tool list.

    Names and input schemas only — a server rewording a description has not
    changed what it can do, and treating that as drift would make the signal
    useless within a week. Sorted, so list order is not mistaken for a change.
    """
    material = sorted(
        (t.get("name", ""), json.dumps(t.get("inputSchema") or {}, sort_keys=True))
        for t in tools
    )
    return hashlib.sha256(json.dumps(material).encode()).hexdigest()[:16]


def _loads(raw: str | None, fallback: Any) -> Any:
    try:
        return json.loads(raw) if raw else fallback
    except (TypeError, ValueError):
        return fallback


def public(row: sqlite3.Row) -> dict[str, Any]:
    """The only shape that leaves this module. Never contains `headers_json`."""
    tools = _loads(row["tools_json"], None)
    headers = _loads(row["headers_json"], {})
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "label": row["label"],
        "transport": row["transport"],
        "command": row["command"],
        "args": _loads(row["args_json"], []),
        "env_keys": sorted(_loads(row["env_json"], {})),
        "url": row["url"],
        # Names only. A header's *value* is where an API key lives.
        "header_keys": sorted(headers),
        "has_headers": bool(headers),
        "enabled": bool(row["enabled"]),
        "last_connected_at": row["last_connected_at"],
        "last_error": row["last_error"],
        "server_name": row["server_name"],
        "server_version": row["server_version"],
        "protocol_version": row["protocol_version"],
        "tools": tools,
        "tool_count": len(tools) if tools else 0,
        "tools_hash": row["tools_hash"],
        "tools_pinned_at": row["tools_pinned_at"],
    }


def list_servers() -> list[dict[str, Any]]:
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        rows = conn.execute("SELECT * FROM mcp_servers ORDER BY created_at").fetchall()
    return [public(r) for r in rows]


def get_server(server_id: str) -> dict[str, Any]:
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        row = conn.execute("SELECT * FROM mcp_servers WHERE id = ?", (server_id,)).fetchone()
    if row is None:
        raise ServerNotFound(server_id)
    return public(row)


def find_by_label(label: str) -> dict[str, Any] | None:
    """Servers are addressed by label from a tool call — ids are for the UI."""
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        row = conn.execute("SELECT * FROM mcp_servers WHERE label = ?", (label,)).fetchone()
    return public(row) if row else None


def secret_for(server_id: str) -> dict[str, Any]:
    """Everything needed to actually connect, credentials included.

    Deliberately not part of `public()`. A call site that needs this is about to
    start a process or make a request on the operator's behalf.
    """
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        row = conn.execute("SELECT * FROM mcp_servers WHERE id = ?", (server_id,)).fetchone()
    if row is None:
        raise ServerNotFound(server_id)
    return {
        "id": row["id"],
        "label": row["label"],
        "transport": row["transport"],
        "command": row["command"],
        "args": _loads(row["args_json"], []),
        "env": _loads(row["env_json"], {}),
        "url": row["url"],
        "headers": _loads(row["headers_json"], {}),
    }


def create_server(
    *,
    label: str,
    transport: str,
    command: str | None = None,
    args: list[str] | None = None,
    env: dict[str, str] | None = None,
    url: str | None = None,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    if transport not in ("stdio", "http"):
        raise McpStoreError(f"unknown transport {transport!r}; expected stdio or http")
    label = (label or "").strip()[:MAX_LABEL_CHARS]
    if not label:
        raise McpStoreError("a server needs a label — it is how a tool call names it")
    if transport == "stdio" and not (command or "").strip():
        raise McpStoreError("a stdio server needs a command")
    if transport == "http" and not (url or "").strip():
        raise McpStoreError("an http server needs a url")

    init_db()
    server_id = new_server_id()
    now = _now()
    with sqlite_util.connect(DB_PATH) as conn:
        try:
            conn.execute(
                """
                INSERT INTO mcp_servers (id, created_at, updated_at, label, transport,
                                         command, args_json, env_json, url, headers_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    server_id, now, now, label, transport,
                    (command or "").strip()[:MAX_COMMAND_CHARS] or None,
                    json.dumps([str(a) for a in (args or [])]),
                    json.dumps({str(k): str(v) for k, v in (env or {}).items()}),
                    (url or "").strip()[:MAX_URL_CHARS] or None,
                    json.dumps({str(k): str(v) for k, v in (headers or {}).items()}),
                ),
            )
            conn.commit()
        except sqlite3.IntegrityError as exc:
            raise DuplicateServer(f"a server labelled {label!r} already exists") from exc
    return get_server(server_id)


def set_enabled(server_id: str, enabled: bool) -> dict[str, Any]:
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        cursor = conn.execute(
            "UPDATE mcp_servers SET enabled = ?, updated_at = ? WHERE id = ?",
            (int(enabled), _now(), server_id),
        )
        conn.commit()
    if not cursor.rowcount:
        raise ServerNotFound(server_id)
    return get_server(server_id)


def delete_server(server_id: str) -> bool:
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        cursor = conn.execute("DELETE FROM mcp_servers WHERE id = ?", (server_id,))
        conn.commit()
        return cursor.rowcount > 0


def record_connection(
    server_id: str,
    *,
    ok: bool,
    error: str | None = None,
    server_name: str | None = None,
    server_version: str | None = None,
    protocol_version: str | None = None,
) -> None:
    """Remember how the last handshake went, so the panel need not reconnect."""
    init_db()
    now = _now()
    with sqlite_util.connect(DB_PATH) as conn:
        conn.execute(
            """
            UPDATE mcp_servers
               SET updated_at = ?,
                   last_connected_at = CASE WHEN ? THEN ? ELSE last_connected_at END,
                   last_error = ?,
                   server_name = COALESCE(?, server_name),
                   server_version = COALESCE(?, server_version),
                   protocol_version = COALESCE(?, protocol_version)
             WHERE id = ?
            """,
            (now, int(ok), now, (error or None), server_name, server_version,
             protocol_version, server_id),
        )
        conn.commit()


def pin_tools(server_id: str, tools: list[dict[str, Any]]) -> dict[str, Any]:
    """Freeze this server's tool list as the one the project was built against.

    Called explicitly, never automatically on connect. Automatic pinning would
    make drift detection meaningless — the snapshot would silently follow
    whatever the server last said, which is the state it exists to notice.
    """
    init_db()
    with sqlite_util.connect(DB_PATH) as conn:
        cursor = conn.execute(
            "UPDATE mcp_servers SET tools_json = ?, tools_hash = ?, tools_pinned_at = ?, "
            "updated_at = ? WHERE id = ?",
            (json.dumps(tools), tools_hash(tools), _now(), _now(), server_id),
        )
        conn.commit()
    if not cursor.rowcount:
        raise ServerNotFound(server_id)
    return get_server(server_id)


def tools_drifted(server_id: str, tools: list[dict[str, Any]]) -> tuple[bool, str]:
    """Whether a live tool list differs from the pinned one, and how.

    Returns `(False, …)` when nothing is pinned: a server that has never been
    frozen cannot have drifted, and calling that drift would cry wolf on every
    first connection.
    """
    server = get_server(server_id)
    pinned = server["tools_hash"]
    if not pinned:
        return False, "no pinned snapshot — nothing to compare against yet"

    current = tools_hash(tools)
    if current == pinned:
        return False, f"matches the snapshot pinned {server['tools_pinned_at']}"

    before = {t.get("name") for t in (server["tools"] or [])}
    after = {t.get("name") for t in tools}
    added = sorted(after - before)
    removed = sorted(before - after)
    changed = []
    if added:
        changed.append(f"added {', '.join(added)}")
    if removed:
        changed.append(f"removed {', '.join(removed)}")
    if not changed:
        changed.append("same tool names, different input schemas")
    return True, "; ".join(changed)
