-- Settings → Agent Tools' Simple / Advanced switch, as a runtime policy.
--
-- Simple is not only a shorter list on screen. While it is on, the registry
-- refuses every tool on the runtime surface except the ones the chat path
-- answers with — the three sensor reads and the selected track's retrieval —
-- whatever 006's locks and 008's per-tool switches say. Advanced hands control
-- back to those two tables, unchanged: switching modes never rewrites them.
--
-- One row at most. No row means Simple, so the default is the narrow one and a
-- fresh install offers the model nothing it does not need; choosing Advanced is
-- the recorded event, with its time.
CREATE TABLE IF NOT EXISTS tool_mode (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    mode        TEXT NOT NULL CHECK (mode IN ('simple', 'advanced')),
    changed_at  TEXT NOT NULL
);
