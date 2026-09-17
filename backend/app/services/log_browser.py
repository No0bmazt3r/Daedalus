"""Read-only browser over the stores Daedalus owns.

Backs the "what is actually in the database right now" viewer. It exists
because the audit trail is only useful if you can look at it: `trace(query_id)`
answers *"prove this one response was grounded"*, and this answers *"show me
everything that has been recorded"*.

## Three rules, because this reads raw rows

1. **Allowlist, never reflection.** A caller names a store and a table, and
   both are checked against `BROWSABLE` before any SQL is built. No
   caller-supplied string reaches a query — the same discipline
   `sensor_store.SENSOR_COLUMNS` applies to column names.
2. **Read-only.** Every connection is opened `mode=ro`, so the driver refuses
   writes even if a bug here tried to make one.
3. **Secrets are redacted, and their table is not listed at all.**
   `model_endpoints` holds benchmark API keys and is deliberately absent from
   `BROWSABLE`; `REDACTED_COLUMNS` is the second line of defence in case a
   credential-shaped column is ever added to a table that *is* listed.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Final

from ..db import sqlite_util
from ..db.audit_store import LOG_TABLES
from ..db.paths import AUDIT_DB, CHAT_DB

from ..db.sensor_store import SENSOR_DB

# Store → (database file, tables that may be read).
#
# `prefs` is absent on purpose: it stores whatever the UI chooses to put there,
# so it is not a safe thing to render verbatim. `model_endpoints` is absent for
# the stronger reason that it holds API keys.
BROWSABLE: Final[dict[str, tuple[Path, tuple[str, ...]]]] = {
    "chat": (CHAT_DB, ("chat_sessions", "chat_messages")),
    "audit": (AUDIT_DB, LOG_TABLES),
    "sensor": (SENSOR_DB, ("sensor_readings", "anomaly_records")),
}

# Human labels, so the UI does not have to carry a second copy of this map.
STORE_LABELS: Final[dict[str, str]] = {
    "chat": "Chat Transcripts",
    "audit": "Audit & Evaluation Logs",
    "sensor": "Sensor Telemetry",
}

# Any column whose name contains one of these is replaced with a marker.
# Defence in depth — nothing in BROWSABLE currently has such a column.
REDACTED_COLUMNS: Final[tuple[str, ...]] = ("api_key", "secret", "auth_token", "access_token", "session_token", "bearer", "password")
REDACTED_MARKER: Final = "••• redacted"

DEFAULT_LIMIT: Final = 100
MAX_LIMIT: Final = 1_000

# A single cell that would otherwise push megabytes of text into the browser.
MAX_CELL_CHARS: Final = 4_000


class UnknownTableError(ValueError):
    """The store or table is not on the allowlist — maps to 404."""


def _resolve(store: str, table: str) -> Path:
    """Validate against the allowlist and return the database to open.

    Both names are checked before any SQL string is built, which is what makes
    the f-string interpolation below safe: by this point `table` can only be
    one of the literals declared in `BROWSABLE`.
    """
    entry = BROWSABLE.get(store)
    if entry is None:
        raise UnknownTableError(f"unknown store '{store}'")
    db_path, tables = entry
    if table not in tables:
        raise UnknownTableError(f"'{table}' is not a browsable table in '{store}'")
    return db_path


def _cell(column: str, value: Any) -> Any:
    lowered = column.lower()
    if any(marker in lowered for marker in REDACTED_COLUMNS):
        return REDACTED_MARKER if value is not None else None
    if isinstance(value, str) and len(value) > MAX_CELL_CHARS:
        return value[:MAX_CELL_CHARS] + f"… (+{len(value) - MAX_CELL_CHARS} chars)"
    if isinstance(value, bytes):
        return f"<{len(value)} bytes>"
    return value


def catalogue() -> list[dict[str, Any]]:
    """Every browsable table with its current row count."""
    out: list[dict[str, Any]] = []
    for store, (db_path, tables) in BROWSABLE.items():
        entry: dict[str, Any] = {
            "store": store,
            "label": STORE_LABELS.get(store, store),
            "path": str(db_path),
            "available": db_path.exists(),
            "tables": [],
        }
        if db_path.exists():
            try:
                with sqlite_util.connect(db_path, read_only=True) as conn:
                    for table in tables:
                        try:
                            rows = conn.execute(
                                f"SELECT COUNT(*) AS n FROM {table}"
                            ).fetchone()["n"]
                        except sqlite3.Error:
                            rows = None
                        entry["tables"].append({"name": table, "rows": rows})
            except (sqlite3.Error, sqlite_util.DatabaseUnavailableError) as exc:
                entry["available"] = False
                entry["error"] = str(exc)
        if not entry["tables"]:
            entry["tables"] = [{"name": t, "rows": None} for t in tables]
        out.append(entry)
        
    # Add vector store
    from ..db import vector_store
    vs_stats = vector_store.stats()
    out.append({
        "store": "vector",
        "label": "Vector Knowledge Base",
        "path": vs_stats["target"],
        "available": vs_stats["available"],
        "tables": [{"name": "daedalus_knowledge", "rows": vs_stats.get("documents")}]
    })

    return out


def read(
    store: str,
    table: str,
    *,
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
    newest_first: bool = True,
) -> dict[str, Any]:
    """A page of raw rows, newest first by default."""
    limit = max(1, min(limit, MAX_LIMIT))
    offset = max(0, offset)

    if store == "vector":
        from ..db import vector_store
        collection = vector_store.get_collection()
        if not collection:
            return {
                "store": store,
                "table": table,
                "columns": [],
                "rows": [],
                "total": 0,
                "limit": limit,
                "offset": offset,
                "available": False,
            }
        
        total = collection.count()
        results = collection.get(limit=limit, offset=offset)
        
        # Format results into a table
        rows = []
        if results and results.get('ids'):
            for i in range(len(results['ids'])):
                rows.append({
                    "id": results['ids'][i],
                    "document": _cell("document", results['documents'][i] if results.get('documents') else None),
                    "metadata": _cell("metadata", str(results['metadatas'][i]) if results.get('metadatas') else None)
                })
                
        return {
            "store": store,
            "table": table,
            "columns": ["id", "document", "metadata"],
            "rows": rows,
            "total": total,
            "limit": limit,
            "offset": offset,
            "available": True,
            "redacted_columns": [],
        }

    db_path = _resolve(store, table)

    if not db_path.exists():
        return {
            "store": store,
            "table": table,
            "columns": [],
            "rows": [],
            "total": 0,
            "limit": limit,
            "offset": offset,
            "available": False,
        }

    direction = "DESC" if newest_first else "ASC"
    with sqlite_util.connect(db_path, read_only=True) as conn:
        total = conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]
        cursor = conn.execute(
            f"SELECT * FROM {table} ORDER BY rowid {direction} LIMIT ? OFFSET ?",
            (limit, offset),
        )
        columns = [d[0] for d in cursor.description]
        rows = [
            {col: _cell(col, row[col]) for col in columns} for row in cursor.fetchall()
        ]

    return {
        "store": store,
        "table": table,
        "columns": columns,
        "rows": rows,
        "total": total,
        "limit": limit,
        "offset": offset,
        "available": True,
        "redacted_columns": [
            c for c in columns if any(m in c.lower() for m in REDACTED_COLUMNS)
        ],
    }

