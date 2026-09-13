-- Cloud model endpoints, for the offline evaluation baseline.
--
-- PROJECT.md Rule 1 forbids cloud APIs in the live runtime and allows them
-- "strictly as offline evaluation baselines" (§3). The dual-track RAG
-- comparison needs those baselines, and §2.2 #7 adds LLM-as-a-judge over
-- exported logs — both are post-hoc work over data the local system already
-- produced.
--
-- `purpose` carries a CHECK that only admits 'benchmark'. A row describing a
-- cloud endpoint for runtime use cannot be written at all, so the rule is
-- enforced by the schema rather than by remembering it. That mirrors how the
-- read-only sensor boundary is enforced by the driver rather than by prompts.
--
-- `api_key` is stored in plain text. This is a single-user local deployment
-- and the file is git-ignored, but it is still a credential: the API never
-- returns it, only a masked hint, and `services/log_browser.py` deliberately
-- does not list this table.

CREATE TABLE IF NOT EXISTS model_endpoints (
    id               TEXT PRIMARY KEY,         -- ep_YYYYMMDD_HHMMSSffffff_xxxx
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,

    label            TEXT NOT NULL,            -- what the user calls it
    provider         TEXT NOT NULL,            -- 'deepseek' | 'openai' | 'custom' | …
    base_url         TEXT NOT NULL,
    api_key          TEXT,                     -- never returned by the API

    enabled          INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),

    -- Structural enforcement of Rule 1 — see the note above.
    purpose          TEXT NOT NULL DEFAULT 'benchmark'
                       CHECK (purpose = 'benchmark'),

    -- Result of the last connection test, so the UI can show it without
    -- re-calling a paid endpoint on every render.
    last_tested_at   TEXT,
    last_test_ok     INTEGER CHECK (last_test_ok IN (0, 1)),
    last_test_detail TEXT,
    last_test_models INTEGER                   -- how many models it advertised
);

-- One endpoint per base URL: adding the same provider twice is a mistake, and
-- silently keeping both would make "which key did the benchmark use?"
-- unanswerable in the results chapter.
CREATE UNIQUE INDEX IF NOT EXISTS idx_model_endpoints_url
    ON model_endpoints(base_url);
