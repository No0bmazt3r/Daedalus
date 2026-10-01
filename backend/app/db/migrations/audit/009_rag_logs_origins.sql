-- Which retrieved items were this rig's own, and which were references.
--
-- JSON array of 'rig' | 'reference', in the same order as
-- `retrieved_chunk_ids` — chunk ids for Track 1, node ids for Track 2. Lets the
-- evaluation report how often an answer rested on this rig's documents versus
-- other installations', which is the difference between "grounded" and
-- "grounded in something that applies here". NULL on rows written before this.
ALTER TABLE rag_logs ADD COLUMN retrieved_origins TEXT;
