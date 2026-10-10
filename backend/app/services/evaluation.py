"""The evaluation harness — PROJECT.md §5's comparison and §9's metrics.

`docs/EVALUATION.md` is the guide; this is the machinery. One run asks every
question in the query set (`config/eval/queries.yaml`) once per **arm**:

| arm | what answers |
|---|---|
| `vector` | Track 1 — vector RAG with the frozen re-ranker |
| `graph-walk` | Track 2, the fixed walk |
| `graph-agent` | Track 2, the agent loop |

`vector` vs either graph arm asks whether graph structure beats vector
similarity; `graph-walk` vs `graph-agent` asks whether the agent's hop choices
beat a fixed path. Only one arm answers any question; the comparison is
between arms, never inside one.

## The same pipeline, not a copy of it

Every question goes through `inference.answer_stream` — the chat path an
operator uses — in its own ephemeral session with no history, inside
`rag_config.arm(...)` for the arm being run. Nothing here re-implements
planning, retrieval or validation, so what is measured is what ships. The turn
is marked `evaluation=True`: its `model_logs` row says `source='eval'` (operator
statistics filter `'chat'` and stay clean) and no background job runs to
compete with the next timed question.

## Freeze, then run once

A run refuses to start unless the comparison is frozen (`rag_config`), because
tuning after seeing results invalidates the comparison. `practice=True` runs
anyway and stamps the report **practice — not citable**. A second official run
over the same frozen configuration and query set is refused too, unless a
reason is given — and the reason is written into the report.

## What is scored, per question per arm

- **Correct** — answerable: every `key_facts` pattern found in the answer;
  out of corpus: the answer declines.
- **Refusal correctness**, **false refusals**, **fact recall**.
- **Hallucination** and **groundedness** — the validator's own flags, from
  `conversation_logs`.
- **Retrieval** — Track 1: precision@3/@5, recall@5 and MRR over the ranked
  chunks, a chunk being relevant when its source file is in
  `relevant_documents`. Track 2: precision and recall over the reached nodes
  against `relevant_nodes` — a set, not a ranking, so no @k or MRR; hops and
  the agent's stop reason beside them.
- **Latency** — the whole turn, time to first token, retrieval alone.
- **Origin** — the share of retrieved items that were this rig's documents.
"""

from __future__ import annotations

import contextvars
import csv
import hashlib
import io
import json
import math
import os
import queue
import re
import statistics
import tempfile
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from ..db import audit_store, paths

QUERY_PATH = paths.CONFIG_DIR / "eval" / "queries.yaml"
RUNS_DIR = paths.DATA_DIR / "eval"

CATEGORIES = (
    "single_hop_factual",
    "single_hop_procedural",
    "multi_hop_causal",
    "ambiguous",
    "out_of_corpus",
)
LANGUAGES = ("en", "ms")

# arm → (track, graph mode)
ARMS: dict[str, tuple[str, str | None]] = {
    "vector": ("vector", None),
    "graph-walk": ("graph", "walk"),
    "graph-agent": ("graph", "agent"),
}

# Ceiling for one question, model and all. A turn past it is recorded as an
# error rather than holding the run forever.
QUESTION_TIMEOUT_S = 180

# How much longer a timed-out turn is waited for before the run stops. The turn
# cannot be cancelled, and the next question timed while it still holds the
# model would carry its cost — so the run waits, and gives up rather than guess.
DRAIN_TIMEOUT_S = 120

# An answer that says the information is not there. The validator's fallback,
# the out-of-scope reply, and the phrasings prompt rule 4 asks for.
_DECLINE = re.compile(
    r"\b(not available|no information|could not (find|generate)|couldn't find|"
    r"(do not|don't) have (any |that |this )?(information|data|record)|cannot find|"
    r"not (in|covered by) the (evidence|documents?|corpus)|outside what I can help|"
    r"tidak (tersedia|dapat))\b",
    re.IGNORECASE,
)


class EvalError(RuntimeError):
    """A query set that does not validate, or a run that may not start."""


