"""The serving path: what actually answers a chat message.

This is the thin slice of M4, and deliberately only that. It resolves which
model to run, sends the conversation to Ollama, and records what the call cost.
Tool-calling, retrieval and the rest of Layer 7's orchestration are not here.

## Why this exists now, before the rest of M4

Everything the Forge produces was unverifiable without it. `model_config.json`
was written by the Deployment tab and read by nothing; the chat dropdown was
browser state that nothing consumed. Two model-selection surfaces, both pointing
at air, and no way to tell whether either was correct.

It also matters for the evaluation. `model_logs` held only `bench_` rows, so the
latency chapter had benchmarks with nothing to compare them against.
`MODULES.md` §2.3 asks that benchmark and production figures come from one
table; this is the half that was missing.

## Which model answers, and how that is recorded

`model_config.resolve()` decides by default, which means `auto` picks the
best-scoring installed model for whatever machine this is. A caller may override
per request, but an override is logged rather than silently honoured: an
evaluation whose rows cannot be attributed to a model is not an evaluation.

Rule 1 is enforced here rather than trusted. The override is checked against the
locally installed set, so a cloud endpoint cannot answer a live query even if
something upstream offers one — which the chat dropdown currently does.

## Timings

Same split the benchmark settled on, for the same reason: `prefill_ms` and
`generation_ms` come from Ollama's own counters and describe the model;
`time_to_first_token_ms` and `total_inference_ms` are wall clock and describe
what the operator waited through. Deriving one from the other understates the
model by whatever else the machine was doing.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any
from collections.abc import Iterator

from ..db import audit_store
from . import chat_service, model_config, ollama_client

# Long enough for a large model on a slow machine, short enough that a hung
# daemon does not hold a worker forever.
GENERATE_TIMEOUT = 300.0

SYSTEM_PROMPT = (
    "You are Daedalus, an assistant for reactor operators. Answer only from the "
    "evidence and conversation you are given. If you do not have what you need, "
    "say so plainly rather than estimating. Never invent a sensor reading. "
    # Replayed assistant turns are prefixed with a "[time UTC]" stamp so the
    # model can tell how old a referenced value is (see chat_service). Small
    # models copy the format straight into their own replies, which is how
    # llama3.2 opened an answer with "[2026-09-16 10:05 UTC]" in testing.
    "Earlier turns are shown with a timestamp in square brackets so you can "
    "judge how stale a value is. Never write one yourself; reply in plain prose."
)

# Belt and braces for the above. A one-line instruction is not reliable on a 1B
# model, and a leaked stamp is visible in the transcript and in the report.
_LEADING_STAMP = re.compile(r"^\s*\[\s*\d{4}-\d{2}-\d{2}[^\]]*\]\s*")


class NoModelAvailable(RuntimeError):
    """Nothing is installed, or the configured model is not."""


def _installed_tags() -> set[str]:
    try:
        return {
            m["name"]
            for m in ollama_client.list_models()
            if m.get("name") and not m.get("remote")
        }
    except Exception:
        return set()


def choose_model(requested: str | None = None) -> dict[str, Any]:
    """Which model answers this request, and why.

    An override is honoured only when the model is actually installed locally.
    Anything else falls back to the configured choice and says so — quietly
    running a different model than the caller asked for would be worse, but so
    would letting a cloud endpoint serve a live query (Rule 1).
    """
    resolved = model_config.resolve()
    installed = _installed_tags()

    if requested and requested != resolved.get("tag"):
        if requested in installed:
            return {
                "tag": requested,
                "source": "override",
                "reason": f"per-request override to {requested}",
                "config_tag": resolved.get("tag"),
            }
        return {
            "tag": resolved.get("tag"),
            "source": "config",
            "reason": (
                f"requested {requested}, which is not installed locally; "
                f"using the configured model instead"
            ),
            "config_tag": resolved.get("tag"),
            "rejected": requested,
        }

    return {
        "tag": resolved.get("tag"),
        "source": resolved["mode"],
        "reason": resolved["reason"],
        "config_tag": resolved.get("tag"),
    }


def answer_stream(
    session_id: str,
    question: str,
    *,
    model: str | None = None,
    evidence: str | None = None,
) -> Iterator[dict[str, Any]]:
    """Answer one message. Yields progress events, writes the assistant turn, and logs.

    `evidence` is where retrieval will plug in. It is a parameter now, unused by
    any caller, so the prompt is assembled in its final shape rather than being
    rearranged later — the evidence block goes last, immediately before the
    question, because that is the ordering `chat_service` already documents.
    """
    choice = choose_model(model)
    tag = choice["tag"]
    if not tag:
        yield {"phase": "error", "error": choice["reason"]}
        return

    query_id = audit_store.new_query_id()

    # History first, then record the question. The order matters both ways:
    # `build_context` must not see this turn (it is appended to the prompt
    # separately, and would otherwise appear twice), and the store must have it
    # before the answer so the transcript reads user-then-assistant.
    #
    # Recording it before the model call rather than after is deliberate. A
    # failed call then leaves the question in the transcript with no answer,
    # which is what actually happened and is recoverable; writing it afterwards
    # would lose the turn entirely whenever Ollama was down.
    window = chat_service.build_context(session_id)
    user_turn = chat_service.add_user_message(session_id, question)

    messages: list[dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(window.as_prompt_messages())
    if evidence:
        messages.append({"role": "system", "content": f"EVIDENCE:\n{evidence}"})
    messages.append({"role": "user", "content": question})

    started = time.perf_counter()
    first_token_at: float | None = None
    pieces: list[str] = []
    final: dict[str, Any] = {}
    error: str | None = None

    payload = {"model": tag, "messages": messages, "stream": True}

    try:
        if ollama_client.httpx is None:
            raise ollama_client.OllamaUnavailable("httpx is not installed")
        for base in ollama_client.candidate_base_urls():
            try:
                with ollama_client.httpx.stream(
                    "POST",
                    f"{base}/api/chat",
                    json=payload,
                    timeout=ollama_client._timeout(GENERATE_TIMEOUT),
                ) as response:
                    if response.status_code >= 400:
                        response.read()
                        raise ollama_client.OllamaError(
                            ollama_client._error_detail(response)
                        )
                    for line in response.iter_lines():
                        if not line.strip():
                            continue
                        try:
                            event = json.loads(line)
                        except ValueError:
                            continue
                        if event.get("error"):
                            raise ollama_client.OllamaError(str(event["error"]))
                        piece = (event.get("message") or {}).get("content") or ""
                        if piece and first_token_at is None:
                            first_token_at = time.perf_counter()
                        if piece:
                            pieces.append(piece)
                            yield {"phase": "generating", "piece": piece}
                        if event.get("done"):
                            final = event
                break
            except (ollama_client.OllamaError, ollama_client.OllamaUnavailable):
                raise
            except Exception:
                continue
        else:
            raise ollama_client.OllamaUnavailable("no Ollama daemon answered")
    except Exception as exc:  # noqa: BLE001
        error = f"{exc.__class__.__name__}: {exc}"
        yield {"phase": "error", "error": error}

    ended = time.perf_counter()
    total_ms = int((ended - started) * 1000)
    ttft_ms = int((first_token_at - started) * 1000) if first_token_at else None
    text = _LEADING_STAMP.sub("", "".join(pieces)).strip()

    ns = 1_000_000
    audit_store.log(
        "model_logs",
        query_id=query_id,
        model_name=tag,
        temperature=None,
        prompt_token_count=final.get("prompt_eval_count"),
        completion_token_count=final.get("eval_count") or (len(pieces) or None),
        time_to_first_token_ms=ttft_ms,
        total_inference_ms=total_ms,
        prefill_ms=int(final.get("prompt_eval_duration", 0) // ns) or None,
        generation_ms=int(final.get("eval_duration", 0) // ns) or None,
        load_ms=int(final.get("load_duration", 0) // ns) or None,
        # What separates these rows from the Forge's `bench_` ones in the same
        # table. §2.3 wants both here; this is how the analysis tells them apart.
        source="chat",
        status="error" if error else "ok",
        error_message=error,
    )

    if error:
        return

    stored = chat_service.add_assistant_message(
        session_id, text, query_id=query_id, evidence=evidence
    )

    yield {
        "phase": "done",
        "result": {
            "query_id": query_id,
            "session_id": session_id,
            "user_message": user_turn,
            "message": stored,
            "answer": text,
            "model": tag,
            "model_choice": choice,
            "timings": {
                "time_to_first_token_ms": ttft_ms,
                "total_inference_ms": total_ms,
                "prefill_ms": int(final.get("prompt_eval_duration", 0) // ns) or None,
                "generation_ms": int(final.get("eval_duration", 0) // ns) or None,
            },
            "context": {
                "history_messages": len(window.messages),
                "dropped": window.dropped,
                "estimated_tokens": window.estimated_tokens,
                "needs_summary": window.needs_summary,
            },
        }
    }
