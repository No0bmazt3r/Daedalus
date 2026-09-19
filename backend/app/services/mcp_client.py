"""A minimal MCP client — `initialize`, `tools/list`, `tools/call`.

## Why this is written here rather than pulled in

MCP is JSON-RPC 2.0 over one of two transports, and the three methods this
project needs are the three above. The official SDK is good and does far more
than that — session management, sampling, prompts, resources, notifications —
none of which Daedalus has anywhere to put.

`requirements.txt` in this project justifies every line it holds, and the rule it
follows is that a dependency earns its place by doing something the codebase
would otherwise get wrong. Three JSON-RPC calls over a pipe is not that. What
*would* be got wrong is the process handling — timeouts, orphaned children, a
server that writes to stdout without being asked — so that is where the care in
this module goes.

## Transports

**stdio** starts the server as a child process and speaks newline-delimited JSON
over its pipes. This is the common case and the sharper one: it is a program
this backend executes, so the environment is scrubbed exactly as the `bash` and
`python` tools scrub theirs, the process gets its own session so a timeout can
kill the whole group, and stderr is captured rather than inherited — a server
that logs to stderr should not interleave with Daedalus' own logs.

**http** posts JSON-RPC to a URL. Same SSRF guard the `web_fetch` tool uses is
*not* applied here, and that is deliberate: an MCP server on `localhost` is the
normal deployment, and unlike `web_fetch` the address is configured by the
operator rather than chosen by a model.

## One connection per call

No pooling, no persistent sessions. A tool call starts the server, handshakes,
calls, and stops it. That costs a process spawn per call and buys three things
worth more: no state carried between calls, no orphan to clean up after a crash,
and a failure that is always attributable to the call that caused it.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from typing import Any, Final

import httpx

PROTOCOL_VERSION: Final = "2025-06-18"
CLIENT_INFO: Final = {"name": "daedalus", "version": "0.1"}

DEFAULT_TIMEOUT: Final = 30.0
# A tool call may legitimately take longer than a handshake, but not forever:
# this sits inside a chat turn with a latency budget.
MAX_TIMEOUT: Final = 120.0
_MAX_RESPONSE_CHARS: Final = 200_000

# Same rule as the execute tools: a child process gets a minimal environment,
# and nothing whose name looks like a credential.
_SECRET_HINT: Final = re.compile(r"(key|token|secret|password|passwd|credential)", re.IGNORECASE)


class McpError(RuntimeError):
    """A server could not be reached, or answered with an error."""


def _child_env(extra: dict[str, str]) -> dict[str, str]:
    """`PATH`, `HOME`, `LANG`, plus whatever the operator configured.

    The operator's own `env` is passed through as given — including a credential,
    if that is what the server needs. What is *not* passed through is Daedalus'
    environment, which holds the Ollama address, the Chroma URL and anything else
    in `.env`.
    """
    env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "HOME": os.environ.get("HOME", "/tmp"),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
    }
    env.update({k: v for k, v in extra.items() if k})
    return env


def _rpc(method: str, params: dict[str, Any] | None, request_id: int) -> str:
    return json.dumps({
        "jsonrpc": "2.0",
        "id": request_id,
        "method": method,
        "params": params or {},
    })


def _notify(method: str, params: dict[str, Any] | None = None) -> str:
    """A JSON-RPC notification — no id, and no response expected."""
    return json.dumps({"jsonrpc": "2.0", "method": method, "params": params or {}})


def _unwrap(payload: dict[str, Any], what: str) -> Any:
    if "error" in payload:
        error = payload["error"] or {}
        raise McpError(f"{what} failed: {error.get('message') or error}")
    return payload.get("result", {})


def _session_stdio(
    server: dict[str, Any], requests: list[str], *, timeout: float
) -> list[dict[str, Any]]:
    """Run one stdio session: write every line, read every response, stop.

    The whole exchange is written up front and the pipe is closed, which is what
    makes this safe to run synchronously — there is no interleaving to deadlock
    on, and the server sees EOF and exits on its own.
    """
    command = (server.get("command") or "").strip()
    if not command:
        raise McpError("this server has no command configured")
    argv = [command, *[str(a) for a in server.get("args") or []]]

    try:
        completed = subprocess.run(  # noqa: S603 — argv is a list, never a shell string
            argv,
            input="\n".join(requests) + "\n",
            capture_output=True,
            text=True,
            timeout=timeout,
            env=_child_env(server.get("env") or {}),
            # Its own session, so a timeout kills whatever the server spawned
            # rather than orphaning it.
            start_new_session=True,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise McpError(f"{command} did not answer within {timeout:.0f}s") from exc
    except FileNotFoundError as exc:
        raise McpError(f"{command} is not installed or not on PATH") from exc
    except PermissionError as exc:
        raise McpError(f"{command} is not executable") from exc

    responses = []
    for line in (completed.stdout or "")[:_MAX_RESPONSE_CHARS].splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            parsed = json.loads(line)
        except ValueError:
            # Servers that print banners to stdout are common enough that this
            # must not be fatal — the JSON-RPC lines are still in there.
            continue
        if isinstance(parsed, dict) and "id" in parsed:
            responses.append(parsed)

    if not responses:
        stderr = (completed.stderr or "").strip()[:300]
        raise McpError(
            f"{command} returned no JSON-RPC response"
            + (f" · stderr: {stderr}" if stderr else "")
        )
    return responses


def _session_http(
    server: dict[str, Any], requests: list[str], *, timeout: float
) -> list[dict[str, Any]]:
    """Post each request in turn. No session id — these three calls are stateless."""
    url = (server.get("url") or "").strip()
    if not url:
        raise McpError("this server has no url configured")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
        **{str(k): str(v) for k, v in (server.get("headers") or {}).items()},
    }

    responses: list[dict[str, Any]] = []
    try:
        with httpx.Client(timeout=timeout, follow_redirects=False) as client:
            for body in requests:
                payload = json.loads(body)
                response = client.post(url, content=body, headers=headers)
                if response.status_code >= 400:
                    raise McpError(f"{url} returned HTTP {response.status_code}")
                # A notification has no id and the server answers 202 with no
                # body; nothing to collect.
                if "id" not in payload or not (response.text or "").strip():
                    continue
                responses.append(_parse_http_body(response.text, url))
    except httpx.RequestError as exc:
        raise McpError(f"could not reach {url} ({exc.__class__.__name__})") from exc
    return responses


def _parse_http_body(text: str, url: str) -> dict[str, Any]:
    """JSON, or the first JSON object out of an SSE stream.

    Streamable-HTTP servers may answer a single request with `text/event-stream`
    even when there is exactly one message in it, so a client that only reads
    JSON works against some servers and mysteriously not others.
    """
    body = text.strip()
    if body.startswith("{"):
        try:
            return json.loads(body)
        except ValueError as exc:
            raise McpError(f"{url} returned a body that is not JSON") from exc

    for line in body.splitlines():
        if line.startswith("data:"):
            chunk = line[5:].strip()
            if chunk:
                try:
                    return json.loads(chunk)
                except ValueError:
                    continue
    raise McpError(f"{url} returned no readable JSON-RPC message")


def _exchange(
    server: dict[str, Any], requests: list[str], *, timeout: float
) -> dict[int, dict[str, Any]]:
    timeout = max(1.0, min(timeout, MAX_TIMEOUT))
    transport = server.get("transport")
    if transport == "stdio":
        responses = _session_stdio(server, requests, timeout=timeout)
    elif transport == "http":
        responses = _session_http(server, requests, timeout=timeout)
    else:
        raise McpError(f"unknown transport {transport!r}")
    return {r["id"]: r for r in responses if isinstance(r.get("id"), int)}


def _initialize_request() -> str:
    return _rpc("initialize", {
        "protocolVersion": PROTOCOL_VERSION,
        # Honest about what this client supports: nothing beyond calling tools.
        # Declaring sampling or roots would invite a server to use them.
        "capabilities": {},
        "clientInfo": CLIENT_INFO,
    }, 1)


def handshake(server: dict[str, Any], *, timeout: float = DEFAULT_TIMEOUT) -> dict[str, Any]:
    """Connect, initialize, and list the tools. One session, then gone."""
    requests = [
        _initialize_request(),
        _notify("notifications/initialized"),
        _rpc("tools/list", {}, 2),
    ]
    responses = _exchange(server, requests, timeout=timeout)

    if 1 not in responses:
        raise McpError("the server did not answer `initialize`")
    init = _unwrap(responses[1], "initialize")
    info = init.get("serverInfo") or {}

    tools: list[dict[str, Any]] = []
    if 2 in responses:
        tools = (_unwrap(responses[2], "tools/list") or {}).get("tools") or []

    return {
        "server_name": info.get("name"),
        "server_version": info.get("version"),
        "protocol_version": init.get("protocolVersion"),
        "capabilities": init.get("capabilities") or {},
        "tools": [
            {
                "name": t.get("name"),
                "description": t.get("description") or "",
                "inputSchema": t.get("inputSchema") or {},
            }
            for t in tools
            if t.get("name")
        ],
    }


def call_tool(
    server: dict[str, Any],
    tool: str,
    arguments: dict[str, Any] | None = None,
    *,
    timeout: float = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """Initialize and call one tool in the same session.

    MCP requires the handshake before any other request, and since a session
    lasts exactly one exchange here, every call carries its own.
    """
    requests = [
        _initialize_request(),
        _notify("notifications/initialized"),
        _rpc("tools/call", {"name": tool, "arguments": arguments or {}}, 2),
    ]
    responses = _exchange(server, requests, timeout=timeout)
    if 2 not in responses:
        raise McpError(f"the server did not answer a call to {tool!r}")

    result = _unwrap(responses[2], f"tools/call {tool}")
    content = result.get("content") or []

    # `isError` is the protocol's way of saying the *tool* failed while the call
    # itself succeeded. Distinct from a transport failure, and worth keeping
    # distinct: one is the server's answer, the other is not reaching it.
    return {
        "tool": tool,
        "is_error": bool(result.get("isError")),
        "content": content,
        "text": "\n".join(
            block.get("text", "") for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        ).strip(),
        "structured": result.get("structuredContent"),
    }