# ── the query set ────────────────────────────────────────────────────────────


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def load_queries(path: Path | None = None) -> list[dict[str, Any]]:
    """The query set, validated. Raises `EvalError` listing every problem."""
    import yaml  # noqa: PLC0415

    path = path or QUERY_PATH
    if not path.exists():
        raise EvalError(f"no query set at {path} — see docs/EVALUATION.md")
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or []
    except yaml.YAMLError as exc:
        raise EvalError(f"{path.name} is not valid YAML: {exc}") from exc
    if not isinstance(raw, list):
        raise EvalError(f"{path.name} must be a list of questions")

    problems: list[str] = []
    seen: set[str] = set()
    queries: list[dict[str, Any]] = []
    for i, q in enumerate(raw, 1):
        where = f"entry {i}"
        if not isinstance(q, dict):
            problems.append(f"{where}: not a mapping")
            continue
        qid = str(q.get("id") or "").strip()
        where = qid or where
        if not qid:
            problems.append(f"{where}: missing id")
        elif qid in seen:
            problems.append(f"{where}: duplicate id")
        seen.add(qid)
        if q.get("category") not in CATEGORIES:
            problems.append(f"{where}: category must be one of {', '.join(CATEGORIES)}")
        if not str(q.get("question") or "").strip():
            problems.append(f"{where}: missing question")
        if q.get("language", "en") not in LANGUAGES:
            problems.append(f"{where}: language must be en or ms")
        expect = q.get("expect") or {}
        if not isinstance(expect, dict) or not isinstance(expect.get("answerable"), bool):
            problems.append(f"{where}: expect.answerable must be true or false")
            expect = {}
        for key in ("key_facts", "relevant_documents", "relevant_nodes"):
            value = expect.get(key, [])
            if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
                problems.append(f"{where}: expect.{key} must be a list of strings")
        for pattern in expect.get("key_facts", []) or []:
            try:
                re.compile(pattern)
            except re.error as exc:
                problems.append(f"{where}: key_fact {pattern!r} is not a valid pattern ({exc})")
        if q.get("category") == "out_of_corpus" and expect.get("answerable") is True:
            problems.append(f"{where}: an out_of_corpus question must have answerable: false")
        queries.append({
            "id": qid,
            "category": q.get("category"),
            "question": str(q.get("question") or "").strip(),
            "language": q.get("language", "en"),
            "rig_specific": bool(q.get("rig_specific", False)),
            "expect": {
                "answerable": expect.get("answerable", True),
                "key_facts": list(expect.get("key_facts") or []),
                "relevant_documents": list(expect.get("relevant_documents") or []),
                "relevant_nodes": list(expect.get("relevant_nodes") or []),
            },
            "notes": q.get("notes"),
        })
    if problems:
        raise EvalError(f"{len(problems)} problem(s) in {path.name}:\n  - " + "\n  - ".join(problems))
    return queries


def query_set_report(path: Path | None = None) -> dict[str, Any]:
    """Validation plus coverage: per-category counts against §5's 6–10, and labels
    that point at nothing (a node the graph lacks, a file the corpus lacks)."""
    path = path or QUERY_PATH
    try:
        queries = load_queries(path)
    except EvalError as exc:
        return {"valid": False, "error": str(exc), "queries": [], "warnings": []}

    warnings: list[str] = []
    counts = {c: sum(1 for q in queries if q["category"] == c) for c in CATEGORIES}
    for category, n in counts.items():
        if n < 6:
            warnings.append(f"{category}: {n} question(s) — PROJECT.md §5 asks for 6–10 per category")
    if not 30 <= len(queries) <= 50:
        warnings.append(f"{len(queries)} questions in total — §5 asks for 30–50")

    try:
        from . import knowledge_graph as kg  # noqa: PLC0415

        graph = kg.load()
        for q in queries:
            for node in q["expect"]["relevant_nodes"]:
                if not graph.has_node(node):
                    warnings.append(f"{q['id']}: relevant node {node!r} is not in the graph")
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"graph not checked: {exc}")
    try:
        from ..db import corpus_store  # noqa: PLC0415

        files = {d["filename"].lower() for d in corpus_store.list_documents()}
        for q in queries:
            for doc in q["expect"]["relevant_documents"]:
                if doc.lower() not in files:
                    warnings.append(f"{q['id']}: relevant document {doc!r} is not in the corpus")
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"corpus not checked: {exc}")

    return {
        "valid": True,
        "path": str(path),
        "sha": _sha(path.read_bytes()),
        "total": len(queries),
        "by_category": counts,
        "warnings": warnings,
        "queries": queries,
    }


# ── one question ─────────────────────────────────────────────────────────────


