-- Open the four extended effects by default.
--
-- 004 shipped them closed on the reasoning that an unlock should be deliberate.
-- That reasoning assumed a system with more than one person in it: somebody
-- configuring a capability and somebody else running into it later. Daedalus is
-- a single-operator console — the person who would unlock these is the person
-- reading this file, and making them click four buttons to reach tools they
-- built is friction that protects nobody.
--
-- What 004's machinery is still for, and why it is not being deleted:
--
--   * The gate still runs on every dispatch, so the *mechanism* that keeps a
--     tool out of the runtime is tested rather than theoretical.
--   * `PROJECT.md` §3's configuration is now one click away rather than the
--     default — Lock all, in Settings → Agent Tools — which is what to do before
--     recording a groundedness number intended for the write-up.
--   * `unlocked_at` and `note` still answer "what was this system allowed to do
--     when that benchmark was recorded?", which is the question that made the
--     table worth having in the first place.
--
-- Seeded with `OR IGNORE`, so an operator who has already locked something and
-- re-runs migrations does not get it silently reopened.

INSERT OR IGNORE INTO tool_policy (effect, unlocked_at, note) VALUES
    ('network_egress', '1970-01-01T00:00:00+00:00',
     'Open by default: single-operator console, and the operator is the admin.'),
    ('write',          '1970-01-01T00:00:00+00:00',
     'Open by default: single-operator console, and the operator is the admin.'),
    ('admin',          '1970-01-01T00:00:00+00:00',
     'Open by default: single-operator console, and the operator is the admin.'),
    ('execute_code',   '1970-01-01T00:00:00+00:00',
     'Open by default: single-operator console, and the operator is the admin.');
