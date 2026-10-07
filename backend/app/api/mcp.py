"""MCP servers — configuration, connection and the pinned tool snapshot.

**Rule 5 — setup tools are not runtime tools.** Adding a server is an operator
action and lives here, not in the agent tool layer: a stdio server is a program
this backend executes, so a model able to write that row could name any
executable on the machine. The tools (`mcp_list_servers`, `mcp_list_tools`,
`mcp_call`) can read and use servers; only this API can create one.

Credentials follow the same rule as everywhere else in this project: headers go
in on a POST and come back only as key names, never values.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, HTTPException

from ..db import mcp_store
from ..services import mcp_client, mcp_servers

router = APIRouter(prefix="/api/mcp", tags=["mcp"])


@router.get("/servers")
def list_servers() -> dict[str, Any]:
    """Every configured server and its pinned snapshot."""
    return mcp_servers.status()


@router.post("/servers")
def add_server(
    label: str = Body(..., embed=True),
    transport: str = Body(..., embed=True),
    command: str | None = Body(default=None, embed=True),
    args: list[str] = Body(default=[], embed=True),
    env: dict[str, str] = Body(default={}, embed=True),
    url: str | None = Body(default=None, embed=True),
    headers: dict[str, str] = Body(default={}, embed=True),
) -> dict[str, Any]:
    """Configure a server. Does not connect to it — `test` does that."""
    try:
        mcp_store.create_server(
            label=label, transport=transport, command=command, args=args,
            env=env, url=url, headers=headers,
        )
    except mcp_store.DuplicateServer as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except mcp_store.McpStoreError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return mcp_servers.status()


@router.post("/servers/{server_id}/test")
def test_server(server_id: str, pin: bool = False) -> dict[str, Any]:
    """Handshake and list the tools. `pin=true` freezes the list as the one of record.

    A failed connection is a `200` with `ok: false` — "this server is not
    answering" is the result the button asked for, not an error in asking.
    """
    try:
        result = mcp_servers.connect(server_id, pin=pin)
    except mcp_store.ServerNotFound as exc:
        raise HTTPException(status_code=404, detail=f"no server {server_id}") from exc
    return {**result, "servers": mcp_servers.status()["servers"]}


@router.post("/servers/{server_id}/pin")
def pin_server(server_id: str) -> dict[str, Any]:
    """Freeze the current tool list. This is the snapshot drift is measured against."""
    try:
        mcp_servers.pin(server_id)
    except mcp_store.ServerNotFound as exc:
        raise HTTPException(status_code=404, detail=f"no server {server_id}") from exc
    except mcp_client.McpError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return mcp_servers.status()


@router.patch("/servers/{server_id}")
def update_server(
    server_id: str,
    enabled: bool = Body(..., embed=True),
) -> dict[str, Any]:
    """Enable or disable. A disabled server is refused by `resolve`, not deleted."""
    try:
        mcp_store.set_enabled(server_id, enabled)
    except mcp_store.ServerNotFound as exc:
        raise HTTPException(status_code=404, detail=f"no server {server_id}") from exc
    return mcp_servers.status()


@router.delete("/servers/{server_id}")
def delete_server(server_id: str) -> dict[str, Any]:
    if not mcp_store.delete_server(server_id):
        raise HTTPException(status_code=404, detail=f"no server {server_id}")
    return mcp_servers.status()
