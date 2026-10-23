# Evaluation — the Track 1 vs Track 2 comparison

Runs the frozen question set (`config/eval/queries.yaml`) through the real chat
path, once per arm — `vector`, `graph-walk`, `graph-agent` — and scores
groundedness, retrieval precision/recall/MRR and latency. Results land in the
audit store like any turn, so Ariadne's Thread can open each one.

## Files

| File | Job |
|---|---|
| `evaluation.py` | The harness: arms, runs, metrics, report |

Command line: `python -m app.cli_eval` (`app/cli_eval.py`, kept at the app root as an entry point). No HTTP routes.

## Touches

- **Stores:** audit (writes turns, reads them back), corpus
- **Depends on:** chat (`inference.answer_stream`, `orchestration`), blueprints (`rag_config`, `knowledge_graph`), forge (`hardware`, `ollama_client`)

Tests: `backend/tests/evaluation/` · Guide: `docs/EVALUATION.md`
