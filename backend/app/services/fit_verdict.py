"""The one rule every non-chat model is judged by: safe / marginal / will not fit.

`docs/MODEL_FIT.md` is the contract this implements; read it before adding a
model kind or changing a threshold. Chat models have their own, richer scorer
(`model_fit.py` — weights × quantization × context against two memory pools);
the models that *support* an answer — embedders and re-rankers — are judged
here, on the two things they spend at answer time:

- **Memory**, against the RAM free now. These run beside the chat model, not
  instead of it, so taking more than half of what is free is already a risk.
- **Time**, against the budget their step has inside §9.2's 3-second answer.

Plus any **hard requirement** a kind has that no machine can fix — an embedder
whose window is shorter than a chunk truncates every chunk on every machine,
so it cannot be `safe` anywhere.

The words are the Forge's (`safe`, `marginal`, `will_not_fit`) so every kind of
model reads the same, and so is the recommendation: the strongest model judged
`safe`, or — when none is — the one least over budget, its verdict still saying
it is over.
"""

from __future__ import annotations

from typing import Any, Callable

VERDICTS = ("safe", "marginal", "will_not_fit")

# Over this share of free memory is `marginal`: the chat model needs the rest.
MEMORY_SHARE = 0.5
# Over this multiple of the time budget is `will_not_fit`: the step would spend
# most of the answer on its own.
OVER_BUDGET = 3


def _time(ms: int) -> str:
    return f"{ms} ms" if ms < 1000 else f"{ms / 1000:.1f} s"


def verdict(
    *,
    memory_bytes: int,
    available_bytes: int | None,
    latency_ms: int,
    budget_ms: int,
    hard_failures: list[str] | None = None,
    per: str = "per question",
) -> tuple[str, list[str]]:
    """(`safe` | `marginal` | `will_not_fit`, the reasons in words).

    Unknown free memory is not a failure — the machine could not be read, which
    says nothing about the model — so memory is then simply not judged.
    """
    reasons = list(hard_failures or [])
    level = 2 if reasons else 0
    if available_bytes:
        if memory_bytes > available_bytes:
            level = 2
            reasons.append("needs more memory than is free now")
        elif memory_bytes > available_bytes * MEMORY_SHARE:
            level = max(level, 1)
            reasons.append("would take over half the free memory, beside the chat model")
    if latency_ms > OVER_BUDGET * budget_ms:
        level = 2
        reasons.append(f"~{_time(latency_ms)} {per}, which uses most of the answer budget on its own")
    elif latency_ms > budget_ms:
        level = max(level, 1)
        reasons.append(f"~{_time(latency_ms)} {per}, over its {_time(budget_ms)} budget")
    return VERDICTS[level], reasons


def recommend(
    pool: list[str],
    judged: dict[str, dict[str, Any]],
    quality: Callable[[str], float],
) -> str | None:
    """The strongest `safe` model in `pool`; failing that, the fastest `marginal`.

    `judged[id]` carries `verdict` and `latency_ms`. Ties in quality go to the
    faster model. Nothing `will_not_fit` is ever recommended.
    """
    safe = [m for m in pool if judged[m]["verdict"] == "safe"]
    if safe:
        return max(safe, key=lambda m: (quality(m), -judged[m]["latency_ms"]))
    marginal = [m for m in pool if judged[m]["verdict"] == "marginal"]
    return min(marginal, key=lambda m: judged[m]["latency_ms"], default=None)


def machine() -> dict[str, Any]:
    """Free RAM and CPU from the hardware profile, for any kind's verdict. Never raises."""
    try:
        from . import hardware  # noqa: PLC0415 — heavy-ish, only when a fit is asked for

        profile = hardware.profile()
        memory, cpu = profile.get("memory") or {}, profile.get("cpu") or {}
        return {
            "available_bytes": memory.get("available_bytes"),
            "total_bytes": memory.get("total_bytes"),
            "cpu": cpu.get("model"),
        }
    except Exception:  # noqa: BLE001
        return {"available_bytes": None, "total_bytes": None, "cpu": None}
