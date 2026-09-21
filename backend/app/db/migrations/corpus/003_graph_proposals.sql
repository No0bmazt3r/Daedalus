-- Assisted graph authoring: proposals awaiting a person's decision.
--
-- ## Why a queue and not a writer
--
-- `search_graph` claims `Integrity.SYSTEM` — a stronger provenance than an
-- ingested PDF — and the whole basis of that claim is that every node in the
-- graph was authored by a person and reviews in a diff. A proposer that wrote
-- directly to the YAML would demote Track 2 to `CORPUS` integrity in one commit,
-- and PROJECT.md §5 would stop comparing two retrieval strategies and start
-- comparing two guesses.
--
-- So the model proposes and a person disposes. A row here has been extracted,
-- canonicalised and validated, and is still not in the graph. `accepted` means
-- somebody looked at it.
--
-- ## Why rejected proposals are kept
--
-- Same argument as `graph_edits` keeping refused edits. What the extractor got
-- wrong is the most informative record of how well it works — it is the only
-- evidence for "the proposer suggests X and it is right Y% of the time", which
-- is a number the report may well want. Deleting rejections would leave only
-- the successes and make the proposer look perfect.
--
-- ## Validation happens at propose time, not at accept time
--
-- Every row carries the verdict of a dry run through the same `_validate` the
-- manual path uses. A proposal that cannot be applied is queued anyway, marked
-- invalid, with the reason — because "the model suggested an edge the schema
-- forbids" is exactly what somebody evaluating this feature needs to see, and a
-- proposer that silently dropped its own bad output would hide its error rate.

CREATE TABLE IF NOT EXISTS proposal_runs (
    run_id          TEXT PRIMARY KEY,
    created_at      TEXT NOT NULL,
    finished_at     TEXT,
    status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','ok','failed')),
    model           TEXT,
    -- Which documents were read. The proposer extracts from the ingested corpus
    -- and never from the web: Rule 5 makes web search a surface for *finding*
    -- documents, and unreviewed external text in the graph breaks the
    -- provenance claim this whole table exists to protect.
    documents_read  INTEGER NOT NULL DEFAULT 0,
    chunks_read     INTEGER NOT NULL DEFAULT 0,
    proposed        INTEGER NOT NULL DEFAULT 0,
    -- Suppressed before reaching the queue because an equivalent already exists.
    -- Counted rather than hidden: a high number means the corpus is already
    -- represented, which is a useful thing to learn early.
    duplicates      INTEGER NOT NULL DEFAULT 0,
    invalid         INTEGER NOT NULL DEFAULT 0,
    elapsed_ms      INTEGER,
    error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_proposal_runs_at ON proposal_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS graph_proposals (
    proposal_id     TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES proposal_runs(run_id) ON DELETE CASCADE,
    created_at      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','accepted','rejected','failed')),

    target          TEXT NOT NULL CHECK (target IN ('node','edge')),
    -- Nodes carry type + id + attributes; edges carry the triple. One table
    -- because they share a lifecycle and a review screen, and a second one
    -- would mean two queues to keep in step.
    node_type       TEXT,
    element_id      TEXT,
    attributes_json TEXT,
    source_id       TEXT,
    edge_type       TEXT,
    target_id       TEXT,

    -- Where it came from, so a reviewer can check the claim against the text
    -- rather than trusting the model's summary of it. A proposal with no
    -- evidence is a guess, and this column is what makes that visible.
    document_id     TEXT,
    chunk_id        TEXT,
    evidence        TEXT,
    rationale       TEXT,
    model           TEXT,

    valid           INTEGER NOT NULL DEFAULT 1,
    validation_error TEXT,

    decided_at      TEXT,
    decided_error   TEXT
);

CREATE INDEX IF NOT EXISTS idx_proposals_status ON graph_proposals(status, created_at);
CREATE INDEX IF NOT EXISTS idx_proposals_run ON graph_proposals(run_id);
CREATE INDEX IF NOT EXISTS idx_proposals_element ON graph_proposals(element_id);
