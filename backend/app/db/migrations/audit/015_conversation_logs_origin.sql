-- Where a turn was asked from. `origin` is 'web' (the Daedalus web app,
-- `/api/chat`), 'mainui' (CO2SorptionDT's Daedalus tab, `/api/rig-chat`, behind
-- a rig token) or 'eval' (the evaluation harness). Set by the route the question
-- arrived on, never by anything the client says about itself. `origin_label` is
-- the rig token's name for 'mainui' ("Lab PC MainUI"), so it says which machine.
-- Both NULL on rows written before this: shown as "unknown", not guessed.
ALTER TABLE conversation_logs ADD COLUMN origin TEXT;
ALTER TABLE conversation_logs ADD COLUMN origin_label TEXT;
