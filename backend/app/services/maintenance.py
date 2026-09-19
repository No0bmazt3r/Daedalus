"""Backup, restore, and the per-category wipes behind the Danger Zone.

Ported in shape from the Odysseus System tab, with three differences that come
straight out of what this project is.

## 1. A backup never contains a credential

Odysseus exports everything it has. Here the benchmark API keys, the search
provider keys and an MCP server's headers are deliberately left out, and the
export records only *that a credential is set*. A backup file is the most
copied, least guarded artefact a system produces — it gets emailed, committed by
accident, and left in a downloads folder. Putting keys in one trades a real risk
for the convenience of not re-typing them after a restore.

## 2. The sensor database is not a category

`PROJECT.md` Rule 2: the SCADA subsystem owns that file and Daedalus opens it
read-only. It cannot be wiped from here, exported from here, or restored from
here, and there is no flag that changes that. `reset.sh --sensor` exists for the
one case where somebody genuinely means it, at a terminal, having typed the
word.

## 3. Wiping the audit log is offered, and says what it costs

`ai_logs.db` is the evaluation evidence — §9.2's latency figures, the
groundedness scoring, `trace(query_id)`. Deleting it is sometimes right (a
development machine full of test traffic before a real run) and is never
casual. It is a category like any other; the copy around it is not.

## Why this duplicates `reset.sh`

It does not, quite. `reset.sh` wipes whole databases and re-runs migrations,
from a terminal, with a snapshot taken first, and refuses while the stack is up.
This empties tables in a running system. Different operations for different
moments — and the script stays the one to reach for when the schema itself is
the problem.
"""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from typing import Any, Callable, Final

from ..db import (
    audit_store,
    chat_store,
    mcp_store,
    model_endpoint_store,
    paths,
    prefs_store,
    search_store,
    sqlite_util,
    tool_policy_store,
    vector_store,
)

EXPORT_VERSION: Final = 1


