"""Memory estimation and fit scoring for the Forge — steps 2 and 3 of six.

`PROJECT.md` §8.2 steps 2 and 3, specified in `docs/research/05`:

    2. Estimate memory per model × quantization
    3. Score fit / speed / quality / context → safe | marginal | will_not_fit

## What this is, and what it deliberately is not

`research/05` is explicit that this is *not* a copy of llmfit: llmfit is a
general-purpose Rust tool covering hundreds of models across many runtimes and
architectures, including MoE. This is the narrow version — the six candidates in
`PROJECT.md` §8.1, all dense, all under Ollama, scored for one workload: RAG over
reactor documentation with a 1–3k-token evidence pack.

That narrowness is what makes it more useful here than the general tool would
be. The weights below are tuned against *this project's* targets (§9.2), not a
generic "chat" profile, and the context dimension is scored against the evidence
packs this system actually builds rather than a nominal maximum.

## Estimates are placeholders — the central rule

`MODULES.md` §2.2: an estimate and a measurement must never look alike. Every
figure here is therefore tagged with where it came from, and the estimator
prefers a measurement whenever one exists:

| Source | Meaning |
|---|---|
| `declared` | From the catalogue. Nobody has run anything; this is arithmetic |
| `measured` | Read from Ollama for a model that is actually pulled |

So `estimated_memory_bytes` for a pulled model uses its real weight size on disk
and its real architecture from `/api/show`, and only the KV cache and runtime
overhead remain arithmetic. The number improves as you work through the module,
which is exactly the progression the report is meant to show.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

GB = 1024**3

_CATALOGUE_PATH = Path(__file__).resolve().parent.parent / "data" / "model_catalogue.json"


# ── quantization constants ───────────────────────────────────────────────────
#
# `bytes_per_param` is the one that decides whether a model fits, so it is worth
# saying where each number comes from. §8.2 gives the ranges (Q4_K_M ≈ 0.5–0.6,
# Q8_0 ≈ 1.0, FP16 ≈ 2.0); these sit inside them, at the top of the Q4 range
# rather than the middle, for a measured reason:
#
#   llama3.2:latest, pulled on the development machine, reports 3.2B parameters
#   and 2,019,393,189 bytes on disk — 0.63 bytes/param, above §8.2's stated
#   range. The gap is the embedding table: a 128k-token vocabulary at 3072
#   dimensions is ~394M parameters, over a tenth of the model, and GGUF keeps
#   embeddings and norms at higher precision than the quantized blocks. The
#   smaller the model, the more that fixed cost dominates.
#
# 0.60 therefore under-promises less on exactly the small models this project
# deploys. It is still an estimate, and a pulled model's real size replaces it.
# The three §8.2 names first, then the rest of the GGUF ladder. The extras are
# not scope creep: the catalogue is a seed, not a closed list, and any model
# already pulled into Ollama is scored from the `quantization_level` it reports
# for itself. That string is whatever the publisher chose — Q5_K_M, Q6_K, MXFP4
# — and a model the console cannot score is a model the console cannot
# recommend, which defeats the point of discovering it.
_QUANT: dict[str, dict[str, float]] = {
    # speed_multiplier applies only to the CPU fallback path, where throughput
    # tracks arithmetic on quantized blocks rather than memory bandwidth.
    # quality_penalty is in MMLU points, subtracted from the declared score.
    "Q4_K_M": {"bytes_per_param": 0.60, "speed_multiplier": 1.15, "quality_penalty": -5.0},
    "Q8_0": {"bytes_per_param": 1.05, "speed_multiplier": 0.80, "quality_penalty": -1.0},
    "FP16": {"bytes_per_param": 2.00, "speed_multiplier": 0.60, "quality_penalty": 0.0},
    # ── beyond §8.2's three, for models discovered rather than declared ──
    "Q2_K": {"bytes_per_param": 0.40, "speed_multiplier": 1.35, "quality_penalty": -12.0},
    "Q3_K_M": {"bytes_per_param": 0.50, "speed_multiplier": 1.25, "quality_penalty": -8.0},
    "Q4_0": {"bytes_per_param": 0.59, "speed_multiplier": 1.15, "quality_penalty": -5.0},
    "Q4_K_S": {"bytes_per_param": 0.57, "speed_multiplier": 1.18, "quality_penalty": -6.0},
    "Q5_K_M": {"bytes_per_param": 0.70, "speed_multiplier": 1.00, "quality_penalty": -2.0},
    "Q5_0": {"bytes_per_param": 0.69, "speed_multiplier": 1.00, "quality_penalty": -2.5},
    "Q6_K": {"bytes_per_param": 0.82, "speed_multiplier": 0.95, "quality_penalty": -1.0},
    "BF16": {"bytes_per_param": 2.00, "speed_multiplier": 0.60, "quality_penalty": 0.0},
    "F32": {"bytes_per_param": 4.00, "speed_multiplier": 0.35, "quality_penalty": 0.0},
    # 4-bit float formats. Better quality than integer Q4 at the same width,
    # which is why the penalty is lighter than Q4_K_M's.
    "MXFP4": {"bytes_per_param": 0.55, "speed_multiplier": 1.10, "quality_penalty": -3.0},
    "NVFP4": {"bytes_per_param": 0.55, "speed_multiplier": 1.15, "quality_penalty": -3.0},
    "FP8": {"bytes_per_param": 1.00, "speed_multiplier": 0.85, "quality_penalty": 0.0},
}

# Ollama reports "F16" where §8.2 says "FP16"; same thing, and the catalogue and
# the registry should not have to agree on spelling for a row to score.
_QUANT_ALIASES = {"F16": "FP16", "FP_16": "FP16", "Q4_K": "Q4_K_M", "Q5_K": "Q5_K_M"}

DEFAULT_QUANT = "Q4_K_M"


def normalise_quant(raw: str | None) -> str:
    """A quantization name from anywhere — catalogue, Ollama, a typed tag.

    Unknown names fall back to Q4_K_M rather than failing: the overwhelming
    majority of Ollama's library is Q4_K_M, so it is the least wrong guess, and
    `quant_known()` lets the caller mark the row as an approximation.
    """
    if not raw:
        return DEFAULT_QUANT
    name = raw.strip().upper().replace("-", "_")
    name = _QUANT_ALIASES.get(name, name)
    return name if name in _QUANT else DEFAULT_QUANT


def quant_known(raw: str | None) -> bool:
    if not raw:
        return False
    name = raw.strip().upper().replace("-", "_")
    return _QUANT_ALIASES.get(name, name) in _QUANT


def parse_params_b(raw: str | None) -> float | None:
    """Ollama's `parameter_size` ("3.2B", "116.8B", "780M") as billions.

    Its own reported figure, which is what makes a discovered model scorable
    without a catalogue entry for it.
    """
    if not raw:
        return None
    match = re.match(r"\s*([\d.]+)\s*([BM])\s*$", str(raw), re.IGNORECASE)
    if not match:
        return None
    try:
        value = float(match.group(1))
    except ValueError:
        return None
    return value / 1000.0 if match.group(2).upper() == "M" else value

# The inference runtime's own footprint — CUDA context, compute buffers, the
# server process. §8.2 says ~0.5–1GB; 0.8 is the middle of that.
_RUNTIME_OVERHEAD_BYTES = int(0.8 * GB)

# KV cache precision. Ollama keeps K and V in fp16 unless told otherwise.
_KV_BYTES_PER_ELEMENT = 2

# Used when a model has not been pulled and the catalogue declares no
# architecture — which is the normal state before step 4.
#
# Measured from llama3.2 on the development machine (28 layers × 8 KV heads ×
# 128 head dim, from /api/show): 2 × 28 × 8 × 128 × 2 = 114,688 bytes/token.
# Every candidate here is a GQA model in the same size class, and those configs
# cluster tightly — 8 KV heads at 128 dimensions over 24–32 layers. It does not
# scale with parameter count, which is why there is no per-billion factor.
#
# Replaced by the real figure the moment /api/show can answer.
_FALLBACK_KV_BYTES_PER_TOKEN = 114_688

# The prompt size the estimate assumes, in tokens.
#
# `research/05` §2.3: the KV cache scales with the context *used*, not the
# context the model supports — budgeting llama3.1's full 128K would report every
# model as unable to run, which is true and useless. MODULES.md §2.3 puts a real
# Daedalus prompt at 1–3k tokens (evidence pack plus replayed history), so 4096
# covers it with headroom and is what the benchmark actually sends.
DEFAULT_WORKING_CONTEXT = 4096


# ── GPU memory bandwidth, for the speed estimate ─────────────────────────────
#
# Generation is memory-bound: each token reads every weight, so tok/s tracks
# bandwidth ÷ model size far better than it tracks FLOPs. This is llmfit's
# approach and `research/05` §1.3 adopts it explicitly ("a memory-bandwidth-based
# estimate, not just theoretical FLOPs").
#
# Deliberately short. A general tool needs hundreds of entries; this one needs
# the lab machine and enough neighbours to be useful if the hardware changes.
# Anything unlisted falls through to the backend constant, which is a worse
# estimate but never a wrong-looking one.
_GPU_BANDWIDTH_GB_S: dict[str, float] = {
    # Laptop parts are separate entries, not a modifier: the mobile 3050 is a
    # 128-bit part at 192 GB/s against the desktop card's 224, and silently
    # quoting the desktop figure would overestimate the development machine by
    # 17%. Longest key wins, so "3050 laptop" is matched before "3050".
    "3050 laptop": 192.0,
    "3050 ti laptop": 192.0,
    "3050": 224.0,
    "3060 laptop": 336.0,
    "3060": 360.0,
    "3070 laptop": 448.0,
    "3070": 448.0,
    "3080 laptop": 448.0,
    "3080": 760.0,
    "3090": 936.0,
    "4050 laptop": 192.0,
    "4060 laptop": 256.0,
    "4060": 272.0,
    "4070 laptop": 256.0,
    "4070": 504.0,
    "4080": 717.0,
    "4090 laptop": 576.0,
    "4090": 1008.0,
    "5070": 672.0,
    "5080": 960.0,
    "5090": 1792.0,
    "a100": 1555.0,
    "h100": 2039.0,
    "l4": 300.0,
    "t4": 320.0,
}
_BANDWIDTH_KEYS = sorted(_GPU_BANDWIDTH_GB_S, key=len, reverse=True)

# Fallback throughput constants, tok/s per billion parameters, from llmfit's
# published table (docs/how-it-works.md). Used when there is no bandwidth figure
# — which for this project is the common case, because the CPU path has no
# equivalent of a VRAM bandwidth lookup.
_BACKEND_K: dict[str, float] = {
    "cuda": 220.0,
    "rocm": 180.0,
    "metal": 160.0,
    "cpu_arm": 90.0,
    "cpu_x86": 70.0,
}

# The share of theoretical bandwidth a real runtime achieves — kernel overhead,
# KV-cache reads, memory controller effects. llmfit's figure, and odysseus's
# hwfit independently calibrated to the same 0.55 against a measured RX 9060 XT.
_BANDWIDTH_EFFICIENCY = 0.55

# System RAM bandwidth for the offload path. Dual-channel DDR4-3200 is ~50 GB/s;
# conservative because an offloaded model is also competing for CPU.
_SYSTEM_RAM_BANDWIDTH_GB_S = 55.0


# ── scoring weights ──────────────────────────────────────────────────────────
#
# llmfit varies these by use case because it serves every use case. This project
# has exactly one — grounded RAG over reactor documentation — so there is one
# weight set, and it is derived from `PROJECT.md` §9.2's own targets rather than
# from a generic profile:
#
#   quality 0.40  Hallucination rate < 10% is the hardest target and the one a
#                 smaller model misses first. It gets the largest share.
#   speed   0.30  End-to-end latency < 3s. Real, but a model that answers
#                 quickly and wrongly fails the more important target.
#   fit     0.20  Headroom, not just fitting. A model at 97% of available RAM
#                 runs until something else on the machine wants memory.
#   context 0.10  Lowest because every candidate clears the 1–3k evidence pack
#                 comfortably; it only discriminates in the extreme.
_WEIGHTS = {"quality": 0.40, "speed": 0.30, "fit": 0.20, "context": 0.10}

# Utilisation bands, from llmfit's published thresholds, collapsed onto the
# three labels §8.2 names. llmfit's "perfect" and "good" are both `safe` here —
# the distinction matters to a tool ranking hundreds of models and not to a
# console showing six.
#
# The ceiling is 98% rather than 100% for allocator slack and fragmentation.
_SAFE_CEILING = 0.85
_MARGINAL_CEILING = 0.98

# Speed normalisation: tok/s that scores 100. Above a certain rate the
# difference stops mattering for a human reading an answer, and a model twice as
# fast as "instant" should not outrank one that is meaningfully more accurate.
_SPEED_SATURATION_TPS = 60.0

# Quality normalisation. MMLU floors around 25 (random choice on four options),
# so scoring it 0–100 directly would compress every real difference into the top
# half of the range.
_QUALITY_FLOOR_MMLU = 25.0
_QUALITY_CEILING_MMLU = 85.0


def _catalogue_raw() -> dict[str, Any]:
    """The catalogue file. Read fresh every call, deliberately.

    It is report data that gets corrected by hand — a verified MMLU score, a
    fixed Ollama tag — and caching it would mean an edit needs a restart to show
    up. It is a 6KB file read a handful of times per panel open.
    """
    try:
        with open(_CATALOGUE_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        # A malformed catalogue must not take the panel down; it degrades to
        # "no candidates" and the endpoint says why.
        return {"models": []}


def catalogue() -> list[dict[str, Any]]:
    return list(_catalogue_raw().get("models", []))


def quantizations() -> dict[str, dict[str, float]]:
    return {k: dict(v) for k, v in _QUANT.items()}


# ── memory ───────────────────────────────────────────────────────────────────


def kv_bytes_per_token(arch: dict[str, Any] | None) -> tuple[int, str]:
    """KV cache cost of one token, and whether it was derived or assumed.

    `2 × layers × kv_heads × head_dim × bytes_per_element` — two because K and V
    are cached separately. GQA is already accounted for by using `kv_heads`
    rather than attention heads, which is why an 8B GQA model can have a smaller
    cache than a 3B model with more layers.
    """
    if arch:
        layers = arch.get("layers")
        kv_heads = arch.get("kv_heads")
        head_dim = arch.get("head_dim")
        if layers and kv_heads and head_dim:
            per_token = 2 * int(layers) * int(kv_heads) * int(head_dim) * _KV_BYTES_PER_ELEMENT
            return per_token, "measured" if arch.get("measured") else "declared"
    return _FALLBACK_KV_BYTES_PER_TOKEN, "assumed"


def estimate_memory(
    *,
    params_b: float,
    quant: str,
    arch: dict[str, Any] | None = None,
    weights_bytes: int | None = None,
    context_tokens: int = DEFAULT_WORKING_CONTEXT,
) -> dict[str, Any]:
    """`(params × bytes_per_param) + kv_cache + runtime_overhead`, in bytes.

    `weights_bytes` is the real size on disk when the model has been pulled. It
    replaces the parameter-count arithmetic entirely rather than being averaged
    with it — a measurement is not a second opinion.
    """
    spec = _QUANT.get(quant, _QUANT[DEFAULT_QUANT])

    if weights_bytes:
        weights = int(weights_bytes)
        weights_source = "measured"
    else:
        weights = int(params_b * 1e9 * spec["bytes_per_param"])
        weights_source = "declared"

    per_token, kv_source = kv_bytes_per_token(arch)
    kv = per_token * max(0, int(context_tokens))
    total = weights + kv + _RUNTIME_OVERHEAD_BYTES

    if weights_source == "measured":
        weights_term = f"{weights / GB:.2f} GB on disk"
    else:
        weights_term = f"{params_b}B × {spec['bytes_per_param']} B/param"

    return {
        "total_bytes": total,
        "weights_bytes": weights,
        "weights_source": weights_source,
        "kv_cache_bytes": kv,
        "kv_bytes_per_token": per_token,
        "kv_source": kv_source,
        "runtime_overhead_bytes": _RUNTIME_OVERHEAD_BYTES,
        "context_tokens": context_tokens,
        "bytes_per_param": spec["bytes_per_param"],
        # Everything the number was built from, spelled out, so a reader can
        # check it instead of trusting it — llmfit's "display the inputs behind
        # each estimate", and the reason this module is defensible in a report.
        "formula": (
            f"{weights_term}"
            f" + {context_tokens} tok × {per_token / 1024:.0f} KB/tok KV"
            f" + {_RUNTIME_OVERHEAD_BYTES // (1024 ** 2)} MB runtime"
        ),
    }


# ── speed ────────────────────────────────────────────────────────────────────


def _lookup_bandwidth(gpu_name: str | None) -> float | None:
    if not gpu_name:
        return None
    name = gpu_name.lower()
    for key in _BANDWIDTH_KEYS:
        if key in name:
            return _GPU_BANDWIDTH_GB_S[key]
    return None


def _cpu_backend(arch: str | None) -> str:
    return "cpu_arm" if (arch or "").lower() in {"arm64", "aarch64"} else "cpu_x86"


def estimate_speed(
    *,
    params_b: float,
    quant: str,
    weights_bytes: int,
    gpu_name: str | None,
    vram_free_bytes: int | None,
    cpu_arch: str | None,
) -> dict[str, Any]:
    """Estimated generation throughput in tokens/sec.

    `(bandwidth ÷ model size) × efficiency` when the weights live on a GPU whose
    bandwidth is known — generation reads every weight per token, so this is the
    binding constraint. Partial offload blends the two bandwidths by time rather
    than halving the result, because the slow side dominates as it grows.

    Falls back to llmfit's `K ÷ params_B × quant_multiplier` when there is no
    bandwidth figure, which on a CPU-only machine is always.
    """
    spec = _QUANT.get(quant, _QUANT[DEFAULT_QUANT])
    model_gb = weights_bytes / GB
    bandwidth = _lookup_bandwidth(gpu_name)

    if model_gb <= 0:
        return {"tokens_per_sec": None, "run_mode": "unknown", "basis": "no model size"}

    if bandwidth and vram_free_bytes:
        fits_vram = weights_bytes <= vram_free_bytes
        if fits_vram:
            tps = (bandwidth / model_gb) * _BANDWIDTH_EFFICIENCY
            return {
                "tokens_per_sec": round(tps, 1),
                "run_mode": "gpu",
                "basis": f"{bandwidth:.0f} GB/s ÷ {model_gb:.2f} GB × {_BANDWIDTH_EFFICIENCY}",
            }
        # Spills. What sits in system RAM is read over the slow path every token.
        offload = 1.0 - (vram_free_bytes / weights_bytes)
        offload = min(max(offload, 0.0), 1.0)
        effective = 1.0 / (offload / _SYSTEM_RAM_BANDWIDTH_GB_S + (1.0 - offload) / bandwidth)
        tps = (effective / model_gb) * _BANDWIDTH_EFFICIENCY
        return {
            "tokens_per_sec": round(tps, 1),
            "run_mode": "cpu_offload",
            "basis": f"{offload * 100:.0f}% offloaded to system RAM",
        }

    backend = _cpu_backend(cpu_arch)
    k = _BACKEND_K[backend]
    tps = (k / params_b) * spec["speed_multiplier"] if params_b > 0 else 0.0
    return {
        "tokens_per_sec": round(tps, 1),
        "run_mode": "cpu",
        "basis": f"{k:.0f} ÷ {params_b}B × {spec['speed_multiplier']} ({backend})",
    }


# ── scoring ──────────────────────────────────────────────────────────────────


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def memory_budget(hardware: dict[str, Any]) -> dict[str, Any]:
    """How much memory a model may actually use on this machine, and which pool.

    VRAM when there is a GPU with a usable amount of it, system RAM otherwise.
    The distinction matters more than it looks: on the development machine the
    GPU has 4GB against 7.7GB of available system RAM, so the *smaller* pool is
    the faster one, and a model chosen against the RAM figure would run at a
    fraction of the speed the estimate promised.

    Available, not total, throughout — `research/05` §2.1 and the same reasoning
    the hardware panel already states. The rest is spoken for.

    Under WSL this is deliberately the VM's figure rather than the Windows
    host's: the model runs inside the VM, so the VM's slice is the constraint.
    `hardware.host_machine` carries the host total for context, and the UI names
    which machine it is describing.
    """
    gpu = hardware.get("gpu") or {}
    devices = gpu.get("devices") or []
    memory = hardware.get("memory") or {}
    ram_available = memory.get("available_bytes")

    vram_available: int | None = None
    vram_total: int | None = None
    device_name: str | None = None
    if devices:
        device = devices[0]
        total = device.get("vram_total_bytes")
        if total:
            used = device.get("vram_used_bytes") or 0
            vram_available = max(0, int(total) - int(used))
            vram_total = int(total)
            device_name = device.get("name")

    return {
        # `primary` names the pool a model would prefer, for display. The
        # verdict uses both figures and does not read this.
        "primary": "vram" if vram_available else "ram",
        "vram_available_bytes": vram_available,
        "vram_total_bytes": vram_total,
        "ram_available_bytes": ram_available,
        "ram_total_bytes": memory.get("total_bytes"),
        "combined_available_bytes": (vram_available or 0) + (ram_available or 0),
        "device": device_name,
    }


def _band(utilisation: float) -> str:
    """llmfit's published bands, collapsed onto the three labels §8.2 names.

    The ceiling is 98% rather than 100% because an allocator cannot use the last
    of a pool: fragmentation and compute buffers take the rest, and a model at
    99.5% on paper fails to load in practice.
    """
    if utilisation <= _SAFE_CEILING:
        return "safe"
    if utilisation <= _MARGINAL_CEILING:
        return "marginal"
    return "will_not_fit"


def verdict(required_bytes: int, budget: dict[str, Any]) -> dict[str, Any]:
    """`safe` | `marginal` | `will_not_fit`, and *where* the model would run.

    Judged against two pools, not one, because a machine with a GPU has two and
    Ollama will use both. An earlier single-pool version marked Mistral 7B
    `will_not_fit` on the development machine — 5.1GB against 3.9GB of VRAM —
    when the machine has 7.7GB of system RAM and runs it perfectly well, just
    slower. That is a recommendation engine refusing to recommend the answer.

    So:

    | required fits | placement | judged against |
    |---|---|---|
    | VRAM | `gpu` | VRAM. The fast case, and the only one worth a full score |
    | VRAM + system RAM | `offload` | the combined pool — Ollama splits layers |
    | neither | — | `will_not_fit`, and it really will not |

    A CPU-only machine has one pool and the middle row becomes `cpu`.
    """
    vram = budget.get("vram_available_bytes")
    ram = budget.get("ram_available_bytes")

    if vram and required_bytes <= vram:
        utilisation = required_bytes / vram
        return {
            "fit": _band(utilisation),
            "placement": "gpu",
            "utilisation": round(utilisation, 3),
            "judged_against": "vram",
            "headroom_bytes": vram - required_bytes,
        }

    # Everything the model can draw on. With a GPU present Ollama offloads what
    # fits and reads the rest from system RAM, so the capacity is the sum.
    combined = (vram or 0) + (ram or 0)
    if combined <= 0:
        return {
            "fit": "unknown",
            "placement": "unknown",
            "utilisation": None,
            "judged_against": None,
            "headroom_bytes": None,
        }

    utilisation = required_bytes / combined
    band = _band(utilisation)
    return {
        "fit": band,
        "placement": ("offload" if vram else "cpu") if band != "will_not_fit" else "none",
        "utilisation": round(utilisation, 3),
        "judged_against": "vram+ram" if vram else "ram",
        "headroom_bytes": combined - required_bytes,
    }


def _fit_score(utilisation: float | None) -> float:
    """Headroom as a 0–100 dimension.

    Not simply `100 − utilisation`: filling 10% of the pool is not nine times
    better than filling 90%, it is merely safe, and a tool that scored it that
    way would always recommend the smallest model. The curve is flat across the
    comfortable range and falls away sharply past the safe ceiling — which is
    where the difference starts to matter.
    """
    if utilisation is None:
        return 0.0
    if utilisation <= _SAFE_CEILING:
        # 100 at empty, 80 at the safe ceiling. A gentle preference for headroom.
        return _clamp(100.0 - (utilisation / _SAFE_CEILING) * 20.0)
    if utilisation <= _MARGINAL_CEILING:
        span = _MARGINAL_CEILING - _SAFE_CEILING
        return _clamp(80.0 - ((utilisation - _SAFE_CEILING) / span) * 60.0)
    return 0.0


def _speed_score(tokens_per_sec: float | None) -> float:
    """Throughput as 0–100, saturating.

    Past the saturation point a person reading an answer cannot tell the
    difference, so extra speed stops earning score. Without this a 1B model at
    150 tok/s would outrank a 4B model at 55 on the speed dimension by nearly
    three to one, and drag the composite with it.
    """
    if not tokens_per_sec or tokens_per_sec <= 0:
        return 0.0
    return _clamp((tokens_per_sec / _SPEED_SATURATION_TPS) * 100.0)


def _quality_score(mmlu: float | None, quant: str) -> dict[str, Any]:
    """Capability as 0–100, after the quantization penalty.

    Rescaled from the MMLU floor rather than from zero: 25 is what guessing
    scores on four options, so treating it as the bottom of the range keeps the
    real differences between candidates visible instead of compressed into the
    top half.
    """
    penalty = _QUANT.get(quant, _QUANT[DEFAULT_QUANT])["quality_penalty"]
    if mmlu is None:
        # Unknown quality is scored at the midpoint, not at zero. Zero would
        # bury every model whose score nobody has filled in yet, and this
        # catalogue ships with most of them unverified on purpose.
        return {"score": 50.0, "effective_mmlu": None, "quant_penalty": penalty, "known": False}

    effective = mmlu + penalty
    span = _QUALITY_CEILING_MMLU - _QUALITY_FLOOR_MMLU
    score = _clamp(((effective - _QUALITY_FLOOR_MMLU) / span) * 100.0)
    return {
        "score": round(score, 1),
        "effective_mmlu": round(effective, 1),
        "quant_penalty": penalty,
        "known": True,
    }


def _context_score(context_length: int | None, needed: int) -> float:
    """Context window against what this system's prompts actually need.

    Scored against the evidence pack, not against the largest window on the
    market: every candidate clears 1–3k comfortably, so this dimension should
    separate a model that *cannot* hold a prompt from one that can, and
    otherwise stay quiet. Hence the low weight and the early saturation.
    """
    if not context_length:
        return 0.0
    if context_length < needed:
        return _clamp((context_length / needed) * 40.0)
    # 4× the requirement is full marks — beyond that the headroom is unused.
    ratio = context_length / (needed * 4)
    return _clamp(60.0 + min(ratio, 1.0) * 40.0)


def score_row(
    *,
    params_b: float,
    quant: str,
    context_length: int | None,
    mmlu: float | None,
    hardware: dict[str, Any],
    budget: dict[str, Any],
    arch: dict[str, Any] | None = None,
    weights_bytes: int | None = None,
    context_tokens: int = DEFAULT_WORKING_CONTEXT,
) -> dict[str, Any]:
    """One model × quantization, estimated and scored against this machine.

    Returns the estimate, the verdict, all four dimensions and the composite —
    every input included, so the UI can show why a row ranked where it did
    rather than asking anyone to trust the ordering.
    """
    quant = normalise_quant(quant)
    estimate = estimate_memory(
        params_b=params_b,
        quant=quant,
        arch=arch,
        weights_bytes=weights_bytes,
        context_tokens=context_tokens,
    )

    fit = verdict(estimate["total_bytes"], budget)

    gpu = hardware.get("gpu") or {}
    devices = gpu.get("devices") or []
    speed = estimate_speed(
        params_b=params_b,
        quant=quant,
        weights_bytes=estimate["weights_bytes"],
        gpu_name=devices[0].get("name") if devices else None,
        vram_free_bytes=budget.get("vram_available_bytes"),
        cpu_arch=(hardware.get("cpu") or {}).get("arch"),
    )

    quality = _quality_score(mmlu, quant)
    dimensions = {
        "fit": round(_fit_score(fit["utilisation"]), 1),
        "speed": round(_speed_score(speed["tokens_per_sec"]), 1),
        "quality": quality["score"],
        "context": round(_context_score(context_length, context_tokens), 1),
    }

    # A model that will not fit scores zero overall rather than a weighted
    # average that might still look respectable. "Will not run" is not a
    # tradeoff against quality — it is disqualifying, and the ranking has to say
    # so plainly or somebody will pull a 16GB model onto an 8GB machine.
    if fit["fit"] == "will_not_fit":
        composite = 0.0
    else:
        composite = sum(dimensions[k] * w for k, w in _WEIGHTS.items())

    return {
        "quantization": quant,
        "quantization_known": True,
        "estimate": estimate,
        "verdict": fit,
        "speed": speed,
        "quality": quality,
        "dimensions": dimensions,
        "weights": dict(_WEIGHTS),
        "score": round(composite, 1),
    }
