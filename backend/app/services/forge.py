"""The Forge's model table — where the catalogue meets the machine.

Assembles one ranked list from three sources, which is the whole job:

1. **The catalogue** (`data/model_catalogue.json`) — the six candidates from
   `PROJECT.md` §8.1, scorable before anything is downloaded. This is what makes
   the console useful on a fresh machine: it answers "what should I pull?".
2. **Ollama** — what is actually installed, with its real size on disk and, via
   `/api/show`, its real architecture. These replace the catalogue's arithmetic
   wherever they exist.
3. **`model_logs`** — the last benchmark for each model, if one has been run.

## The catalogue is a seed, not a closed list

Anything pulled into Ollama appears here whether or not it was ever declared.
Ollama reports each model's own parameter count and quantization, which is
everything the scorer needs, so a model discovered this way is ranked on the
same footing as a declared one — it simply has no MMLU score until somebody
adds one.

That matters for the deployment story: the committed choice is a policy, not a
name (`services/model_config.py`), and `auto` resolves against this table. Pull
a better model and the system moves to it without an edit anywhere.

## Three confidence levels, never blurred

`MODULES.md` §2.2: an estimate and a measurement must never look alike. Every
row therefore carries all three states explicitly, and the UI renders them
differently:

    declared   → arithmetic over a parameter count. Nothing has been run
    measured   → real bytes on disk, real architecture from /api/show
    benchmarked → real tok/s and TTFT from model_logs

The gap between the first and the last is the module's contribution to the
report, and it closes as you work through the six steps.
"""

from __future__ import annotations

import sqlite3
import threading
from typing import Any

from ..db import audit_store, sqlite_util
from ..db.paths import AUDIT_DB
from . import hardware, model_fit, ollama_client

# /api/show costs a round trip per model. Keyed by digest, so a re-pulled or
# changed model invalidates itself and nothing else does — the architecture of
# a given digest is immutable.
_show_cache: dict[str, dict[str, Any]] = {}
_show_lock = threading.Lock()


def _show_cached(name: str, digest: str | None) -> dict[str, Any] | None:
    key = digest or name
    with _show_lock:
        hit = _show_cache.get(key)
    if hit is not None:
        return hit
    try:
        detail = ollama_client.show(name)
    except Exception:
        # A model that will not describe itself still scores from what
        # /api/tags said about it. Degrade, never fail the table.
        return None
    with _show_lock:
        _show_cache[key] = detail
    return detail


def _last_benchmarks() -> dict[str, dict[str, Any]]:
    """The most recent successful benchmark per model, from `model_logs`.

    Same table live traffic writes to, which is the point — `MODULES.md` §2.3
    requires the latency chapter to draw benchmark and production numbers from
    one place so they are comparable.

    Generation rate excludes prefill: time-to-first-token is the prefill, and
    folding it into tok/s would make a long RAG prompt look like a slow model.
    """
    try:
        audit_store.init_db()
        with sqlite_util.connect(AUDIT_DB) as conn:
            rows = conn.execute(
                """
                SELECT m.* FROM model_logs m
                WHERE m.status = 'ok'
                  AND m.id = (
                    SELECT MAX(x.id) FROM model_logs x
                    WHERE x.model_name = m.model_name AND x.status = 'ok'
                  )
                """
            ).fetchall()
    except (sqlite3.Error, Exception):
        return {}

    out: dict[str, dict[str, Any]] = {}
    for raw in rows:
        row = dict(raw)
        name = row.get("model_name")
        if not name:
            continue
        ttft = row.get("time_to_first_token_ms")
        total = row.get("total_inference_ms")
        completion = row.get("completion_token_count")
        tps = None
        if completion and total and ttft is not None and total > ttft:
            tps = round(completion / ((total - ttft) / 1000.0), 1)
        out[name] = {
            "at": row.get("timestamp"),
            "query_id": row.get("query_id"),
            "time_to_first_token_ms": ttft,
            "total_inference_ms": total,
            "prompt_token_count": row.get("prompt_token_count"),
            "completion_token_count": completion,
            "tokens_per_sec": tps,
        }
    return out


def _installed_index() -> tuple[dict[str, dict[str, Any]], str | None]:
    """Locally pulled models keyed by tag, plus why the list is empty if it is."""
    try:
        models = ollama_client.list_models()
    except ollama_client.OllamaUnavailable as exc:
        return {}, str(exc)
    except Exception as exc:  # noqa: BLE001
        return {}, f"{exc.__class__.__name__}: {exc}"
    return {m["name"]: m for m in models if m.get("name")}, None