class MaintenanceError(RuntimeError):
    """A wipe or restore that could not be done, with a readable reason."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ── Export ────────────────────────────────────────────────────────────────────

def _config_files() -> dict[str, Any]:
    """The JSON config the Forge and the embedding module commit to disk."""
    out: dict[str, Any] = {}
    for name in ("model_config.json", "embedding_config.json", "rag_config.json"):
        path = paths.CONFIG_DIR / name
        try:
            out[name] = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
    return out


def export_data() -> dict[str, Any]:
    """Everything Daedalus owns that is worth carrying to another machine.

    Deliberately excluded: the sensor database (Rule 2 — not ours), the audit
    log (evidence, and large), the vector index (rebuildable from the corpus by
    re-ingesting, and meaningless without the same embedding model), and every
    credential.
    """
    sessions = chat_store.list_sessions(limit=500, include_archived=True)
    transcripts = {
        s["session_id"]: chat_store.get_messages(s["session_id"], limit=10_000)
        for s in sessions
    }

    return {
        "daedalus_export_version": EXPORT_VERSION,
        "exported_at": _now(),
        "note": (
            "Contains no credentials. API keys, search provider keys and MCP headers "
            "are recorded as set/unset only and must be re-entered after a restore."
        ),
        "prefs": prefs_store.get_all_prefs(),
        "chat": {"sessions": sessions, "messages": transcripts},
        "config": _config_files(),
        "search": {
            "config": search_store.read_config(),
            # `has_key` rather than the key. See the module docstring.
            "providers": [
                {k: v for k, v in row.items() if k != "key_hint"}
                for row in search_store.list_providers().values()
            ],
        },
        "endpoints": [
            {k: v for k, v in row.items() if k not in ("key_hint",)}
            for row in model_endpoint_store.list_endpoints()
        ],
        "mcp_servers": mcp_store.list_servers(),
        "tool_policy": {"locked": sorted(tool_policy_store.locked())},
    }


# ── Import ────────────────────────────────────────────────────────────────────

def import_data(payload: dict[str, Any]) -> dict[str, Any]:
    """Restore what can be restored, and report what was skipped and why.

    Additive: nothing is deleted first. A restore that silently emptied the
    machine it was restoring onto would make "try importing this" an
    irreversible experiment, and the Danger Zone is one screen away for anybody
    who wants that.
    """
    if not isinstance(payload, dict):
        raise MaintenanceError("that file is not a Daedalus export")
    version = payload.get("daedalus_export_version")
    if version != EXPORT_VERSION:
        raise MaintenanceError(
            f"unsupported export version {version!r}; this build reads version {EXPORT_VERSION}"
        )

    restored: dict[str, int] = {}
    skipped: list[str] = []

    for key, value in (payload.get("prefs") or {}).items():
        try:
            prefs_store.set_pref(key, value)
            restored["prefs"] = restored.get("prefs", 0) + 1
        except Exception:  # noqa: BLE001 — one bad key must not abort the restore
            skipped.append(f"pref {key}")

    for name, body in (payload.get("config") or {}).items():
        path = paths.CONFIG_DIR / name
        try:
            paths.CONFIG_DIR.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")
            restored["config"] = restored.get("config", 0) + 1
        except OSError:
            skipped.append(name)

    search_config = (payload.get("search") or {}).get("config")
    if isinstance(search_config, dict):
        try:
            search_store.write_config(
                provider=search_config.get("provider", "disabled"),
                result_count=int(search_config.get("result_count", 5)),
                safesearch=search_config.get("safesearch", "strict"),
                fallback_chain=list(search_config.get("fallback_chain") or []),
            )
            restored["search_config"] = 1
        except Exception:  # noqa: BLE001
            skipped.append("search config")

    for server in payload.get("mcp_servers") or []:
        try:
            mcp_store.create_server(
                label=server["label"],
                transport=server["transport"],
                command=server.get("command"),
                args=server.get("args") or [],
                url=server.get("url"),
            )
            restored["mcp_servers"] = restored.get("mcp_servers", 0) + 1
        except Exception:  # noqa: BLE001 — a duplicate label is the usual reason
            skipped.append(f"mcp server {server.get('label')}")

    for effect in (payload.get("tool_policy") or {}).get("locked") or []:
        try:
            tool_policy_store.lock(effect, "restored from a backup")
            restored["tool_locks"] = restored.get("tool_locks", 0) + 1
        except Exception:  # noqa: BLE001
            skipped.append(f"tool lock {effect}")

    # Chat transcripts are not restored, and this is not an oversight. Session
    # ids are primary keys, `chat_store` assigns them, and re-inserting a
    # transcript under a new id would produce a conversation whose audit rows
    # point at an id that no longer exists — a broken trace is worse than an
    # absent one.
    if payload.get("chat", {}).get("sessions"):
        skipped.append("chat transcripts (ids cannot be re-issued without breaking traces)")

    # Credentials are not in the file to begin with.
    if payload.get("endpoints"):
        skipped.append("endpoint credentials (never exported — re-enter them)")

    return {
        "ok": True,
        "restored": restored,
        "skipped": skipped,
        "detail": (
            f"restored {sum(restored.values())} items"
            + (f", skipped {len(skipped)}" if skipped else "")
        ),
    }


# ── Wipes ─────────────────────────────────────────────────────────────────────

def _wipe_chats() -> int:
    chat_store.init_db()
    with sqlite_util.transaction(chat_store.DB_PATH) as conn:
        count = conn.execute("SELECT COUNT(*) FROM chat_sessions").fetchone()[0]
        conn.execute("DELETE FROM chat_messages")
        conn.execute("DELETE FROM chat_sessions")
    return count


def _wipe_audit() -> int:
    audit_store.init_db()
    total = 0
    with sqlite_util.transaction(audit_store.AUDIT_DB) as conn:
        for table in audit_store.LOG_TABLES:
            total += conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]  # noqa: S608
            conn.execute(f"DELETE FROM {table}")  # noqa: S608
    return total


def _wipe_vector() -> int:
    """Every collection this project owns. Chroma has no 'truncate'."""
    client = vector_store.get_client()
    if client is None:
        raise MaintenanceError("the vector store is not reachable")
    removed = 0
    for index in vector_store.collections():
        try:
            client.delete_collection(index["name"])
            removed += 1
        except Exception as exc:  # noqa: BLE001
            raise MaintenanceError(f"could not delete {index['name']}: {exc}") from exc
    return removed


def _wipe_prefs() -> int:
    prefs_store.init_db()
    with sqlite_util.transaction(prefs_store.DB_PATH) as conn:
        count = conn.execute("SELECT COUNT(*) FROM user_prefs").fetchone()[0]
        conn.execute("DELETE FROM user_prefs")
    return count


def _wipe_endpoints() -> int:
    rows = model_endpoint_store.list_endpoints()
    for row in rows:
        model_endpoint_store.delete_endpoint(row["id"])
    return len(rows)


def _wipe_search() -> int:
    search_store.init_db()
    with sqlite_util.transaction(search_store.DB_PATH) as conn:
        count = conn.execute("SELECT COUNT(*) FROM search_providers").fetchone()[0]
        conn.execute("DELETE FROM search_providers")
    search_store.write_config(
        provider="disabled", result_count=5, safesearch="strict", fallback_chain=[]
    )
    return count


def _wipe_mcp() -> int:
    rows = mcp_store.list_servers()
    for row in rows:
        mcp_store.delete_server(row["id"])
    return len(rows)


def _wipe_workspace() -> int:
    """The agent's scratch directory — whatever `bash`, `python` and `write_file` left."""
    workspace = paths.DATA_DIR / "agent_workspace"
    if not workspace.is_dir():
        return 0
    count = sum(1 for _ in workspace.rglob("*") if _.is_file())
    shutil.rmtree(workspace, ignore_errors=True)
    return count


