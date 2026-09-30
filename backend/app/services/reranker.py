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

The weights come from Hugging Face on request (Settings → Knowledge Base →
Download), into `DATA_DIR/models/rerankers/<id>/`, at a **pinned commit** — the
same bytes on every machine, so a re-ranked result can be reproduced. After
that, nothing here touches the network; Rule 1's offline runtime holds.

A catalogue of two, like the embedding models: an English model that is small
and fast, and a multilingual one for Malay questions (§7.1 flags `ms`) at four
times the size. Anything else is a code change, because a re-ranker is a
research variable and belongs in a diff.

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

CATALOGUE: dict[str, dict[str, Any]] = {
    "ms-marco-minilm-l6": {
        "id": "ms-marco-minilm-l6",
        "label": "MiniLM-L6 (MS MARCO)",
        "repo": "cross-encoder/ms-marco-MiniLM-L6-v2",
        "revision": "233902d25c440f23af6f7d6e94d2946bac0bee0a",
        "onnx": "onnx/model.onnx",
        "languages": "English",
        "size_bytes": 91_011_230,
        "note": "Small and fast. The default: most of the corpus is English.",
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
        "size_bytes": 118_620_016,
        "note": "Understands Malay questions. Slower, and four times the download.",
    },
}
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


def models() -> list[dict[str, Any]]:
    """The catalogue, with what is on this disk and any download in progress."""
    out = []
    for model_id, entry in CATALOGUE.items():
        with _download_lock:
            job = dict(_downloads.get(model_id) or {})
        manifest = _manifest(model_id) if installed(model_id) else None
        out.append({
            **{k: v for k, v in entry.items() if k != "onnx"},
            "installed": manifest is not None,
            "downloaded_at": (manifest or {}).get("downloaded_at"),
            "download": job or None,
        })
    return out


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
            f"{CATALOGUE[model_id]['label']} is not downloaded — Settings → Knowledge Base → Re-ranking"
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
