-- Which chat a fork was copied from, so the sidebar can file forks under their
-- original instead of listing every edit, retry and rerun as a chat of its own.
-- NULL for a chat that is not a fork. Not a foreign key: deleting the original
-- leaves its forks standing, and the sidebar then shows them at the top level.
ALTER TABLE chat_sessions ADD COLUMN forked_from TEXT;
