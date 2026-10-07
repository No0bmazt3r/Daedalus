-- Web search providers, for corpus sourcing and setup research.
--
-- PROJECT.md Rule 1 keeps the production runtime 100% local, and a web search
-- is network egress by definition. So this is fenced the same way the cloud
-- model endpoints are (002): `purpose` carries a CHECK admitting only 'setup',
-- and nothing on the chat path imports the service that reads these rows.
--
-- What it is *for*: finding and checking the manuals, SOPs and datasheets that
-- M2 ingests, and looking up a model card while sizing one in the Forge. Both
-- are offline-preparation activities in the same sense §8.2 already permits
-- "model downloading is a one-time setup activity performed when internet is
-- available". The answer path never sees a search result; the corpus it
-- produced is what gets ingested, reviewed and cited.
--
-- Credentials are stored as written. As with 002, the API returns a masked
-- hint rather than the key, `services/log_browser.py` does not list either
-- table, and the file is git-ignored.

CREATE TABLE IF NOT EXISTS search_providers (
    id               TEXT PRIMARY KEY,         -- 'searxng' | 'brave' | 'tavily' | …
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,

    -- Only SearXNG uses this: a self-hosted instance has no published address.
    base_url         TEXT,
    api_key          TEXT,                     -- never returned by the API
    -- Google PSE needs a second, non-secret identifier alongside the key: the
    -- Programmable Search Engine id. Its own column rather than a blob, because
    -- exactly one provider needs it and a JSON bag would hide that.
    engine_id        TEXT,

    -- Result of the last test, so the panel can report it without spending a
    -- quota on every render.
    last_tested_at   TEXT,
    last_test_ok     INTEGER CHECK (last_test_ok IN (0, 1)),
    last_test_detail TEXT,
    last_test_count  INTEGER,                  -- results the probe query returned
    last_test_ms     INTEGER
);

-- The selection itself. One row, enforced by the CHECK: "which provider is
-- configured" is a single answer, and a table that can hold two of them is a
-- table that will eventually hold two of them.
CREATE TABLE IF NOT EXISTS search_config (
    id               INTEGER PRIMARY KEY CHECK (id = 1),
    updated_at       TEXT NOT NULL,

    -- 'disabled' is a real, selectable state rather than the absence of a row,
    -- so turning search off is something you can see having been done.
    provider         TEXT NOT NULL DEFAULT 'disabled',
    result_count     INTEGER NOT NULL DEFAULT 5
                       CHECK (result_count BETWEEN 1 AND 100),
    safesearch       TEXT NOT NULL DEFAULT 'strict'
                       CHECK (safesearch IN ('strict', 'moderate', 'off')),
    -- Ordered JSON array of provider ids tried when the primary returns
    -- nothing. Ordered, so it is a list and not a set.
    fallback_chain   TEXT NOT NULL DEFAULT '[]',

    -- Structural enforcement of Rule 1 — see the note above.
    purpose          TEXT NOT NULL DEFAULT 'setup'
                       CHECK (purpose = 'setup')
);

INSERT OR IGNORE INTO search_config (id, updated_at, provider)
VALUES (1, '1970-01-01T00:00:00+00:00', 'disabled');
