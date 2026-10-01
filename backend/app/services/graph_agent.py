"""Track 2's agent loop — the model chooses each hop.

`research/03` §7 and `PROJECT.md` §5: Track 2 is *agentic* GraphRAG, and this is
the agentic half. Entry points are found exactly as the fixed walk finds them
(`graph_query_natural` — aliases, no embeddings), so the only thing that differs
between Track 2's two modes is **who decides where to walk**: the schema's fixed
order in `graph_walk`, or the local model here. That is the within-track
comparison, and it only means something if everything else is held equal.

## One step

The model is shown the question, the nodes gathered so far, and a numbered list
of the moves the schema allows from them — each move one edge type, in one
direction, from the gathered nodes of the type it starts at. It replies with one
JSON object: a move number (0 to stop), and its verdict on whether what it has
*before* this move already answers the question. A verdict of "sufficient" ends
the loop whatever move came with it.

Moves are offered as numbers rather than asked for by name because a small model
names edges and node ids unreliably, and a reply this loop has to repair is a
reply it cannot record honestly. For the same reason the model does not pick
start nodes: a move walks from all of its start nodes (at most `WALK_FROM`, the
fixed walk's bound), which qwen3:1.7b was seen answering with move numbers in
place of node ids. The agent's choice is *which edge, and when to stop*.

Everything in a reply is checked before it is acted on: an unknown move is
**rejected**, recorded in the path, and costs the step. Two rejections in a row
end the loop — a model that cannot follow the format will not start following
it on the third try.

## Bounded twice

`max_steps` (at most 4, the schema's longest chain) and a wall-clock budget for
the whole loop, model calls included. An HTTP timeout is not a wall-clock bound
— it limits each read, and a cold model load sits inside one — so each model
call runs on a worker thread and the loop waits for it only as long as the
budget has left. A call still running at the deadline is abandoned: the loop
answers from what it has gathered, and the reply, when it comes, is discarded.
The first call after a model was unloaded is the usual casualty; `stop_reason:
"budget"` with no hops is what that looks like in `rag_logs`.

## No model, no loop

Always the committed **local** model, the same rule `query_pipeline.local_model`
follows: the loop sends the question to whatever chooses the hops, and a cloud
override chosen for the answer never asked to cover retrieval. With no local
model installed the fixed walk runs instead, and the path says so
(`mode: "walk"`, `stop_reason: "no_local_model"`) — a fallback recorded as itself
rather than silently counted as an agent run.
"""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from typing import Any, Callable

from . import graph_tools
from . import knowledge_graph as kg
from .query_pipeline import local_model

# The most nodes of one type a single move walks from — the same bound the fixed
# walk uses, so neither mode can reach further in one hop than the other.
WALK_FROM = 4
# Below this, another model call cannot finish inside the budget.
_MIN_CALL_S = 0.3
# Model calls run here so the loop can stop waiting at the deadline. A small
# pool: an abandoned call still occupies a worker until Ollama answers it.
_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="graph-agent")
# How much of each node the model is shown. Labels and types are what it walks
# by; descriptions are for the answer, which sees the full node.
_LABEL_CHARS = 60

_SYSTEM = (
    "You plan a walk through a knowledge graph about a lab CO2 sorption reactor, to gather "
    "evidence for a question. Another step writes the answer; you only choose where to walk. "
    "Reply with JSON and nothing else:\n"
    '{"move": <number of a listed move, or 0 to stop>, "sufficient": <true if the gathered '
    'nodes already answer the question>, "reason": "<at most ten words>"}\n'
    "A question about what to do needs the procedure's steps. A question about a sensor "
    "or a limit needs the sensor and its thresholds. Stop as soon as the gathered nodes "
    "answer it; walk only moves that lead toward the answer."
)

Ask = Callable[..., tuple[dict[str, Any] | None, str | None]]

# What each node type *is*, shown beside every move. Information, not a rule:
# without it qwen3:1.7b walked Sensor → OperatingMode for "what do I do?" three
# times out of three, because a bare type name says nothing about where a move
# leads. It does not say which move to take — that stays the model's choice.
TYPE_MEANING = {
    "Sensor": "a measured quantity",
    "OperatingMode": "the reactor's running mode (Manual/Absorption/Desorption)",
    "Threshold": "a sensor's alarm limit",
    "AnomalyType": "the abnormal condition a limit signals",
    "SOPDocument": "the procedure that resolves a condition",
    "SOPStep": "one step of a procedure",
}


def _brief(node: dict[str, Any]) -> str:
    label = str(node.get("label") or "")[:_LABEL_CHARS]
    return f"{node['id']} ({node.get('type')}) {label}".rstrip()


def _moves(sub: graph_tools.Subgraph, taken: set[tuple[str, bool, tuple[str, ...]]]) -> list[dict[str, Any]]:
    """Every edge the schema allows from the gathered nodes, both directions.

    A move whose exact start set was already walked is left out: walking it again
    reaches nothing new and spends a step.
    """
    moves = []
    for edge, (src_type, dst_type) in kg.EDGE_DOMAINS.items():
        for reverse, start_type, end_type in ((False, src_type, dst_type), (True, dst_type, src_type)):
            starts = tuple(n["id"] for n in sub.of_type(start_type))[:WALK_FROM]
            if not starts or (edge, reverse, starts) in taken:
                continue
            moves.append({
                "number": len(moves) + 1,
                "edge": edge,
                "reverse": reverse,
                "start_type": start_type,
                "end_type": end_type,
                "starts": list(starts),
            })
    return moves


