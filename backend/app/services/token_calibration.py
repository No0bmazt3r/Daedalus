"""Characters per token, measured rather than assumed — the history budget's unit.

`chat_service.build_context` fits history into `DEFAULT_HISTORY_TOKEN_BUDGET`
tokens, and it cannot tokenize: Ollama has no tokenize endpoint, and each model
family splits text differently. So it counts characters and divides. The divisor
was a flat 4, the usual English-on-GPT figure, and nobody had checked it against
the models this project actually runs.

The check was always possible in principle. Every chat turn logs Ollama's own
`prompt_eval_count` to `model_logs.prompt_token_count`; what was missing was the
length it was counted from. Migration 008 adds `prompt_chars`, and this module
turns the pairs into a ratio.

## How the ratio is chosen

1. The **median** of `prompt_chars / prompt_token_count` over the newest
   `WINDOW` chat rows for the model asked about. Median, not mean: a turn where
   Ollama reused a cached prefix reports a small count for a long prompt, and
   one of those would drag a mean a long way.
2. Too few rows for that model → the same median over every chat row. Models
   differ, but by tens of percent, and a pooled measurement beats a guess.
3. Too few rows at all → `DEFAULT`, the old constant, and `source` says so.

The prompt measured is the whole prompt — system rules, evidence and history
together — and the ratio is applied to history alone. Rule text and evidence
lines are denser in digits and punctuation than chat prose, so the measured
ratio runs slightly low for history, which errs toward a smaller window rather
than an overflowing one. That is the side to err on.

## Cheap enough for every turn

One indexed query, cached for `TTL_S`. A new measurement lands on the next turn
after the cache expires; a ratio that moves by a percent a minute later changes
nothing a budget of 1,200 tokens can notice.
"""

from __future__ import annotations

import statistics
import threading
import time
from typing import Any

from ..db import audit_store, sqlite_util
from ..db.paths import AUDIT_DB

DEFAULT = 4.0
WINDOW = 50
MIN_SAMPLES = 5
TTL_S = 60.0

# A ratio outside this is a bad row (a cached-prefix count, a truncated prompt),
# not a tokenizer. Real tokenizers on English sit between about 2.5 and 5.
_PLAUSIBLE = (1.5, 8.0)

_cache: dict[str | None, tuple[float, dict[str, Any]]] = {}
_lock = threading.Lock()


def _ratios(model: str | None) -> list[float]:
    audit_store.init_db()
    sql = (
        "SELECT prompt_chars, prompt_token_count FROM model_logs "
        "WHERE source IN ('chat', 'chat_cloud') AND status = 'ok' "
        "AND prompt_chars > 0 AND prompt_token_count > 0"
    )
    params: list[Any] = []
    if model:
        sql += " AND model_name = ?"
        params.append(model)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(WINDOW)
    with sqlite_util.connect(AUDIT_DB) as conn:
        rows = conn.execute(sql, params).fetchall()
    out = [r["prompt_chars"] / r["prompt_token_count"] for r in rows]
    return [r for r in out if _PLAUSIBLE[0] <= r <= _PLAUSIBLE[1]]


def calibration(model: str | None = None) -> dict[str, Any]:
    """The ratio to use, with where it came from and how many rows back it."""
    now = time.monotonic()
    with _lock:
        hit = _cache.get(model)
        if hit and now - hit[0] < TTL_S:
            return hit[1]

    result: dict[str, Any] = {"chars_per_token": DEFAULT, "source": "default", "samples": 0, "model": model}
    try:
        if model:
            own = _ratios(model)
            if len(own) >= MIN_SAMPLES:
                result = {"chars_per_token": round(statistics.median(own), 3),
                          "source": "model", "samples": len(own), "model": model}
        if result["source"] == "default":
            pooled = _ratios(None)
            if len(pooled) >= MIN_SAMPLES:
                result = {"chars_per_token": round(statistics.median(pooled), 3),
                          "source": "pooled", "samples": len(pooled), "model": model}
    except Exception:  # noqa: BLE001 — an unreadable audit log means "use the default"
        pass

    with _lock:
        _cache[model] = (now, result)
    return result


def chars_per_token(model: str | None = None) -> float:
    return float(calibration(model)["chars_per_token"])


def estimate(text: str, ratio: float) -> int:
    return max(1, int(len(text) / ratio))


def reset_cache() -> None:
    """For tests, which write rows and want them read at once."""
    with _lock:
        _cache.clear()
