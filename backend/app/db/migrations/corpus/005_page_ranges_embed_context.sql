-- Two recipe details the manifest did not record.
--
-- `documents.page_ranges` — which pages of a PDF to read, as "1-5, 80-120".
-- NULL reads every page. For a long manual that is mostly irrelevant here (the
-- 216-page pressure-transmitter manual is mostly 4–20 mA configuration), so the
-- useful sections can be ingested without the rest outnumbering the corpus.
-- Applied at extraction, so it takes effect on the next re-ingest.
ALTER TABLE documents ADD COLUMN page_ranges TEXT;

-- `chunks.embed_context` — whether the chunk was embedded with its document
-- title and section prepended (`corpus_config.context_header`). Per chunk,
-- because a re-embed can change it without re-chunking, and the evaluation's
-- chunk recipe has to say what retrieval actually searched.
ALTER TABLE chunks ADD COLUMN embed_context INTEGER NOT NULL DEFAULT 0 CHECK (embed_context IN (0, 1));
