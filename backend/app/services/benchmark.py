"""Real measurements — step 5 of six, the one that replaces the estimates.

`PROJECT.md` §8.2: *"Measured numbers replace estimates in the final report.
That directly satisfies Objective 3 with evidence rather than projection."*

## The prompt has to be the right size, or the number is meaningless

`MODULES.md` §2.3 is specific about this and it is the easiest thing here to get
wrong. Raw tok/s on a twenty-token prompt says nothing about this system's
latency. A real Daedalus query arrives with an evidence pack — several retrieved
chunks plus replayed conversation history — so the prompt is typically 1–3k
tokens. Prefill dominates time-to-first-token, and TTFT dominates *perceived*
latency. Benchmarking "hello" would produce a flattering number that the live
system never reproduces, and the latency chapter would be fiction.

So the benchmark builds a representative evidence pack, in this order:

1. **From `rag_logs`** — a real retrieval this system actually performed, with
   its chunks fetched back out of the vector store. The best case: the prompt is
   one the system genuinely produced.
2. **From the bundled fixture** — synthetic reactor-SOP text padded to the same
   token budget, used when no retrieval has been logged yet or the vector store
   is unavailable.

Which one was used is recorded in the result and returned to the UI, because a
fixture-based number and a production-trace-based number are not the same claim.

## Every run writes to `model_logs`

The same table live traffic writes to, under a synthetic `query_id` prefixed
`bench_`. §2.3 requires this: the latency chapter has to draw benchmark and
production numbers from one place or they cannot be compared. The prefix is what
lets an analysis separate them again.

Rule 5: a setup surface. The orchestrator must never call this.
"""

from __future__ import annotations

import json
import sqlite3
import time
from datetime import datetime, timezone
from typing import Any

from ..db import audit_store, sqlite_util
from ..db.paths import AUDIT_DB
from . import ollama_client

# Roughly four characters per token for English prose — the usual rule of
# thumb, and good enough to size a prompt. The real count comes back from
# Ollama as `prompt_eval_count` and is what gets logged; this only decides how
# much text to assemble.
_CHARS_PER_TOKEN = 4

# The evidence pack's target size. MODULES.md §2.3 puts a real prompt at 1–3k
# tokens; 2000 sits in the middle rather than at a flattering end.
DEFAULT_PROMPT_TOKENS = 2000

# Generation length. Long enough for a stable tok/s — a handful of tokens is
# dominated by startup noise — and short enough that benchmarking six models
# does not take an afternoon.
DEFAULT_MAX_TOKENS = 128

BENCHMARK_TIMEOUT = 300.0

_QUESTION = (
    "Given the procedures and readings above, is the reactor within its normal "
    "operating envelope? Answer in two sentences and cite the section you used."
)

