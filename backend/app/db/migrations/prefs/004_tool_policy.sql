-- Which normally-forbidden effects the agent tool layer may use at runtime.
--
-- 003 fenced web search as a setup surface; this is the row that can unfence it,
-- and four others like it. The project's default stays what PROJECT.md §3
-- describes — Rule 1 (local runtime), Rule 5 (setup tools are not runtime
-- tools) — and every row here is a deliberate, recorded departure from it.
--
-- Recorded is the operative word. The alternative to a table is a code change
-- or an environment variable, and neither of those can answer "was the agent
-- able to run shell commands when this benchmark was recorded?" six weeks later
-- while writing up the results. `unlocked_at` and `note` exist for that
-- question, and `services/agent_tools` stamps the active policy onto every
-- catalogue response so a screenshot carries it too.
--
-- One row per effect, present only when unlocked. An absent row is locked, so
-- the safe state is the one that needs no record and cannot be reached by a
-- half-applied migration.

CREATE TABLE IF NOT EXISTS tool_policy (
    effect       TEXT PRIMARY KEY
                   CHECK (effect IN ('network_egress', 'write', 'admin', 'execute_code')),
    unlocked_at  TEXT NOT NULL,
    -- Why, in the operator's words. Not optional: an unlock with no stated
    -- reason is the one nobody can defend later.
    note         TEXT NOT NULL
);
