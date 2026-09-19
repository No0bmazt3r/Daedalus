"""Tools that run models and chain tools — `chat_with_model` and `pipeline`.

Both were on the "not offered" list, and both are offered now with the one
constraint that actually mattered kept in place.

## `chat_with_model` and the benchmark

The original objection was that a tool which quietly routes to a different model
makes §8.1's benchmark describe a system nobody deployed. That objection is
about *quietly*, not about routing: a second opinion from a larger local model
is a legitimate thing to want, and hiding it was never the fix.

So the tool exists, it refuses anything Ollama serves from its cloud (Rule 1
is not negotiable here — that is a deployment boundary, not a preference), and
the model it used comes back in the result and goes into `tool_logs`. A
benchmark run that involved a second model can be seen to have involved one.

## `pipeline` and why it is not a loophole

A combinator declaring no effects of its own looks like a way around the gate,
and is not: each step is dispatched through `registry.call()`, which runs the
same surface check, the same argument validation and the same logging it would
have run had the model asked for that tool directly. A locked effect stays
locked inside a pipeline, and every step gets its own `tool_logs` row.

What it buys is fewer round trips. "Find the SOP for this anomaly" is three
calls whose arguments do not depend on each other's *content*, and spending
three inference turns to issue them is three chances to drift.
"""

from __future__ import annotations

from typing import Any

from ... import ollama_client
from ..registry import Effect, Integrity, Param, ToolError, call, register

_MAX_STEPS = 5
_MAX_TOKENS = 1024
_TIMEOUT = 120.0


@register(
    name="chat_with_model",
    category="other",
    summary=(
        "Ask a different local model a question — a second opinion, or a larger model "
        "for a harder sub-problem. Local models only, and the model used is recorded."
    ),
    effects={Effect.INFERENCE},
    integrity=Integrity.CORPUS,
    citable=False,
    params=(
        Param("model", str, "The local model tag, e.g. qwen3:1.7b.", required=True, max_length=120,
              example="qwen3:1.7b"),
        Param("prompt", str, "What to ask it.", required=True, max_length=8000,
              example="Say hello in one sentence."),
        Param("max_tokens", int, "Cap on the reply length.",
              default=256, minimum=1, maximum=_MAX_TOKENS),
    ),
)
def chat_with_model(model: str, prompt: str, max_tokens: int) -> dict[str, Any]:
    """One non-streaming generation against a named local model.

    `citable: False` and `CORPUS` integrity, which is the interesting part. What
    comes back is another language model's output — not a measurement, not a
    document, and not this system's own statement about itself. Rule 3 does not
    get weaker because the text was generated locally: a number from here was
    invented by a model exactly as surely as one invented by the model reading
    it.
    """
    if not ollama_client.available():
        raise ToolError("the model runtime is not reachable")

    installed = {m.get("name") or m.get("model"): m for m in ollama_client.list_models()}
    row = installed.get(model)
    if row is None:
        # Only local tags are suggested. Listing a cloud one as "available" would
        # be pointing at the door this tool refuses to open two lines below.
        local = sorted(k for k, v in installed.items() if k and not v.get("remote"))
        raise ToolError(
            f"{model!r} is not installed; local models: {', '.join(local) or 'none'}"
        )
    if row.get("remote"):
        raise ToolError(
            f"{model} is served from Ollama's cloud. Rule 1 keeps cloud models out of the "
            "live path — they are offline benchmark references only."
        )

    data = ollama_client._request(
        "POST",
        "/api/generate",
        timeout=_TIMEOUT,
        json={
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {"num_predict": max_tokens},
        },
    )
    reply = (data.get("response") or "").strip()
    return {
        "data": {
            "model": model,
            "reply": reply,
            # Straight from the engine's own counters, so the cost of the detour
            # is visible in the log rather than inferred from the latency.
            "eval_count": data.get("eval_count"),
            "prompt_eval_count": data.get("prompt_eval_count"),
        },
        "detail": f"{model} replied with {len(reply)} characters",
    }


@register(
    name="pipeline",
    category="other",
    summary=(
        "Run several tools in one go and get all their results together. Each step is "
        "gated, validated and logged exactly as a direct call would be."
    ),
    effects=set(),
    params=(
        Param("steps", list, "Steps as `tool_name` or `tool_name {\"arg\": \"value\"}`.",
              example="get_current_time, knowledge_status",
              required=True),
    ),
)
def pipeline(steps: list) -> dict[str, Any]:
    """Several calls, one turn.

    Steps are strings rather than objects because that is what a model reliably
    emits into an array: `"graph_lookup {\\"entity\\": \\"co2_ppm\\"}"`. The JSON
    tail is optional and parsed here; anything malformed fails that step and
    leaves the rest alone, since a pipeline that aborts on step two hides
    whatever step three would have said.
    """
    import json  # noqa: PLC0415 — only needed on this path

    if not steps:
        raise ToolError("steps cannot be empty")
    if len(steps) > _MAX_STEPS:
        raise ToolError(f"at most {_MAX_STEPS} steps; got {len(steps)}")

    results = []
    for raw in steps[:_MAX_STEPS]:
        text = str(raw).strip()
        name, _, tail = text.partition(" ")
        arguments: dict[str, Any] = {}
        if tail.strip():
            try:
                parsed = json.loads(tail)
                if not isinstance(parsed, dict):
                    raise ValueError("arguments must be an object")
                arguments = parsed
            except (ValueError, TypeError) as exc:
                results.append({
                    "tool": name, "ok": False, "status": "invalid_arguments",
                    "detail": f"could not read the arguments for {name}: {exc}",
                    "data": None, "citable": False,
                })
                continue
        try:
            # Through the front door: same gate, same validation, same log row.
            results.append(call(name, arguments))
        except ToolError as exc:
            results.append({
                "tool": name, "ok": False, "status": "error", "detail": str(exc),
                "data": None, "citable": False,
            })

    ok = sum(1 for r in results if r.get("ok"))
    return {
        "data": {"steps": results},
        "detail": f"{ok} of {len(results)} steps succeeded",
    }
