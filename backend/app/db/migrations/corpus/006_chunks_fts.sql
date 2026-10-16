-- A keyword (BM25) index over chunk text, for Track 1's hybrid retrieval.
--
-- Dense vectors are poor at exact tokens — valve tags (ABV-1), alarm codes, SOP
-- numbers — which is exactly what an operator types. FTS5's bm25() is good at
-- them, and `search_corpus` fuses both rankings (RRF) before re-ranking.
--
-- A regular FTS5 table (it keeps its own copy of the text) rather than an
-- external-content one keyed on chunks.rowid: chunks has a TEXT primary key, so
-- its rowids are not stable across `VACUUM INTO` backups and a restore would
-- silently point every hit at the wrong chunk. chunk_id is the join key instead.
--
-- `title` is the document's, copied in so a chunk matches on what its document
-- is called — the keyword half of the title/section header embedding gets.
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    chunk_id UNINDEXED,
    text,
    section_title,
    title,
    tokenize = 'porter unicode61'
);

INSERT INTO chunks_fts (chunk_id, text, section_title, title)
SELECT c.chunk_id, c.text, coalesce(c.section_title, ''), coalesce(d.title, d.filename, '')
  FROM chunks c JOIN documents d ON d.document_id = c.document_id;

-- Triggers, not calls in corpus_store, so a write path added later (or a
-- cascade from deleting a document) cannot leave the two indexes disagreeing.
-- ponytail: the delete is a scan of chunks_fts per row (chunk_id is UNINDEXED);
-- fine at a lab corpus's tens of thousands of chunks, key on a stable integer
-- id if re-chunking a large manual ever gets slow.
CREATE TRIGGER IF NOT EXISTS chunks_fts_insert AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts (chunk_id, text, section_title, title)
    VALUES (new.chunk_id, new.text, coalesce(new.section_title, ''),
            (SELECT coalesce(title, filename, '') FROM documents WHERE document_id = new.document_id));
END;

CREATE TRIGGER IF NOT EXISTS chunks_fts_delete AFTER DELETE ON chunks BEGIN
    DELETE FROM chunks_fts WHERE chunk_id = old.chunk_id;
END;

CREATE TRIGGER IF NOT EXISTS chunks_fts_update AFTER UPDATE OF text, section_title ON chunks BEGIN
    UPDATE chunks_fts SET text = new.text, section_title = coalesce(new.section_title, '')
     WHERE chunk_id = new.chunk_id;
END;

CREATE TRIGGER IF NOT EXISTS chunks_fts_title AFTER UPDATE OF title, filename ON documents BEGIN
    UPDATE chunks_fts SET title = coalesce(new.title, new.filename, '')
     WHERE chunk_id IN (SELECT chunk_id FROM chunks WHERE document_id = new.document_id);
END;