def _ask(question: str) -> dict[str, Any]:
    """One question through the real chat path, in a fresh ephemeral session.

    The stream is read on its own thread so the deadline holds even when the
    model goes silent — checking the clock between events never fires if no
    event arrives. A timed-out turn is not cancelled (`answer_stream` has no
    cancel; its worker always finishes and logs), so the next question waits
    for it to end: up to `DRAIN_TIMEOUT_S`, after which `still_running` tells
    the run to stop rather than time a question alongside it.
    """
    from . import chat_service, inference  # noqa: PLC0415

    session = chat_service.create_session(title="evaluation", ephemeral=True)
    events: queue.Queue[dict[str, Any] | None] = queue.Queue()

    def _consume() -> None:
        try:
            for event in inference.answer_stream(session["session_id"], question, evaluation=True):
                events.put(event)
        except Exception as exc:  # noqa: BLE001
            events.put({"phase": "error", "error": f"{exc.__class__.__name__}: {exc}"})
        finally:
            # answer_stream only returns once its worker has finished, so this
            # sentinel means the turn is over — not merely that we stopped reading.
            events.put(None)

    started = time.perf_counter()
    # A copy of this context, so the evaluation arm (`rag_config.arm`) reaches
    # the stream and the chat worker it starts.
    threading.Thread(
        target=contextvars.copy_context().run, args=(_consume,), name="eval-ask", daemon=True,
    ).start()

    result: dict[str, Any] | None = None
    error: str | None = None
    ended = False
    deadline = started + QUESTION_TIMEOUT_S
    while True:
        try:
            event = events.get(timeout=max(0.0, deadline - time.perf_counter()))
        except queue.Empty:
            error = f"timed out after {QUESTION_TIMEOUT_S}s"
            break
        if event is None:
            ended = True
            break
        if event.get("phase") == "done":
            result = event["result"]
        elif event.get("phase") == "error":
            error = str(event.get("error"))
    wall_ms = int((time.perf_counter() - started) * 1000)

    if not ended:
        drain_until = time.perf_counter() + DRAIN_TIMEOUT_S
        while not ended:
            try:
                ended = events.get(timeout=max(0.0, drain_until - time.perf_counter())) is None
            except queue.Empty:
                break
    if ended:
        # Only once the turn is over: deleting under a running worker would fail
        # its transcript write. An abandoned one is ephemeral and purged anyway.
        try:
            chat_service.delete_session(session["session_id"])
        except Exception:  # noqa: BLE001
            pass
    return {"result": result, "error": error, "wall_ms": wall_ms, "still_running": not ended}


def _json(value: Any, default: Any) -> Any:
    if value in (None, ""):
        return default
    try:
        return json.loads(value) if isinstance(value, str) else value
    except ValueError:
        return default


def _declines(answer: str) -> bool:
    from .orchestration import validator  # noqa: PLC0415

    return answer.strip() == validator.FALLBACK or bool(_DECLINE.search(answer))


