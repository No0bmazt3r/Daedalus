-- Per-tool on/off, which is a different axis from 006's effect locks.
--
-- 006 answers "may anything touch the network?". This answers "do I want the
-- model to be offered `web_fetch` at all?" — a preference about the tool list
-- the model reasons over, not a claim about what this machine is permitted to
-- do. Both had to exist: closing `network_egress` to silence one noisy tool
-- also closes the three others that share the effect, and turning a single tool
-- off says nothing about the safety envelope the write-up cites.
--
-- Same inversion as 006, for the same reason: the row records what is **off**,
-- so an empty table means every registered tool is offered, "enable all" is a
-- delete, and the default cannot be lost by a migration that runs once.
--
-- No CHECK on the name. Tool names live in the registry decorators, and a list
-- of them copied into SQL is a second source of truth that goes stale the first
-- time one is renamed — the API rejects an unknown name against the registry
-- itself before this table ever sees it. A row for a tool that later disappears
-- is harmless: nothing reads it, and re-registering the name restores its
-- meaning rather than resurrecting a setting nobody chose.
CREATE TABLE IF NOT EXISTS tool_disabled (
    tool         TEXT PRIMARY KEY,
    disabled_at  TEXT NOT NULL,
    -- Why it was turned off. Optional, like 006's: making somebody justify
    -- narrowing what the model may do is friction pointed the wrong way.
    note         TEXT
);
