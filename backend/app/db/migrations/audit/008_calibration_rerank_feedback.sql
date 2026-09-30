-- Three additions that the chat path needed before its rows were complete.
--
-- 1. How many characters the prompt was, beside how many tokens Ollama counted.
--
--    `chat_store.CHARS_PER_TOKEN` budgets history from a character count, and
--    the only ground truth for that ratio is `prompt_token_count` — which is
--    useless without the length it was counted from. With both on one row, the
--    ratio is measured per model (`services/token_calibration.py`) instead of
--    assumed to be 4. NULL on rows written before this migration, and on
--    benchmark rows, which size their prompts by target token count instead.
ALTER TABLE model_logs ADD COLUMN prompt_chars INTEGER;

-- 2. Re-ranking, recorded where retrieval already is.
--
--    Track 1 now fetches a wider candidate pool from Chroma and re-scores it
--    with a cross-encoder before keeping `top_k`. The existing columns keep
--    their meaning — `retrieved_chunk_ids` are the chunks the answer could
--    cite, `retrieval_scores` their cosine distances as Chroma gave them — and
--    these say what happened between the two:
--
--      rerank_model       the cross-encoder, or NULL when re-ranking was off or
--                         could not run (the reason is in the tool's detail)
--      rerank_scores      JSON array, the cross-encoder's score per kept chunk,
--                         in the same order as `retrieved_chunk_ids`
--      candidate_count    how many chunks Chroma returned for re-scoring
--      rerank_latency_ms  the cross-encoder alone, so the evaluation can price
--                         precision against latency without subtracting
ALTER TABLE rag_logs ADD COLUMN rerank_model TEXT;
ALTER TABLE rag_logs ADD COLUMN rerank_scores TEXT;
ALTER TABLE rag_logs ADD COLUMN candidate_count INTEGER;
ALTER TABLE rag_logs ADD COLUMN rerank_latency_ms INTEGER;

-- 3. Which message a rating is about, and a thumbs rating in its own column.
--
--    `feedback_logs` had scores but no writer. The chat UI now rates an answer
--    up or down, which is a different instrument from the 1–5 usefulness and
--    correctness scores Method A (§9.3) collects — so it gets its own column
--    rather than being squeezed into one of those scales.
--
--      rating      +1 | -1, from the chat UI; NULL on a Method A row
--      session_id  the chat, so a rating survives the message being re-read
ALTER TABLE feedback_logs ADD COLUMN rating INTEGER;
ALTER TABLE feedback_logs ADD COLUMN session_id TEXT;

-- No schema change for memory_logs; its `kind` vocabulary grows by one:
--
--   'fact' | 'preference'  written by the workspace memory tools
--   'summary'              the background summariser's rolling summary
--   'context'              what one chat turn replayed into its prompt — the
--                          summary, which turns, and the estimated size. One
--                          row per answered turn, keyed on its query_id.
--
-- And error_logs gains its first writer: the chat path records a failed model
-- call, a failed tool and an unexpected exception there, on the turn's query_id.
