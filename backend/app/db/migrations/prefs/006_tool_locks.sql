-- Invert the tool policy: record what is **locked**, not what is unlocked.
--
-- 004 stored unlocked effects, so an empty table meant "everything refused".
-- 005 then seeded four rows to make the default open. That works exactly once:
-- `lock all` deletes the rows, and because a migration runs a single time, the
-- default never comes back. The system quietly reverts to fully-locked and the
-- only way out is to re-unlock by hand — which is how a machine ends up in a
-- state nobody chose.
--
-- Storing the locks instead makes the empty table mean "open", which is the
-- default this console wants (single operator, and the operator is the admin)
-- and is now a property of the schema rather than of a seed that ran once.
-- Restoring the default becomes *deleting* rows, which is idempotent.
--
-- The audit value moves with it, and improves: closing an effect is now the
-- event worth recording, and `locked_at` + `note` record it. Nothing is lost —
-- `tool_policy` is left in place rather than dropped, because it holds the
-- history of which effects were opened when, and this project's whole argument
-- is that the record of what the system was allowed to do outlives the setting.

CREATE TABLE IF NOT EXISTS tool_locks (
    effect     TEXT PRIMARY KEY
                 CHECK (effect IN ('network_egress', 'write', 'admin', 'execute_code')),
    locked_at  TEXT NOT NULL,
    -- Why it was closed. Not NOT NULL: locking is the safe direction, and
    -- demanding a justification to make something *safer* is friction pointed
    -- the wrong way.
    note       TEXT
);