# Synthetic, and labelled as such everywhere it is used. Written to look like
# what the real corpus contains — numbered SOP clauses, setpoints with units,
# an anomaly note — because prefill cost depends on the token distribution, and
# lorem ipsum tokenises differently from technical prose with figures in it.
_FIXTURE_CHUNKS = [
    "SOP-412 §3.1 Coolant loop A shall be maintained between 288 °C and 295 °C at "
    "the core outlet. A sustained excursion above 297 °C for more than 120 seconds "
    "requires the operator to initiate a controlled power reduction to 80% and log "
    "the event under UAUC-7.",
    "SOP-412 §3.4 Primary loop pressure is nominally 15.5 MPa. Deviations beyond "
    "±0.4 MPa are reportable. The pressuriser heater bank shall not be cycled more "
    "than four times per hour; excessive cycling indicates level instrumentation "
    "drift and is investigated under MAINT-88.",
    "MANUAL-09 §7.2 Neutron flux is monitored by four independent ex-core detectors. "
    "A single detector reading more than 8% from the channel mean is treated as "
    "instrument fault, not a reactivity event, provided the remaining three agree "
    "within 2%.",
    "ANOMALY-2024-118 At 03:14 the CO2 concentration in the containment sampling "
    "line rose from 412 ppm to 470.2 ppm over nine minutes. Loop A outlet "
    "temperature was 291.4 °C and stable. Root cause was traced to a calibration "
    "gas bottle left open in the instrument room; no reactor parameter was affected.",
    "SOP-118 §2.9 Before any coolant chemistry adjustment, the operator confirms "
    "boron concentration from two independent samples taken at least ten minutes "
    "apart. Agreement within 5 ppm is required before dosing proceeds.",
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _fixture_pack(target_tokens: int) -> str:
    """Synthetic evidence, repeated to the token budget."""
    budget = target_tokens * _CHARS_PER_TOKEN
    parts: list[str] = []
    length = 0
    index = 0
    while length < budget:
        chunk = _FIXTURE_CHUNKS[index % len(_FIXTURE_CHUNKS)]
        # Numbered like a real evidence pack so the model sees the same shape.
        block = f"[chunk {index + 1}] {chunk}"
        parts.append(block)
        length += len(block) + 2
        index += 1
    return "\n\n".join(parts)


def _rag_pack(target_tokens: int) -> tuple[str, dict[str, Any]] | None:
    """A real evidence pack rebuilt from the most recent logged retrieval.

    Returns None whenever anything is missing — no retrieval logged yet, no
    vector store running, chunk ids that no longer resolve. All normal on a
    development machine, and all reasons to fall back rather than fail.
    """
    try:
        audit_store.init_db()
        with sqlite_util.connect(AUDIT_DB) as conn:
            row = conn.execute(
                """
                SELECT query_id, query_text, retrieved_chunk_ids, source_files
                FROM rag_logs
                WHERE retrieved_chunk_ids IS NOT NULL AND retrieved_chunk_ids != ''
                ORDER BY id DESC LIMIT 1
                """
            ).fetchone()
    except (sqlite3.Error, Exception):
        return None

    if not row:
        return None

    try:
        chunk_ids = json.loads(row["retrieved_chunk_ids"])
        if isinstance(chunk_ids, str):
            chunk_ids = [chunk_ids]
        if not chunk_ids:
            return None
    except (ValueError, TypeError):
        return None

    try:
        from ..db import vector_store

        collection = vector_store.get_collection()
        fetched = collection.get(ids=list(chunk_ids)[:20])
        documents = [d for d in (fetched.get("documents") or []) if d]
    except Exception:
        return None

    if not documents:
        return None

    budget = target_tokens * _CHARS_PER_TOKEN
    parts: list[str] = []
    length = 0
    for index, doc in enumerate(documents):
        block = f"[chunk {index + 1}] {doc}"
        parts.append(block)
        length += len(block) + 2
        if length >= budget:
            break

    return "\n\n".join(parts), {
        "source": "rag_logs",
        "from_query_id": row["query_id"],
        "query_text": row["query_text"],
        "chunks": len(parts),
    }


def build_prompt(target_tokens: int = DEFAULT_PROMPT_TOKENS) -> tuple[str, dict[str, Any]]:
    """A RAG-context-sized prompt, and provenance for it."""
    real = _rag_pack(target_tokens)
    if real:
        pack, meta = real
    else:
        pack = _fixture_pack(target_tokens)
        meta = {
            "source": "fixture",
            "from_query_id": None,
            "query_text": _QUESTION,
            "chunks": pack.count("[chunk "),
        }

    prompt = (
        "You are assisting a reactor operator. Use only the retrieved evidence "
        "below; if it does not answer the question, say so.\n\n"
        f"=== RETRIEVED EVIDENCE ===\n{pack}\n=== END EVIDENCE ===\n\n"
        f"Question: {meta.get('query_text') or _QUESTION}\n"
    )
    meta["approx_prompt_tokens"] = len(prompt) // _CHARS_PER_TOKEN
    meta["prompt_chars"] = len(prompt)
    return prompt, meta


def _warm_up(tag: str) -> bool:
    """Load the model into memory before the timed run. Returns whether it worked.

    Without this the first benchmark of a model measures disk. Observed on the
    development machine: llama3.2 cold reported 22.0s time-to-first-token and
    6.1 tok/s, against an estimate of 56 tok/s — almost all of that gap was
    Ollama reading 1.9GB of weights off an SSD, not the model being slow.

    A cold start is a real cost, but it is paid once per model rather than once
    per query, and Objective 3's latency target is about what an operator
    experiences in a conversation. Steady state is the honest number to put
    against it, and `warmed_up` travels with the result so nobody has to guess
    which was measured.

    One token on a trivial prompt is enough — it is the weight load that is
    expensive, not the generation.
    """
    try:
        ollama_client._request(
            "POST",
            "/api/generate",
            timeout=BENCHMARK_TIMEOUT,
            json={
                "model": tag,
                "prompt": "ok",
                "stream": False,
                "options": {"num_predict": 1, "temperature": 0.0},
            },
        )
        return True
    except Exception:
        # A failed warm-up is not a failed benchmark — the timed run will
        # simply include the load, and `warmed_up: false` says so.
        return False


def run(
    tag: str,
    *,
    prompt_tokens: int = DEFAULT_PROMPT_TOKENS,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    warmup: bool = True,
) -> dict[str, Any]:
    """Benchmark one model. Writes `model_logs` and returns the measurement.

    Time-to-first-token is taken from the wall clock at the first streamed
    chunk, not from Ollama's `prompt_eval_duration`. The two differ by queueing
    and transport, and the wall clock is the one an operator experiences — which
    is what Objective 3's latency target is about.

    Generation rate deliberately excludes prefill: `completion ÷ (total − TTFT)`.
    Folding prefill in would make a long evidence pack look like a slow model,
    and the whole point of §2.3 is that the evidence pack is long.
    """
    if ollama_client.httpx is None:
        raise ollama_client.OllamaUnavailable("httpx is not installed")

    prompt, provenance = build_prompt(prompt_tokens)
    query_id = "bench_" + datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S%f")

    warmed_up = _warm_up(tag) if warmup else False

    started = time.perf_counter()
    first_token_at: float | None = None
    pieces: list[str] = []
    final: dict[str, Any] = {}
    error: str | None = None

    payload = {
        "model": tag,
        "prompt": prompt,
        "stream": True,
        "options": {
            "num_predict": max_tokens,
            # Deterministic, so re-running the benchmark measures the machine
            # rather than resampling a different answer of a different length.
            "temperature": 0.0,
        },
    }

    try:
        for base in ollama_client.candidate_base_urls():
            try:
                with ollama_client.httpx.stream(
                    "POST",
                    f"{base}/api/generate",
                    json=payload,
                    timeout=ollama_client._timeout(BENCHMARK_TIMEOUT),
                ) as response:
                    if response.status_code >= 400:
                        response.read()
                        raise ollama_client.OllamaError(ollama_client._error_detail(response))
                    for line in response.iter_lines():
                        if not line.strip():
                            continue
                        try:
                            event = json.loads(line)
                        except ValueError:
                            continue
                        if event.get("error"):
                            raise ollama_client.OllamaError(str(event["error"]))
                        piece = event.get("response") or ""
                        if piece and first_token_at is None:
                            first_token_at = time.perf_counter()
                        if piece:
                            pieces.append(piece)
                        if event.get("done"):
                            final = event
                break
            except ollama_client.OllamaError:
                raise
            except Exception:
                continue
        else:
            raise ollama_client.OllamaUnavailable("no Ollama daemon answered")
    except Exception as exc:  # noqa: BLE001
        error = f"{exc.__class__.__name__}: {exc}"

    ended = time.perf_counter()
    total_ms = int((ended - started) * 1000)
    ttft_ms = int((first_token_at - started) * 1000) if first_token_at else None

    # Ollama's own counters are authoritative for token counts — a character
    # estimate would put a made-up number in the table the report draws from.
    prompt_tokens_actual = final.get("prompt_eval_count")
    completion_tokens = final.get("eval_count") or (len(pieces) or None)

    tokens_per_sec = None
    if completion_tokens and ttft_ms is not None and total_ms > ttft_ms:
        tokens_per_sec = round(completion_tokens / ((total_ms - ttft_ms) / 1000.0), 1)

    status = "error" if error else "ok"
    audit_store.log(
        "model_logs",
        query_id=query_id,
        model_name=tag,
        temperature=0.0,
        prompt_token_count=prompt_tokens_actual,
        completion_token_count=completion_tokens,
        time_to_first_token_ms=ttft_ms,
        total_inference_ms=total_ms,
        status=status,
        error_message=error,
    )

    return {
        "tag": tag,
        "query_id": query_id,
        "at": _now(),
        "status": status,
        "error": error,
        "time_to_first_token_ms": ttft_ms,
        "total_inference_ms": total_ms,
        "tokens_per_sec": tokens_per_sec,
        "prompt_token_count": prompt_tokens_actual,
        "completion_token_count": completion_tokens,
        # False means the figures include loading the weights from disk, which
        # is a different measurement and a much worse-looking one.
        "warmed_up": warmed_up,
        # So a reader can tell a production-trace number from a fixture one.
        "prompt": provenance,
        "sample": "".join(pieces)[:400],
    }