def _row(
    *,
    row_id: str,
    model_id: str,
    label: str,
    tag: str,
    tier: str,
    source: str,
    params_b: float,
    quant: str,
    context_length: int | None,
    mmlu: float | None,
    quality_meta: dict[str, Any] | None,
    hardware_profile: dict[str, Any],
    budget: dict[str, Any],
    installed: dict[str, Any] | None,
    benchmarks: dict[str, dict[str, Any]],
    context_tokens: int,
    tag_verified: bool = True,
    vendor: str | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    arch: dict[str, Any] | None = None
    weights_bytes: int | None = None
    measured_context: int | None = None

    if installed and not installed.get("remote"):
        # Installed: prefer everything the machine can tell us over everything
        # the catalogue guessed.
        weights_bytes = installed.get("size_bytes")
        detail = _show_cached(installed["name"], installed.get("digest"))
        if detail:
            arch = detail.get("arch")
            measured_context = detail.get("context_length")

    scored = model_fit.score_row(
        params_b=params_b,
        quant=quant,
        context_length=measured_context or context_length,
        mmlu=mmlu,
        hardware=hardware_profile,
        budget=budget,
        arch=arch,
        weights_bytes=weights_bytes,
        context_tokens=context_tokens,
    )

    measured = benchmarks.get(tag)
    accuracy = None
    estimated_tps = (scored.get("speed") or {}).get("tokens_per_sec")
    measured_tps = (measured or {}).get("tokens_per_sec")
    if estimated_tps and measured_tps:
        accuracy = {
            "estimated_tokens_per_sec": estimated_tps,
            "measured_tokens_per_sec": measured_tps,
            "ratio": round(measured_tps / estimated_tps, 2),
        }

    return {
        "id": row_id,
        "model_id": model_id,
        "label": label,
        "vendor": vendor,
        "tag": tag,
        "tag_verified": tag_verified,
        "tier": tier,
        "source": source,
        "params_b": params_b,
        "context_length": measured_context or context_length,
        "context_source": "measured" if measured_context else "declared",
        "notes": notes,
        "installed": bool(installed) and not (installed or {}).get("remote"),
        "remote": bool((installed or {}).get("remote")),
        "size_bytes": (installed or {}).get("size_bytes"),
        "modified_at": (installed or {}).get("modified_at"),
        "quality_meta": quality_meta,
        # The measured half. None until somebody runs step 5 — a first-class
        # state the UI renders as "not benchmarked", never as a blank.
        "measured": measured,
        # How far the estimate was out, once there is something to compare it
        # to. This is the module's actual contribution to the report: §8.2 says
        # measured numbers replace estimates, and this is the number that says
        # by how much and in which direction.
        #
        # >1 means the machine beat the estimate, <1 means the estimate was
        # optimistic. Expect the latter: the estimate assumes the weights sit in
        # VRAM, and a 4GB card also has to hold the KV cache and compute
        # buffers, so a model that "fits" on paper often part-offloads.
        "estimate_accuracy": accuracy,
        **scored,
    }


def _build(context_tokens: int | None = None) -> dict[str, Any]:
    context_tokens = context_tokens or model_fit.DEFAULT_WORKING_CONTEXT
    hardware_profile = hardware.profile()
    budget = model_fit.memory_budget(hardware_profile)
    installed, ollama_error = _installed_index()
    benchmarks = _last_benchmarks()

    rows: list[dict[str, Any]] = []
    claimed: set[str] = set()

    # ── declared candidates ──
    for model in model_fit.catalogue():
        quality = model.get("quality") or {}
        for variant in model.get("quantizations") or []:
            tag = variant.get("tag") or model.get("default_tag")
            if not tag:
                continue
            claimed.add(tag)
            rows.append(
                _row(
                    row_id=f"{model['id']}@{variant['quant']}",
                    model_id=model["id"],
                    label=model.get("label") or model["id"],
                    tag=tag,
                    tier=model.get("tier") or "slm",
                    source="catalogue",
                    params_b=float(model.get("params_b") or 0),
                    quant=variant["quant"],
                    context_length=model.get("context_length"),
                    mmlu=quality.get("mmlu"),
                    quality_meta=quality,
                    hardware_profile=hardware_profile,
                    budget=budget,
                    installed=installed.get(tag),
                    benchmarks=benchmarks,
                    context_tokens=context_tokens,
                    tag_verified=bool(variant.get("tag_verified")),
                    vendor=model.get("vendor"),
                    notes=model.get("notes"),
                )
            )

    # ── discovered: installed, but nothing in the catalogue claims it ──
    for tag, model in installed.items():
        if tag in claimed:
            continue
        params_b = model_fit.parse_params_b(model.get("parameter_size"))
        quant_raw = model.get("quantization_level")
        if model.get("remote") or not params_b:
            # Ollama could not say how large it is — usually a cloud entry.
            # Scoring it would mean inventing the one number that decides the
            # verdict, so it is listed as unscorable instead.
            rows.append({
                "id": f"discovered@{tag}",
                "model_id": tag,
                "label": tag,
                "vendor": None,
                "tag": tag,
                "tag_verified": True,
                "tier": "discovered",
                "source": "discovered",
                "params_b": None,
                "context_length": None,
                "context_source": "unknown",
                "notes": (
                    # Ollama lists cloud-hosted models beside local ones. They
                    # are not a local deployment target under Rule 1 and their
                    # weights are not on this disk, so scoring them against this
                    # machine's memory would be answering a question nobody
                    # asked. Listed, labelled, and left unranked.
                    "Hosted by Ollama's cloud, not on this machine — benchmark reference only, never deployed."
                    if model.get("remote")
                    else "Ollama reports no parameter count for this model, so it cannot be scored."
                ),
                "installed": not model.get("remote"),
                "remote": bool(model.get("remote")),
                "size_bytes": model.get("size_bytes"),
                "modified_at": model.get("modified_at"),
                "quality_meta": None,
                "measured": benchmarks.get(tag),
                "quantization": model_fit.normalise_quant(quant_raw),
                "quantization_known": model_fit.quant_known(quant_raw),
                "estimate": None,
                "verdict": {
                    "fit": "cloud" if model.get("remote") else "unknown",
                    "placement": "cloud" if model.get("remote") else "unknown",
                    "utilisation": None,
                    "judged_against": None,
                    "headroom_bytes": None,
                },
                "speed": None,
                "quality": None,
                "dimensions": None,
                "weights": None,
                "score": None,
            })
            continue

        row = _row(
            row_id=f"discovered@{tag}",
            model_id=tag,
            label=tag,
            tag=tag,
            tier="discovered",
            source="discovered",
            params_b=params_b,
            quant=quant_raw or model_fit.DEFAULT_QUANT,
            context_length=None,
            # No MMLU for a model nobody declared. `_quality_score` scores an
            # unknown at the midpoint rather than zero, so a discovered model
            # competes on fit and speed without being buried for missing a
            # figure the catalogue never claimed to have.
            mmlu=None,
            quality_meta=None,
            hardware_profile=hardware_profile,
            budget=budget,
            installed=model,
            benchmarks=benchmarks,
            context_tokens=context_tokens,
            vendor=None,
            notes=None,
        )
        row["quantization_known"] = model_fit.quant_known(quant_raw)
        rows.append(row)

    # Ranked: score descending, then installed first, then smaller first — a
    # tie between two models that score the same is broken toward the one
    # already on disk, and then toward the cheaper one to run.
    rows.sort(
        key=lambda r: (
            # Unscorable rows (cloud, or no parameter count) sort below every
            # scored one instead of tying with the will-not-fits at zero.
            r["score"] is None,
            -(r["score"] or 0),
            not r["installed"],
            (r["estimate"] or {}).get("total_bytes", 1 << 62),
        )
    )
    for index, row in enumerate(rows, start=1):
        row["rank"] = index

    return {
        "rows": rows,
        "budget": budget,
        "context_tokens": context_tokens,
        "hardware": {
            "cpu": hardware_profile.get("cpu"),
            "memory": hardware_profile.get("memory"),
            "gpu": hardware_profile.get("gpu"),
            "host": hardware_profile.get("host"),
            "host_machine": hardware_profile.get("host_machine"),
        },
        "ollama": {
            "available": ollama_error is None,
            "error": ollama_error,
            "installed_count": len(installed),
        },
        "quantizations": model_fit.quantizations(),
        "weights": dict(model_fit._WEIGHTS),
    }


def models(context_tokens: int | None = None) -> dict[str, Any]:
    """The full ranked table — catalogue and discovered, estimated and measured."""
    return _build(context_tokens)


def installed_rows(context_tokens: int | None = None) -> list[dict[str, Any]]:
    """Ranked rows for models actually on this disk.

    What `model_config.resolve()` picks from in `auto` mode. Excludes remote
    entries: Ollama lists cloud-hosted models alongside local ones, and those
    are not a local deployment target under Rule 1.
    """
    table = _build(context_tokens)
    return [r for r in table["rows"] if r["installed"] and not r["remote"] and r["score"] is not None]


def invalidate_cache() -> None:
    """Forget cached `/api/show` results — after a pull or a delete."""
    with _show_lock:
        _show_cache.clear()
