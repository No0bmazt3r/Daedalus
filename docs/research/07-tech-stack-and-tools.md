# Technology Stack & Tooling

## 1. Full stack summary

| Layer | Technology | Justification |
|---|---|---|
| Data layer (sensor time-series) | SQLite (existing) | Serverless, zero-config, fully on-device — matches offline-first constraint |
| Model provider / runtime | Ollama | Simple local model serving, supports Qwen3/Phi-3/Gemma/Llama/Mistral, no cloud dependency |
| Traditional RAG vector store | ChromaDB | Lightweight, embedded, local-first, avoids managed cloud vector service |
| Agentic GraphRAG store | NetworkX (primary) / Kùzu (stretch comparison) | In-memory simplicity vs. embedded graph-query-language tradeoff — see `03-agentic-graphrag-spec.md` §6 |
| Embedding model | `nomic-embed-text` or `bge-small-en` via Ollama/sentence-transformers | Local, no API key, small footprint |
| Backend orchestration | FastAPI | Async REST, auto-generated OpenAPI schema for tool testing, keeps chat UI responsive during inference |
| Frontend | PyQt5 submodule | Embeds directly into existing CO2SorptionDT — no new application to install/launch |
| Model/hardware fit tool | Custom Python (inspired by llmfit) | Purpose-built, scoped to actual candidate models — see `05-model-hardware-fit-tool.md` |

## 2. Candidate models for benchmarking (unchanged from interim report)

| Tier | Models |
|---|---|
| Local SLM (production candidates) | Qwen3 1.7B, Phi-3 Mini 3.8B, Gemma 3 1B |
| Local LLM (accuracy upper bound, higher latency) | Qwen3 8B, Llama 3.1 8B, Mistral 7B |
| Cloud LLM (benchmark ceiling only — never deployed) | GPT-4o Mini, Claude 3.5 Haiku, Gemini 1.5/2.0 Flash |

## 3. Python libraries (backend)

- `fastapi`, `uvicorn` — API server
- `chromadb` — traditional RAG vector store
- `networkx` — GraphRAG graph store (primary)
- `sentence-transformers` or Ollama embedding API — chunk/entity embeddings
- `sqlite3` (stdlib) — sensor data access, read-only mode
- `pydantic` — request/response schema validation for tool contracts
- `psutil` — hardware detection (RAM/CPU) for the fit-checking tool
- `pynvml` or `GPUtil` — GPU/VRAM detection (if lab hardware has an NVIDIA GPU)
- `ollama` (Python client) — talk to the local Ollama server

## 4. Frontend

- `PyQt5` — matches the existing CO2SorptionDT codebase exactly (no framework mismatch)
- Chat panel: a `QWidget` tab with a scrollable `QTextEdit`/`QListWidget` for history, a `QLineEdit` for input, and a citation/source indicator per message (e.g. a small colored tag: "📊 Live DB" vs "📄 SOP-04" vs "🕸 Graph")

## 5. Alternatives considered and rejected (worth a paragraph in your report's tools justification section)

| Considered | Rejected because |
|---|---|
| Cloud LLM APIs (OpenAI, Anthropic) | Violates offline-first / data-sovereignty constraint (Section 1.4 scope) |
| FAISS for vector store | No built-in metadata filtering, more manual plumbing than ChromaDB for this scope |
| Turso/libSQL (SQLite-native vectors) | Promising per your SLR gap, but less mature tooling/documentation — worth a small side-experiment rather than the primary path, given FYP timeline risk |
| Neo4j for GraphRAG | Requires a running server process — conflicts with the "embedded, zero-extra-infrastructure" design philosophy that governs every other component choice in this project |
| Next.js web frontend | Explicitly deferred to future Phase 2 (Table 1 of interim report) |

## 6. Reference tools for the fit-checking module

- [llmfit](https://github.com/AlexsJones/llmfit) — primary inspiration; Rust-based, general-purpose hardware/model fit scorer with a TUI, benchmark-sharing community leaderboard, and multi-runtime support (Ollama, llama.cpp, MLX, Docker Model Runner, LM Studio). Cite as related work / prior art.
- LLM Checker (referenced in interim report) — Node.js CLI, Ollama-integrated, actually runs models to benchmark rather than pure estimation. Good cross-check for your own tool's estimates.
- AirLLM (referenced in interim report) — memory optimization technique (layer streaming) for running very large models on limited VRAM; more relevant to feasibility-checking the *local LLM* tier than the production SLM tier, since production targets small fully-resident models rather than streamed giant ones.

## 7. Development environment notes

- All inference must be tested with **no internet connection active**, at least once before final evaluation, to genuinely validate the offline-first claim rather than just assuming it holds.
- Recommend version-pinning Ollama and model tags explicitly (e.g. `ollama pull qwen3:1.7b-q4_K_M`) in your methodology write-up, since Ollama's default tags can point to different quantizations over time — reproducibility matters if an examiner or future student wants to replicate your benchmark numbers.
