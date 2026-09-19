"""The agent tool layer — Layer 8's surface.

Two endpoints and a deliberate asymmetry between them.

`GET /api/tools` is documentation generated from the enforcement. The catalogue
is built from the same declarations the dispatcher gates on, so what the panel
shows and what the orchestrator is actually allowed to do cannot drift.

`POST /api/tools/{name}/try` runs one tool with a person watching. It is not the
orchestrator's path — the orchestrator will call `agent_tools.call()` directly,
in-process, as part of §7.1's step 6. This exists so a tool can be exercised
before there *is* an orchestrator, and so a reader of the report can see what
`graph_traverse` actually returns rather than taking a table's word for it.

Every trial is logged to `tool_logs` under a `try_`-prefixed query id, so an
operator's experiment is distinguishable from a real answer's evidence in the
audit trail rather than being invisible in it.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, HTTPException

from ..db import audit_store, tool_policy_store
from ..services import agent_tools

router = APIRouter(prefix="/api/tools", tags=["tools"])


@router.get("")
def list_tools(surface: str = "runtime") -> dict[str, Any]:
    """The catalogue: every tool, its effects, and whether it may run here."""
    try:
        chosen = agent_tools.Surface(surface)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"unknown surface {surface!r}") from exc
    return agent_tools.catalogue(surface=chosen)


@router.get("/schemas")
def tool_schemas() -> list[dict[str, Any]]:
    """The function-calling payload the model will be given, exactly as sent.

    Worth having as its own endpoint rather than only as an internal call: the
    prompt is the least inspectable part of an LLM system, and this is the half
    of it that can be checked mechanically.
    """
    return agent_tools.schemas()


@router.post("/{name}/try")
def try_tool(
    name: str,
    arguments: dict[str, Any] = Body(default={}, embed=True),
) -> dict[str, Any]:
    """Run one tool once, from Settings, with a person watching.

    A tool that refuses or fails still answers `200`. The envelope's `ok` and
    `status` carry the verdict, because "this tool declined, and here is the
    rule" is the result the panel exists to show — turning it into a 4xx would
    make the interesting case the one the UI renders as a generic error.
    """
    try:
        agent_tools.get(name)
    except agent_tools.ToolNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return agent_tools.call(
        name,
        arguments,
        surface=agent_tools.Surface.RUNTIME,
        query_id=f"try_{audit_store.new_query_id()}",
    )


@router.get("/policy")
def get_policy() -> dict[str, Any]:
    """What is closed and what is switched off. Empty is the default for both."""
    return {
        "locked": sorted(tool_policy_store.locked().values(), key=lambda p: p["effect"]),
        "unlockable": list(tool_policy_store.UNLOCKABLE),
        "disabled": sorted(tool_policy_store.disabled().values(), key=lambda t: t["tool"]),
    }


@router.post("/policy/lock")
def lock_effect(
    effect: str | None = Body(default=None, embed=True),
    note: str | None = Body(default=None, embed=True),
) -> dict[str, Any]:
    """Refuse one effect at runtime. With no effect named, locks everything.

    The "lock everything" path exists because that is the button somebody
    reaches for before recording a result, and making them name four effects one
    at a time is how one gets left open.
    """
    try:
        if effect is None:
            tool_policy_store.lock_all(note)
        else:
            tool_policy_store.lock(effect, note)
    except tool_policy_store.ToolPolicyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return agent_tools.catalogue()


@router.post("/policy/unlock")
def unlock_effect(effect: str | None = Body(default=None, embed=True)) -> dict[str, Any]:
    """Permit an effect again. With none named, restores the default.

    Restoring the default is a delete, so it is idempotent — which is the whole
    reason 006 stores locks rather than permissions.
    """
    try:
        if effect is None:
            tool_policy_store.unlock_all()
        else:
            tool_policy_store.unlock(effect)
    except tool_policy_store.ToolPolicyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return agent_tools.catalogue()


@router.post("/policy/disable")
def disable_tool(
    tool: str = Body(embed=True),
    note: str | None = Body(default=None, embed=True),
) -> dict[str, Any]:
    """Stop offering one tool: out of the model's schema list, refused at dispatch.

    A different axis from lock/unlock above, which is why it is a different pair
    of routes. Locking `network_egress` is a claim about what this machine may
    do while a result is recorded; switching off `web_fetch` is an opinion about
    which tools the model should be choosing between. Collapsing them would mean
    hiding one noisy tool also took the other three that share its effect.

    The name is resolved against the registry first, so a typo is a 404 here
    rather than a row that quietly disables nothing.
    """
    try:
        agent_tools.get(tool)
    except agent_tools.ToolNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    try:
        tool_policy_store.disable(tool, note)
    except tool_policy_store.ToolPolicyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return agent_tools.catalogue()


@router.post("/policy/enable")
def enable_tool(tool: str | None = Body(default=None, embed=True)) -> dict[str, Any]:
    """Offer a tool again. With none named, restores the default — all of them.

    No registry check on the way back: enabling is a delete, and refusing to
    clear the row for a tool that has since been renamed would leave a setting
    nobody can reach. Unknown names simply delete nothing.
    """
    try:
        if tool is None:
            tool_policy_store.enable_all()
        else:
            tool_policy_store.enable(tool)
    except tool_policy_store.ToolPolicyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return agent_tools.catalogue()
