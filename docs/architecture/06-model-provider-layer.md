# Layer 6: Local Model Provider Layer

> **Local Model Provider Layer**

* **Zone Mapping:** Zone 3
* **Purpose:** Runs the language model locally to provide natural-language synthesis based *only* on provided evidence. Does not directly access sensor data — only receives evidence from the orchestration layer.
* **Technology:** **Ollama** (Local API, supports quantized GGUF models, works offline after setup, simplifies model management).

---

## Why Ollama?

- Runs models locally
- Supports quantized models
- Provides a local API
- Simplifies model management
- Works offline after model download
- Supports small and medium local models

---

## Model Tiers

### Production Models (SLM Tier)
```text
qwen3:1.7b-q4_K_M
phi3:3.8b-q4_K_M
gemma3:1b-q4_K_M
```

### Benchmark Models (LLM Tier)
```text
qwen3:8b
llama3.1:8b
mistral:7b
```

### Cloud Benchmark-Only Models (NEVER in production)
```text
GPT-4o Mini
Claude 3.5 Haiku
Gemini Flash
```

---

## Model Compatibility Reference

| Model | Parameters | Quantization | Estimated RAM/VRAM | Status |
|---|---:|---|---:|---|
| Gemma 3 1B | 1B | Q4_K_M | ~1.2 GB | Safe |
| Qwen3 1.7B | 1.7B | Q4_K_M | ~1.8 GB | Safe |
| Phi-3 Mini 3.8B | 3.8B | Q4_K_M | ~3.0 GB | Marginal |
| Mistral 7B | 7B | Q4_K_M | ~5.5 GB | Not recommended |
| Llama 3.1 8B | 8B | Q4_K_M | ~6.0 GB | Not recommended |

---

## Configuration

Driven by `config/model_config.json`:

```json
{
  "production_model": "qwen3:1.7b",
  "benchmark_models": [
    "qwen3:1.7b", "phi3:3.8b", "gemma3:1b",
    "qwen3:8b", "llama3.1:8b", "mistral:7b"
  ],
  "embedding_model": "nomic-embed-text",
  "temperature": 0.1,
  "quantization_preference": "q4_K_M",
  "max_context_length": 4096,
  "timeout_seconds": 10
}
```

---

## Model Selection Logic

```text
FastAPI reads config/model_config.json
   ↓
selects production_model
   ↓
calls Ollama
```

The model is **never hardcoded** in FastAPI.

---

## Model Provider Responsibilities

1. Model loading
2. Quantized inference
3. Prompt completion
4. Local API serving
5. Temperature control
6. Context length handling
7. Token generation
8. Latency measurement

---

## Setup vs Runtime

| Phase | Internet | Details |
|---|---|---|
| Setup Mode | Allowed | `ollama pull qwen3:1.7b` |
| Runtime Mode | **Not required** | All inference local |
| Offline Deployment | N/A | Pre-download and transfer via Ollama's local model cache or portable storage |

### Examiner Answer for Offline Download
> "Model downloading is a one-time setup activity performed when internet is available. The production runtime remains fully offline. For strictly offline deployment, models are pre-downloaded and transferred to the lab machine using Ollama's local model cache or portable storage."

---

## AirLLM Positioning

> "AirLLM is used only as a feasibility investigation tool to understand whether larger models could theoretically run under constrained memory. The production system uses Ollama with fully resident quantized models for stable low-latency inference."

AirLLM is **not** used for production inference because it can be slow, relies on streaming layers, and is experimental. Ollama handles local GGUF quantized models more cleanly.

---

## Diagram Elements

```text
Ollama Local Runtime
  - Qwen3 1.7B
  - Phi-3 Mini
  - Gemma 3 1B

Local Model Config (config/model_config.json)

Cloud benchmark only (dashed/grey box)
  Label: "Not used in production"
```

> **Boundary Statement:** "All production inference is local via Ollama. Cloud LLMs are only external benchmark references."
