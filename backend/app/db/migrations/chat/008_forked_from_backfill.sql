-- Forks made before 007: a fork copies its parent's answers with their
-- query_id, so the parent is the newest older chat sharing one. A fork cut
-- before the first answer shares none and stays at the top level.
UPDATE chat_sessions
   SET forked_from = (
       SELECT s2.session_id
         FROM chat_messages m1
         JOIN chat_messages m2 ON m2.query_id = m1.query_id AND m2.session_id <> m1.session_id
         JOIN chat_sessions s2 ON s2.session_id = m2.session_id
        WHERE m1.session_id = chat_sessions.session_id
          AND m1.query_id IS NOT NULL
          AND s2.created_at < chat_sessions.created_at
        ORDER BY s2.created_at DESC
        LIMIT 1)
 WHERE title LIKE 'Fork: %' AND forked_from IS NULL;
