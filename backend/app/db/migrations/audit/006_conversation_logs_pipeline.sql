-- What the query pipeline decided before any model ran (PROJECT.md §7.1 steps
-- 2-4), so the evaluation can separate "understood the question" from
-- "answered it".
--
-- `intent` already exists on this table. These record how it was reached and
-- whether the guard stopped the turn:
--
--   standalone_query  the question after follow-up rewriting; equals the
--                     normalised query when nothing was rewritten
--   rewrite_method    'none' | 'rules' | 'model' — how the rewrite was made
--   intent_method     'rules' | 'model' — the model is a tiebreaker only
--   guard_reason      NULL, or why the safety guard refused: 'control_command'
--                     | 'data_write' | 'instruction_override'
--
-- A refused turn is still a row: "the guard blocked N% of control phrasings"
-- is a result the report needs, and it can only be counted if refusals are
-- recorded the same way answers are.
ALTER TABLE conversation_logs ADD COLUMN standalone_query TEXT;
ALTER TABLE conversation_logs ADD COLUMN rewrite_method TEXT;
ALTER TABLE conversation_logs ADD COLUMN intent_method TEXT;
ALTER TABLE conversation_logs ADD COLUMN guard_reason TEXT;
