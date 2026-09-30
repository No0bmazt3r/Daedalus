"""The serving path: what actually answers a chat message — PROJECT.md §7.1, all 11 steps.

    1–4   query_pipeline.understand   normalise, rewrite a follow-up, classify, guard
    5–8   orchestration               plan, run tools, build evidence, build prompt
    9     here                        stream the answer from Ollama
    10    orchestration.validator     numbers, citations, control claims
    11    here                        transcript + audit rows, one `query_id`

A turn can end before the model at three points, each with a fixed reply and no
model call: the pipeline refuses it or finds it out of scope, or the planner
cannot place the time it asks about and asks instead. A turn that reaches the
model can still end in §7.1's fallback, when the validator rejects the answer —
the operator then reads the fallback, and the audit row keeps what the model
actually said.

Events on the stream, in order: `understood` (steps 1–4), `evidence` (5–7),
`generating` per token (9), `validated` (10), then exactly one `done` or
`error`. A client that shows tokens as they arrive must replace them with
`done.result.answer`, which is the fallback when validation failed.

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
import uuid
from collections.abc import Iterator
from typing import Any

from ..db import audit_store
from . import (
    chat_service,
    model_config,
    ollama_client,
    orchestration,
    query_pipeline,
    session_titles,
    summariser,
)

# Long enough for a large model on a slow machine, short enough that a hung
# daemon does not hold a worker forever.
GENERATE_TIMEOUT = 300.0

# Belt and braces for the prompt's "never write a timestamp" line
# (`orchestration.prompt`). A one-line instruction is not reliable on a 1B
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


def _finish_without_model(
    session_id: str,
    query_id: str,
    question: str,
    understood: query_pipeline.Understanding,
    user_turn: dict[str, Any],
    window: chat_service.ContextWindow,
    pipeline_log: dict[str, Any],
    turn_started: float,
    events: queue.Queue[dict[str, Any] | None],
    *,
    reply: str | None = None,
    stop: str | None = None,
    plan: orchestration.Plan | None = None,
) -> None:
    """End a turn without a model: a refusal, out of scope, or a clarifying question.

    No model ran, so there is no `model_logs` row — a refusal has no inference
    to time, and an empty row would read as a model call that took 0ms. The
    `conversation_logs` row carries the intent and the guard's reason, which is
    what "the guard refused N% of control phrasings" is counted from.

    `reply`/`stop` default to the pipeline's; the planner passes its own when it
    ends the turn to ask which time was meant.
    """
    total_ms = int((time.perf_counter() - turn_started) * 1000)
    reply = reply if reply is not None else (understood.reply or "")
    stop = stop or understood.stop
    audit_store.log(
        "conversation_logs",
        query_id=query_id,
        session_id=session_id,
        user_query=question,
        model_used=None,
        response_text=reply,
        total_latency_ms=total_ms,
        **pipeline_log,
    )
    stored = chat_service.add_assistant_message(session_id, reply, query_id=query_id)
    summary_scheduled = _maybe_summarise(session_id)
    session_titles.schedule(session_id)
    reason = {
        "too_long": "the message was too long to answer",
        "out_of_scope": "the question is outside what Daedalus covers",
        "clarify": "the question's time could not be placed, so it asked",
    }.get(stop or "", f"refused by the safety guard ({stop})")
    events.put({
        "phase": "done",
        "result": {
            "query_id": query_id,
            "session_id": session_id,
            "user_message": user_turn,
            "message": stored,
            "answer": reply,
            "model": None,
            "model_choice": {
                "tag": None,
                "source": "pipeline",
                "reason": f"answered without a model: {reason}",
            },
            "timings": {
                "time_to_first_token_ms": None,
                "total_inference_ms": None,
                "prefill_ms": None,
                "generation_ms": None,
            },
            "context": {
                "history_messages": len(window.messages),
                "dropped": window.dropped,
                "estimated_tokens": window.estimated_tokens,
                "needs_summary": window.needs_summary,
                "summary_scheduled": summary_scheduled,
            },
            "understanding": understood.as_event(),
            "intent": understood.intent,
            "plan": plan.as_dict() if plan else None,
            "tools_used": [],
            "citations": [],
            "grounded": False,
            "validation": None,
            "latency_ms": total_ms,
        },
    })


def _maybe_summarise(session_id: str) -> bool:
    """Fold turns that no longer fit the history budget — in the background.

    Checked against the window *after* this turn was stored, since the two
    messages just written are what usually pushes the oldest out. The check is
    one read; the summary itself runs on its own thread (`summariser`), so the
    `done` event is never held for it.
    """
    try:
        if chat_service.build_context(session_id).needs_summary:
            return summariser.schedule(session_id)
    except Exception as exc:  # noqa: BLE001 — memory upkeep must not fail a turn
        audit_store.log_error("summariser", exc, level="warning")
    return False


def _log_context(query_id: str, session_id: str, window: chat_service.ContextWindow) -> None:
    """One `memory_logs` row per prompt: what history this turn replayed.

    The transcript says what was *said*; this says what the model was *shown*
    of it — which is less, once turns fall out of the budget — so a claim in
    an answer can be traced to whether the turn it echoes was even in view.
    """
    seqs = [m["seq"] for m in window.messages]
    audit_store.log(
        "memory_logs",
        memory_id=f"ctx_{uuid.uuid4().hex[:12]}",
        session_id=session_id,
        query_id=query_id,
        kind="context",
        content={
            "summary_included": bool(window.summary),
            "summary_upto_seq": window.summary_upto_seq,
            "replayed_seqs": [seqs[0], seqs[-1]] if seqs else [],
            "replayed_messages": len(seqs),
            "dropped": window.dropped,
            "estimated_tokens": window.estimated_tokens,
            "chars_per_token": window.chars_per_token,
            "calibration": window.calibration_source,
        },
        source="build_context",
    )


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
) -> Iterator[dict[str, Any]]:
    """Answer one message, yielding progress events as the model produces them.

    Yields the phase events listed in the module docstring, then exactly one
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
    """
    if session_id in ACTIVE_GENERATIONS:
        yield {
            "phase": "error",
            "error": "a generation is already in progress for this session",
        }
        return

    query_id = audit_store.new_query_id()

    # History before this turn is recorded, so `build_context` does not see the
    # question twice. Read here rather than in the worker because an unknown
    # session raises, and that has to reach the caller as an error event.
    window = chat_service.build_context(session_id)

    # `None` is the sentinel that closes the stream. Unbounded on purpose: the
    # worker must never block on a consumer that has gone away.
    events: queue.Queue[dict[str, Any] | None] = queue.Queue()

    state: dict[str, Any] = {
        "pieces": [],
        "started_at": time.time(),
        # Filled in once the pipeline has decided a model is needed.
        "model": None,
    }
    ACTIVE_GENERATIONS[session_id] = state

    def _worker() -> None:
        try:
            turn_started = time.perf_counter()

            # Steps 1–4. Before the question is recorded, because the record
            # carries its standalone form — the next follow-up is rewritten
            # against that. A refused command never reaches a model here: the
            # pipeline guards the raw text before any model step it might run.
            understood = query_pipeline.understand(question, window.messages)

            # Recorded before any model call rather than after. A failed call
            # then leaves the question in the transcript with no answer, which
            # is what actually happened and is recoverable; writing it
            # afterwards would lose the turn entirely whenever Ollama was down.
            user_turn = chat_service.add_user_message(
                session_id,
                question,
                standalone_query=understood.standalone if understood.rewritten else None,
            )
            events.put({"phase": "understood", **understood.as_event()})

            pipeline_log = {
                "intent": understood.intent,
                "standalone_query": understood.standalone,
                "rewrite_method": understood.rewrite_method,
                "intent_method": understood.intent_method,
                "guard_reason": understood.guard_reason,
            }

            if understood.reply is not None:
                _finish_without_model(
                    session_id, query_id, question, understood, user_turn, window,
                    pipeline_log, turn_started, events,
                )
                return

            # Steps 5–7. Deterministic and model-free: every call goes through
            # the registry's gates and logs its own `tool_logs` / `rag_logs` row.
            t = time.perf_counter()
            plan = orchestration.planner.plan(understood)
            pipeline_log["selected_tools"] = [c.tool for c in plan.calls]
            if plan.clarify:
                _finish_without_model(
                    session_id, query_id, question, understood, user_turn, window,
                    pipeline_log, turn_started, events,
                    reply=plan.clarify, stop="clarify", plan=plan,
                )
                return
            envelopes = orchestration.executor.execute(plan, query_id)
            for env in envelopes:
                # A refusal is policy working; an error is something broken.
                if not env.get("ok") and env.get("status") == "error":
                    audit_store.log_error(
                        f"tool:{env.get('tool')}", str(env.get("detail") or "tool failed"),
                        query_id=query_id, level="warning",
                    )
            pack = orchestration.evidence.build(envelopes, notes=plan.notes)
            pipeline_log["selected_tools"] = pack.tools_used
            evidence_ms = int((time.perf_counter() - t) * 1000)
            events.put({
                "phase": "evidence",
                "intent": plan.intent,
                "tools_used": pack.tools_used,
                "citations": pack.citations(),
                "failures": pack.failures,
                "track": plan.track,
                "elapsed_ms": evidence_ms,
            })

            # Only now, and only for a turn that needs a model. Resolving `auto`
            # scores every installed model and costs seconds on a cold start;
            # a refusal or a greeting must not wait for it.
            choice = choose_model(model)
            tag = choice["tag"]
            state["model"] = tag
            if not tag:
                events.put({"phase": "error", "error": choice["reason"]})
                audit_store.log(
                    "conversation_logs", query_id=query_id, session_id=session_id,
                    user_query=question, error_message=choice["reason"], **pipeline_log,
                )
                audit_store.log_error("model_selection", choice["reason"], query_id=query_id)
                return

            # Step 8.
            messages = orchestration.prompt.build(window, pack, understood)
            payload = {"model": tag, "messages": messages, "stream": True}
            # Beside Ollama's token count, this is what calibrates the history
            # budget's characters-per-token (`token_calibration`).
            prompt_chars = sum(len(m["content"]) for m in messages)
            _log_context(query_id, session_id, window)

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
                audit_store.log_error("inference", exc, query_id=query_id)

            ended = time.perf_counter()
            total_ms = int((ended - started) * 1000)
            ttft_ms = int((first_token_at - started) * 1000) if first_token_at else None
            text = _LEADING_STAMP.sub("", "".join(pieces)).strip()
            # One citation format for the validator, the transcript and the UI:
            # `[EVIDENCE: S1]` and friends become `[S1]`.
            text = orchestration.validator.normalise_citations(text)

            ns = 1_000_000
            audit_store.log(
                "model_logs",
                query_id=query_id,
                model_name=tag,
                temperature=None,
                prompt_token_count=final.get("prompt_eval_count"),
                prompt_chars=prompt_chars,
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

            # Step 10. Only on a completed answer: a failed call has nothing to
            # check, and its error already went out as the terminal event.
            verdict: orchestration.Validation | None = None
            delivered = text
            if not error:
                # The rolling summary is history too: a number that survived its
                # redaction is as stale as one in a replayed turn.
                history = window.messages + (
                    [{"role": "system", "content": window.summary}] if window.summary else []
                )
                verdict = orchestration.validator.validate(
                    text, pack, question=understood.standalone, history=history,
                )
                if not verdict.passed:
                    delivered = orchestration.FALLBACK
                events.put({"phase": "validated", **verdict.as_dict(),
                            "answer": delivered})
            grounded = bool(verdict and orchestration.validator.grounded(verdict, pack))

            audit_store.log(
                "conversation_logs",
                query_id=query_id,
                session_id=session_id,
                user_query=question,
                model_used=tag,
                # What the operator was given. When validation replaced the
                # answer, the model's own text is kept beside it — the
                # evaluation counts what the model tried to say, not only what
                # got through.
                response_text=delivered if not error else None,
                model_response_text=text if verdict and not verdict.passed else None,
                grounded_flag=int(grounded) if verdict else None,
                hallucination_flag=int(verdict.hallucination) if verdict else None,
                validation_json=verdict.as_dict() if verdict else None,
                # The whole turn, pipeline included — what the operator waited.
                total_latency_ms=int((ended - turn_started) * 1000),
                error_message=error,
                **pipeline_log,
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
            #
            # The evidence pack is stored with the turn for the UI and for
            # Ariadne's Thread; `build_context` never replays it (§7.4).
            stored = chat_service.add_assistant_message(
                session_id, delivered, query_id=query_id, evidence=pack.as_json(), model_tag=tag
            )
            summary_scheduled = _maybe_summarise(session_id)
            # After the answer is stored, on its own thread — like the summary,
            # the operator never waits for a title.
            session_titles.schedule(session_id)

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
                    "answer": delivered,
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
                        # Folding happens on its own thread, after this event.
                        "summary_scheduled": summary_scheduled,
                        "chars_per_token": window.chars_per_token,
                        "calibration": window.calibration_source,
                    },
                    "understanding": understood.as_event(),
                    # architecture/07's response contract.
                    "intent": plan.intent,
                    "plan": plan.as_dict(),
                    "tools_used": pack.tools_used,
                    "citations": pack.citations(),
                    "grounded": grounded,
                    "validation": verdict.as_dict() if verdict else None,
                    "latency_ms": int((ended - turn_started) * 1000),
                }
            })
        except Exception as exc:  # noqa: BLE001
            # The inner try covers the model call. This one covers everything
            # after it — the two audit writes and the transcript write — because
            # a failure there would otherwise leave the consumer blocked on a
            # sentinel that never arrives.
            events.put({"phase": "error", "error": f"{exc.__class__.__name__}: {exc}"})
            audit_store.log_error("orchestrator", exc, query_id=query_id)
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

