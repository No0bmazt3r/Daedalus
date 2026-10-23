# The Forge — models and hardware

Answers *"which model can this machine run, and how fast — measured?"* in six
steps: **detect → estimate → score → manage → benchmark → commit**. Also owns
every other model choice: embedding model, re-ranker, cloud baselines, and the
small model that runs background jobs.

Screen: `frontend/src/components/forge/` · Client: `lib/forgeClient.ts`, `lib/embeddingsClient.ts`

## Files

| File | Job |
|---|---|
| `hardware.py` | Detect RAM, CPU, GPU (NVML), disk |
| `model_fit.py` | Estimate a model's memory; reads `app/data/model_catalogue.json` |
| `fit_verdict.py` | The verdict: `safe` / `marginal` / `will_not_fit` |
| `ollama_client.py` | Talks to the local Ollama (list, pull, delete, generate) — used app-wide |
| `ollama_registry.py`, `hf_discovery.py` | Find models on the Ollama library and Hugging Face |
| `benchmark.py` | Real time-to-first-token and tokens/s on a ~2k-token RAG prompt |
| `model_usage.py` | Per-model usage read from the audit log |
| `model_config.py` | Commit the chosen chat model (`config/model_config.json`) |
| `forge.py` | The model table that joins all of the above |
| `embedding_models.py` | Track 1's embedding model: choose, pull, verify, benchmark |
| `reranker.py` | Track 1's cross-encoder re-ranker (ONNX, CPU) |
| `model_endpoints.py` | Cloud baseline endpoints (Advanced mode only) |
| `background_models.py` | Which model runs titles, summaries, persona scans |
| `schemas.py` | Pydantic wire contracts for cloud providers |

## Routes — `api/`

| File | Prefix |
|---|---|
| `forge.py` | `/api/forge` — hardware, models, pull/delete, benchmarks |
| `embeddings.py` | `/api/embeddings` |
| `providers.py` | `/api/providers` — cloud endpoints |
| `background_jobs.py` | `/api/background-jobs` |

## Touches

- **Stores:** audit (benchmarks, usage), prefs (`model_endpoint_store`), vectors (embedding collections)
- **Used by:** chat (the model call), blueprints (embedding during ingest), tools

Tests: `backend/tests/models/` · Method: `docs/MODEL_FIT.md`, `docs/BENCHMARK.md`