def _prompt(question: str, sub: graph_tools.Subgraph, moves: list[dict[str, Any]], steps_left: int) -> str:
    gathered = "\n".join(f"- {_brief(n)}" for n in sub.nodes.values()) or "- (nothing)"
    listed = "\n".join(
        f"{m['number']}. {m['start_type']} --{m['edge']}{' (backwards)' if m['reverse'] else ''}--> "
        f"{m['end_type']} ({TYPE_MEANING.get(m['end_type'], '')}), from: {', '.join(m['starts'])}"
        for m in moves
    )
    return (
        f"Question: {question}\n\n"
        f"Gathered so far:\n{gathered}\n\n"
        f"Moves available ({steps_left} left):\n{listed}"
    )


def _parse(reply: dict[str, Any] | None, moves: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, str | None]:
    """(move, None) for a usable reply — move None means stop — or (None, why) if not."""
    if not isinstance(reply, dict):
        return None, "no JSON object"
    raw = reply.get("move")
    if isinstance(raw, bool) or not isinstance(raw, (int, str)):
        return None, f"move is not a number: {raw!r}"
    try:
        number = int(raw)
    except ValueError:
        return None, f"move is not a number: {raw!r}"
    if number == 0:
        return {"stop": True}, None
    move = next((m for m in moves if m["number"] == number), None)
    if move is None:
        return None, f"move {number} was not offered"
    return {"stop": False, "move": move}, None


def run(
    query: str,
    *,
    limit: int = 6,
    budget_s: float = 6.0,
    max_steps: int = 4,
    ask: Ask | None = None,
    tag: str | None = None,
) -> dict[str, Any]:
    """Entry search, then model-chosen hops. Same data shape as `graph_walk`.

    `ask` and `tag` exist for tests: a scripted `ask` drives the loop without a
    model, and `tag` stands in for the committed local model.
    """
    ask = ask or local_model.ask_json
    started = time.perf_counter()
    deadline = started + budget_s

    tag = tag or local_model.local_tag()
    path = graph_tools.TraversalPath(entry_query=query, mode="agent", model=tag)
    entries, strategy = graph_tools.graph_query_natural(query, limit=limit)
    path.entry_strategy = strategy
    path.entry_nodes = [n["id"] for n in entries]

    sub = graph_tools.Subgraph()
    for node in entries:
        sub.add_node(node["id"])

    if not tag:
        return _fallback(query, limit, "no_local_model")
    if sub.is_empty:
        path.stop_reason = "no_entry_points"

    taken: set[tuple[str, bool, tuple[str, ...]]] = set()
    strikes = 0
    steps = 0
    while not sub.is_empty:
        if steps >= max_steps:
            path.stop_reason = "step_limit"
            break
        remaining = deadline - time.perf_counter()
        if remaining < _MIN_CALL_S:
            path.stop_reason = "budget"
            break
        moves = _moves(sub, taken)
        if not moves:
            # Nothing left to walk; there is no decision to ask for.
            path.stop_reason = "no_moves"
            break

        call = _POOL.submit(
            ask, _SYSTEM, _prompt(query, sub, moves, max_steps - steps),
            max_tokens=60, timeout=remaining, tag=tag,
        )
        path.model_calls += 1
        try:
            reply, _ = call.result(timeout=remaining)
        except FutureTimeout:
            path.stop_reason = "budget"
            break
        if reply is None and time.perf_counter() >= deadline - _MIN_CALL_S:
            path.stop_reason = "budget"
            break

        decision, problem = _parse(reply, moves)
        verdict = reply.get("sufficient") if isinstance(reply, dict) else None
        reason = reply.get("reason") if isinstance(reply, dict) else None
        # The verdict is about what the *previous* hop produced, so it is
        # attached there — the replay shows "after this hop, enough? why".
        if path.hops and isinstance(verdict, bool):
            path.mark(verdict, str(reason or "")[:200])

        if decision is None:
            path.rejected.append({"step": steps + 1, "reply": reply, "problem": problem})
            steps += 1
            strikes += 1
            if strikes >= 2:
                path.stop_reason = "invalid_replies"
                break
            continue
        strikes = 0

        if decision["stop"] or verdict is True:
            path.stop_reason = "sufficient" if verdict is not False else "model_stopped"
            break

        move = decision["move"]
        taken.add((move["edge"], move["reverse"], tuple(move["starts"])))
        sub = graph_tools.graph_traverse(
            move["starts"], move["edge"], subgraph=sub, path=path, reverse=move["reverse"],
        )
        steps += 1

    walked = sub.as_dict()
    return {
        "data": {
            "nodes": walked["nodes"],
            "edges": walked["edges"],
            "entry_nodes": path.entry_nodes,
            "entry_strategy": strategy,
            "path": path.as_dict(),
            "track": "graph",
        },
        "detail": (
            f"{len(walked['nodes'])} nodes, {path.hop_count} hops chosen by {tag} "
            f"({path.stop_reason}) from {len(entries)} entry points via {strategy}"
            if entries else f"nothing matched ({strategy})"
        ),
    }


def _fallback(query: str, limit: int, reason: str) -> dict[str, Any]:
    """The fixed walk, labelled as a fallback from the agent."""
    from .agent_tools import search  # noqa: PLC0415 — search registers the tools that import this

    result = search.graph_walk(query, limit)
    data = result.get("data") or {}
    if isinstance(data.get("path"), dict):
        data["path"]["stop_reason"] = reason
    result["detail"] = f"{result.get('detail')} — fixed walk, the agent could not run ({reason})"
    return result
