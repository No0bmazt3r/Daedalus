-- Baseline for the preference store.
--
-- IF NOT EXISTS is deliberate: databases created before the migration runner
-- existed already have this table, and baselining them must be a no-op.

CREATE TABLE IF NOT EXISTS user_prefs (
    user_id    TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,   -- JSON
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
);
