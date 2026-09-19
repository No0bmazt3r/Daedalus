"""MCP servers as Daedalus sees them — connect, snapshot, call, report drift.

The layer between `db/mcp_store` (rows) and `mcp_client` (protocol). Everything
here exists to answer one question the protocol does not: **was the tool list the
agent had the one this project was built against?**

`PROJECT.md` §7.2 makes the tool layer deterministic and whitelisted; §5 freezes
both retrieval tracks for the comparison. An MCP server declares its own tools
at connect time and may declare different ones tomorrow, which is the point of
the protocol and is in tension with both. The resolution is not to refuse MCP —
it is to write the list down (`pin`), compare against it on every connection, and
report a difference as drift rather than adopting it silently.

A drifted server still works. It is reported, not disabled: deciding what a
changed tool list means is the operator's call, and silently refusing to run
would be its own kind of surprise.
"""

from __future__ import annotations

from typing import Any

from ..db import mcp_store
from . import mcp_client


def status() -> dict[str, Any]:
    """Every configured server, with its pinned snapshot. No credentials."""
    servers = mcp_store.list_servers()
    return {
        "servers": servers,
        "enabled_count": sum(1 for s in servers if s["enabled"]),
        "tool_count": sum(s["tool_count"] for s in servers if s["enabled"]),
        "protocol_version": mcp_client.PROTOCOL_VERSION,
    }


def connect(server_id: str, *, pin: bool = False) -> dict[str, Any]:
    """Handshake, list the tools, compare against the snapshot, record the result.

    `pin=False` by default, including on the first connection. Pinning is a
    decision — *this is the tool list the results were produced with* — and doing
    it automatically would make the snapshot follow whatever the server last
    said, which is exactly the state it exists to detect.
    """
    secret = mcp_store.secret_for(server_id)
    try:
        info = mcp_client.handshake(secret)
    except mcp_client.McpError as exc:
        mcp_store.record_connection(server_id, ok=False, error=str(exc))
        return {
            "ok": False, "server_id": server_id, "label": secret["label"],
            "detail": str(exc), "tools": [], "drifted": False,
        }

    mcp_store.record_connection(
        server_id,
        ok=True,
        error=None,
        server_name=info["server_name"],
        server_version=info["server_version"],
        protocol_version=info["protocol_version"],
    )

    drifted, drift_detail = mcp_store.tools_drifted(server_id, info["tools"])
    if pin:
        mcp_store.pin_tools(server_id, info["tools"])
        drifted, drift_detail = False, "pinned just now"

    return {
        "ok": True,
        "server_id": server_id,
        "label": secret["label"],
        "server_name": info["server_name"],
        "server_version": info["server_version"],
        "protocol_version": info["protocol_version"],
        "tools": info["tools"],
        "drifted": drifted,
        "drift_detail": drift_detail,
        "detail": (
            f"{info['server_name'] or secret['label']} offers {len(info['tools'])} tools"
            + (f" · DRIFT: {drift_detail}" if drifted else "")
        ),
    }


def pin(server_id: str) -> dict[str, Any]:
    """Freeze the current tool list as the one of record."""
    result = connect(server_id, pin=True)
    if not result["ok"]:
        raise mcp_client.McpError(result["detail"])
    return mcp_store.get_server(server_id)


def resolve(label: str) -> dict[str, Any]:
    """Find an enabled server by the label a tool call used."""
    server = mcp_store.find_by_label(label)
    if server is None:
        known = [s["label"] for s in mcp_store.list_servers() if s["enabled"]]
        raise mcp_client.McpError(
            f"no MCP server labelled {label!r}"
            + (f"; configured: {', '.join(known)}" if known else "; none are configured")
        )
    if not server["enabled"]:
        raise mcp_client.McpError(f"the MCP server {label!r} is disabled")
    return server


def list_tools(label: str) -> dict[str, Any]:
    """What one server offers right now, and whether that matches the snapshot."""
    server = resolve(label)
    result = connect(server["id"])
    if not result["ok"]:
        raise mcp_client.McpError(result["detail"])
    return result


def call(label: str, tool: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
    """Call one tool on one server, if the snapshot accounts for it.

    The pinned list is the whitelist §7.2 asks for. A server with no snapshot is
    refused outright, and a tool that appeared after the snapshot was taken is
    refused too — it grew *outside* the review every other tool in this project
    goes through.
    """
    server = resolve(label)
    pinned = server["tools"]
    if pinned is None:
        # Unpinned means unreviewed. Allowing the call "just this once" is how a
        # tool nobody wrote down ends up in a result, which is the single thing
        # the snapshot exists to prevent.
        raise mcp_client.McpError(
            f"{label} has no pinned tool list, so nothing on it can be called. "
            "Pin it in Settings → Integrations — that is the snapshot results get "
            "attributed to."
        )

    names = {t.get("name") for t in pinned}
    if tool not in names:
        raise mcp_client.McpError(
            f"{tool!r} is not in {label}'s pinned tool list "
            f"({', '.join(sorted(n for n in names if n))}). "
            "Re-pin the server in Settings if it is meant to be there."
        )

    secret = mcp_store.secret_for(server["id"])
    return {**mcp_client.call_tool(secret, tool, arguments), "server": label}
