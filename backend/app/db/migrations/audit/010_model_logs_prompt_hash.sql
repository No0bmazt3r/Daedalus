-- SHA-256 of the exact messages sent to the model (JSON, keys sorted).
--
-- The prompt itself is not stored: it holds the evidence and the replayed
-- history, which would duplicate the transcript into a table a user cannot
-- delete from. The hash proves which prompt produced an answer — two turns
-- with the same hash were asked identically — and lets Ariadne's Thread say so.
-- NULL on rows written before this.
ALTER TABLE model_logs ADD COLUMN prompt_sha256 TEXT;
