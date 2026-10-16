-- Track 1's hybrid retrieval: how many BM25 keyword hits were fused with the
-- vector ranking for this query. NULL when hybrid was off (the dense-only
-- baseline), so "was this arm hybrid" is one IS NOT NULL away — the same shape
-- as `rerank_model`. NULL on rows written before this.
ALTER TABLE rag_logs ADD COLUMN keyword_hits INTEGER;
