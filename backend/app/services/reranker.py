"""Cross-encoder re-ranking for Track 1 — `PROJECT.md` §5's "re-score top-N locally".

## What it fixes

Vector search ranks by cosine distance between two embeddings made *separately*:
one of the question, one of the chunk, neither having seen the other. That is
what makes it fast enough to search a whole corpus, and also why it confuses
"passage about the same topic" with "passage that answers this question" — an
SOP's table of contents sits close to every question about that SOP.

A cross-encoder reads the question and one passage *together*, through every
layer, and outputs a single relevance score. Far too slow to run over a corpus,
fast enough to run over twenty candidates. So Track 1 becomes two stages:

    Chroma: nearest `candidates` chunks by cosine   (recall — cheap, broad)
    cross-encoder: re-score each (question, chunk)  (precision — slow, exact)
    keep the best `top_k`                           → the evidence pack

## Why ONNX, and not sentence-transformers or Ollama

- **Ollama** has no re-rank endpoint (checked against 0.13.5: `/api/rerank` is
  a 404), and a generative model prompted to score passages is a slower,
  less calibrated imitation of the real thing.
- **sentence-transformers** would do it in three lines and pull in PyTorch —
  over a gigabyte, for a model that needs none of it.
- **onnxruntime + tokenizers** is the same model, exported by its authors, run
  by ~80 MB of CPU-only runtime. MiniLM-L6 scores twenty passages in tens of
  milliseconds on a laptop CPU, which is the latency budget this has.

## Models are fetched once and pinned

The weights come from Hugging Face on request (The Forge → Re-rankers →
Download), into `DATA_DIR/models/rerankers/<id>/`, at a **pinned commit** — the
same bytes on every machine, so a re-ranked result can be reproduced. After
that, nothing here touches the network; Rule 1's offline runtime holds.

The catalogue is a curated list, not a search: every entry is a cross-encoder
whose authors publish an ONNX export, at a commit checked to exist, under a
licence a thesis can use. Adding one is a code change, because a re-ranker is a
research variable and belongs in a diff. It spans the trade-off that matters —
from TinyBERT (tens of milliseconds, weakest) to bge-reranker-v2-m3 (strongest,
multilingual, seconds on a laptop CPU) — and `fit()` says which of them this
machine can afford.

## Fit — what this machine can afford

The Forge does for chat models what `fit()` does here, on the two resources a
re-ranker actually spends:

- **Memory.** The ONNX file plus the runtime's working set (~2× the file), against
  the RAM available now — the re-ranker runs beside Ollama, not instead of it.
- **Time.** How long re-scoring `BENCH_CANDIDATES` chunks takes, against
  `LATENCY_BUDGET_MS` — the slice of §9.2's 3-second answer re-ranking can have.
  Estimated from each model's transformer size, scaled from one measurement
  (`_CALIBRATION`), until `benchmark()` replaces the estimate with this
  machine's own number.

The recommendation is the strongest model that fits on both — or, when none
does, the one least over budget — once for English and once for Malay
questions. An estimate says so; only a benchmark is quoted as a measurement.

## Failure is a stated fallback, never an exception

No runtime installed, model not downloaded, a corrupt file: `rerank()` raises
`RerankUnavailable` with the reason, and `search_corpus` keeps Chroma's order
and says so in its detail and in `rag_logs` (`rerank_model` NULL). An answer
from un-reranked chunks is worse; no answer at all is not better.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..db import paths

log = logging.getLogger("daedalus.reranker")

RERANKER_DIR = paths.DATA_DIR / "models" / "rerankers"

# `compute_m`: millions of parameters in the transformer layers — what a forward
# pass actually multiplies through, unlike the embedding table, which is a lookup
# and is most of a multilingual model's size. `quality`: rank within this list
# (higher is better), from the authors' published MS MARCO / BEIR / MIRACL
# results; it orders the recommendation and is not a score. Sizes are the ONNX
# file at the pinned revision, from the Hugging Face API.
CATALOGUE: dict[str, dict[str, Any]] = {
    "ms-marco-tinybert-l2": {
        "id": "ms-marco-tinybert-l2",
        "label": "TinyBERT-L2 (MS MARCO)",
        "repo": "cross-encoder/ms-marco-TinyBERT-L2-v2",
        "revision": "81d1926f67cb8eee2c2be17ca9f793c7c3bd20cc",
        "onnx": "onnx/model.onnx",
        "languages": "English",
        "multilingual": False,
        "size_bytes": 17_604_619,
        "compute_m": 0.4,
        "quantized": False,
        "quality": 1,
        "licence": "Apache-2.0",
        "note": "Two layers. Near-instant on any machine, and the weakest ranking — for a slow machine, or as an ablation floor.",
    },
    "ms-marco-minilm-l6": {
        "id": "ms-marco-minilm-l6",
        "label": "MiniLM-L6 (MS MARCO)",
        "repo": "cross-encoder/ms-marco-MiniLM-L6-v2",
        "revision": "233902d25c440f23af6f7d6e94d2946bac0bee0a",
        "onnx": "onnx/model.onnx",
        "languages": "English",
        "multilingual": False,
        "size_bytes": 91_011_230,
        "compute_m": 10.6,
        "quantized": False,
        "quality": 2,
        "licence": "Apache-2.0",
        "note": "Small and fast. The default: most of the corpus is English.",
    },
    "ms-marco-minilm-l12": {
        "id": "ms-marco-minilm-l12",
        "label": "MiniLM-L12 (MS MARCO)",
        "repo": "cross-encoder/ms-marco-MiniLM-L12-v2",
        "revision": "7b0235231ca2674cb8ca8f022859a6eba2b1c968",
        # 8-bit export: a quarter of the 134 MB fp32 file.
        "onnx": "onnx/model_quint8_avx2.onnx",
        "languages": "English",
        "multilingual": False,
        "size_bytes": 34_311_898,
        "compute_m": 21.2,
        "quantized": True,
        "quality": 3,
        "licence": "Apache-2.0",
        "note": "Twice MiniLM-L6's depth for a better ranking, 8-bit so it is smaller than L6 on disk.",
    },
    "mxbai-rerank-xsmall": {
        "id": "mxbai-rerank-xsmall",
        "label": "mxbai-rerank-xsmall (DeBERTa-v3)",
        "repo": "mixedbread-ai/mxbai-rerank-xsmall-v1",
        "revision": "b5c6e9da73abc3711f593f705371cdbe9e0fe422",
        "onnx": "onnx/model_quantized.onnx",
        "languages": "English",
        "multilingual": False,
        "size_bytes": 87_245_802,
        # DeBERTa-v3-xsmall: 12 layers at 384 wide like the L12s, plus
        # disentangled attention — measured at ~1.1× their time.
        "compute_m": 23.0,
        "quantized": True,
        "quality": 4,
        "licence": "Apache-2.0",
        "note": "A newer architecture that ranks above the MiniLMs on BEIR. Slower per chunk.",
    },
    "mmarco-mminilm-l12": {
        "id": "mmarco-mminilm-l12",
        "label": "mMiniLMv2-L12 (mMARCO, multilingual)",
        "repo": "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1",
        "revision": "1427fd652930e4ba29e8149678df786c240d8825",
        # The 8-bit export: a quarter of the fp32 file (118 MB, not 471 MB) for
        # a ranking that is, in the authors' own evaluation, effectively the same.
        "onnx": "onnx/model_quint8_avx2.onnx",
        "languages": "Multilingual, including Malay",
        "multilingual": True,
        "size_bytes": 118_620_016,
        "compute_m": 21.2,
        "quantized": True,
        "quality": 3,
        "licence": "Apache-2.0",
        "note": "Understands Malay questions at MiniLM speed. Most of its size is the multilingual vocabulary.",
    },
    "bge-reranker-base": {
        "id": "bge-reranker-base",
        "label": "bge-reranker-base",
        "repo": "BAAI/bge-reranker-base",
        "revision": "2cfc18c9415c912f9d8155881c133215df768a70",
        "onnx": "onnx/model.onnx",
        "languages": "Multilingual (strongest in English and Chinese)",
        "multilingual": True,
        "size_bytes": 1_112_459_588,
        "compute_m": 85.0,
        "quantized": False,
        "quality": 5,
        "licence": "MIT",
        "note": "XLM-RoBERTa base. A clear step up in ranking, at roughly eight times MiniLM's time on a CPU.",
    },
    "bge-reranker-v2-m3": {
        "id": "bge-reranker-v2-m3",
        "label": "bge-reranker-v2-m3 (8-bit)",
        "repo": "onnx-community/bge-reranker-v2-m3-ONNX",
        "revision": "6f5ff65298512715a1e669753bc754d2bc8f367b",
        "onnx": "onnx/model_quantized.onnx",
        "languages": "Multilingual, including Malay",
        "multilingual": True,
        "size_bytes": 570_727_094,
        "compute_m": 302.0,
        "quantized": True,
        "quality": 6,
        "licence": "Apache-2.0 (BAAI weights; community ONNX export)",
        "note": "The strongest here, and multilingual. XLM-RoBERTa large: seconds per question on a laptop CPU — for a machine with a GPU-class CPU budget, or offline evaluation.",
    },
}

# ── fit ──────────────────────────────────────────────────────────────────────

# How many chunks re-ranking scores per question — the default candidate pool.
BENCH_CANDIDATES = 20
# Re-ranking's slice of §9.2's 3-second answer. Above it a model is `marginal`;
# above three times it, `will_not_fit` — it would spend the whole answer alone.
LATENCY_BUDGET_MS = 1000
# One measured point the estimates scale from: MiniLM-L6, fp32, `benchmark()`'s
# 20 chunk-sized passages (~250 tokens each) on a 4-thread i5-11400H under WSL,
# median of three: 805 ms. The same run measured MiniLM-L12 (8-bit) at 1127 ms,
# mMiniLMv2-L12 (8-bit) at 1150, mxbai-xsmall (8-bit) at 1238 and TinyBERT at
# 37 — which is where the speedup and `compute_m` values below come from.
_CALIBRATION = {"compute_m": 10.6, "ms": 805.0, "threads": 4}
# An 8-bit graph against fp32 on CPU: 1.43 and 1.40 measured for the two L12s.
_QUANT_SPEEDUP = 1.4
# Tokenising, padding and session overhead that no model escapes.
_FLOOR_MS = 35.0
# Runtime working set beside the weights, as a multiple of the file.
_MEMORY_FACTOR = 2.0
DEFAULT_MODEL = "ms-marco-minilm-l6"

# Every file a model needs, beside its ONNX graph.
_FILES = ("tokenizer.json", "config.json")
MAX_LENGTH = 512
# Small batches of similar length. Measured on a 4-core i5-11400H (WSL) over 20
# chunks: batches of 4 sorted by length ran ~450 ms against ~650 ms unsorted in
# 16s — a batch is padded to its longest member, so mixing a 40-token chunk with
# a 400-token one makes the short one cost 400.
_BATCH = 4
_DOWNLOAD_TIMEOUT = 60.0


class RerankUnavailable(RuntimeError):
    """The re-ranker cannot run; the message says why, in words for the log."""


# ── state ────────────────────────────────────────────────────────────────────

_sessions: dict[str, tuple[Any, Any, set[str]]] = {}
_session_lock = threading.Lock()
_downloads: dict[str, dict[str, Any]] = {}
_download_lock = threading.Lock()


def _dir(model_id: str) -> Path:
    return RERANKER_DIR / model_id


def _manifest(model_id: str) -> dict[str, Any] | None:
    try:
        return json.loads((_dir(model_id) / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def runtime_available() -> tuple[bool, str]:
    try:
        import onnxruntime  # noqa: F401, PLC0415
        import tokenizers  # noqa: F401, PLC0415
    except ImportError as exc:
        return False, f"the re-ranking runtime is not installed ({exc.name}) — pip install onnxruntime tokenizers"
    return True, "onnxruntime + tokenizers"


def installed(model_id: str) -> bool:
    manifest = _manifest(model_id)
    if not manifest or manifest.get("revision") != CATALOGUE[model_id]["revision"]:
        return False
    return all((_dir(model_id) / name).exists() for name in manifest.get("files", {}))


def _threads() -> int:
    """The intra-op threads a session gets — the same rule `_load` applies."""
    return max(1, min(4, os.cpu_count() or 1))


def _machine() -> dict[str, Any]:
    """Available RAM and CPU, from the hardware profile. Never raises."""
    try:
        from . import hardware  # noqa: PLC0415 — heavy-ish, only when fit is asked for

        profile = hardware.profile()
        memory, cpu = profile.get("memory") or {}, profile.get("cpu") or {}
        return {
            "available_bytes": memory.get("available_bytes"),
            "total_bytes": memory.get("total_bytes"),
            "cpu": cpu.get("model"),
        }
    except Exception:  # noqa: BLE001
        return {"available_bytes": None, "total_bytes": None, "cpu": None}


def estimate_ms(model_id: str, threads: int | None = None) -> int:
    """Estimated milliseconds to score `BENCH_CANDIDATES` chunks on this machine.

    Linear in transformer compute from one measured point, faster when 8-bit,
    slower with fewer threads. A sizing estimate, not a measurement — the panel
    labels it as one until `benchmark()` replaces it.
    """
    entry = CATALOGUE[model_id]
    threads = threads or _threads()
    ms = _CALIBRATION["ms"] * entry["compute_m"] / _CALIBRATION["compute_m"]
    if entry["quantized"]:
        ms /= _QUANT_SPEEDUP
    ms *= _CALIBRATION["threads"] / threads
    return int(max(_FLOOR_MS, ms))


def _verdict(memory_bytes: int, available: int | None, latency_ms: int) -> tuple[str, list[str]]:
    """`safe` | `marginal` | `will_not_fit`, the Forge's words, and why."""
    reasons: list[str] = []
    level = 0
    if available:
        if memory_bytes > available:
            level, _ = 2, reasons.append("needs more memory than is free now")
        elif memory_bytes > available * 0.5:
            level = max(level, 1)
            reasons.append("would take over half the free memory, beside the chat model")
    if latency_ms > 3 * LATENCY_BUDGET_MS:
        level = 2
        reasons.append(f"~{latency_ms / 1000:.1f} s per question — the whole answer budget on its own")
    elif latency_ms > LATENCY_BUDGET_MS:
        level = max(level, 1)
        reasons.append(f"~{latency_ms / 1000:.1f} s per question — over the {LATENCY_BUDGET_MS} ms re-ranking budget")
    return ("safe", "marginal", "will_not_fit")[level], reasons


