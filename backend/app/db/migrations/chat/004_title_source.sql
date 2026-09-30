-- Who named a chat, so an automatic title never overwrites the operator's.
--
-- A title used to be the first user message, cut to 60 characters, and never
-- revisited. That labels a conversation by its opening line, which is the one
-- part of a long troubleshooting session least likely to describe it. Titles
-- are now written by a background model job (`services/session_titles.py`)
-- after an answer, and optionally refreshed as the chat grows.
--
--   title_source  'first_message'  derived from the opening question — the
--                                  placeholder until the job has run
--                 'model'          written by the title job
--                 'user'           typed by the operator; the job never
--                                  touches these again
--                 NULL             no title yet, or one cleared by the operator
--                                  (which hands the chat back to the job)
--   title_turns   how many operator turns the chat had when the job last named
--                 it — what "refresh every N turns" counts from
--
-- Existing titles are all first-message derived or typed, and nothing recorded
-- which. Marking them 'first_message' lets the job improve them; a hand-typed
-- one that gets retitled can be renamed back, and is then 'user' for good.
ALTER TABLE chat_sessions ADD COLUMN title_source TEXT;
ALTER TABLE chat_sessions ADD COLUMN title_turns INTEGER NOT NULL DEFAULT 0;

UPDATE chat_sessions SET title_source = 'first_message' WHERE title IS NOT NULL;
