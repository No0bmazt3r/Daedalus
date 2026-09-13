# Layer 5: Local Vector Retrieval Layer

> **Local Vector Retrieval Layer**

* **Zone Mapping:** Zone 3
* **Purpose:** Stores and retrieves domain knowledge embeddings. Supports troubleshooting, SOP, manual, anomaly, and UAUC queries.

---

## Production Technology

**ChromaDB** — selected as production baseline because it is:
- Local and embedded
- Python-friendly
- Persistent
- Easy to integrate
- Suitable for FYP RAG MVP

---

## RAG Technique Coverage (Advanced)

| Advanced RAG Technique | Included? | Notes |
|---|---|---|
| Basic retrieve-then-generate | ✅ Yes | Core pattern — retrieve chunks, build evidence, LLM synthesizes |
| Metadata-filtered retrieval | ✅ Yes | Filter by source_type, reactor_mode, document_version |
| Re-ranking retrieved chunks | ✅ Yes | Uses a local cross-encoder model to re-score and perfectly order chunks before LLM synthesis |
| Query expansion / reformulation | ✅ Yes | Agent LLM rewrites the user query to include technical synonyms and optimize vector search |
| Hybrid search (keyword + semantic) | ✅ Yes | Combines dense vector search (semantic) with sparse keyword search (BM25) for exact terminology |
| Multi-hop retrieval | ✅ Yes | Agent iteratively queries Vector DB if the first retrieval lacks complete evidence to answer |
| Contextual compression | ✅ Yes | Extractor agent filters out irrelevant sentences from retrieved chunks to save context window |

### How the Advanced RAG Flow Actually Works

```text
User query (e.g., "What if NDIR drifts?")
   ↓
1. Intent classifier tags it as `sop_query`
   ↓
2. Tool planner selects `rag_retrieve()`
   ↓
3. Query Reformulation (LLM rewrites query to include exact lab synonyms)
   ↓
4. Hybrid Search (Semantic embedding + BM25 keyword search against Vector DB)
   ↓
5. Top-N chunks returned and passed to a Local Re-ranker (Cross-Encoder)
   ↓
6. Top-K re-ranked chunks undergo Contextual Compression (removing useless sentences)
   ↓
7. Multi-hop Check (LLM assesses if context is sufficient; if not, loops back to step 3)
   ↓
8. Evidence Builder packages the refined chunks into the evidence pack
   ↓
9. Prompt Builder injects evidence + safety rules + original user query
   ↓
10. Ollama synthesizes a grounded answer from the highly-optimized chunks
   ↓
11. Response Validator checks the answer isn't hallucinated
   ↓
12. Citation attached (e.g., [Source: SOP_NDIR.pdf, p.4])
```

The LLM is **not** just parroting the chunk. With this advanced pipeline, it acts as an active agent: reformulating the search, re-ranking the best results, compressing out the noise, checking if it needs to search again (multi-hop), and finally **synthesizing** a highly grounded answer. If nothing relevant is retrieved even after multiple hops, the system must say "information is unavailable."

---

## Benchmark Vector DB Candidates

To address the FYP research gap regarding SQLite-native vs. embedded vector DBs:

```text
ChromaDB, sqlite-vec, libSQL, Turso Database, FAISS, LanceDB
```

> **Important:** Turso Cloud is not allowed. Pinecone is not allowed. MongoDB Atlas Vector Search is not allowed. Any hosted embedding API is not allowed. Only local/embedded usage counts.

---

## Vector Store Abstraction Layer

A common Python interface (`VectorStoreAdapter`) wraps all candidates:

```python
class VectorStoreAdapter:
    def initialize(self, config):
        """Create or connect to the vector store."""
        pass
    def add_chunks(self, chunks):
        """Insert embedded chunks with metadata."""
        pass
    def query(self, query_text, top_k=5, filters=None):
        """Return top-k retrieved chunks."""
        pass
    def update_chunk(self, chunk_id, chunk):
        """Update/re-index one chunk."""
        pass
    def delete_chunk(self, chunk_id):
        """Delete one chunk."""
        pass
    def persist(self):
        """Ensure data is saved locally."""
        pass
    def get_stats(self):
        """Return disk size, count, metadata support, etc."""
        pass
```

Each DB gets its own adapter (e.g., `chroma_store.py`, `sqlitevec_store.py`). The FastAPI tool can call:
```python
rag_retrieve(store="chroma", query="What should I do if the NDIR reading drifts?", top_k=5)
```

---

## Vector DB Responsibilities

1. Similarity search
2. Top-k retrieval
3. Metadata filtering
4. Persistent storage
5. Offline operation
6. Local document citations
7. Benchmark comparison

---

## Retrieval Examples