def fit() -> dict[str, Any]:
    """Every catalogue model judged against this machine, and the recommendations.

    Uses a model's own benchmark when it has one, the estimate otherwise. The
    recommendation is the highest-`quality` model judged `safe` — once over every
    model (English questions) and once over the multilingual ones (Malay).
    """
    machine = _machine()
    threads = _threads()
    judged: dict[str, dict[str, Any]] = {}
    for model_id, entry in CATALOGUE.items():
        bench = (_manifest(model_id) or {}).get("benchmark") if installed(model_id) else None
        measured = bool(bench and bench.get("ms") is not None)
        latency = int(bench["ms"]) if measured else estimate_ms(model_id, threads)
        memory = int(entry["size_bytes"] * _MEMORY_FACTOR)
        verdict, reasons = _verdict(memory, machine["available_bytes"], latency)
        judged[model_id] = {
            "verdict": verdict,
            "reasons": reasons,
            "latency_ms": latency,
            "latency_source": "measured" if measured else "estimated",
            "memory_bytes": memory,
            "benchmark": bench,
        }

    def best(pool: list[str]) -> str | None:
        # The strongest `safe` model; failing that, the fastest `marginal` one —
        # on a slow machine "the least over budget" is still the useful answer,
        # and its verdict says it is over.
        safe = [m for m in pool if judged[m]["verdict"] == "safe"]
        if safe:
            return max(safe, key=lambda m: (CATALOGUE[m]["quality"], -judged[m]["latency_ms"]))
        marginal = [m for m in pool if judged[m]["verdict"] == "marginal"]
        return min(marginal, key=lambda m: judged[m]["latency_ms"], default=None)

    return {
        "machine": {**machine, "threads": threads},
        "budget_ms": LATENCY_BUDGET_MS,
        "candidates": BENCH_CANDIDATES,
        "models": judged,
        "recommended": {
            "english": best(list(CATALOGUE)),
            "malay": best([m for m, e in CATALOGUE.items() if e["multilingual"]]),
        },
    }


