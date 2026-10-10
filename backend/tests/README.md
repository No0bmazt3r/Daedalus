# Backend tests

Stdlib `unittest`, no extra dependency. **243 tests**, grouped by the part of
the system they pin. From `backend/`:

```bash
python -m unittest discover -s tests -t .          # everything
python -m unittest discover -s tests/thread -t .   # one folder
python -m unittest tests.chat.test_chat_path       # one file
```

Shared, at the top of this folder:

| File | What it is |
|---|---|
| `__init__.py` | Points every store, the config and the logs at a throwaway directory **before** anything is imported, so a run never touches `data/` or `config/` |
| `fixtures.py` | A small deterministic sensor database (two hours, one CO₂ excursion) and `set_track()` |
| `fakes.py` | `FakeHttpx`: a fake Ollama that streams a scripted answer, so the chat path runs with no model |
| `test_error_reporting.py` | 2 tests: an unexpected server error is logged under a short id and answered with its reason, so the UI's error toast can be matched to the Process Log; the demo seeders refuse unless `DAEDALUS_ALLOW_DEMO_SEED=1` |
| `test_scrub.py` | 3 tests (M7): secrets and personal identifiers never reach an audit row or a process-log line; readings do |

### `chat/` — The chat path end to end: the safety guard, the turn itself with Ollama faked, the rolling summary, titles, and Settings → Assistant.

| File | Tests | What it pins |
|---|---|---|
| `test_assistant_settings.py` | 5 | Settings → Assistant: timezone precedence, validation, the freeze, custom refusals. |
| `test_background_jobs.py` | 14 | Background jobs: model-written chat titles, their settings, and the token ratio. |
| `test_chat_path.py` | 10 | The whole of §7.1 through `inference.answer_stream`, with Ollama faked. |
| `test_follow_ups.py` | 3 | Follow-ups: a spoken opener ("so …") is not a continuation, and "the previous answer" is understood. |
| `test_safety.py` | 9 | M5: every unsafe phrasing is refused before any tool or model runs. |
| `test_summariser.py` | 5 | §7.4's rolling summary: folds what fell out of the window, never keeps a value. |
| `test_title_display.py` | 2 | Chat titles in the sidebar: always capitalised, and flagged while being written. |

### `tools/` — The deterministic tool layer: the registry's gates, simple/advanced mode, the read-only sensor tools, and planning → evidence → validation.

| File | Tests | What it pins |
|---|---|---|
| `test_orchestration.py` | 47 | M5 steps 5–10: time resolution, planning, evidence and validation. |
| `test_registry.py` | 5 | The tool registry's gates, as they apply to the orchestrator's tools. |
| `test_sensor_tools.py` | 13 | M3: the sensor tools are read-only, whitelisted and bounded. |
| `test_tool_mode.py` | 10 | Simple mode is enforced at dispatch, not only drawn in Settings. |

### `retrieval/` — Both retrieval tracks: Track 1's re-ranking and embedding prefixes, Track 2's agent loop, and document origin (rig or reference).

| File | Tests | What it pins |
|---|---|---|
| `test_coverage.py` | 1 | The graph-gap check: corpus documents no node names, and nodes naming a document that is not ingested. |
| `test_document_usage.py` | 1 | Which documents earn their place: retrieved per track, cited by answers, seeded walks excluded. |
| `test_embedding_prefixes.py` | 5 | Asymmetric embedders get their query and document prefixes — and the index knows which. |
| `test_graph_agent.py` | 16 | Track 2's agent loop, driven by a scripted model — no Ollama anywhere. |
| `test_origin.py` | 11 | Document origin — this rig's own, or a reference from another installation. |
| `test_pdf_extraction.py` | 5 | PDF uploads: an AES-locked manual opens, font-shifted text ("WKH" for "the") is decoded, a missing `cryptography` is explained, and no parser error becomes an HTTP 500. |
| `test_replay.py` | 2 | Blueprints' Track 1 replay: a recorded vector query read back, never re-run. |
| `test_rerank.py` | 14 | Track 1's two-stage retrieval: a wide Chroma pool, re-scored by a cross-encoder. |
| `test_run_documents.py` | 3 | Ingest logs by document: a run names its documents, and a document gets its runs' logs; chunks longer than the embedder's window are named. |

### `models/` — Which model may do which job, and the fit contract that judges a model against this machine.

| File | Tests | What it pins |
|---|---|---|
| `test_benchmark_export.py` | 1 | The Forge's benchmark table for the report: engine-counter rates beside the estimate, as CSV and Markdown. |
| `test_chat_models_only.py` | 5 | An embedding model is never the chat model — at any of the three layers. |
| `test_cloud_toggle.py` | 2 | Settings → Cloud Models off: a cloud model is neither listed nor used. |
| `test_embedding_fit.py` | 10 | The fit contract (`docs/MODEL_FIT.md`) — for embedders, and the shared rule. |

### `evaluation/` — The evaluation harness: query sets, scoring, arms, timeouts and aborts.

| File | Tests | What it pins |
|---|---|---|
| `test_evaluation.py` | 22 | The evaluation harness — query-set validation, scoring, arms, timeouts, aborts. |

### `thread/` — Ariadne's Thread: traces, the number verdicts, labels, incognito redaction, settings and retrieval detail.

| File | Tests | What it pins |
|---|---|---|
| `test_thread.py` | 17 | Ariadne's Thread — real turns through the chat path, read back as traces. |
