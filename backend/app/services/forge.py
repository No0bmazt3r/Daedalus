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

import re
import sqlite3
import threading
from typing import Any

from ..db import audit_store, sqlite_util
from ..db.paths import AUDIT_DB
from . import hardware, hf_discovery, model_fit, ollama_client, ollama_registry

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

    Generation rate comes from the engine's own `generation_ms`, not from
    `completion ÷ (total − TTFT)`. The subtraction charges the model for any
    client-side delay; on a busy machine that halved the figure. Rows written
    before migration 002 have no `generation_ms` and fall back to the old
    arithmetic, flagged so the UI can say which it used.
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
        generation_ms = row.get("generation_ms")

        tps = None
        rate_source = None
        if completion and generation_ms:
            tps = round(completion / (generation_ms / 1000.0), 1)
            rate_source = "engine"
        elif completion and total and ttft is not None and total > ttft:
            tps = round(completion / ((total - ttft) / 1000.0), 1)
            rate_source = "wall_clock"

        out[name] = {
            "at": row.get("timestamp"),
            "query_id": row.get("query_id"),
            "time_to_first_token_ms": ttft,
            "total_inference_ms": total,
            "prefill_ms": row.get("prefill_ms"),
            "generation_ms": generation_ms,
            "prompt_token_count": row.get("prompt_token_count"),
            "completion_token_count": completion,
            "tokens_per_sec": tps,
            "rate_source": rate_source,
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
    kind: str = "general",
    shortlist: bool = False,
    registry: dict[str, Any] | None = None,
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
    weights_hint: str | None = None
    measured_context: int | None = None

    # Weight size, best source first. All three beat `params × bytes_per_param`,
    # and the row reports which one answered so an estimate is never mistaken
    # for a measurement.
    capabilities: list[str] = []
    if installed:
        # Asked for cloud tags too: a cloud model's capabilities are a property
        # of the model, not of where it runs, and the picker shows them either
        # way. `_show_cached` keys on the digest, so this is one call per tag.
        detail = _show_cached(installed["name"], installed.get("digest"))
        if detail:
            capabilities = detail.get("capabilities") or []

    if installed and not installed.get("remote"):
        weights_bytes = installed.get("size_bytes")
        weights_hint = "measured"
        if detail:
            arch = detail.get("arch")
            measured_context = detail.get("context_length")
    elif registry and registry.get("weights_bytes"):
        # Not downloaded, but the registry publishes the real size — so even an
        # un-pulled row estimates from a byte count rather than arithmetic.
        weights_bytes = registry["weights_bytes"]
        weights_hint = "registry"

    scored = model_fit.score_row(
        params_b=params_b,
        quant=quant,
        context_length=measured_context or context_length,
        mmlu=mmlu,
        hardware=hardware_profile,
        budget=budget,
        arch=arch,
        weights_bytes=weights_bytes,
        weights_source_hint=weights_hint,
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

    # An embedding model is not a candidate to answer anything.
    #
    # Tiering is `slm` under 4B params and `llm` over, which was correct while
    # every installed model was generative. `nomic-embed-text` is 137M, so it
    # would land in `slm` — the tier the deployment actually picks from — and be
    # offered as a chat model with a fit verdict, a speed estimate and a quality
    # score computed on a scale that does not apply to it. On a machine where it
    # was the only model pulled, `model_config.resolve()` in auto mode would
    # select it and the chat path would ask an embedder for a completion.
    #
    # Capability comes from Ollama's own `/api/show`, so this holds for anything
    # pulled, not just the four in the embedding catalogue.
    if "embedding" in capabilities:
        tier = "embedding"
        kind = "embedding"

    return {
        "id": row_id,
        "model_id": model_id,
        "label": label,
        "vendor": vendor,
        "tag": tag,
        "tag_verified": tag_verified,
        "tier": tier,
        "kind": kind,
        "shortlist": shortlist,
        "source": source,
        # None when the registry could not be reached — distinct from False,
        # which means the tag genuinely is not published.
        "tag_exists": (registry or {}).get("exists"),
        "download_bytes": (registry or {}).get("weights_bytes"),
        "params_b": params_b,
        "context_length": measured_context or context_length,
        "context_source": "measured" if measured_context else "declared",
        # The architecture the memory estimate was computed from. Already read
        # for the KV-cache arithmetic; carried to the UI so §8.2's numbers can
        # be checked rather than trusted — `estimate.formula` states the sum,
        # and these are its inputs.
        #
        # Note `embedding_length` here is the model's hidden size, not a
        # retrieval vector width. Same GGUF key as an embedding model's output
        # dimension, different meaning, so it is never labelled "dimensions".
        "arch": arch,
        "notes": notes,
        "capabilities": capabilities,
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

    catalogue = model_fit.catalogue()

    # One parallel pass over the registry for every tag in the catalogue, before
    # scoring any of them. Serially this would be one round trip per row and the
    # table has fifty; batched and cached it is a second on the first call of a
    # process and free thereafter. It answers two things at once: whether the
    # tag is real, and how large the download actually is.
    all_tags = [
        variant.get("tag") or model.get("default_tag")
        for model in catalogue
        for variant in (model.get("quantizations") or [])
    ]
    manifests = ollama_registry.verify_many([t for t in all_tags if t])

    # ── declared candidates ──
    for model in catalogue:
        quality = model.get("quality") or {}
        shortlist = bool(model.get("shortlist"))
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
                    kind=model.get("kind") or "general",
                    shortlist=shortlist,
                    registry=manifests.get(tag),
                    # Two sets, distinguished: `shortlist` is what the report
                    # argues about, `library` is everything else this machine
                    # could run. The filter bar is built on this.
                    source="shortlist" if shortlist else "library",
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
        discovered_detail = _show_cached(tag, model.get("digest")) or {}
        discovered_caps = discovered_detail.get("capabilities") or []
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
                "kind": "general",
                "shortlist": False,
                "tag_exists": None,
                "download_bytes": None,
                "source": "cloud" if model.get("remote") else "installed",
                "params_b": None,
                "context_length": None,
                "context_source": "unknown",
                "notes": (
                    # Ollama lists cloud-hosted models beside local ones. They
                    # are not a local deployment target under Rule 1 and their
                    # weights are not on this disk, so scoring them against this
                    # machine's memory would be answering a question nobody
                    # asked. Listed, labelled, and left unranked.
                    "Hosted by Ollama's cloud, not on this machine. Benchmark reference only, never deployed."
                    if model.get("remote")
                    else "Ollama reports no parameter count for this model, so it cannot be scored."
                ),
                "capabilities": discovered_caps,
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
            tier="slm" if params_b <= 4.0 else "llm",
            source="installed",
            kind="general",
            shortlist=False,
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


# The widths people actually run, best-quality first. A repository shipping
# twenty variants gets cut to these, in this order, so one prolific publisher
# cannot bury every other result — and so the list leads with a usable quant
# rather than with IQ1_S purely because it is the smallest.
_QUANT_LADDER = ("Q8_0", "Q6_K", "Q5_K_M", "Q4_K_M", "IQ4_XS", "Q3_K_M", "Q2_K")


def _pick_quants(available: list[str] | None, limit: int = 4) -> list[str]:
    """Up to `limit` quantizations worth offering, in descending quality."""
    if not available:
        return [model_fit.DEFAULT_QUANT]
    present = {q.upper() for q in available}
    picked = [q for q in _QUANT_LADDER if q in present][:limit]
    if picked:
        return picked
    # Nothing from the ladder — an unusual repository. Fall back to the widest
    # few it does ship, which are the least degraded.
    return sorted(
        available,
        key=lambda q: -model_fit.quant_spec(model_fit.normalise_quant(q))["bytes_per_param"],
    )[:limit]


def huggingface_rows(
    query: str = "",
    *,
    limit: int = 24,
    context_tokens: int | None = None,
) -> dict[str, Any]:
    """GGUF repositories from Hugging Face, scored against this machine.

    Kept out of `models()` and behind its own call for two reasons. It is a
    network search that can be slow or fail, and the main table must render on
    an offline machine; and it is a *query*, answering "what else is out there"
    rather than "what am I choosing between", which is a different question and
    belongs behind a search box.

    Each repository contributes one row per quantization it ships, because that
    is the unit you can actually pull — `hf.co/{repo}:{quant}` — and the whole
    point is that Q4_K_M of a 14B model and Q8_0 of the same model are different
    answers to "will this run".
    """
    context_tokens = context_tokens or model_fit.DEFAULT_WORKING_CONTEXT
    found = hf_discovery.search(query, limit=limit)
    if found["error"]:
        return {"rows": [], "error": found["error"], "cached": found["cached"]}

    hardware_profile = hardware.profile()
    budget = model_fit.memory_budget(hardware_profile)
    installed, _ = _installed_index()
    benchmarks = _last_benchmarks()

    rows: list[dict[str, Any]] = []
    for repo in found["models"]:
        quants = _pick_quants(repo["quantizations"])
        for quant in quants:
            tag = hf_discovery.ollama_tag(repo["repo"], quant)
            row = _row(
                row_id=f"hf@{repo['repo']}@{quant}",
                model_id=repo["repo"],
                label=repo["repo"].split("/")[-1],
                tag=tag,
                tier="slm" if repo["params_b"] <= 4.0 else "llm",
                source="huggingface",
                kind="general",
                shortlist=False,
                registry=None,
                params_b=repo["params_b"],
                quant=quant,
                context_length=repo.get("context_length"),
                # Nobody has scored these. Same treatment as a discovered
                # model: neutral on quality, judged on fit and speed.
                mmlu=None,
                quality_meta=None,
                hardware_profile=hardware_profile,
                budget=budget,
                installed=installed.get(tag),
                benchmarks=benchmarks,
                context_tokens=context_tokens,
                vendor=repo.get("author"),
                notes=(
                    f"{repo['downloads']:,} downloads on Hugging Face"
                    if repo.get("downloads")
                    else None
                ),
            )
            row["quantization_known"] = model_fit.quant_known(quant)
            row["hf"] = {
                "repo": repo["repo"],
                "url": repo["url"],
                "architecture": repo.get("architecture"),
                "downloads": repo.get("downloads"),
                "likes": repo.get("likes"),
                "gated": repo.get("gated"),
            }
            rows.append(row)

    rows.sort(key=lambda r: (r["score"] is None, -(r["score"] or 0)))
    for index, row in enumerate(rows, start=1):
        row["rank"] = index

    return {
        "rows": rows,
        "error": None,
        "cached": found["cached"],
        "budget": budget,
        "context_tokens": context_tokens,
    }


def warm_registry() -> None:
    """Pre-fetch every catalogue tag's manifest. Called from the lifespan.

    Without it the first `GET /api/forge/models` of a process pays ~11s of
    registry round trips before it can answer — the cost is per-tag and the
    catalogue has fifty. Off the request path it is invisible, and afterwards
    the table builds in about 25ms.
    """
    try:
        tags = [
            variant.get("tag") or model.get("default_tag")
            for model in model_fit.catalogue()
            for variant in (model.get("quantizations") or [])
        ]
        ollama_registry.verify_many([t for t in tags if t])
    except Exception:  # pragma: no cover - defensive
        # Offline is normal. The table falls back to declared estimates.
        pass


# Quantization suffix on an Ollama tag: `qwen3:8b-q4_K_M`, `phi3:mini-fp16`.
_TAG_QUANT = re.compile(r"[-:]((?:I?Q\d[\w_]*)|f?p?16|bf16|f32|mxfp4)$", re.IGNORECASE)


def inspect_tag(tag: str, *, context_tokens: int | None = None) -> dict[str, Any]:
    """Score one arbitrary tag the catalogue has never heard of.

    The "I know what I want, just tell me if it fits" path. Takes anything
    Ollama would take — a library tag (`qwen3:30b`), a namespaced repo, or a
    Hugging Face pull (`hf.co/user/repo:Q4_K_M`) — and puts it through the same
    scorer as everything else.

    Parameter count is derived from the published weight size rather than
    declared, because the registry reports bytes and not parameters. That
    inversion is fine here: the memory estimate wants bytes and already has the
    real ones, so the derived parameter count is only used for the CPU speed
    fallback, where being a few percent out is far below the noise floor of the
    estimate itself.
    """
    tag = (tag or "").strip()
    if not tag:
        return {"row": None, "error": "no tag given"}

    context_tokens = context_tokens or model_fit.DEFAULT_WORKING_CONTEXT
    hardware_profile = hardware.profile()
    budget = model_fit.memory_budget(hardware_profile)
    installed, _ = _installed_index()
    benchmarks = _last_benchmarks()

    match = _TAG_QUANT.search(tag)
    quant = model_fit.normalise_quant(match.group(1) if match else None)

    local = installed.get(tag)
    hf_repo = hf_discovery.parse_hf_tag(tag)
    registry = None
    hf_row: dict[str, Any] | None = None

    if not local and hf_repo:
        # A Hugging Face pull. Ollama's registry knows nothing about it — the
        # size and parameter count have to come from Hugging Face's own API.
        repo, tag_quant = hf_repo
        if tag_quant:
            quant = model_fit.normalise_quant(tag_quant)
        found = hf_discovery.detail(repo)
        if found["error"]:
            return {"row": None, "error": found["error"]}
        hf_row = found["model"]
    elif not local:
        registry = ollama_registry.manifest(tag)

    if not local and registry and registry.get("exists") is False:
        return {
            "row": None,
            # Ollama's own vocabulary, so the message matches what a failed pull
            # would say rather than inventing a second way to describe it.
            "error": f"no manifest for '{tag}'. Check the tag against the model's page.",
        }

    weights = (local or {}).get("size_bytes") or (registry or {}).get("weights_bytes")
    if local and local.get("parameter_size"):
        params_b = model_fit.parse_params_b(local["parameter_size"]) or 0.0
    elif hf_row:
        # Hugging Face reports the parameter count directly, so this is the one
        # path that does not have to work backwards from a byte count.
        params_b = hf_row["params_b"]
        weights = None
    elif weights:
        params_b = round(weights / 1e9 / model_fit.quant_spec(quant)["bytes_per_param"], 2)
    else:
        return {
            "row": None,
            "error": (
                f"could not size '{tag}'. The registry did not answer, so there is nothing "
                "to estimate from. Check your connection, or pull it and it gets measured."
            ),
        }

    row = _row(
        row_id=f"custom@{tag}",
        model_id=tag,
        label=tag.split("/")[-1],
        tag=tag,
        tier="slm" if params_b <= 4.0 else "llm",
        source="custom",
        kind="general",
        shortlist=False,
        registry=registry,
        params_b=params_b,
        quant=quant,
        context_length=(hf_row or {}).get("context_length"),
        mmlu=None,
        quality_meta=None,
        hardware_profile=hardware_profile,
        budget=budget,
        installed=local,
        benchmarks=benchmarks,
        context_tokens=context_tokens,
        vendor=(hf_row or {}).get("author"),
        notes=(
            None
            if local
            else "Parameter count from Hugging Face."
            if hf_row
            else "Parameter count derived from the published weight size, not declared."
        ),
    )
    if hf_row:
        row["hf"] = {
            "repo": hf_row["repo"],
            "url": hf_row["url"],
            "architecture": hf_row.get("architecture"),
            "downloads": hf_row.get("downloads"),
            "likes": hf_row.get("likes"),
            "gated": hf_row.get("gated"),
        }
    row["rank"] = 1
    row["quantization_known"] = model_fit.quant_known(match.group(1) if match else None)
    return {"row": row, "error": None, "budget": budget}