def score(query: dict[str, Any], asked: dict[str, Any], trace: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    """Every metric for one question on one arm. Pure, given the trace."""
    expect = query["expect"]
    result = asked.get("result") or {}
    answer = str(result.get("answer") or "")
    convo = (trace.get("conversation_logs") or [{}])[-1]
    model = (trace.get("model_logs") or [{}])[-1]
    rag = (trace.get("rag_logs") or [None])[-1]

    out: dict[str, Any] = {
        "id": query["id"],
        "category": query["category"],
        "question": query["question"],
        "query_id": result.get("query_id"),
        "error": asked.get("error"),
        "answer": answer,
        "intent": convo.get("intent"),
        "model": result.get("model"),
    }
    if asked.get("error") and not answer:
        out.update(correct=False, declined=None, refusal_correct=False)
        return out

    declined = _declines(answer) or convo.get("intent") == "out_of_scope"
    facts = expect["key_facts"]
    matched = [f for f in facts if re.search(f, answer, re.IGNORECASE)] if not declined else []
    if expect["answerable"]:
        correct = (not declined) and len(matched) == len(facts)
    else:
        correct = declined
    out.update(
        declined=declined,
        refusal_correct=(declined != expect["answerable"]),
        false_refusal=expect["answerable"] and declined,
        fact_recall=(len(matched) / len(facts)) if (facts and expect["answerable"]) else None,
        facts_missing=[f for f in facts if f not in matched] if expect["answerable"] else [],
        correct=correct,
        fallback=answer.strip() == _fallback(),
        hallucination=_flag(convo.get("hallucination_flag")),
        grounded=_flag(convo.get("grounded_flag")),
        total_ms=convo.get("total_latency_ms") or asked.get("wall_ms"),
        ttft_ms=model.get("time_to_first_token_ms"),
        inference_ms=model.get("total_inference_ms"),
    )
    if rag:
        out.update(_retrieval(rag, expect))
    return out


def _fallback() -> str:
    from .orchestration import validator  # noqa: PLC0415

    return validator.FALLBACK


def _flag(value: Any) -> bool | None:
    return None if value is None else bool(value)


def _retrieval(rag: dict[str, Any], expect: dict[str, Any]) -> dict[str, Any]:
    ids = _json(rag.get("retrieved_chunk_ids"), [])
    origins = _json(rag.get("retrieved_origins"), [])
    out: dict[str, Any] = {
        "track": rag.get("track"),
        "retrieval_ms": rag.get("retrieval_latency_ms"),
        "retrieved": len(ids),
        "rig_share": (sum(1 for o in origins if o == "rig") / len(origins)) if origins else None,
    }
    if rag.get("track") == "vector":
        relevant = {d.lower() for d in expect["relevant_documents"]}
        files = _chunk_files(ids)
        hits = [files.get(i, "").lower() in relevant for i in ids]
        found = {files.get(i, "").lower() for i, h in zip(ids, hits) if h}
        first = next((n for n, h in enumerate(hits, 1) if h), None)
        labelled = bool(relevant)
        out.update(
            precision_at_3=(sum(hits[:3]) / min(3, len(hits))) if (labelled and hits) else None,
            precision_at_5=(sum(hits[:5]) / min(5, len(hits))) if (labelled and hits) else None,
            recall_at_5=(len({files.get(i, "").lower() for i, h in zip(ids[:5], hits[:5]) if h}) / len(relevant))
            if labelled else None,
            mrr=(1 / first if first else 0.0) if labelled else None,
            documents_found=sorted(found),
        )
    else:
        relevant = set(expect["relevant_nodes"])
        reached = set(ids)
        path = _json(rag.get("traversal_path"), {})
        out.update(
            node_precision=(len(reached & relevant) / len(reached)) if (relevant and reached) else None,
            node_recall=(len(reached & relevant) / len(relevant)) if relevant else None,
            hops=path.get("hop_count", rag.get("hop_count")),
            graph_mode=path.get("mode"),
            stop_reason=path.get("stop_reason"),
            model_calls=path.get("model_calls"),
            rejected=len(path.get("rejected") or []),
        )
    return out


def _chunk_files(ids: list[str]) -> dict[str, str]:
    try:
        from ..db import corpus_store  # noqa: PLC0415

        return {c["chunk_id"]: c.get("filename") or "" for c in corpus_store.chunks_by_id(ids)}
    except Exception:  # noqa: BLE001
        return {}


# ── aggregation ──────────────────────────────────────────────────────────────


def _rate(rows: list[dict[str, Any]], key: str) -> float | None:
    values = [r[key] for r in rows if r.get(key) is not None]
    return round(sum(1 for v in values if v) / len(values), 3) if values else None


def _mean(rows: list[dict[str, Any]], key: str) -> float | None:
    values = [float(r[key]) for r in rows if r.get(key) is not None]
    return round(statistics.fmean(values), 3) if values else None


def _latency(rows: list[dict[str, Any]], key: str) -> dict[str, Any] | None:
    values = sorted(float(r[key]) for r in rows if r.get(key) is not None)
    if not values:
        return None

    def pct(p: float) -> int:  # nearest rank: the ceil(p·n)-th smallest value
        return int(values[max(0, min(len(values) - 1, math.ceil(p * len(values)) - 1))])

    return {"n": len(values), "mean": int(statistics.fmean(values)), "p50": pct(0.5), "p95": pct(0.95)}


def summarise(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """The metrics for one arm (or one category within it)."""
    answerable = [r for r in rows if r.get("fact_recall") is not None or r.get("false_refusal")]
    stops: dict[str, int] = {}
    for r in rows:
        if r.get("stop_reason"):
            stops[r["stop_reason"]] = stops.get(r["stop_reason"], 0) + 1
    return {
        "n": len(rows),
        "errors": sum(1 for r in rows if r.get("error")),
        "correct": _rate(rows, "correct"),
        "fact_recall": _mean(answerable, "fact_recall"),
        "refusal_correct": _rate(rows, "refusal_correct"),
        "false_refusal": _rate(rows, "false_refusal"),
        "hallucination": _rate(rows, "hallucination"),
        "grounded": _rate(rows, "grounded"),
        "fallback": _rate(rows, "fallback"),
        "precision_at_3": _mean(rows, "precision_at_3"),
        "precision_at_5": _mean(rows, "precision_at_5"),
        "recall_at_5": _mean(rows, "recall_at_5"),
        "mrr": _mean(rows, "mrr"),
        "node_precision": _mean(rows, "node_precision"),
        "node_recall": _mean(rows, "node_recall"),
        "hops": _mean(rows, "hops"),
        "rig_share": _mean(rows, "rig_share"),
        "stop_reasons": stops,
        "latency_total": _latency(rows, "total_ms"),
        "latency_ttft": _latency(rows, "ttft_ms"),
        "latency_retrieval": _latency(rows, "retrieval_ms"),
    }


# ── the run ──────────────────────────────────────────────────────────────────


def _git_head() -> str | None:
    """The commit the code was at — read from .git, no git command run."""
    root = paths.CONFIG_DIR.parent / ".git"
    try:
        head = (root / "HEAD").read_text().strip()
        if head.startswith("ref: "):
            ref = root / head[5:]
            return ref.read_text().strip()[:12] if ref.exists() else head[5:]
        return head[:12]
    except OSError:
        return None


def snapshot() -> dict[str, Any]:
    """Everything §5 holds constant, recorded so a reader can check it was."""
    from . import embedding_models, hardware, inference, rag_config  # noqa: PLC0415
    from . import knowledge_graph as kg  # noqa: PLC0415

    snap: dict[str, Any] = {"git_head": _git_head()}
    config = rag_config.read()
    snap["rag_config"] = config
    try:
        emb = embedding_models.read()
        state = embedding_models.index_state(emb)
        snap["embedding"] = {"model": emb.get("model"), "provider": emb.get("provider"),
                             "index_state": state["index_state"], "documents": state.get("index_documents")}
    except Exception as exc:  # noqa: BLE001
        snap["embedding"] = {"error": str(exc)}
    choice = inference.choose_model(None)
    snap["chat_model"] = {"tag": choice.get("tag"), "reason": choice.get("reason")}
    try:
        info = kg.schema()
        source = kg.source_path()
        snap["graph"] = {"nodes": info["total_nodes"], "edges": info["total_edges"],
                         "file": source.name, "sha": _sha(source.read_bytes())}
    except Exception as exc:  # noqa: BLE001
        snap["graph"] = {"error": str(exc)}
    try:
        from ..db import corpus_store  # noqa: PLC0415

        snap["corpus"] = corpus_store.stats()
        # The chunking ablation's variable: two runs that differ only here are
        # the ablation table's two columns (`compare_markdown`).
        snap["chunking"] = corpus_store.chunk_recipes()
    except Exception as exc:  # noqa: BLE001
        snap["corpus"] = {"error": str(exc)}
    try:
        profile = hardware.profile()
        snap["machine"] = {"cpu": (profile.get("cpu") or {}).get("model"),
                           "ram_bytes": (profile.get("memory") or {}).get("total_bytes"),
                           "gpus": [g.get("name") for g in (profile.get("gpu") or {}).get("devices", [])]}
    except Exception:  # noqa: BLE001
        snap["machine"] = {}
    # Settings → Assistant changes what the model is told and what is refused.
    from . import assistant_settings  # noqa: PLC0415
    from .orchestration.prompt import SYSTEM_PROMPT  # noqa: PLC0415

    custom = assistant_settings.read()
    prompt = custom["system_prompt"] or SYSTEM_PROMPT
    snap["assistant"] = {
        "system_prompt_sha": _sha(prompt.encode()),
        "custom_prompt": custom["system_prompt"] is not None,
        "refusals": custom["refusals"],
        "blocked_phrases": custom["blocked_phrases"],
        "disabled_rules": custom["disabled_rules"],
        "timezone": str(assistant_settings.site_tz()),
    }
    customised = (snap["assistant"]["custom_prompt"] or custom["refusals"] or custom["blocked_phrases"]
                  or custom["disabled_rules"])
    # What makes two official runs "the same": the frozen choices and the inputs.
    # The assistant settings join only when customised, so runs on the defaults
    # keep the fingerprint they had before these settings existed.
    keys = ("rag_config", "embedding", "chat_model", "graph", "chunking") + (("assistant",) if customised else ())
    fingerprint = json.dumps({k: snap.get(k) for k in keys}, sort_keys=True, default=str)
    snap["fingerprint"] = _sha(fingerprint.encode())
    return snap


_RUN_LOCK = threading.Lock()


@dataclass
class Progress:
    run_id: str
    total: int
    done: int = 0
    current: str | None = None
    errors: list[str] = field(default_factory=list)


def run(
    *,
    arms: list[str] | None = None,
    practice: bool = False,
    rerun_reason: str | None = None,
    query_ids: list[str] | None = None,
    on_progress: Callable[[Progress], None] | None = None,
) -> dict[str, Any]:
    """Ask every question once per arm, score it, and write the run to disk."""
    from . import rag_config  # noqa: PLC0415

    arms = arms or list(ARMS)
    unknown = [a for a in arms if a not in ARMS]
    if unknown:
        raise EvalError(f"unknown arm(s) {unknown}; expected {list(ARMS)}")
    queries = load_queries()
    if query_ids:
        queries = [q for q in queries if q["id"] in set(query_ids)]
        if not queries:
            raise EvalError("none of those question ids are in the query set")
    query_sha = _sha(QUERY_PATH.read_bytes())

    frozen = rag_config.read()["frozen"]
    if not frozen and not practice:
        raise EvalError(
            "the comparison is not frozen. PROJECT.md §5: freeze both tracks, then run once. "
            "Set \"frozen\": true in config/rag_config.json, or run with practice=True "
            "(the report is then marked not citable)."
        )
    snap = snapshot()
    official = frozen and not practice and not query_ids
    if official:
        prior = [r for r in list_runs() if r.get("official") and r.get("fingerprint") == snap["fingerprint"]
                 and r.get("query_sha") == query_sha and r.get("status") == "complete"]
        if prior and not rerun_reason:
            raise EvalError(
                f"an official run over this frozen configuration and query set already exists "
                f"({prior[0]['run_id']}). §5 runs it once; pass a rerun reason to run again — it "
                "is written into the report."
            )

    if not _RUN_LOCK.acquire(blocking=False):
        raise EvalError("an evaluation run is already in progress")
    try:
        run_id = datetime.now(timezone.utc).strftime("eval_%Y%m%d_%H%M%S")
        progress = Progress(run_id=run_id, total=len(queries) * len(arms))
        record: dict[str, Any] = {
            "run_id": run_id,
            "started_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "official": official,
            "practice": practice or not frozen,
            "partial": bool(query_ids),
            "rerun_reason": rerun_reason,
            "arms": arms,
            "query_sha": query_sha,
            "fingerprint": snap["fingerprint"],
            "snapshot": snap,
            "queries": queries,
            "results": {arm: [] for arm in arms},
            "status": "running",
        }
        try:
            # Arm by arm, not question by question: one arm's model state (a loaded
            # embedder, a warm cache) never leaks into the next arm's timings mid-way.
            for arm in arms:
                track, mode = ARMS[arm]
                with rag_config.arm(track, mode):  # type: ignore[arg-type]
                    for q in queries:
                        progress.current = f"{arm} · {q['id']}"
                        if on_progress:
                            on_progress(progress)
                        asked = _ask(q["question"])
                        qid = (asked.get("result") or {}).get("query_id")
                        trace = audit_store.trace(qid) if qid else {}
                        scored = score(q, asked, trace)
                        record["results"][arm].append(scored)
                        if scored.get("error"):
                            progress.errors.append(f"{arm} {q['id']}: {scored['error']}")
                        progress.done += 1
                        # Every answer reaches disk as it is scored, so even a
                        # killed process leaves what it had (status `running`).
                        _checkpoint(record)
                        if on_progress:
                            on_progress(progress)
                        if asked.get("still_running"):
                            raise EvalError(
                                f"{arm} {q['id']} was still running {DRAIN_TIMEOUT_S}s after its "
                                f"{QUESTION_TIMEOUT_S}s timeout — stopped, so no later question is "
                                "timed alongside it"
                            )
        except BaseException as exc:
            # A crash, a stuck model or Ctrl-C: keep every answer already scored,
            # marked aborted (never citable) with the reason, then re-raise.
            reason = "interrupted" if isinstance(exc, KeyboardInterrupt) else (
                str(exc) if isinstance(exc, EvalError) else f"{exc.__class__.__name__}: {exc}"
            )
            record["status"] = "aborted"
            record["abort_reason"] = reason
            _finish(record)
            if isinstance(exc, Exception):
                raise EvalError(
                    f"run {run_id} aborted after {progress.done} of {progress.total} answers: {reason}\n"
                    f"Partial results saved to {_dir(run_id)}"
                ) from exc
            raise

        record["status"] = "complete"
        _finish(record)
        return record
    finally:
        _RUN_LOCK.release()


def summary_of(record: dict[str, Any]) -> dict[str, Any]:
    """Per-arm metrics, overall and by category, over whatever results exist."""
    return {
        arm: {
            "overall": summarise(rows),
            "by_category": {
                c: summarise([r for r in rows if r["category"] == c])
                for c in CATEGORIES if any(r["category"] == c for r in rows)
            },
        }
        for arm, rows in record["results"].items()
    }


def _finish(record: dict[str, Any]) -> None:
    record["summary"] = summary_of(record)
    record["finished_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    _save(record)


# ── storage and reports ──────────────────────────────────────────────────────


def _dir(run_id: str) -> Path:
    if not re.fullmatch(r"eval_\d{8}_\d{6}", run_id):
        raise EvalError(f"not a run id: {run_id!r}")
    return RUNS_DIR / run_id


def _checkpoint(record: dict[str, Any]) -> None:
    """Write run.json alone, atomically — a kill mid-write leaves the last good copy."""
    folder = _dir(record["run_id"])
    folder.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=".run.", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(record, indent=2, default=str) + "\n")
        os.replace(tmp, folder / "run.json")
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _save(record: dict[str, Any]) -> None:
    _checkpoint(record)
    folder = _dir(record["run_id"])
    (folder / "report.md").write_text(report_markdown(record), encoding="utf-8")
    (folder / "results.csv").write_text(results_csv(record), encoding="utf-8")
    (folder / "judge.jsonl").write_text(judge_jsonl(record), encoding="utf-8")


def list_runs() -> list[dict[str, Any]]:
    """Every saved run, newest first, as headline facts only."""
    if not RUNS_DIR.exists():
        return []
    out = []
    for folder in sorted(RUNS_DIR.iterdir(), reverse=True):
        try:
            record = json.loads((folder / "run.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        out.append({k: record.get(k) for k in (
            "run_id", "started_at", "finished_at", "status", "official", "practice", "partial",
            "arms", "fingerprint", "query_sha", "rerun_reason", "abort_reason",
        )} | {"questions": len(record.get("queries") or [])})
    return out


def get_run(run_id: str) -> dict[str, Any]:
    path = _dir(run_id) / "run.json"
    if not path.exists():
        raise EvalError(f"no run {run_id}")
    return json.loads(path.read_text(encoding="utf-8"))


def _pct(value: float | None) -> str:
    return "—" if value is None else f"{value * 100:.0f}%"


def _num(value: float | None, digits: int = 2) -> str:
    return "—" if value is None else f"{value:.{digits}f}"


def _ms(stats: dict[str, Any] | None, key: str) -> str:
    if not stats:
        return "—"
    v = stats[key]
    return f"{v} ms" if v < 1000 else f"{v / 1000:.1f} s"


def report_markdown(record: dict[str, Any]) -> str:
    """The comparison table, per category, and every failure — the run's report."""
    arms = record["arms"]
    # A checkpoint from a killed run has results but no summary yet.
    summary = record.get("summary") or summary_of(record)
    lines = [f"# Evaluation run {record['run_id']}", ""]
    if record.get("status") != "complete":
        answered = sum(len(rows) for rows in record["results"].values())
        expected = len(record.get("queries") or []) * len(arms)
        reason = record.get("abort_reason") or "the process ended before the run finished"
        lines += [f"> **Incomplete — {record.get('status')}** after {answered} of {expected} answers: "
                  f"{reason}. Not citable.", ""]
    if record.get("practice"):
        lines += ["> **PRACTICE RUN — not citable.** The comparison was not frozen, or this was",
                  "> run as practice. PROJECT.md §5: freeze both tracks, then run once.", ""]
    if record.get("partial"):
        lines += ["> **Partial run** — a subset of the query set. Not citable.", ""]
    if record.get("rerun_reason"):
        lines += [f"> **Re-run.** Reason given: {record['rerun_reason']}", ""]
    snap = record.get("snapshot") or {}
    lines += [
        f"- Started {record.get('started_at')}, finished {record.get('finished_at')}",
        f"- Questions: {len(record.get('queries') or [])} · query set `{record.get('query_sha')}` · "
        f"configuration fingerprint `{record.get('fingerprint')}` · code `{snap.get('git_head')}`",
        f"- Chat model: `{(snap.get('chat_model') or {}).get('tag')}` · embedding: "
        f"`{(snap.get('embedding') or {}).get('model')}` ({(snap.get('embedding') or {}).get('index_state')}) · "
        f"graph: {(snap.get('graph') or {}).get('nodes')} nodes",
        f"- Chunking: {_recipe(snap)}",
        f"- Machine: {(snap.get('machine') or {}).get('cpu')}",
        "",
        "## Comparison",
        "",
        "| Metric | " + " | ".join(arms) + " |",
        "|---|" + "---|" * len(arms),
    ]

    def row(label: str, fn: Callable[[dict[str, Any]], str]) -> None:
        lines.append(f"| {label} | " + " | ".join(fn(summary.get(a, {}).get("overall", {})) for a in arms) + " |")

    row("Correct", lambda s: _pct(s.get("correct")))
    row("Fact recall (answerable)", lambda s: _num(s.get("fact_recall")))
    row("Refusal correct", lambda s: _pct(s.get("refusal_correct")))
    row("False refusals", lambda s: _pct(s.get("false_refusal")))
    row("Hallucination (caught by validator)", lambda s: _pct(s.get("hallucination")))
    row("Grounded", lambda s: _pct(s.get("grounded")))
    row("Precision@3 (Track 1)", lambda s: _num(s.get("precision_at_3")))
    row("Precision@5 (Track 1)", lambda s: _num(s.get("precision_at_5")))
    row("Recall@5 (Track 1)", lambda s: _num(s.get("recall_at_5")))
    row("MRR (Track 1)", lambda s: _num(s.get("mrr")))
    row("Node precision (Track 2)", lambda s: _num(s.get("node_precision")))
    row("Node recall (Track 2)", lambda s: _num(s.get("node_recall")))
    row("Mean hops (Track 2)", lambda s: _num(s.get("hops"), 1))
    row("Retrieved from this rig", lambda s: _pct(s.get("rig_share")))
    row("Latency mean", lambda s: _ms(s.get("latency_total"), "mean"))
    row("Latency p50", lambda s: _ms(s.get("latency_total"), "p50"))
    row("Latency p95", lambda s: _ms(s.get("latency_total"), "p95"))
    row("Time to first token p50", lambda s: _ms(s.get("latency_ttft"), "p50"))
    row("Retrieval p50", lambda s: _ms(s.get("latency_retrieval"), "p50"))
    row("Errors", lambda s: str(s.get("errors", 0)))
    lines.append("")

    lines += ["## By category — correct", "", "| Category | " + " | ".join(arms) + " |",
              "|---|" + "---|" * len(arms)]
    for c in CATEGORIES:
        cells = []
        for a in arms:
            cat = (summary.get(a, {}).get("by_category") or {}).get(c)
            cells.append(f"{_pct(cat['correct'])} (n={cat['n']})" if cat else "—")
        if any(cell != "—" for cell in cells):
            lines.append(f"| {c} | " + " | ".join(cells) + " |")
    lines.append("")

    agent = summary.get("graph-agent", {}).get("overall", {})
    if agent.get("stop_reasons"):
        lines += ["## Agent stop reasons", ""]
        lines += [f"- {k}: {v}" for k, v in sorted(agent["stop_reasons"].items(), key=lambda kv: -kv[1])]
        lines.append("")

    lines += ["## Failures", "", "Every question an arm got wrong, with what was missing — the",
              "qualitative failure analysis starts here.", ""]
    for a in arms:
        failed = [r for r in record["results"].get(a, []) if not r.get("correct")]
        lines.append(f"### {a} — {len(failed)} wrong")
        lines.append("")
        for r in failed:
            why = r.get("error") or (
                "declined an answerable question" if r.get("false_refusal")
                else "answered an out-of-corpus question" if r.get("declined") is False and r["category"] == "out_of_corpus"
                else f"missing: {', '.join(r.get('facts_missing') or []) or '—'}"
            )
            lines.append(f"- **{r['id']}** ({r['category']}) — {why}. `query_id {r.get('query_id')}`")
        lines.append("")
    lines += ["---", "",
              "Metric definitions: docs/EVALUATION.md. Correctness here is lexical (key facts by pattern);",
              "the LLM-judge and human-panel scores come from `judge.jsonl` and `results.csv`, offline.", ""]
    return "\n".join(lines)


def _recipe(snap: dict[str, Any]) -> str:
    recipes = snap.get("chunking") or []
    if not recipes:
        return "not recorded"
    return " + ".join(f"{r['strategy']} {r['chunk_size']}/{r['chunk_overlap']} ({r['chunks']} chunks)" for r in recipes)


# The headline metrics, in the order the ablation table shows them.
_COMPARE_METRICS: tuple[tuple[str, str, Callable[[float | None], str]], ...] = (
    ("Correct", "correct", _pct),
    ("Fact recall", "fact_recall", _num),
    ("Hallucination", "hallucination", _pct),
    ("Grounded", "grounded", _pct),
    ("Precision@5", "precision_at_5", _num),
    ("Recall@5", "recall_at_5", _num),
    ("MRR", "mrr", _num),
    ("Node recall", "node_recall", _num),
)


def compare_markdown(records: list[dict[str, Any]]) -> str:
    """Runs side by side, per arm — the ablation table.

    Meant for runs that differ in one thing (the chunking, for the chunking
    ablation). Says so when they also differ in anything else the fingerprint
    covers, or in the query set, because then the columns are not an ablation.
    """
    snaps = [r.get("snapshot") or {} for r in records]
    lines = ["# Run comparison", ""]
    for r, snap in zip(records, snaps):
        kind = "practice" if r.get("practice") else "official"
        lines.append(f"- `{r['run_id']}` ({kind}) — chunking: {_recipe(snap)}")
    if len({r.get("query_sha") for r in records}) > 1:
        lines += ["", "> **Different query sets** — these runs did not ask the same questions."]
    others = ("rag_config", "embedding", "chat_model", "graph")
    differing = [k for k in others if len({json.dumps(s.get(k), sort_keys=True, default=str) for s in snaps}) > 1]
    if differing:
        lines += ["", f"> **Not a clean ablation** — these also differ: {', '.join(differing)}."]
    lines.append("")

    arms = [a for a in ARMS if all(a in r["arms"] for r in records)]
    header = "| Metric | " + " | ".join(r["run_id"] for r in records) + " |"
    for arm in arms:
        lines += [f"## {arm}", "", header, "|---|" + "---|" * len(records)]
        for label, key, fmt in _COMPARE_METRICS:
            cells = [fmt(((r.get("summary") or summary_of(r)).get(arm) or {}).get("overall", {}).get(key))
                     for r in records]
            lines.append(f"| {label} | " + " | ".join(cells) + " |")
        lines.append("")
    if not arms:
        lines.append("These runs share no arm, so there is nothing to compare.")
    return "\n".join(lines) + "\n"


_CSV_FIELDS = (
    "arm", "id", "category", "question", "answer", "correct", "fact_recall", "declined",
    "refusal_correct", "hallucination", "grounded", "precision_at_3", "precision_at_5",
    "recall_at_5", "mrr", "node_precision", "node_recall", "hops", "stop_reason", "rig_share",
    "total_ms", "ttft_ms", "retrieval_ms", "query_id", "error",
)


def results_csv(record: dict[str, Any]) -> str:
    """One row per question per arm — for a spreadsheet and the human panel."""
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=list(_CSV_FIELDS) + ["human_score", "human_notes"],
                            extrasaction="ignore")
    writer.writeheader()
    for arm, rows in record["results"].items():
        for r in rows:
            writer.writerow({**r, "arm": arm})
    return buffer.getvalue()


def judge_jsonl(record: dict[str, Any]) -> str:
    """Method B's input: question, labels and answer, per arm — for an offline
    LLM judge over the *exported* logs. Nothing here calls a model."""
    by_id = {q["id"]: q for q in record["queries"]}
    lines = []
    for arm, rows in record["results"].items():
        for r in rows:
            q = by_id.get(r["id"], {})
            lines.append(json.dumps({
                "run_id": record["run_id"], "arm": arm, "id": r["id"], "category": r["category"],
                "question": r["question"], "answer": r.get("answer"),
                "answerable": (q.get("expect") or {}).get("answerable"),
                "key_facts": (q.get("expect") or {}).get("key_facts"),
                "query_id": r.get("query_id"),
            }, ensure_ascii=False))
    return "\n".join(lines) + ("\n" if lines else "")
