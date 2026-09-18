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
import queue
import re
import threading
import time
from collections.abc import Iterator
from typing import Any

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
    """Nothing is installed, or the configured model is not.

    Kept for callers that want to fail loudly. `answer_stream` does not raise it
    — by the time it knows, it is already a streaming response, so it yields a
    terminal `error` event instead.
    """


def _known_tags() -> tuple[set[str], set[str]]:
    """Tags Ollama will serve, split by where they run: (local, remote)."""
    local: set[str] = set()
    remote: set[str] = set()
    try:
        for m in ollama_client.list_models():
            name = m.get("name")
            if not name:
                continue
            (remote if m.get("remote") else local).add(name)
    except Exception:
        pass
    return local, remote


def _installed_tags() -> set[str]:
    """Local tags only. What `auto` mode and the default path may pick from."""
    return _known_tags()[0]


def choose_model(requested: str | None = None) -> dict[str, Any]:
    """Which model answers this request, where it runs, and why.

    ## Rule 1, and where the line actually sits

    The default path is local and nothing changes that: `model_config.resolve()`
    only ever names a local tag, and `auto` ranks installed models on this disk.

    A caller may nonetheless override to a cloud tag, and that override is
    honoured. This is a deliberate narrowing of Rule 1 from *prevented* to
    *recorded*: the console is an evaluation instrument as well as an operator
    surface, and comparing the local answer with a hosted one is the comparison
    §5 exists to make. Refusing outright pushed that comparison outside the
    system, where nothing logged it at all.

    What makes it defensible is that the choice is never silent. `remote` rides
    on the result, `answer_stream` logs the turn as `source='chat_cloud'`
    instead of `'chat'`, and the transcript marks it. Every Objective 3 query
    filters `source = 'chat'` and therefore keeps describing the local
    production path exactly as before, without being rewritten.

    An override naming a tag Ollama does not have at all still falls back to the
    configured model and says so — quietly answering from something other than
    what was asked for would be worse than refusing.
    """
    resolved = model_config.resolve()
    local, remote = _known_tags()

    if requested and requested != resolved.get("tag"):
        if requested in local:
            return {
                "tag": requested,
                "source": "override",
                "remote": False,
                "reason": f"per-request override to {requested}",
                "config_tag": resolved.get("tag"),
            }
        if requested in remote:
            return {
                "tag": requested,
                "source": "override",
                "remote": True,
                "reason": (
                    f"per-request override to {requested}, which runs on Ollama's "
                    f"cloud. Logged as chat_cloud and excluded from the local "
                    f"latency figures"
                ),
                "config_tag": resolved.get("tag"),
            }
        return {
            "tag": resolved.get("tag"),
            "source": "config",
            "remote": False,
            "reason": (
                f"requested {requested}, which Ollama does not have; "
                f"using the configured model instead"
            ),
            "config_tag": resolved.get("tag"),
            "rejected": requested,
        }

    return {
        "tag": resolved.get("tag"),
        "source": resolved["mode"],
        "remote": False,
        "reason": resolved["reason"],
        "config_tag": resolved.get("tag"),
    }


# Sessions with a generation in flight, keyed by session id. The worker owns the
# entry: it is added before the thread starts and removed in the thread's
# `finally`, so `GET /api/chat/{id}/status` can answer truthfully even after the
# client that started the generation has disconnected.
ACTIVE_GENERATIONS: dict[str, dict[str, Any]] = {}


def answer_stream(
    session_id: str,
    question: str,
    *,
    model: str | None = None,
    evidence: str | None = None,
) -> Iterator[dict[str, Any]]:
    """Answer one message, yielding progress events as the model produces them.

    Yields `{"phase": "generating", "piece": ...}` per token, then exactly one
    terminal event — `{"phase": "done", "result": {...}}` or
    `{"phase": "error", "error": ...}`. Errors are yielded rather than raised:
    by the time the first token is out the HTTP response has already begun, so
    there is no status code left to fail with.

    The model call runs on a worker thread rather than inline. That is what lets
    a generation survive the client going away — the browser navigating off the
    page closes the SSE response, and the turn would otherwise be lost
    mid-flight. The worker finishes, writes the assistant turn, and clears its
    `ACTIVE_GENERATIONS` entry regardless; a returning client polls `/status`
    and picks the transcript back up.

    `evidence` is where retrieval will plug in. It is a parameter now, unused by
    any caller, so the prompt is assembled in its final shape rather than being
    rearranged later — the evidence block goes last, immediately before the
    question, because that is the ordering `chat_service` already documents.
    """
    if session_id in ACTIVE_GENERATIONS:
        yield {
            "phase": "error",
            "error": "a generation is already in progress for this session",
        }
        return

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

    payload = {"model": tag, "messages": messages, "stream": True}

    # `None` is the sentinel that closes the stream. Unbounded on purpose: the
    # worker must never block on a consumer that has gone away.
    events: queue.Queue[dict[str, Any] | None] = queue.Queue()

    state: dict[str, Any] = {
        "pieces": [],
        "started_at": time.time(),
        "model": tag,
    }
    ACTIVE_GENERATIONS[session_id] = state

    def _worker() -> None:
        try:
            started = time.perf_counter()
            first_token_at: float | None = None
            pieces: list[str] = state["pieces"]
            final: dict[str, Any] = {}
            error: str | None = None

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
                                raise ollama_client.error_from(response)
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
                                    events.put({"phase": "generating", "piece": piece})
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
                events.put({"phase": "error", "error": error})

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
                # What separates these rows from the Forge's `bench_` ones in the
                # same table. §2.3 wants both here; this is how the analysis tells
                # them apart.
                source="chat_cloud" if choice.get("remote") else "chat",
                host=ollama_client.serving_host(tag),
                status="error" if error else "ok",
                error_message=error,
            )

            audit_store.log(
                "conversation_logs",
                query_id=query_id,
                session_id=session_id,
                user_query=question,
                model_used=tag,
                response_text=text if not error else None,
                total_latency_ms=total_ms,
                error_message=error,
            )

            if error:
                return

            # Written only on success. A failed call must not leave a blank
            # assistant turn in the transcript that the next prompt would replay
            # as context.
            #
            # `query_id` goes with it: that is the thread joining this turn to its
            # `model_logs` row and, later, to the retrieval and tool rows Ariadne's
            # Thread reassembles. Losing it here would make the transcript and the
            # evidence two unrelated tables.
            stored = chat_service.add_assistant_message(
                session_id, text, query_id=query_id, evidence=evidence, model_tag=tag
            )

            events.put({
                "phase": "done",
                "result": {
                    "query_id": query_id,
                    "session_id": session_id,
                    # Both turns, so the caller can reconcile its optimistic echo
                    # and append the answer without a second round trip to
                    # re-read the transcript.
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
                        # Layer 7 should summarise after responding, never here.
                        "needs_summary": window.needs_summary,
                    },
                }
            })
        except Exception as exc:  # noqa: BLE001
            # The inner try covers the model call. This one covers everything
            # after it — the two audit writes and the transcript write — because
            # a failure there would otherwise leave the consumer blocked on a
            # sentinel that never arrives.
            events.put({"phase": "error", "error": f"{exc.__class__.__name__}: {exc}"})
        finally:
            ACTIVE_GENERATIONS.pop(session_id, None)
            # Always last, and always exactly once: this is what ends the stream.
            events.put(None)

    threading.Thread(target=_worker, name=f"chat-{query_id}", daemon=True).start()

    while True:
        event = events.get()
        if event is None:
            return
        yield event

