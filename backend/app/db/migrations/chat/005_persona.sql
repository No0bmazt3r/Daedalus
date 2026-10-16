-- The user persona (`services/persona.py`): what Daedalus has learned about how
-- this install's user works, proposed by a background job and accepted or
-- rejected by them in Settings → Persona. In chat.db because it is learned from
-- the transcripts and is this install's own; a fresh install starts empty.
--
-- One row per (kind, key, value). A proposal seen again is the same row with
-- more sightings, not a second row; a rejected one stays rejected.
CREATE TABLE IF NOT EXISTS persona_traits (
    trait_id     TEXT PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('style', 'vocabulary', 'focus', 'role')),
    key          TEXT NOT NULL,
    value        TEXT NOT NULL,
    -- The knowledge-graph node a vocabulary or focus trait was grounded on.
    node_id      TEXT,
    status       TEXT NOT NULL DEFAULT 'proposed'
                 CHECK (status IN ('proposed', 'accepted', 'rejected')),
    sightings    INTEGER NOT NULL DEFAULT 1,
    -- JSON list of {"session_id", "seq"}: the user messages that showed it.
    -- Pointers, not copies, so deleting a chat removes the words too.
    evidence     TEXT NOT NULL DEFAULT '[]',
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    decided_at   TEXT,
    UNIQUE (kind, key, value)
);

CREATE INDEX IF NOT EXISTS idx_persona_status ON persona_traits(status);

-- How far each chat has been read, so a scan only looks at new messages.
CREATE TABLE IF NOT EXISTS persona_scans (
    session_id   TEXT PRIMARY KEY REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
    upto_seq     INTEGER NOT NULL DEFAULT 0,
    scanned_at   TEXT NOT NULL
);
