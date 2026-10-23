# Labyrinth Blueprints — the knowledge behind both tracks

Builds and shows what the two retrieval tracks answer from. **Track 1** (vector
RAG): documents → text → chunks → embeddings. **Track 2** (graph RAG): a
hand-authored knowledge graph, and the walk/agent that searches it. Also holds
the switch that decides which track answers.

Screen: `frontend/src/components/blueprints/` · Client: `lib/blueprintsClient.ts`

## Files

**Track 1 — corpus**

| File | Job |
|---|---|
| `ingestion.py` | The pipeline: upload → extract → chunk → embed → record the run |
| `extraction.py` | Text from PDF (pypdf, pdfplumber tables) and plain-text formats |
| `chunking.py` | Recursive splitter (size/overlap) |
| `corpus_config.py` | Chunking settings (`config/corpus_config.json`) |
| `document_usage.py` | How often each document was retrieved and cited |
| `retrieval_replay.py` | Re-show what a past vector query returned |

**Track 2 — graph**

| File | Job |
|---|---|
| `knowledge_graph.py` | Loads the graph (`config/knowledge_graph.yaml`, else the seed in `app/data/graph/`) |
| `graph_tools.py` | Deterministic lookups and the fixed walk |
| `graph_agent.py` | The agent that picks each hop |
| `graph_authoring.py` | Add/edit nodes and edges |
| `graph_proposals.py` | Model-proposed nodes, queued for a human to review |
| `graph_seed.py` | Demo traversal traces |

**Both**

| File | Job |
|---|---|
| `rag_config.py` | Which track answers (`config/rag_config.json`), and the freeze |

## Routes — `api/`

| File | Prefix |
|---|---|
| `corpus.py` | `/api/corpus` — documents, chunks, runs, config, replay |
| `graph.py` | `/api/graph/…` — nodes, coverage, traversals, authoring |

## Touches

- **Stores:** corpus, vectors (Chroma), audit (replays), graph YAML
- **Depends on:** forge (`embedding_models`, `reranker`, `ollama_client`), system (`live_events`)
- **Searched by:** `tools/agent_tools/search.py` and `knowledge.py` at chat time

Tests: `backend/tests/retrieval/` · Design: `docs/MODULES.md` §3
