"""The Forge — hardware and model console (Layer 11).

Step 1 of `PROJECT.md` §8.2: detect what this machine is, so the model-fit
estimate has measured numbers rather than assumptions. The remaining five steps
(estimate · score · manage · benchmark · commit) are specified in
`docs/MODULES.md` §2 and not built yet.

**Rule 5 — setup tools are not runtime tools.** Everything under `/api/forge`
is a setup surface. The orchestrator must never call it on the chat path, and
nothing here is exposed to the model as a tool.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..services import benchmark as benchmark_service
from ..services import forge as forge_service
from ..services import hardware, model_config, ollama_client

router = APIRouter(prefix="/api/forge", tags=["forge"])


@router.get("/hardware")
def hardware_profile() -> dict[str, Any]:
    """RAM, CPU, GPU/VRAM, disk and Ollama, as far as they can be determined.

    Serves the snapshot a background task keeps warm rather than probing here:
    detection costs seconds on this machine — a PowerShell interop call, a
    subprocess, an HTTP timeout — and paying it per panel open made the cost
    scale with how often somebody looked. `hardware.profile()` explains the
    tiers; the `refresh` block in the response says how current the numbers are,
    so the UI can show a cached figure honestly instead of passing it off as
    live.

    Always 200. Every probe is independently guarded and reports what it could
    not determine — a machine with no GPU and no Ollama is a normal machine,
    not an error, and the panel needs to render on it.
    """
    return hardware.profile()


@router.post("/hardware/refresh")
def redetect_hardware() -> dict[str, Any]:
    """Re-probe everything now, ignoring the schedule. Backs "Re-detect".

    POST rather than GET because it is the one call here with a cost worth
    declaring: it pays for every probe, including the ~2.5s WSL interop call the
    cache exists to avoid. Correct — somebody pressing the button is asking a
    question the cache cannot answer, namely *has this machine changed?*
    """
    return hardware.redetect()


# ── steps 2 & 3: estimate and score ──────────────────────────────────────────


@router.get("/models")
def models(
    context_tokens: int | None = Query(
        default=None,
        ge=256,
        le=131072,
        description="Prompt size the estimate budgets a KV cache for. Defaults to 4096 — see model_fit.DEFAULT_WORKING_CONTEXT.",
    ),
) -> dict[str, Any]:
    """The ranked table: every candidate estimated and scored against this machine.

    Includes models nobody declared. Anything pulled into Ollama is discovered
    and scored from the parameter count and quantization it reports for itself,
    so the catalogue is a starting point rather than a limit.

    Always 200, including with Ollama stopped — the estimate half needs no
    daemon, and `ollama.error` says why the measured half is missing.
    """
    return forge_service.models(context_tokens)


# ── step 4: manage ───────────────────────────────────────────────────────────


@router.post("/models/pull")
def pull_model(tag: str = Body(..., embed=True)) -> StreamingResponse:
    """Pull a model, streaming progress as server-sent events.

    SSE rather than a blocking POST because a 5GB pull is minutes long and
    `MODULES.md` §2.6 names blocking a worker on it as a risk. The client
    closing the connection abandons the generator, which closes the upstream
    read — Ollama keeps the layers it already wrote, so a resumed pull does not
    start over.
    """

    def events() -> Iterator[str]:
        try:
            for event in ollama_client.pull(tag):
                yield f"data: {json.dumps(event)}\n\n"
        except (ollama_client.OllamaError, ollama_client.OllamaUnavailable) as exc:
            # Reported inside the stream, not as a status code: by the time this
            # fires the response has already begun, and Ollama's own message
            # ("model not found") is the one worth showing.
            yield f"data: {json.dumps({'error': str(exc), 'done': True})}\n\n"
        except Exception as exc:  # noqa: BLE001
            yield f"data: {json.dumps({'error': f'{exc.__class__.__name__}: {exc}', 'done': True})}\n\n"
        finally:
            # A new model changes what /api/show would answer for it.
            forge_service.invalidate_cache()

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            # nginx and friends buffer by default, which would hold the whole
            # pull back and deliver it at the end — the one thing SSE is for.
            "X-Accel-Buffering": "no",
        },
    )


@router.delete("/models/{tag:path}")
def delete_model(tag: str) -> dict[str, Any]:
    """Remove a local model. `:path` because a tag may contain slashes.

    `hf.co/user/repo:Q4_K_M` is a valid Ollama tag, and a plain path parameter
    would 404 on it before this function ever ran.
    """
    try:
        ollama_client.delete(tag)
    except ollama_client.OllamaError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ollama_client.OllamaUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    forge_service.invalidate_cache()
    return {"deleted": True, "tag": tag}


# ── step 5: benchmark ────────────────────────────────────────────────────────


@router.post("/benchmark")
def run_benchmark(
    tag: str = Body(..., embed=True),
    prompt_tokens: int = Body(default=benchmark_service.DEFAULT_PROMPT_TOKENS, embed=True),
    max_tokens: int = Body(default=benchmark_service.DEFAULT_MAX_TOKENS, embed=True),
) -> dict[str, Any]:
    """Measure time-to-first-token and tok/s on a RAG-context-sized prompt.

    Writes `model_logs` under a `bench_` query id, so the latency chapter draws
    benchmark and production numbers from one table and can still tell them
    apart. Slow by nature — a warm-up pass plus a 2k-token prefill — and
    deliberately synchronous: it is one explicit click, not a background job,
    and the result is worthless if nobody is waiting for it.
    """
    try:
        return benchmark_service.run(
            tag, prompt_tokens=prompt_tokens, max_tokens=max_tokens
        )
    except ollama_client.OllamaUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ollama_client.OllamaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ── step 6: commit ───────────────────────────────────────────────────────────


@router.get("/active-model")
def active_model() -> dict[str, Any]:
    """What the orchestrator would run right now, and why.

    Resolves rather than just reading the file, because in `auto` mode the file
    holds a policy and not a name — the answer depends on this machine and on
    what is installed at this moment.
    """
    return model_config.resolve()


@router.put("/active-model")
def set_active_model(
    mode: str = Body(..., embed=True),
    tag: str | None = Body(default=None, embed=True),
    quantization: str | None = Body(default=None, embed=True),
    note: str | None = Body(default=None, embed=True),
) -> dict[str, Any]:
    """Commit the choice to `config/model_config.json`.

    `mode` is `pinned` (run exactly this) or `auto` (run whichever installed
    model scores highest on whatever machine this is). Auto is the default for a
    reason — see `services/model_config.py`; a pinned name is a claim about one
    machine's hardware that goes quietly stale on any other.
    """
    try:
        model_config.write(mode=mode, tag=tag, quantization=quantization, note=note)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"could not write config: {exc}") from exc
    return model_config.resolve()
