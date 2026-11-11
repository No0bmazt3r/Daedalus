-- What re-ranking changed, and why it did not run. `rerank_ranks` is each kept
-- chunk's 1-based place in the candidate list before re-ranking (the vector
-- order, or the fused vector + keyword order when hybrid is on), aligned with
-- `retrieved_chunk_ids`. `rerank_reason` says why the model is NULL: switched
-- off, or switched on and unavailable. Both NULL on rows written before this.
ALTER TABLE rag_logs ADD COLUMN rerank_ranks TEXT;
ALTER TABLE rag_logs ADD COLUMN rerank_reason TEXT;
