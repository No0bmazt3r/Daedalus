-- Baseline for the audit and evaluation log store (Layer 10).
--
-- Every row of every table carries a `query_id`, so one question traces end to
-- end: intent → tool calls → retrieved evidence → model inference → response →
-- error → user feedback. That trace is what answers "prove this was grounded".
--
-- IF NOT EXISTS is deliberate — see prefs/001.

-- One row per user question.
CREATE TABLE IF NOT EXISTS conversation_logs (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    query_id           TEXT NOT NULL,
    timestamp          TEXT NOT NULL,
    session_id         TEXT,
    user_query         TEXT,
    intent             TEXT,
    selected_tools     TEXT,
    model_used         TEXT,
    response_text      TEXT,
    grounded_flag      INTEGER,
    hallucination_flag INTEGER,
    total_latency_ms   INTEGER,
    error_message      TEXT,
    user_feedback      TEXT
);

-- One row per deterministic tool invocation.
CREATE TABLE IF NOT EXISTS tool_logs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    query_id            TEXT NOT NULL,
    timestamp           TEXT NOT NULL,
    tool_name           TEXT NOT NULL,
    tool_input_json     TEXT,
    tool_output_summary TEXT,
    status              TEXT,
    latency_ms          INTEGER,
    error_message       TEXT
);

-- One row per retrieval, for precision/recall scoring later.
CREATE TABLE IF NOT EXISTS rag_logs (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    query_id             TEXT NOT NULL,
    timestamp            TEXT NOT NULL,
    track                TEXT,          -- 'vector' | 'graph'
    vector_db_used       TEXT,
    query_text           TEXT,
    top_k                INTEGER,
    retrieved_chunk_ids  TEXT,
    retrieval_scores     TEXT,
    source_files         TEXT,
    hop_count            INTEGER,
    retrieval_latency_ms INTEGER
);

-- One row per model call, for the latency chapter.
CREATE TABLE IF NOT EXISTS model_logs (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    query_id               TEXT NOT NULL,
    timestamp              TEXT NOT NULL,
    model_name             TEXT,
    temperature            REAL,
    prompt_token_count     INTEGER,
    completion_token_count INTEGER,
    time_to_first_token_ms INTEGER,
    total_inference_ms     INTEGER,
    status                 TEXT,
    error_message          TEXT
);

CREATE TABLE IF NOT EXISTS error_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    error_id    TEXT NOT NULL,
    timestamp   TEXT NOT NULL,
    query_id    TEXT,
    component   TEXT,
    level       TEXT,
    error_type  TEXT,
    message     TEXT,
    stack_trace TEXT
);

CREATE TABLE IF NOT EXISTS feedback_logs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    query_id          TEXT NOT NULL,
    timestamp         TEXT NOT NULL,
    evaluator_role    TEXT,
    usefulness_score  INTEGER,
    correctness_score INTEGER,
    comment           TEXT
);

-- Agent memory: durable facts the assistant may recall across sessions.
CREATE TABLE IF NOT EXISTS memory_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id  TEXT NOT NULL,
    timestamp  TEXT NOT NULL,
    session_id TEXT,
    query_id   TEXT,
    kind       TEXT,      -- 'fact' | 'preference' | 'summary'
    content    TEXT,
    source     TEXT,
    expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_conv_query   ON conversation_logs(query_id);
CREATE INDEX IF NOT EXISTS idx_conv_time    ON conversation_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_conv_session ON conversation_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_query   ON tool_logs(query_id);
CREATE INDEX IF NOT EXISTS idx_rag_query    ON rag_logs(query_id);
CREATE INDEX IF NOT EXISTS idx_model_query  ON model_logs(query_id);
CREATE INDEX IF NOT EXISTS idx_error_query  ON error_logs(query_id);
CREATE INDEX IF NOT EXISTS idx_feedback_q   ON feedback_logs(query_id);
CREATE INDEX IF NOT EXISTS idx_memory_sess  ON memory_logs(session_id);
