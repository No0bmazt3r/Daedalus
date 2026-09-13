# Layer 4: Domain Knowledge Ingestion Layer (RAG Setup)

> **Offline RAG Knowledge Ingestion Layer**

* **Zone Mapping:** Setup/Offline Utility
* **Purpose:** Converts unstructured domain documents into searchable knowledge chunks. Executed during setup or document updates, **not during live chat**.

---

## Document Sources

1. Machine manuals
2. Standard Operating Procedures (SOPs)
3. Historical anomaly records
4. User Anomaly and Usage Context records (UAUC)
5. Reactor operating mode descriptions
6. Troubleshooting guides
7. Safety procedure documents

---

## Supported File Types

```text
PDF, Markdown, TXT, DOCX, CSV/JSON (for structured anomaly records)
```

---

## Document Storage

Documents placed in a local folder structure (no cloud upload):

```text
/data/documents/
    manuals/
    sops/
    anomaly_records/
    uauc_records/
```

---

## Processing Pipeline

### Step 1: Text Extraction

```text
PDF → text
DOCX → text
Markdown → text
CSV → structured text chunks
```

### Step 2: Cleaning

Remove:
- Page numbers
- Repeated headers
- Corrupted characters
- Irrelevant formatting
- Duplicate sections

Normalize:
- Whitespace
- Bullet points
- Section headings

### Step 3: Chunking

```text
Chunk size: 300–500 tokens
Overlap: 50 tokens
```

For SOPs, prefer **section-based chunking**:
```text
Document → Section → Step 1, Step 2, Step 3
```
Do not split safety procedures in the middle if possible.

### Step 4: Metadata Assignment

Each chunk gets rich metadata:

```json
{
  "chunk_id": "sop_ndir_drift_004",
  "source_file": "SOP_NDIR_Calibration.pdf",
  "source_type": "sop",
  "section_title": "Drift Correction",
  "page_number": 4,
  "document_version": "1.2",
  "reactor_mode": "all",
  "updated_at": "2026-01-01"
}
```

| Field | Purpose |
|---|---|
| source_file | Traceability |
| source_type | manual/sop/anomaly/uauc |
| section_title | Better retrieval context |
| page_number | Citation |
| document_version | Avoid outdated SOPs |
| reactor_mode | Manual/Absorption/Desorption |
| updated_at | Freshness |

### Step 5: Local Embedding Generation

Generate embeddings locally. **No cloud embedding APIs.**

Recommended models:
```text
nomic-embed-text       ← Recommended
all-minilm             ← If hardware is weak
bge-small              ← Alternative
mxbai-embed-large      ← Alternative
```

Process:
```text
Chunk text → Local embedding model → Vector embedding
```

### Step 6: Vector Store Insertion

```text
Chunk text + metadata + embedding → ChromaDB / benchmark vector DB
```

---

## Outputs

1. Embedded knowledge chunks
2. Metadata-enriched retrieval units
3. Local vector index
4. Document-to-chunk mapping
5. Citation source references

---

## Important: Chunking & Embedding Must Be Fixed for Benchmarking

When benchmarking vector DBs, you **must** use the same chunking strategy and embedding model for every candidate. Otherwise you're comparing chunking strategies, not databases.

Pre-compute a fixed corpus file:
```text
corpus_chunks.json
  - chunk_id
  - text
  - metadata
  - embedding
```

---

## Test Data Corpus Size

| Level | Chunk Count |
|---|---|
| Minimum | 20–40 chunks |
| Better | 80–150 chunks |
| Strong | 200+ chunks |

| Source Type | Example Content |
|---|---|
| Machine manual | Reactor overview, sensor descriptions, operating modes |
| SOP | Startup, shutdown, absorption, desorption, emergency procedures |
| Anomaly records | Past high CO₂ events, pressure spikes, NDIR drift |
| UAUC records | User Anomaly and Usage Context notes |
| Troubleshooting guide | Sensor calibration, valve behaviour, drift handling |

---

## Diagram Elements

```text
Manuals / SOPs / Anomaly Records
        ↓
Text Extraction
        ↓
Cleaning
        ↓
Chunking
        ↓
Metadata Tagging
        ↓
Local Embedding Model
        ↓
Vector DB
```

> **Boundary Statement:** "Knowledge ingestion is performed fully offline. No document is sent to any cloud service."
