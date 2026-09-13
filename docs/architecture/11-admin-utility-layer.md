# Layer 11: Administrative Utility Layer

> **Local Administrative Utility Layer**

* **Zone Mapping:** Setup / Support
* **Purpose:** Supports hardware profiling, model selection, and benchmarking. **Not part of the live operator chat path.**
* **Positioning:** *"A local administrative utility for model selection, benchmarking, and resource management"*, NOT *"Another AI layer inside the chat system."*

---

## Components

1. **Local Model Selection and Benchmark Console** (Streamlit)
2. **Hardware Profiler & LLM Checker / AirLLM** (Feasibility tools)
3. **Vector DB Benchmark Runner**
4. **Docker Compose Scripts**

---

## Model Selection Console — Detailed Specification

### Correct Positioning

Sits **outside** the main operator chat workflow:
```text
Local Model Selector UI → Hardware Profiler → Model Recommendation Engine
→ Ollama Model Manager → Writes selected model to config
→ FastAPI backend uses selected model
```

The UI **does not answer user questions**. It only configures which model the agent should use.

### Naming

**Use:** "Local Model Selection and Benchmark Console"

**Do NOT call it:** "AI Manager", "LLM Chat UI", "Agentic UI", "Model Chat Layer"

---

### Core Features

#### 1. Hardware Detection
Display:
```text
CPU model, RAM total, RAM available, GPU name, VRAM total, VRAM free,
Disk space, OS, Python version, Ollama version
```
This replaces manual use of llm-checker.

#### 2. Model Compatibility Check
Classify each candidate model:

| Model | Parameters | Quantization | Est. RAM/VRAM | Status |
|---|---:|---|---:|---|
| Gemma 3 1B | 1B | Q4_K_M | ~1.2 GB | Safe |
| Qwen3 1.7B | 1.7B | Q4_K_M | ~1.8 GB | Safe |
| Phi-3 Mini 3.8B | 3.8B | Q4_K_M | ~3.0 GB | Marginal |
| Mistral 7B | 7B | Q4_K_M | ~5.5 GB | Not recommended |
| Llama 3.1 8B | 8B | Q4_K_M | ~6.0 GB | Not recommended |

Classifications: **Safe / Marginal / Not Recommended / Unsupported**

#### 3. Model List Management
Show: Installed models, available models, currently selected production model, model file size, quantization format, last used, benchmark status.

#### 4. Ollama Model Management
```text
List installed: GET /api/tags
Pull model:     POST /api/pull
Delete model:   POST /api/delete
Show model size, set default model
```
This is fine because Ollama is local.

#### 5. Mini Benchmark Runner
```text
Send fixed prompt → Measure time to first token → Measure total response time
→ Measure memory usage → Repeat 5 times → Save average result
```

Example output:

| Model | Avg Latency | Memory Used | Status |
|---|---|---|---|
| Qwen3 1.7B | 1.2s | 1.9 GB | Good |
| Phi-3 Mini 3.8B | 2.1s | 3.2 GB | Acceptable |
| Mistral 7B | 4.8s | 6.1 GB | Too slow |

Helps justify which model meets the <3 seconds target.

#### 6. Save Selected Model to Config
Writes to local config:
```json
{
  "production_model": "qwen3:1.7b",
  "benchmark_models": ["qwen3:1.7b", "phi3:3.8b", "gemma3:1b"],
  "quantization_preference": "q4_K_M",
  "max_context_length": 4096
}
```
FastAPI backend reads this config. Clean separation.

---

### The Console Must NOT

| Must NOT | Belongs To |
|---|---|
| Chat or answer reactor questions | PyQt chat panel |
| Query sensor data | FastAPI tools |
| Manage RAG documents | Ingestion pipeline |
| Use cloud APIs | Violates local constraint |
| Become a huge dashboard | Scope creep |

Specifically avoid: user management, login system, complex analytics, GPU graph dashboard, model training UI, prompt playground, chat history manager.

---

### Setup vs Offline Mode

The UI can show two modes:
- **Setup Mode:** Internet allowed for model download
- **Offline Mode:** Only installed models can be used

---

### Technology

**Recommended:** Streamlit (fast, good tables/buttons/metrics, local, Dockerizable)

**Alternatives:** PyQt Settings Tab (more complex), FastAPI + simple HTML (more control, more work)

---

### CLI Fallback (if short on time)

```bash
python model_manager.py --show-hardware
python model_manager.py --list-models
python model_manager.py --recommend
python model_manager.py --benchmark qwen3:1.7b
python model_manager.py --set-production qwen3:1.7b
```

Build the Streamlit UI only if you have time. CLI is the safest MVP.

---

### MVP vs Optional Features

| MVP (build this) | Optional (if time allows) |
|---|---|
| Show hardware specs | Show memory usage during benchmark |
| Show installed Ollama models | Compare SLM vs LLM tiers |
| Show recommended models | Export benchmark CSV |
| Pull/delete local models | Show quantization recommendations |
| Select production model | Show offline mode warning |
| Run simple latency benchmark | |
| Save config locally | |

---

### Risk Assessment

| Risk Level | Description |
|---|---|
| **Low** | Local model selector + benchmark logger only |
| **Medium** | Full LLM operations dashboard — may distract from FYP |
| **High** | Cloud APIs, Google Sheets, external logging, hosted UI — violates constraint |

---

## LLM Checker & AirLLM Positioning

These are **not** core runtime components. They are **feasibility tools**.

> "AirLLM is used only as a feasibility investigation tool to understand whether larger models could theoretically run under constrained memory. The production system uses Ollama with fully resident quantized models for stable low-latency inference."

In diagrams, place in a dashed box:
```text
Feasibility/Setup Tools
  - LLM Checker
  - AirLLM
  - Hardware Profiler
  Label: "Used during model selection, not runtime inference"
```

---

## Examiner Justifications

**Why build the model selector?**
> "The model selector console is a local administrative utility used to support Objective 3. It profiles the lab hardware, recommends compatible quantized SLMs, manages local Ollama models, and records benchmark results. It is not part of the operator-facing conversational interface. Its purpose is to make the model selection process reproducible, hardware-aware, and documented."

**Report wording:**
> "To support hardware-aware model selection, a local Model Selection and Benchmark Console was developed as a supporting administrative utility. The console detects available CPU, RAM, and GPU resources, estimates the feasibility of running candidate quantized models, manages locally stored Ollama model artifacts, and executes lightweight latency benchmarks. The selected production model is written to a local configuration file, which is then consumed by the FastAPI orchestration backend. This utility is not part of the operator-facing conversational workflow and does not query reactor data; it only supports model governance and benchmarking for Objective 3."
