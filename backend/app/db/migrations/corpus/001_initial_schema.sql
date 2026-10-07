-- The corpus manifest — Track 1's relational half (PROJECT.md §6.3, MODULES.md §3.1).
--
-- ## Why this is not a sixth store
--
-- §6.3 names five stores and §6.4 rests a safety argument on the count. This
-- file does not add to it: the Vector store *is* ChromaDB plus this manifest,
-- the same way Chroma itself keeps a SQLite catalogue beside its vectors. The
-- separation argument is about who writes what — Daedalus still writes only to
-- its own files and still cannot reach sensor_readings — and a manifest that
-- lived inside Chroma would be unqueryable, unmigratable and unbrowsable.
--
-- ## Why chunk text is stored here as well as in Chroma
--
-- Not duplication for its own sake. Two operations need the text without a
-- vector store round trip, and one of them needs it before any vector exists:
--
--   1. **Previewing a chunking change.** Adjusting size or overlap must be
--      inspectable before it is committed, and re-embedding to look at a split
--      would make the cheap question expensive.
--   2. **Re-embedding.** Changing the embedding model invalidates every vector
--      and none of the text. Keeping the text means a model swap re-embeds from
--      here instead of re-parsing every PDF, which is the difference between
--      seconds and minutes — and, for a scanned document, between reproducible
--      and not.
--
-- Chroma stays the retrieval index; this stays the record of what was ingested.

CREATE TABLE IF NOT EXISTS documents (
    document_id     TEXT PRIMARY KEY,
    filename        TEXT NOT NULL,
    -- Where the uploaded bytes live, relative to the corpus directory. Kept so
    -- a re-ingest re-reads the original rather than the extraction, which is
    -- what makes a parser fix retroactive.
    stored_name     TEXT NOT NULL,
    -- sha256 of the bytes. Uploading the same file twice is caught here rather
    -- than producing a second copy nobody can tell from the first.
    content_hash    TEXT NOT NULL,
    media_type      TEXT NOT NULL,
    size_bytes      INTEGER NOT NULL,

    -- The metadata retrieval filters on. `source_type` is the one `search_corpus`
    -- exposes as a parameter, so its values are constrained here rather than
    -- trusted from an upload form.
    source_type     TEXT NOT NULL DEFAULT 'other'
                    CHECK (source_type IN ('manual','sop','anomaly_record','uauc_record','other')),
    title           TEXT,
    document_version TEXT,
    reactor_mode    TEXT,

    -- Extraction outcome, separate from ingestion: a document can be stored and
    -- unparseable, and that is a state worth being able to list.
    extract_status  TEXT NOT NULL DEFAULT 'pending'
                    CHECK (extract_status IN ('pending','ok','failed')),
    extract_error   TEXT,
    extractor       TEXT,
    page_count      INTEGER,
    char_count      INTEGER,

    uploaded_at     TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_hash ON documents(content_hash);
CREATE INDEX IF NOT EXISTS idx_documents_source_type ON documents(source_type);

-- One row per chunk. `chunk_id` is what Chroma stores as its own id, so a row
-- here and a vector there are the same object under the same name — which is
-- what lets the browser show a chunk that failed to embed next to one that did.
CREATE TABLE IF NOT EXISTS chunks (
    chunk_id        TEXT PRIMARY KEY,
    document_id     TEXT NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
    run_id          TEXT,
    ordinal         INTEGER NOT NULL,
    text            TEXT NOT NULL,
    -- Offsets into the extracted text, so a chunk can be shown in context and a
    -- citation can point at a place rather than at a copy.
    char_start      INTEGER NOT NULL,
    char_end        INTEGER NOT NULL,
    token_estimate  INTEGER,
    page_number     INTEGER,
    section_title   TEXT,

    -- Embedding state per chunk, not per document: a run that failed halfway
    -- leaves some of each, and a document-level flag would erase that.
    embedded        INTEGER NOT NULL DEFAULT 0,
    embedding_model TEXT,
    collection      TEXT,
    embed_error     TEXT,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_chunks_run ON chunks(run_id);
CREATE INDEX IF NOT EXISTS idx_chunks_embedded ON chunks(embedded);

-- Every pipeline run, with the settings it ran under.
--
-- The settings are copied onto the row rather than referenced, because they are
-- what makes a result reproducible: "these 412 chunks came from size 800 /
-- overlap 120 / recursive / nomic-embed-text" has to stay true after somebody
-- changes the defaults. A foreign key to a mutable config would not.
CREATE TABLE IF NOT EXISTS ingest_runs (
    run_id          TEXT PRIMARY KEY,
    kind            TEXT NOT NULL DEFAULT 'ingest'
                    CHECK (kind IN ('ingest','rechunk','reembed')),
    status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','ok','failed','cancelled')),
    stage           TEXT,

    strategy        TEXT NOT NULL,
    chunk_size      INTEGER NOT NULL,
    chunk_overlap   INTEGER NOT NULL,
    embedding_model TEXT,
    collection      TEXT,

    documents_total INTEGER NOT NULL DEFAULT 0,
    documents_done  INTEGER NOT NULL DEFAULT 0,
    chunks_written  INTEGER NOT NULL DEFAULT 0,
    vectors_written INTEGER NOT NULL DEFAULT 0,

    started_at      TEXT NOT NULL,
    finished_at     TEXT,
    elapsed_ms      INTEGER,
    error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_started ON ingest_runs(started_at DESC);

-- The debug log. One row per thing that happened, at whatever granularity the
-- stage warrants — a document parsed, a chunk boundary chosen, an embed call
-- refused. MODULES.md §0 rule 4 says an empty panel must explain itself; this
-- is the same principle applied to a pipeline, where "it produced nothing" and
-- "it produced nothing *because the embedding model was not pulled*" are the
-- difference between a bug report and a fix.
--
-- Deliberately in the corpus store and not in `audit`. Audit rows are evidence
-- that an *answer* was grounded and are append-only for the evaluation chapter;
-- these are operational logs for a pipeline, and deleting a document should take
-- its ingestion history with it rather than leave orphaned evidence behind.
CREATE TABLE IF NOT EXISTS ingest_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      TEXT NOT NULL REFERENCES ingest_runs(run_id) ON DELETE CASCADE,
    at          TEXT NOT NULL,
    level       TEXT NOT NULL DEFAULT 'info'
                CHECK (level IN ('debug','info','warn','error')),
    stage       TEXT NOT NULL,
    document_id TEXT,
    message     TEXT NOT NULL,
    -- JSON, for anything structured the message should not try to be.
    detail      TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_run ON ingest_events(run_id, id);
CREATE INDEX IF NOT EXISTS idx_events_level ON ingest_events(level);
