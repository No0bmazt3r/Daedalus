# Model & Hardware Fit-Checking Tool

**Inspiration:** [llmfit](https://github.com/AlexsJones/llmfit) — "Hundreds of models & providers. One command to find what runs on your hardware."

This is not a copy of llmfit — llmfit is a general-purpose Rust CLI/TUI covering hundreds of models across many runtimes. This project needs a much narrower, purpose-built version of the same *idea*: given the lab machine's specs, which of the specific candidate SLMs/LLMs already shortlisted in the interim report (Qwen3, Phi-3, Gemma 3, Llama 3.1, Mistral) will actually run acceptably, and at what expected speed/quality/context tradeoff.

## 1. What llmfit does, conceptually (the parts worth borrowing)

1. **Hardware detection** — RAM, CPU, GPU/VRAM, detected backend.
2. **A model catalog** with known specs per model (parameter count, architecture type — dense vs MoE, quantization variants available, context length).
3. **A scoring function across four dimensions:**
   - **Memory fit** — will this quantization of this model actually fit in available RAM/VRAM without swapping/crashing?
   - **Estimated speed** — tokens/sec, derived from a memory-bandwidth-based estimate (not just theoretical FLOPs) grounded against real community-reported measurements.
   - **Quality** — a benchmark-derived quality signal (e.g. general capability leaderboard scores) so you're not just picking the fastest possible model.
   - **Context** — how large a context window the model supports, relevant since your RAG context blocks (chunks or subgraphs) need to fit.
4. **A recommendation output** — ranked list of what to actually try first, rather than trial-and-erroring every candidate on real hardware.
5. **Optional real benchmarking** — once a model is actually pulled into Ollama, measure real tok/s and time-to-first-token, and use *those* measured numbers going forward instead of the estimate.

## 2. What this project's version needs to do (scoped-down)

### 2.1 Hardware detection
- Detect: total RAM, available RAM, CPU core count, GPU presence + VRAM (if any — lab hardware may well be CPU-only or have a modest GPU).
- Detect installed backend: is Ollama installed and running? What version?
- This can be implemented in Python (since the rest of the backend is Python/FastAPI) using libraries like `psutil` (RAM/CPU) and `pynvml`/`GPUtil` (NVIDIA VRAM, if applicable), rather than needing llmfit's Rust implementation directly.

### 2.2 A small, hand-curated model catalog (not hundreds — just your candidates)

| Model | Params | Quantization variants to check | Context length | Tier |
|---|---|---|---|---|
| Gemma 3 1B | 1B | Q4_K_M, Q8_0 | 32K | Local SLM |
| Qwen3 1.7B | 1.7B | Q4_K_M, Q8_0 | 32K | Local SLM |
| Phi-3 Mini | 3.8B | Q4_K_M, Q8_0 | 128K | Local SLM |
| Qwen3 8B | 8B | Q4_K_M | 32K | Local LLM |
| Llama 3.1 8B | 8B | Q4_K_M | 128K | Local LLM |
| Mistral 7B | 7B | Q4_K_M | 32K | Local LLM |

(Cloud-tier models — GPT-4o Mini, Claude 3.5 Haiku, Gemini Flash — are excluded from this tool entirely, since they're benchmark-only references and never actually deployed; no hardware fit question applies to them.)

### 2.3 Memory estimation formula (simplified, adapted from llmfit's approach)

For a dense (non-MoE) model at a given quantization:

```
estimated_memory_GB ≈ (param_count_billions × bytes_per_param) + kv_cache_overhead + runtime_overhead

where bytes_per_param depends on quantization:
  Q4_K_M ≈ 0.5–0.6 bytes/param
  Q8_0   ≈ 1.0 bytes/param
  FP16   ≈ 2.0 bytes/param

kv_cache_overhead scales with context length used, not max context length
runtime_overhead ≈ fixed ~0.5–1GB for the inference runtime itself
```

This doesn't need to be as sophisticated as llmfit's full model (which also handles MoE architectures like Mixtral/DeepSeek where only a subset of experts are active per token) — none of your candidate models are MoE, so the dense-model formula above is sufficient scope.

### 2.4 Scoring output

For each model × quantization combination:

```json
{
  "model": "phi-3-mini",
  "quantization": "Q4_K_M",
  "estimated_memory_gb": 2.8,
  "fits_available_ram": true,
  "estimated_tokens_per_sec": 18.5,
  "context_length": 128000,
  "fit_score": "good",       // good / marginal / will_not_fit
  "recommendation_rank": 2
}
```

### 2.5 Recommendation command

```bash
python fit_check.py recommend
# → ranked table of which local models to actually pull/benchmark first,
#   given this specific lab machine's detected hardware
```

### 2.6 Real-benchmark pass (once a model is pulled into Ollama)

After the estimate-based recommendation narrows the field, actually run each shortlisted model through Ollama on a handful of representative prompts (e.g. a sample query from your evaluation set) and measure:
- Time-to-first-token
- Tokens/sec (generation speed)
- End-to-end latency for a realistic RAG-context-sized prompt (this matters more than raw tok/s, since your real prompts include retrieved context, not just a short question)

Replace the *estimated* numbers with these *measured* numbers in your final report — this is exactly the "benchmark & share, real numbers beat estimates" philosophy llmfit itself emphasizes, and it directly satisfies Objective 3's latency requirement with actual evidence rather than theoretical projection.

## 3. Where this tool fits in your existing methodology

This is the concrete implementation of what Section 3.4.2 (Model Provider Layer) and Section 4.4 (Anticipated Challenges) in your interim report already gesture toward — you mentioned using "LLM Checker" and "AirLLM" as external tools for this purpose. This spec proposes **building your own minimal purpose-built version** instead of (or alongside) relying purely on third-party tools, for two reasons:

1. **It becomes a demonstrable artifact of your own engineering work**, not just "I used someone else's CLI" — worth more to an examiner and to your own portfolio.
2. **It can be scoped exactly to your candidate model list and your actual RAG context sizes**, giving more relevant numbers than a general-purpose tool would.

You can still *reference* LLM Checker and AirLLM in your literature/tools section as prior art you drew inspiration from and validated against — this doesn't have to be either/or. Running your own tool's estimates against LLM Checker's recommendations as a sanity check is actually a nice small validation step for your methodology chapter.

## 4. Suggested file/module structure

```
fit_check/
├── hardware_detect.py     # RAM/CPU/GPU detection
├── model_catalog.py       # Your hand-curated candidate model specs
├── memory_estimator.py    # The formula from 2.3
├── scorer.py               # Combines detection + catalog → ranked recommendations
├── benchmark_runner.py    # Real Ollama benchmark pass (2.6)
└── cli.py                  # `recommend`, `benchmark`, `info <model>` commands
```

## 5. Deliverable framing for your report

Position this as a **fourth objective-adjacent contribution**: not a formal numbered objective, but a supporting tool that operationalizes Objective 3 with a reusable, documented methodology — worth a subsection in your Methodology chapter (e.g. "3.4.7 Model & Hardware Fit-Checking Tool") and a table of its output in your Preliminary Findings / Results chapter.
