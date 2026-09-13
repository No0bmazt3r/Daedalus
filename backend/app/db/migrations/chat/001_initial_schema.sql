-- Chat transcript store — durable conversation state.
--
-- Separate from the audit log by design: a user owns their chats and may
-- rename, archive or delete them; audit rows are append-only evidence. See
-- `db/paths.py` for the full argument. `query_id` links a message back to its
-- audit trace in ai_logs.db without coupling the two files.
--
-- This store holds conversation *state*. It is not, and must never become, a
-- source of numeric evidence: Rule 3 says numbers come from tools at query
-- time, never from what the model said twenty minutes ago.

CREATE TABLE IF NOT EXISTS chat_sessions (
    session_id       TEXT PRIMARY KEY,            -- s_YYYYMMDD_HHMMSSffffff_hex
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,               -- bumped per message; orders the sidebar
    title            TEXT,                        -- NULL until the first user message
    device_id        TEXT NOT NULL DEFAULT 'co2_reactor',

    -- Rolling summary of turns older than `summary_upto_seq`, so a long
    -- conversation stays within an SLM's context window without losing its
    -- thread. Regenerated in the background, never on the request path.
    summary          TEXT,
    summary_upto_seq INTEGER NOT NULL DEFAULT 0,

    -- Incognito. Kept in the same tables so in-session memory behaves
    -- identically, then swept on shutdown and at startup.
    ephemeral        INTEGER NOT NULL DEFAULT 0 CHECK (ephemeral IN (0, 1)),

    archived_at      TEXT
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id     TEXT NOT NULL
                     REFERENCES chat_sessions(session_id) ON DELETE CASCADE,

    -- Per-session monotonic ordinal. Ordering must never rely on `created_at`:
    -- two messages can share a timestamp, and the transcript would silently
    -- scramble. It is also the cursor the summariser and prompt builder use.
    seq            INTEGER NOT NULL,

    role           TEXT NOT NULL CHECK (role IN ('user', 'assistant')),

    -- Natural language only. Tool output belongs in `evidence_json`.
    content        TEXT NOT NULL,

    -- Links to conversation_logs.query_id in ai_logs.db. Nullable: a user
    -- message exists before the query that answers it does.
    query_id       TEXT,

    -- Citations and tool results, for rendering. Deliberately NOT replayed
    -- into prompts — a stale reading re-entering context is exactly how a
    -- model ends up narrating a number nothing fetched.
    evidence_json  TEXT,

    -- Approximate, for context-window budgeting. Calibrate the ratio against
    -- the real prompt_eval_count recorded in model_logs.prompt_token_count.
    token_estimate INTEGER NOT NULL DEFAULT 0,

    created_at     TEXT NOT NULL
);

-- Enforces one message per ordinal per session, which is what makes the
-- read-max-then-insert allocation in chat_store safe under concurrency: a
-- racing writer hits this constraint instead of silently duplicating a seq.
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_seq
    ON chat_messages(session_id, seq);

-- The sidebar: most-recently-updated non-archived sessions.
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated
    ON chat_sessions(updated_at DESC);

-- The startup sweep for abandoned incognito sessions.
CREATE INDEX IF NOT EXISTS idx_chat_sessions_ephemeral
    ON chat_sessions(ephemeral) WHERE ephemeral = 1;

-- Tracing a transcript back to its audit rows.
CREATE INDEX IF NOT EXISTS idx_chat_messages_query
    ON chat_messages(query_id) WHERE query_id IS NOT NULL;
