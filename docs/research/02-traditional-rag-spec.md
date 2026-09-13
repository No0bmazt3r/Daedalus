# Track 1: Traditional RAG Pipeline

This is the baseline retrieval architecture described in the interim report — a standard embed → chunk → retrieve → generate pipeline. It exists both as a production path and as the **control group** for the comparison against Agentic GraphRAG.

## 1. Purpose

Answer troubleshooting/SOP/domain-knowledge queries ("what do I do if my NDIR reading drifts?") by retrieving the most semantically relevant chunks of unstructured documents (manuals, SOPs, anomaly/UAUC records) and grounding the SLM's response in that retrieved text — never letting the model answer from its own untrusted parametric knowledge.

## 2. Document corpus

| Document type | Examples | Format |
|---|---|---|
| Machine manuals | Reactor rig operating manual, sensor spec sheets | PDF/DOCX → converted to plain text |
| SOPs | Standard operating procedures for absorption/desorption cycles, safety procedures | PDF/DOCX |
| Anomaly / UAUC records | Historical anomaly annotations, past-run notes, "User Anomaly and Usage Context" logs | Structured logs + free-text notes |

## 3. Pipeline stages

### 3.1 Ingestion & chunking
- Documents are parsed and split into chunks (target: 300–500 tokens per chunk, with ~15% overlap to avoid splitting relevant context across chunk boundaries).
- Chunking strategy: prefer semantic/structural boundaries (headings, numbered SOP steps, paragraph breaks) over naive fixed-length splitting, since SOP steps are often meaningfully atomic units.
- Each chunk is tagged with metadata: `source_document`, `section_heading`, `document_type` (manual/SOP/anomaly), `date` (for anomaly records).

### 3.2 Embedding
- A local embedding model (candidates: `nomic-embed-text`, `bge-small-en`, or `all-MiniLM-L6-v2` — all runnable via Ollama or `sentence-transformers` locally, no cloud API) converts each chunk into a vector.
- Embeddings are computed once at ingestion time and stored in ChromaDB; re-embedding only happens when source documents change.

### 3.3 Vector store
- **ChromaDB** (local, persistent client mode — no separate server process needed) stores chunk vectors + metadata.
- Alternatives evaluated per the SLR gap: FAISS (no metadata filtering built-in), SQLite-vss/Turso (unified storage with the sensor DB, but less mature tooling). ChromaDB is the production choice for Track 1; the Turso/SQLite-vss comparison is a separate side-experiment noted in `07-tech-stack-and-tools.md`.

### 3.4 Retrieval
- Given a user query, the query is embedded with the same embedding model.
- Top-k (default k=4–6) most similar chunks are retrieved via cosine similarity.
- Optional: a metadata filter narrows retrieval by `document_type` if the query's routed intent already indicates "SOP question" vs "anomaly history question."
- Optional re-ranking step (e.g. cross-encoder re-ranker) can be added as a stretch goal to improve precision if the target of >80% precision isn't met with flat retrieval alone.

### 3.5 Generation
- Retrieved chunks are concatenated into a context block and passed to the local SLM along with the user's original query and a system prompt instructing it to answer **only** from the provided context, and to say "I don't have information on that" if the context doesn't cover the question.
- The SLM's response includes inline or trailing citation of which document(s)/section(s) it drew from — this is rendered in the PyQt chat UI so the operator can verify provenance at a glance.

## 4. Tool signature

```python
def rag_retrieve(query: str, top_k: int = 5, doc_type_filter: str | None = None) -> list[RetrievedChunk]:
    """
    Read-only. Returns the top-k most relevant document chunks for the query.
    Never writes to the vector store at query time (only at ingestion time,
    offline, outside the live query path).
    """
```

`RetrievedChunk` = `{text, source_document, section_heading, document_type, similarity_score}`

## 5. Strengths (why this track exists)

- Simple, well-understood, fast to implement and debug.
- Low latency — single embedding + single vector search + single generation call.
- Well-suited to single-hop questions ("what's the procedure for X?") where the answer lives in one document section.
- Established literature precedent (your SLR baseline studies mostly use this pattern).

## 6. Known limitations (the reason Track 2 exists)

- **Multi-hop reasoning is weak.** A question like "what SOP applies when both pressure AND temperature are anomalous, and has this combination happened before?" requires connecting facts across multiple documents/records — flat top-k retrieval may miss one side of the connection if it's not semantically close to the query wording.
- **No explicit relationship modeling.** Traditional RAG treats each chunk independently; it has no notion that "Sensor P-101" relates to "SOP Section 4.2" relates to "Anomaly Record #17" unless that relationship happens to be co-located in text.
- **Retrieval quality is sensitive to chunking/embedding choices** and can silently miss relevant context without any signal that it did so.

This is precisely the gap the Agentic GraphRAG track (`03-agentic-graphrag-spec.md`) is built to probe empirically — not on faith, but by running the same query set through both and measuring where each one wins or fails.

## 7. Configuration knobs to expose (for experimentation)

- `chunk_size`, `chunk_overlap`
- `embedding_model`
- `top_k`
- `similarity_threshold` (minimum score to include a chunk — helps refuse gracefully rather than pad with irrelevant context)
- `doc_type_filter` toggle

These are worth exposing as config rather than hardcoding, since your evaluation chapter will likely want to report a small ablation (e.g. "precision at k=3 vs k=6") to show methodological rigor.