### Request
```json
{
  "query": "What should I do if the NDIR reading drifts?",
  "top_k": 5,
  "filters": { "source_type": ["sop", "manual"] }
}
```

### Response
```json
{
  "results": [{
    "chunk_id": "sop_ndir_drift_004",
    "text": "If the NDIR reading drifts, perform calibration according to Section 4.2...",
    "score": 0.87,
    "source_file": "SOP_NDIR_Calibration.pdf",
    "source_type": "sop",
    "section_title": "Drift Correction",
    "page_number": 4
  }]
}
```

### Metadata Filtering Examples
```text
source_type = sop | manual | anomaly | uauc
reactor_mode = absorption | desorption | all
document_version = latest
```

---

## Hard Pass/Fail Gates for Vector DB Selection

| Gate | Requirement |
|---|---|
| Offline operation | Must run 100% locally with no runtime network calls |
| Local persistence | Must save data locally and reload after restart |
| Python integration | Must work with FastAPI backend |
| Embedding storage | Must store vectors from local embedding model |
| Queryability | Must return relevant chunks for basic queries |
| No cloud dependency | Must not require managed cloud service |
| Acceptable maturity | Must not be too unstable for FYP deployment |

---

## Evaluation Matrix Criteria & Weights

| Criterion | Weight | Reason |
|---|---|---|
| Retrieval precision/recall | 30% | Core RAG quality |
| Query latency | 20% | Needed for <3s response target |
| Offline/local guarantee | 15% | Non-negotiable constraint |
| Integration effort | 10% | Must fit FYP timeline |
| Metadata filtering | 8% | Needed for source-type filtering |
| Disk footprint | 7% | Edge/lab constraint |
| Maturity/stability | 5% | Avoid beta risk in production |
| Update/re-index effort | 5% | Practical maintenance |

**Final Score Formula:**
```text
(Retrieval × 0.30) + (Latency × 0.20) + (Offline × 0.15) + (Integration × 0.10)
+ (Metadata × 0.08) + (Disk × 0.07) + (Maturity × 0.05) + (Update × 0.05)
```

---

## Scoring Rubrics

### Retrieval Precision@5

| Precision@5 | Score |
|---|---|
| ≥ 90% | 5 |
| 80–89% | 4 |
| 70–79% | 3 |
| 60–69% | 2 |
| < 60% | 1 |

### Query Latency p95

| Latency | Score |
|---|---|
| < 100 ms | 5 |
| 100–300 ms | 4 |
| 300–700 ms | 3 |
| 700–1500 ms | 2 |
| > 1500 ms | 1 |

These are **vector retrieval latencies only**, not full LLM response latency.

---

## Full Evaluation Matrix Template

| Candidate | Precision@5 | Recall@5 | MRR | P50 Latency | P95 Latency | Disk Size | Offline? | Metadata? |
|---|---|---|---|---|---|---|---|---|
| ChromaDB | | | | | | | Yes | Yes |
| sqlite-vec | | | | | | | Yes | Yes |
| libSQL | | | | | | | Yes | Yes |
| Turso DB | | | | | | | Yes | Partial |
| FAISS | | | | | | | Yes | Manual |
| LanceDB | | | | | | | Yes | Yes |

---

## Decision Rule

1. **Step 1:** Exclude failures (Offline gate, Persistence gate).
2. **Step 2:** Pick highest weighted score.

---

## Phased Approach

* **Phase 1 (MVP):** Use ChromaDB (fastest to integrate).
* **Phase 2 (Benchmark):** Build adapters for all candidates.
* **Phase 3 (Run Eval):** Same corpus, chunks, model, queries.
* **Phase 4 (Final Choice):** Likely ChromaDB for production, but research comparison highlights SQLite-native alternatives.

---

## Benchmark Tests

### Metadata Filtering Test
Query with filters (e.g., `source_type: "sop"`). Verify only SOP chunks are returned. Check if invalid filters crash the system.

### Update and Reindex Test
SOPs can change. Test Insert, Update, and Delete. Can it update without rebuilding the whole index?

### Offline Verification Test
Verify installability, lack of internet dependency, no cloud login, no hosted embedding, persistence after restart.

### Benchmark Script Flow
1. Load corpus chunks
2. Generate embeddings locally
3. For each vector DB: initialize → insert chunks → run query set → save results → calculate metrics (Precision, Recall, MRR, latency, disk size) → test metadata and persistence → export results
4. Compare all results in one matrix

---

## Diagram Elements

```text
ChromaDB Production Store

Vector DB Benchmark Harness (dashed box)
  - sqlite-vec
  - libSQL
  - Turso Database
  - FAISS
  - LanceDB
  Label: "Benchmark box is not part of production runtime"
```

> **Boundary Statement:** "The vector retrieval layer is fully local and stores only embedded domain knowledge, not live control commands."