def models() -> list[dict[str, Any]]:
    """The catalogue, with what is on this disk, any download in progress, and its fit."""
    judged = fit()
    out = []
    for model_id, entry in CATALOGUE.items():
        with _download_lock:
            job = dict(_downloads.get(model_id) or {})
        manifest = _manifest(model_id) if installed(model_id) else None
        recommended = [k for k, v in judged["recommended"].items() if v == model_id]
        out.append({
            **{k: v for k, v in entry.items() if k != "onnx"},
            "installed": manifest is not None,
            "downloaded_at": (manifest or {}).get("downloaded_at"),
            "download": job or None,
            "fit": judged["models"][model_id],
            "recommended_for": recommended,
        })
    return out


def fit_summary() -> dict[str, Any]:
    """The machine and the budget the verdicts were made against — for the panel's header."""
    judged = fit()
    return {k: judged[k] for k in ("machine", "budget_ms", "candidates", "recommended")}


# A fixed workload, so benchmarks on two machines are comparable: plant-style
# passages of mixed length, the shape `search_corpus` hands over.
_BENCH_QUERY = "What should the operator do if the NDIR CO2 reading drifts during absorption?"


def benchmark(model_id: str, *, runs: int = 3) -> dict[str, Any]:
    """Time re-scoring `BENCH_CANDIDATES` passages on this machine; store it.

    One warm-up (loading the session is not what a question pays), then the
    median of `runs`. Written into the model's manifest, so `fit()` quotes it from
    then on, and so it goes when the weights do. Raises `RerankUnavailable`.
    """
    from . import benchmark as llm_benchmark  # noqa: PLC0415 — reuses its labelled synthetic chunks

    # Each passage is four fixture paragraphs (~300 tokens) — the size the
    # chunker produces. Single paragraphs measured 2–3× faster than real chunks
    # would run, because a cross-encoder's cost grows with the pair's length.
    fixture = list(llm_benchmark._FIXTURE_CHUNKS)  # noqa: SLF001
    passages = [
        " ".join(fixture[(i + k) % len(fixture)] for k in range(4)) for i in range(BENCH_CANDIDATES)
    ]
    score(_BENCH_QUERY, passages[:2], model_id=model_id)
    timings = []
    for _ in range(max(1, runs)):
        started = time.perf_counter()
        score(_BENCH_QUERY, passages, model_id=model_id)
        timings.append((time.perf_counter() - started) * 1000)
    timings.sort()
    result = {
        "ms": int(timings[len(timings) // 2]),
        "runs_ms": [int(t) for t in timings],
        "candidates": BENCH_CANDIDATES,
        "threads": _threads(),
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    path = _dir(model_id) / "manifest.json"
    manifest = _manifest(model_id) or {}
    manifest["benchmark"] = result
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return result


# ── download ─────────────────────────────────────────────────────────────────


def download(model_id: str) -> bool:
    """Fetch a catalogue model in the background. False if one is already running."""
    if model_id not in CATALOGUE:
        raise ValueError(f"unknown re-ranker {model_id!r}; expected one of {sorted(CATALOGUE)}")
    with _download_lock:
        if (_downloads.get(model_id) or {}).get("status") == "downloading":
            return False
        _downloads[model_id] = {"status": "downloading", "bytes": 0,
                                "total": CATALOGUE[model_id]["size_bytes"], "error": None}
    threading.Thread(target=_download, args=(model_id,), name=f"rerank-dl-{model_id}", daemon=True).start()
    return True


def _download(model_id: str) -> None:
    entry = CATALOGUE[model_id]
    target = _dir(model_id)
    try:
        import httpx  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover - httpx is a hard dependency
        _fail(model_id, f"httpx is not installed ({exc})")
        return

    wanted = {"model.onnx": entry["onnx"], **{name: name for name in _FILES}}
    hashes: dict[str, str] = {}
    try:
        target.mkdir(parents=True, exist_ok=True)
        with httpx.Client(follow_redirects=True, timeout=httpx.Timeout(_DOWNLOAD_TIMEOUT)) as client:
            for local, remote in wanted.items():
                url = f"https://huggingface.co/{entry['repo']}/resolve/{entry['revision']}/{remote}"
                tmp = target / f".{local}.part"
                digest = hashlib.sha256()
                with client.stream("GET", url) as response:
                    if response.status_code >= 400:
                        raise RuntimeError(f"{remote}: HTTP {response.status_code}")
                    with open(tmp, "wb") as fh:
                        for chunk in response.iter_bytes(1 << 20):
                            fh.write(chunk)
                            digest.update(chunk)
                            if local == "model.onnx":
                                with _download_lock:
                                    _downloads[model_id]["bytes"] += len(chunk)
                os.replace(tmp, target / local)
                hashes[local] = digest.hexdigest()
        manifest = {
            "id": model_id,
            "repo": entry["repo"],
            "revision": entry["revision"],
            "onnx": entry["onnx"],
            "files": hashes,
            "downloaded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        # Written last: a model is installed only once every file is in place,
        # so an interrupted download reads as "not installed", never as broken.
        (target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        with _session_lock:
            _sessions.pop(model_id, None)
        with _download_lock:
            _downloads[model_id] = {"status": "done", "bytes": _downloads[model_id]["bytes"],
                                    "total": _downloads[model_id]["total"], "error": None}
    except Exception as exc:  # noqa: BLE001 — reported to the panel, never raised
        _fail(model_id, str(exc))


def _fail(model_id: str, message: str) -> None:
    log.warning("re-ranker download %s failed: %s", model_id, message)
    with _download_lock:
        job = _downloads.get(model_id) or {}
        _downloads[model_id] = {**job, "status": "error", "error": message}


def delete(model_id: str) -> bool:
    if model_id not in CATALOGUE:
        raise ValueError(f"unknown re-ranker {model_id!r}")
    with _session_lock:
        _sessions.pop(model_id, None)
    removed = False
    target = _dir(model_id)
    if target.exists():
        for child in target.iterdir():
            child.unlink(missing_ok=True)
            removed = True
        target.rmdir()
    with _download_lock:
        _downloads.pop(model_id, None)
    return removed


# ── scoring ──────────────────────────────────────────────────────────────────


def _load(model_id: str) -> tuple[Any, Any, set[str]]:
    with _session_lock:
        if model_id in _sessions:
            return _sessions[model_id]
    if model_id not in CATALOGUE:
        raise RerankUnavailable(f"unknown re-ranker {model_id!r}")
    ok, why = runtime_available()
    if not ok:
        raise RerankUnavailable(why)
    if not installed(model_id):
        raise RerankUnavailable(
            f"{CATALOGUE[model_id]['label']} is not downloaded — The Forge → Re-rankers"
        )

    import onnxruntime as ort  # noqa: PLC0415
    from tokenizers import Tokenizer  # noqa: PLC0415

    folder = _dir(model_id)
    try:
        tokenizer = Tokenizer.from_file(str(folder / "tokenizer.json"))
        tokenizer.enable_truncation(max_length=MAX_LENGTH)
        pad = "<pad>" if tokenizer.token_to_id("<pad>") is not None else "[PAD]"
        tokenizer.enable_padding(pad_id=tokenizer.token_to_id(pad) or 0, pad_token=pad)
        options = ort.SessionOptions()
        # A chat turn is one query at a time; more threads than this only
        # contend with Ollama for the same cores.
        options.intra_op_num_threads = max(1, min(4, os.cpu_count() or 1))
        session = ort.InferenceSession(str(folder / "model.onnx"), options,
                                       providers=["CPUExecutionProvider"])
    except Exception as exc:  # noqa: BLE001
        raise RerankUnavailable(f"{model_id} could not be loaded: {exc}") from exc
    inputs = {i.name for i in session.get_inputs()}
    with _session_lock:
        _sessions[model_id] = (tokenizer, session, inputs)
    return tokenizer, session, inputs


def score(query: str, passages: list[str], *, model_id: str = DEFAULT_MODEL) -> list[float]:
    """Relevance of each passage to `query`, 0–1 (the model's logit through a sigmoid).

    Raises `RerankUnavailable` when it cannot run. Order matches `passages`.
    """
    if not passages:
        return []
    import numpy as np  # noqa: PLC0415 — arrives with onnxruntime

    tokenizer, session, inputs = _load(model_id)
    out = [0.0] * len(passages)
    order = sorted(range(len(passages)), key=lambda i: len(passages[i] or ""))
    for start in range(0, len(order), _BATCH):
        batch = order[start:start + _BATCH]
        encoded = tokenizer.encode_batch([(query, passages[i] or "") for i in batch])
        feed = {
            "input_ids": np.array([e.ids for e in encoded], dtype=np.int64),
            "attention_mask": np.array([e.attention_mask for e in encoded], dtype=np.int64),
            "token_type_ids": np.array([e.type_ids for e in encoded], dtype=np.int64),
        }
        logits = session.run(None, {k: v for k, v in feed.items() if k in inputs})[0]
        for i, row in zip(batch, np.asarray(logits).reshape(len(batch), -1)):
            out[i] = 1.0 / (1.0 + math.exp(-float(row[0])))
    return out


def rerank(
    query: str,
    chunks: list[dict[str, Any]],
    *,
    model_id: str = DEFAULT_MODEL,
    keep: int,
) -> tuple[list[dict[str, Any]], int]:
    """The best `keep` chunks by cross-encoder score, and the milliseconds it took.

    Each chunk gains `rerank_score` and `vector_rank` (its 1-based place in
    Chroma's order), so a log reader can see what re-ranking moved.
    """
    started = time.perf_counter()
    scores = score(query, [str(c.get("text") or "") for c in chunks], model_id=model_id)
    ranked = [
        {**chunk, "rerank_score": round(s, 4), "vector_rank": i + 1}
        for i, (chunk, s) in enumerate(zip(chunks, scores))
    ]
    # Stable: equal scores keep Chroma's order, so ties are broken by distance.
    ranked.sort(key=lambda c: -c["rerank_score"])
    return ranked[:keep], int((time.perf_counter() - started) * 1000)