def _wipe_logs() -> int:
    """The process log and its rotations. Not `ai_logs.db` — that is `audit`."""
    from . import app_logs  # noqa: PLC0415 — avoids an import cycle at boot

    removed = 0
    for path in paths.LOG_DIR.glob(f"{app_logs.LOG_FILE.name}*"):
        try:
            path.unlink()
            removed += 1
        except OSError:
            continue
    return removed


WIPES: Final[dict[str, dict[str, Any]]] = {
    "chats": {
        "label": "Chat transcripts",
        "detail": "Every session and message. Audit rows about them survive.",
        "run": _wipe_chats,
    },
    "audit": {
        "label": "Audit & evaluation logs",
        "detail": (
            "Every tool, retrieval, model, error and feedback row. This is the evidence "
            "§9.2's figures are computed from — deleting it is sometimes right and never "
            "casual."
        ),
        "run": _wipe_audit,
        "grave": True,
    },
    "vector": {
        "label": "Vector index",
        "detail": "Every Chroma collection. Rebuildable by re-ingesting the corpus.",
        "run": _wipe_vector,
    },
    "prefs": {
        "label": "Interface preferences",
        "detail": "Theme, custom themes, layout. The app returns to its defaults.",
        "run": _wipe_prefs,
    },
    "endpoints": {
        "label": "Benchmark endpoints",
        "detail": "Cloud provider rows and their stored API keys.",
        "run": _wipe_endpoints,
    },
    "search": {
        "label": "Search providers",
        "detail": "Provider credentials and the selection, back to disabled.",
        "run": _wipe_search,
    },
    "mcp": {
        "label": "MCP servers",
        "detail": "Every configured server and its pinned tool snapshot.",
        "run": _wipe_mcp,
    },
    "workspace": {
        "label": "Agent workspace",
        "detail": "Files the bash, python and write_file tools created.",
        "run": _wipe_workspace,
    },
    "logs": {
        "label": "Process log",
        "detail": "daedalus.log and its rotations. Not the audit database.",
        "run": _wipe_logs,
    },
}


def categories() -> list[dict[str, Any]]:
    """What the Danger Zone offers, for the panel to render."""
    return [
        {
            "kind": kind,
            "label": spec["label"],
            "detail": spec["detail"],
            "grave": bool(spec.get("grave")),
        }
        for kind, spec in WIPES.items()
    ]


def wipe(kind: str) -> dict[str, Any]:
    """Empty one category. Returns how much went."""
    spec = WIPES.get(kind)
    if spec is None:
        raise MaintenanceError(
            f"unknown category {kind!r}; expected one of {', '.join(WIPES)}"
        )
    run: Callable[[], int] = spec["run"]
    try:
        count = run()
    except MaintenanceError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise MaintenanceError(f"{spec['label']}: {exc.__class__.__name__}: {exc}") from exc
    return {"kind": kind, "label": spec["label"], "count": count,
            "detail": f"removed {count} from {spec['label'].lower()}"}


def wipe_all() -> dict[str, Any]:
    """Every category in turn.

    One failure does not stop the rest: a vector store that is down should not
    prevent the transcripts from being cleared, and a partial result that says
    which part failed is more useful than an exception that says none of it
    happened when some of it did.
    """
    results = []
    for kind in WIPES:
        try:
            results.append({**wipe(kind), "ok": True})
        except MaintenanceError as exc:
            results.append({"kind": kind, "ok": False, "count": 0, "detail": str(exc)})
    total = sum(r["count"] for r in results if r["ok"])
    failed = [r["kind"] for r in results if not r["ok"]]
    return {
        "results": results,
        "total": total,
        "detail": (
            f"removed {total} items across {len(results) - len(failed)} categories"
            + (f"; failed: {', '.join(failed)}" if failed else "")
        ),
    }
