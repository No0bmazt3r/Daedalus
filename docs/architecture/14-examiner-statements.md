# Examiner-Safe Statements & Anti-Patterns

---

## Examiner-Safe Statements

Use these exact phrasings during your proposal defence, viva, and final report.

### 1. Local-only Constraint
> "All production inference and retrieval is local. Cloud LLMs are only used as external benchmark references and are not part of the deployed runtime system."

### 2. Read-only Safety
> "Zone 3 is strictly read-only. The agent can query SQLite and the vector store, but it cannot issue actuator commands or modify SCADA state."

### 3. Anti-hallucination
> "The language model never generates numerical sensor values directly. All numerical evidence is retrieved through deterministic tools from the local SQLite database."

### 4. RAG Grounding
> "SOP and troubleshooting responses are grounded in retrieved domain documents. If no relevant document is retrieved, the system states that the information is unavailable instead of guessing."

### 5. Model Selection
> "Model selection is hardware-aware. LLM Checker and AirLLM were used as feasibility tools, while Ollama is the production model provider."

### 6. Vector DB Research Gap
> "ChromaDB is used as the production baseline, while sqlite-vec, libSQL, Turso Database, FAISS, and LanceDB are evaluated through an abstraction benchmark harness to address the research gap regarding SQLite-native vector storage."

### 7. Observability & Logging
> "The read-only boundary applies to the reactor control layers. The AI layer writes to its own local audit database so that every query, tool call, and model response can be audited for groundedness and safety without transmitting data externally."

### 8. Vector DB Evaluation
> "To avoid selecting the vector database based only on documentation, a vector-store evaluation layer was designed. Each candidate database is wrapped behind a common adapter interface and evaluated using the same document corpus, the same chunking strategy, the same local embedding model, and the same held-out query set. This allows the final vector-store selection to be justified empirically rather than qualitatively."

### 9. Model Selector Console
> "The model selector console is a local administrative utility used to support Objective 3. It profiles the lab hardware, recommends compatible quantized SLMs, manages local Ollama models, and records benchmark results. It is not part of the operator-facing conversational interface. Its purpose is to make the model selection process reproducible, hardware-aware, and documented."

### 10. AirLLM
> "AirLLM is used only as a feasibility investigation tool to understand whether larger models could theoretically run under constrained memory. The production system uses Ollama with fully resident quantized models for stable low-latency inference."

### 11. Offline Model Download
> "Model downloading is a one-time setup activity performed when internet is available. The production runtime remains fully offline. For strictly offline deployment, models are pre-downloaded and transferred to the lab machine using Ollama's local model cache or portable storage."

### 12. Automated Evaluation Pipeline (n8n & Google Sheets)
> "While the production runtime is strictly local and offline to guarantee reactor safety, the evaluation phase utilizes an asynchronous, cloud-based automation pipeline. Exported local logs were processed via n8n and pushed to Google Sheets. This allowed for scalable distribution to a large pool of human evaluators and facilitated an 'LLM-as-a-judge' baseline scoring mechanism. This separation ensures we meet the statistical requirements for Objective 3 without compromising the strict local-only constraint of the operational system."

---

## Anti-Patterns: What NOT to Include

| Do Not Draw / Build | Reason |
| :--- | :--- |
| **n8n / Google Sheets (in Production)** | Forbidden in the *live runtime* due to offline/privacy constraints. (Allowed ONLY for offline, post-run evaluation data processing). |
| **OpenAI / Anthropic / Gemini APIs** | Violates the strict 100% local production constraint. (Allowed ONLY as 'LLM-as-a-judge' in the offline evaluation phase). |
| **Pinecone / MongoDB Atlas** | Cloud-managed vector DBs violate the local-first constraint |
| **Hugging Face hosted inference** | Cloud API — forbidden in production |
| **Direct LLM-to-SQL Arrow** | Highly dangerous; leads to SQL injection and numerical hallucinations |
| **AI Write Arrow to SCADA** | Violates the fundamental read-only safety boundary |
| **AirLLM as Production Runtime** | Experimental and slow; strictly a feasibility/setup tool |
| **Model Selector as Chat UI** | Mispositions an admin utility as a core conversational layer |
| **Grafana / Prometheus** | Overkill for FYP; Streamlit log viewer is sufficient |
| **Log Viewer arrow to Reactor/SCADA** | Log viewer only reads logs, never touches reactor |
| **User accounts / Login system** | Scope creep for Model Selector Console |
| **Cloud sync / Online model ranking** | Violates local-only constraint |
| **Prompt playground / Fine-tuning dashboard** | Scope creep |

---

## Final Architecture Summary Paragraph

*Use for your executive summary or abstract:*

> "The proposed system is a fully local, read-only conversational agentic AI layer embedded into the existing CO2SorptionDT PyQt5 dashboard. Sensor telemetry from the CO₂ sorption reactor is acquired by the existing SCADA/data acquisition layer and stored in a local SQLite database. Domain knowledge from manuals, SOPs, anomaly records, and UAUC logs is chunked, embedded locally, and stored in a local vector database. When a user asks a question through the PyQt chat panel, the FastAPI orchestration backend classifies the intent, applies safety guards, and calls deterministic tools to retrieve evidence from SQLite or the vector store. The retrieved evidence is packaged into a prompt and sent to a local SLM served by Ollama. The language model only synthesizes the final response; it does not generate numerical readings or control commands. All runtime components operate offline, and the AI layer remains strictly read-only with respect to the reactor and SCADA system, while maintaining comprehensive local audit logging for evaluation and traceability."
